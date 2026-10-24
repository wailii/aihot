package com.xiaodeng.aihot

import android.Manifest
import android.app.Activity
import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.Icon
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.PowerManager
import android.os.SystemClock
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.os.VibrationAttributes
import android.os.VibrationEffect
import android.os.Vibrator
import android.provider.Settings
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Locale

/**
 * Codex 额度重置监控。
 * 精确闹钟每 5 分钟把 App 叫醒查一次（需要精确闹钟、电池不限制、vivo 允许后台高耗电），JobScheduler 再兜一层。
 * 不用前台服务：安卓不许藏前台服务的常驻通知。悬浮窗权限只用来在后台把提醒页弹到最前，不挂窗口。
 * 有新消息就发全屏提醒：亮屏、锁屏上显示、持续震动到点「知道了」，不出声。
 */
object CodexWatch {
    const val CH_ALERT = "codex_alert"
    private const val OLD_WATCH = "codex_watch"
    private const val OLD_WATCH_QUIET = "codex_watch_quiet"
    const val CH_LOG = "codex_log"
    const val CH_KEEP = "codex_keep"
    private const val OLD_CHANNEL = "codex_reset"
    private const val JOB_PERIODIC = 1
    private const val JOB_NOW = 2
    const val INTERVAL = 5 * 60 * 1000L
    private const val PREFS = "codex_watch"
    private const val URL_RECENT = "https://aihot.news/api/v1/codex-resets/recent"
    private const val URL_SITE = "https://aihot.news/api/site/codex-reset"

    data class Event(val id: String, val title: String, val label: String, val status: String,
                     val scheduleLabel: String?, val scheduleFrom: Long?, val lastPost: String?)

    fun ensureChannels(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        // 频道建好后声音改不了，旧的带铃声频道直接删掉
        nm.getNotificationChannel(OLD_CHANNEL)?.let { nm.deleteNotificationChannel(OLD_CHANNEL) }
        // 旧的常驻频道是显示的；前台服务还占着它时删不掉，所以包一层
        for (old in listOf(OLD_WATCH, OLD_WATCH_QUIET)) try { nm.getNotificationChannel(old)?.let { nm.deleteNotificationChannel(old) } } catch (_: Exception) {}
        if (nm.getNotificationChannel(CH_ALERT) == null) {
            nm.createNotificationChannel(NotificationChannel(CH_ALERT, "Codex 重置提醒", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Tibo 发布 Codex 用量重置的预告、确认或撤回时，全屏提醒并持续震动，不出声"
                setSound(null, null)
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 900, 300, 900, 300, 900)
                enableLights(true)
                lightColor = Color.rgb(255, 90, 0)
                lockscreenVisibility = Notification.VISIBILITY_PUBLIC
                setShowBadge(true)
            })
        }
        if (nm.getNotificationChannel(CH_KEEP) == null) {
            nm.createNotificationChannel(NotificationChannel(CH_KEEP, "后台运行", NotificationManager.IMPORTANCE_MIN).apply {
                description = "让系统清内存时不把 App 停掉；这条通知可以直接划掉"
                setSound(null, null)
                enableVibration(false)
                setShowBadge(false)
            })
        }
        if (nm.getNotificationChannel(CH_LOG) == null) {
            nm.createNotificationChannel(NotificationChannel(CH_LOG, "重置记录", NotificationManager.IMPORTANCE_LOW).apply {
                description = "全屏提醒弹出后，留在通知栏里的那条记录"
                setSound(null, null)
                enableVibration(false)
            })
        }
    }

    // ── 权限自检 ──
    fun notifOn(ctx: Context): Boolean {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        val ch = nm.getNotificationChannel(CH_ALERT)
        return ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED &&
            nm.areNotificationsEnabled() && (ch == null || ch.importance != NotificationManager.IMPORTANCE_NONE)
    }
    fun fsiOn(ctx: Context) = ctx.getSystemService(NotificationManager::class.java).canUseFullScreenIntent()
    fun overlayOn(ctx: Context) = Settings.canDrawOverlays(ctx)
    fun exactOn(ctx: Context) = ctx.getSystemService(AlarmManager::class.java).canScheduleExactAlarms()
    fun batteryOn(ctx: Context) = ctx.getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(ctx.packageName)

    fun status(ctx: Context): String {
        val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return JSONObject().apply {
            put("notif", notifOn(ctx)); put("fsi", fsiOn(ctx)); put("overlay", overlayOn(ctx))
            put("exact", exactOn(ctx)); put("battery", batteryOn(ctx))
            put("next", p.getLong("nextAlarm", 0))
            put("lastCheck", p.getLong("lastCheck", 0)); put("lastError", p.getString("lastError", "") ?: "")
        }.toString()
    }

    /** 打开对应权限的系统设置页 */
    fun openSetting(a: Activity, kind: String) {
        val pkg = Uri.parse("package:${a.packageName}")
        val i = when (kind) {
            "fsi" -> Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, pkg)
            "overlay" -> Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, pkg)
            "exact" -> Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, pkg)
            "battery" -> Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, pkg)
            "notif" -> Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
                .putExtra(Settings.EXTRA_APP_PACKAGE, a.packageName).putExtra(Settings.EXTRA_CHANNEL_ID, CH_ALERT)
            "notifstyle" -> Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, a.packageName)
            // vivo：锁屏显示、后台弹出界面、关联启动都在这一页
            "vivo" -> Intent().setClassName("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.SoftPermissionDetailActivity")
                .putExtra("packagename", a.packageName)
            else -> Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, pkg)
        }
        try { a.startActivity(i) } catch (_: Exception) {
            a.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, pkg))
        }
    }

    // ── 排班：服务 + 闹钟 + Job ──
    fun startAll(ctx: Context) {
        ensureChannels(ctx)
        keepAlive(ctx)
        scheduleAlarm(ctx)
        // 打开 App 时顺手查一次
        Thread { try { check(ctx) } catch (_: Exception) {} }.start()
        try { scheduleJobs(ctx) } catch (_: Exception) {}
    }

    /** vivo 内存紧张时会直接「强行停止」后台 App，连闹钟一起清掉；挂一个前台服务它就不停 */
    fun keepAlive(ctx: Context) {
        // 已经在跑就别再启动，不然每次都会把划掉的通知重新挂出来
        if (WatchService.running) return
        try { ctx.startForegroundService(Intent(ctx, WatchService::class.java)) } catch (_: Exception) {}
    }

    fun scheduleAlarm(ctx: Context) {
        val am = ctx.getSystemService(AlarmManager::class.java)
        val pi = PendingIntent.getBroadcast(ctx, 9, Intent(ctx, AlarmReceiver::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val at = System.currentTimeMillis() + INTERVAL
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putLong("nextAlarm", at).apply()
        if (am.canScheduleExactAlarms()) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
        else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
    }

    private fun scheduleJobs(ctx: Context) {
        val js = ctx.getSystemService(JobScheduler::class.java)
        val cn = ComponentName(ctx, CodexJob::class.java)
        if (js.getPendingJob(JOB_PERIODIC) == null) {
            js.schedule(JobInfo.Builder(JOB_PERIODIC, cn).setPeriodic(15 * 60 * 1000L)
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setPersisted(true).build())
        }
        js.schedule(JobInfo.Builder(JOB_NOW, cn).setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setOverrideDeadline(5000).build())
    }

    // ── 拉数据 ──
    private fun get(url: String): JSONObject {
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = 10000
        c.readTimeout = 15000
        c.setRequestProperty("Accept", "application/json")
        c.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 16) AIHotApp/0.4")
        try {
            return JSONObject(c.inputStream.bufferedReader().use { it.readText() })
        } finally {
            c.disconnect()
        }
    }

    private fun parseTime(s: String?): Long? {
        if (s.isNullOrEmpty()) return null
        for (p in listOf("yyyy-MM-dd'T'HH:mm:ss.SSSXXX", "yyyy-MM-dd'T'HH:mm:ssXXX")) {
            try { return SimpleDateFormat(p, Locale.US).parse(s)?.time } catch (_: Exception) {}
        }
        return null
    }

    private fun parse(o: JSONObject?): Event? {
        if (o == null || !o.has("id")) return null
        val posts = o.optJSONArray("posts")
        val last = if (posts != null && posts.length() > 0) posts.getJSONObject(posts.length() - 1) else null
        val sch = o.optJSONObject("schedule")
        return Event(
            id = o.getString("id"),
            title = o.optString("title").ifEmpty { o.optString("label") },
            label = o.optString("displayLabel").ifEmpty { o.optString("label") },
            status = o.optString("status"),
            scheduleLabel = sch?.optString("label")?.takeIf { it.isNotEmpty() },
            scheduleFrom = parseTime(sch?.optString("from")),
            lastPost = last?.optString("text")?.takeIf { it.isNotEmpty() },
        )
    }

    private val lock = Any()

    /** 拉接口、对比已读，有新消息就提醒。返回发了几条。 */
    fun check(ctx: Context): Int = synchronized(lock) {
        val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val wl = ctx.getSystemService(PowerManager::class.java).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "aihot:codex")
        wl.acquire(30_000)
        try {
            val events = mutableListOf<Event>()
            get(URL_RECENT).optJSONArray("events")?.let { arr -> for (i in 0 until arr.length()) parse(arr.getJSONObject(i))?.let(events::add) }
            try { parse(get(URL_SITE).optJSONObject("current"))?.let { cur -> if (events.none { it.id == cur.id }) events.add(0, cur) } } catch (_: Exception) {}
            val seen = prefs.getStringSet("seen", emptySet())!!.toMutableSet()
            val seeded = prefs.getBoolean("seeded", false)
            var sent = 0
            for (e in events) {
                // 同一条事件状态变了（预告 → 确认 / 撤回）也算新消息
                val key = "${e.id}|${e.status}"
                if (key in seen) continue
                seen.add(key)
                if (seeded) { alert(ctx, e, false); sent++ }
            }
            // 最近 80 次检查的时间（秒），排查后台有没有断过
            val now = System.currentTimeMillis()
            val hist = (prefs.getString("checks", "") ?: "").split(",").filter { it.isNotEmpty() }.takeLast(79) + (now / 1000).toString()
            prefs.edit().putStringSet("seen", seen).putBoolean("seeded", true)
                .putLong("lastCheck", now).putString("checks", hist.joinToString(",")).putString("lastError", "").apply()
            sent
        } catch (e: Exception) {
            prefs.edit().putString("lastError", e.javaClass.simpleName).apply()
            throw e
        } finally {
            if (wl.isHeld) wl.release()
        }
    }

    fun testAlert(ctx: Context, delayMs: Long) {
        Handler(ctx.mainLooper).postDelayed({
            Thread {
                val e = try { parse(get(URL_RECENT).optJSONArray("events")?.optJSONObject(0)) } catch (_: Exception) { null }
                    ?: Event("test", "Tibo 确认重置", "全员重置", "confirmed", null, null, "这是一条测试提醒")
                alert(ctx, e, true)
            }.start()
        }, delayMs)
    }

    fun statusZh(s: String) = when (s) {
        "confirmed" -> "已落地"
        "retracted", "cancelled" -> "已撤回"
        "announced", "forecast", "pending" -> "已预告"
        else -> "有新进展"
    }

    fun alertId(e: Event) = e.id.hashCode()

    /** 最高级别提醒：全屏页（亮屏、锁屏上显示）+ 反复震动的横幅，不出声 */
    private fun alert(ctx: Context, e: Event, test: Boolean) {
        if (!notifOn(ctx)) return
        ensureChannels(ctx)
        val title = (if (test) "【测试】" else "") + "Codex 重置${statusZh(e.status)}：${e.title}"
        val body = listOfNotNull(e.label.takeIf { it.isNotEmpty() }, e.scheduleLabel, e.lastPost?.let { "“$it”" }).joinToString("\n")
        val id = alertId(e)
        val full = Intent(ctx, AlertActivity::class.java)
            .putExtra("title", title).putExtra("body", body).putExtra("id", id)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_USER_ACTION)
        val fullPi = PendingIntent.getActivity(ctx, id, full, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val openPi = PendingIntent.getActivity(ctx, id + 1,
            Intent(ctx, MainActivity::class.java).putExtra("tab", "reset").putExtra("ack", id).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val ackPi = PendingIntent.getBroadcast(ctx, id + 2, Intent(ctx, AckReceiver::class.java).putExtra("id", id),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val icon = Icon.createWithResource(ctx, R.drawable.ic_stat)
        val b = Notification.Builder(ctx, CH_ALERT)
            .setSmallIcon(icon)
            .setContentTitle(title)
            .setContentText(body.lineSequence().firstOrNull() ?: "")
            .setStyle(Notification.BigTextStyle().bigText(body))
            .setCategory(Notification.CATEGORY_ALARM)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setColor(Color.rgb(255, 90, 0))
            .setFullScreenIntent(fullPi, true)
            .setContentIntent(openPi)
            .setDeleteIntent(ackPi)
            .addAction(Notification.Action.Builder(icon, "知道了", ackPi).build())
            .setAutoCancel(true)
            .setShowWhen(true)
        ctx.getSystemService(NotificationManager::class.java).notify(id, b.build())
        // 不管系统给不给「全屏通知」：后台服务自己长震不停，点亮屏幕，有悬浮窗权限就直接把提醒页拉到最前
        Buzzer.start(ctx)
        val pm = ctx.getSystemService(PowerManager::class.java)
        @Suppress("DEPRECATION")
        pm.newWakeLock(PowerManager.FULL_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP or PowerManager.ON_AFTER_RELEASE, "aihot:wake").acquire(15_000)
        if (Settings.canDrawOverlays(ctx)) try { ctx.startActivity(full) } catch (_: Exception) {}
    }

    /** 全屏页已经亮出来了：把反复震动的横幅换成通知栏里一条安静的记录，免得挡住提醒页 */
    fun quiet(ctx: Context, id: Int, title: String, body: String) {
        val open = PendingIntent.getActivity(ctx, id + 1,
            Intent(ctx, MainActivity::class.java).putExtra("tab", "reset").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val n = Notification.Builder(ctx, CH_LOG)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentTitle(title)
            .setContentText(body.lineSequence().firstOrNull() ?: "")
            .setStyle(Notification.BigTextStyle().bigText(body))
            .setColor(Color.rgb(255, 90, 0))
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()
        ctx.getSystemService(NotificationManager::class.java).notify(id, n)
    }

    fun ack(ctx: Context, id: Int) {
        Buzzer.stop()
        ctx.getSystemService(NotificationManager::class.java).cancel(id)
        AlertActivity.current?.finish()
    }
}

/** 精确闹钟：每 5 分钟把 App 叫醒查一次，查完就退，不留常驻通知 */
class AlarmReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        CodexWatch.scheduleAlarm(ctx)
        CodexWatch.keepAlive(ctx)
        val r = goAsync()
        Thread { try { CodexWatch.check(ctx) } catch (_: Exception) {} finally { r.finish() } }.start()
    }
}

/** 开机、更新后恢复 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) = CodexWatch.startAll(ctx)
}

class AckReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) = CodexWatch.ack(ctx, intent.getIntExtra("id", 0))
}

/** 前台服务本身什么都不干，只为让系统把 App 当成「正在用」，不在清内存时强行停止；检查还是靠闹钟 */
class WatchService : android.app.Service() {
    companion object { @Volatile var running = false }

    override fun onBind(intent: Intent?) = null

    override fun onDestroy() {
        running = false
        super.onDestroy()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        CodexWatch.ensureChannels(this)
        val open = PendingIntent.getActivity(this, 77, Intent(this, MainActivity::class.java).putExtra("tab", "reset")
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val n = Notification.Builder(this, CodexWatch.CH_KEEP)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentTitle("AI 热点在后台盯 Codex 重置")
            .setContentIntent(open)
            .setShowWhen(false)
            .setOngoing(false)
            .build()
        try {
            startForeground(31, n, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
            running = true
        } catch (_: Exception) { stopSelf(); return START_NOT_STICKY }
        return START_STICKY
    }
}

class CodexJob : JobService() {
    override fun onStartJob(params: JobParameters): Boolean {
        Thread {
            var retry = false
            try { CodexWatch.check(this) } catch (_: Exception) { retry = true }
            jobFinished(params, retry)
        }.start()
        return true
    }

    override fun onStopJob(params: JobParameters) = true
}

/**
 * 持续震动：1.6 秒长震、停 0.25 秒，最大强度，按闹钟级别（静音模式也震），一直循环到点「知道了」、
 * 点开或划掉通知为止，最长 10 分钟。
 */
object Buzzer {
    private var vib: Vibrator? = null
    private val h = Handler(android.os.Looper.getMainLooper())
    @Volatile var active = false

    /** 提醒方式，存在 codex_watch 里；时长单位秒，0 = 关 */
    data class Config(val vibSec: Int, val vibStyle: String, val flashSec: Int, val flashStyle: String)
    private val KEYS = mapOf("vibSec" to "60", "vibStyle" to "long", "flashSec" to "60", "flashStyle" to "triple")

    fun config(ctx: Context): Config {
        val p = ctx.getSharedPreferences("codex_watch", Context.MODE_PRIVATE)
        fun g(k: String) = p.getString("cfg_$k", null) ?: KEYS.getValue(k)
        return Config((g("vibSec").toIntOrNull() ?: 60).coerceIn(0, 300), g("vibStyle"), (g("flashSec").toIntOrNull() ?: 60).coerceIn(0, 180), g("flashStyle"))
    }
    fun configJson(ctx: Context): String = config(ctx).let {
        JSONObject().put("vibSec", it.vibSec).put("vibStyle", it.vibStyle).put("flashSec", it.flashSec).put("flashStyle", it.flashStyle).toString()
    }
    fun setConfig(ctx: Context, key: String, value: String) {
        if (key !in KEYS) return
        ctx.getSharedPreferences("codex_watch", Context.MODE_PRIVATE).edit().putString("cfg_$key", value).apply()
    }

    // 震感：长震 / 心跳 / 急促（波形里 0 毫秒起步，第三个参数 0 = 从头循环）
    private fun wave(style: String): VibrationEffect = when (style) {
        "pulse" -> VibrationEffect.createWaveform(longArrayOf(0, 180, 120, 180, 900), intArrayOf(0, 255, 0, 255, 0), 0)
        "rapid" -> VibrationEffect.createWaveform(longArrayOf(0, 260, 140), intArrayOf(0, 255, 0), 0)
        else -> VibrationEffect.createWaveform(longArrayOf(0, 1600, 250), intArrayOf(0, 255, 0), 0)
    }
    // 闪法：亮、灭交替的毫秒数
    private fun flashPattern(style: String) = when (style) {
        "strobe" -> longArrayOf(70, 70)
        "slow" -> longArrayOf(600, 600)
        else -> longArrayOf(120, 120, 120, 120, 120, 1200)
    }

    private var cam: CameraManager? = null
    private var torchId: String? = null
    private var flashUntil = 0L
    private var pattern = flashPattern("triple")
    private var step = 0
    private val flash = object : Runnable {
        override fun run() {
            if (torchId == null) return
            if (!active || SystemClock.elapsedRealtime() > flashUntil) { torch(false); return }
            torch(step % 2 == 0)
            h.postDelayed(this, pattern[step % pattern.size])
            step++
        }
    }

    private fun torch(on: Boolean) {
        val id = torchId ?: return
        try { cam?.setTorchMode(id, on) } catch (_: Exception) {}
    }

    /** 真提醒：按用户配的时长和样式来 */
    fun start(ctx: Context) {
        val c = config(ctx)
        run(ctx, c.vibSec * 1000L, c.vibStyle, c.flashSec * 1000L, c.flashStyle)
    }

    /** 设置页里点样式时试 3 秒 */
    fun preview(ctx: Context, kind: String, style: String) {
        if (kind == "vib") run(ctx, 3000, style, 0, "triple") else run(ctx, 0, "long", 3000, style)
    }

    private fun run(ctx: Context, vibMs: Long, vibStyle: String, flashMs: Long, flashStyle: String) {
        val app = ctx.applicationContext
        stop()
        if (vibMs <= 0 && flashMs <= 0) return
        active = true
        if (vibMs > 0) {
            val v = app.getSystemService(Vibrator::class.java)
            vib = v
            v?.vibrate(wave(vibStyle), VibrationAttributes.createForUsage(VibrationAttributes.USAGE_ALARM))
            h.postDelayed({ vib?.cancel() }, vibMs)
        }
        if (flashMs > 0) {
            cam = app.getSystemService(CameraManager::class.java)
            torchId = try {
                cam?.cameraIdList?.firstOrNull { cam?.getCameraCharacteristics(it)?.get(CameraCharacteristics.FLASH_INFO_AVAILABLE) == true }
            } catch (_: Exception) { null }
            pattern = flashPattern(flashStyle)
            flashUntil = SystemClock.elapsedRealtime() + flashMs
            step = 0
            h.post(flash)
        }
        h.postDelayed({ stop() }, maxOf(vibMs, flashMs) + 50)
    }

    fun stop() {
        active = false
        vib?.cancel()
        h.removeCallbacksAndMessages(null)
        torch(false)
    }
}

/** 全屏提醒：亮屏、锁屏上直接显示，点「知道了」才停震 */
class AlertActivity : Activity() {
    companion object { var current: AlertActivity? = null }


    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        current = this
        setShowWhenLocked(true)
        setTurnScreenOn(true)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        val id = intent.getIntExtra("id", 0)
        CodexWatch.quiet(this, id, intent.getStringExtra("title") ?: "Codex 重置", intent.getStringExtra("body") ?: "")
        val dp = { v: Float -> TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, resources.displayMetrics).toInt() }
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.rgb(250, 248, 244))
            setPadding(dp(28f), dp(96f), dp(28f), dp(48f))
        }
        val tag = TextView(this).apply {
            text = "● Codex 额度重置"
            setTextColor(Color.rgb(255, 90, 0))
            textSize = 14f
            typeface = Typeface.MONOSPACE
        }
        val title = TextView(this).apply {
            text = intent.getStringExtra("title") ?: "Codex 重置"
            setTextColor(Color.rgb(22, 16, 12))
            textSize = 30f
            typeface = Typeface.DEFAULT_BOLD
            setPadding(0, dp(14f), 0, 0)
        }
        val body = TextView(this).apply {
            text = intent.getStringExtra("body") ?: ""
            setTextColor(Color.rgb(106, 95, 87))
            textSize = 17f
            setLineSpacing(0f, 1.4f)
            setPadding(0, dp(16f), 0, 0)
        }
        val space = View(this)
        fun btn(label: String, dark: Boolean, onTap: () -> Unit) = TextView(this).apply {
            text = label
            gravity = Gravity.CENTER
            textSize = 17f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(if (dark) Color.WHITE else Color.rgb(22, 16, 12))
            background = GradientDrawable().apply {
                cornerRadius = dp(16f).toFloat()
                setColor(if (dark) Color.rgb(22, 16, 12) else Color.rgb(239, 232, 223))
            }
            setOnClickListener { onTap() }
        }
        root.addView(tag)
        root.addView(title)
        root.addView(body)
        root.addView(space, LinearLayout.LayoutParams(1, 0, 1f))
        root.addView(btn("打开 AI 热点", false) {
            CodexWatch.ack(this, id)
            startActivity(Intent(this, MainActivity::class.java).putExtra("tab", "reset").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP))
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(56f)).apply { bottomMargin = dp(12f) })
        root.addView(btn("知道了", true) { CodexWatch.ack(this, id) },
            LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(56f)))
        setContentView(root)

        // 震动由 Buzzer 负责（服务里就开始了），这里只确保在震
        if (!Buzzer.active) Buzzer.start(this)
    }

    override fun onDestroy() {
        if (current === this) current = null
        super.onDestroy()
    }
}
