package com.xiaodeng.aihot

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.view.WindowInsets
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.window.OnBackInvokedDispatcher
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale
import java.util.concurrent.Executors

/**
 * 外壳只做网页做不了的事：系统语音朗读、打开原文、系统分享、返回键、刘海和手势条的安全区。
 * 页面本身在 assets/www，数据直接从 aihot.news 公开接口拿。
 */
class MainActivity : Activity(), TextToSpeech.OnInitListener {
    private lateinit var web: WebView
    private var tts: TextToSpeech? = null

    // init：还在连语音引擎；ok：能读；none：手机上没有语音引擎；nolang：引擎不支持中文
    @Volatile private var ttsState = "init"
    private val io = Executors.newFixedThreadPool(6)
    private var insetTop = 0f
    private var insetBottom = 0f

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.setDecorFitsSystemWindows(false)

        web = WebView(this)
        web.setBackgroundColor(0xFFFAF8F4.toInt())
        with(web.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = true
            mediaPlaybackRequiresUserGesture = false
            textZoom = 100
        }
        web.addJavascriptInterface(Bridge(), "AndroidBridge")
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url
                if (url.scheme == "http" || url.scheme == "https") {
                    openExternal(url)
                    return true
                }
                return false
            }

            override fun onPageFinished(view: WebView, url: String) {
                pushInsets()
                openTabFromIntent(intent)
            }
        }
        web.setOnApplyWindowInsetsListener { v, insets ->
            val bars = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
            val d = resources.displayMetrics.density
            insetTop = bars.top / d
            insetBottom = bars.bottom / d
            pushInsets()
            v.onApplyWindowInsets(insets)
        }
        setContentView(web)
        web.loadUrl("file:///android_asset/www/index.html")
        val at = getSharedPreferences("codex_watch", MODE_PRIVATE).getLong("resumeWatch", 0)
        resumeWatch = System.currentTimeMillis() - at < 10 * 60 * 1000L

        onBackInvokedDispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT) { goBack("gesture") }

        tts = TextToSpeech(this, this)

        // Codex 重置通知：第一次打开就要通知权限，并排好每 15 分钟的检查
        CodexWatch.ensureChannels(this)
        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQ_NOTIF)
        }
        // 后台盯梢（服务 + 闹钟 + Job）起不来也不能拖垮整个 App
        try { CodexWatch.startAll(this) } catch (e: Exception) { android.util.Log.w("AIHot", "start codex watch failed", e) }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        openTabFromIntent(intent)
    }

    /** 点重置通知进来时直接切到「模型」页 */
    private fun openTabFromIntent(i: Intent?) {
        // 点重置通知进来：先停震
        i?.getIntExtra("ack", 0)?.takeIf { it != 0 }?.let { CodexWatch.ack(this, it); i.removeExtra("ack") }
        val tab = i?.getStringExtra("tab") ?: return
        i.removeExtra("tab")
        web.evaluateJavascript("window.switchTab && switchTab('$tab')", null)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQ_NOTIF) js("window.__wtRefresh && __wtRefresh()")
    }

    override fun onResume() {
        super.onResume()
        getSharedPreferences("codex_watch", MODE_PRIVATE).edit().remove("resumeWatch").apply()
        // 从系统设置改完权限回来，刷新自检；服务被杀过也在这里拉起
        if (::web.isInitialized) js("window.__wtRefresh && __wtRefresh(); window.rerenderTab && S && S.tab === 'reset' && !S.stack.length && rerenderTab('reset')")
        try { CodexWatch.startAll(this) } catch (_: Exception) {}
    }

    companion object { private const val REQ_NOTIF = 7 }

    private fun pushInsets() {
        if (!::web.isInitialized) return
        web.evaluateJavascript("window.__insets && window.__insets($insetTop, $insetBottom)", null)
    }

    // 网页报上来的页面层数和当前 Tab；网页没接住返回时，只有停在精选首页才退出
    @Volatile private var resumeWatch = false
    @Volatile private var navDepth = 0
    @Volatile private var navTab = "feed"

    private fun goBack(src: String) {
        val canStay = navDepth > 0 || navTab != "feed"
        web.evaluateJavascript("window.__back ? window.__back() : false") { handled ->
            getSharedPreferences("codex_watch", MODE_PRIVATE).edit()
                .putString("lastBack", "${System.currentTimeMillis()} $src handled=$handled depth=$navDepth tab=$navTab").apply()
            if (handled != "true" && !canStay) finish()
        }
    }

    @Deprecated("OnBackInvokedCallback 没生效的系统上走这里")
    override fun onBackPressed() = goBack("key")

    private fun js(code: String) = runOnUiThread { web.evaluateJavascript(code, null) }

    override fun onInit(status: Int) {
        val engine = tts
        if (status != TextToSpeech.SUCCESS || engine == null || engine.engines.isEmpty()) {
            ttsState = "none"
            return
        }
        val lang = engine.setLanguage(Locale.SIMPLIFIED_CHINESE)
        ttsState = if (lang == TextToSpeech.LANG_MISSING_DATA || lang == TextToSpeech.LANG_NOT_SUPPORTED) "nolang" else "ok"
        engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(id: String) {}
            override fun onDone(id: String) = js("window.__ttsDone && window.__ttsDone('$id')")
            @Deprecated("Deprecated in Java")
            override fun onError(id: String) = js("window.__ttsDone && window.__ttsDone('$id')")
            override fun onError(id: String, errorCode: Int) = js("window.__ttsDone && window.__ttsDone('$id')")
            override fun onStop(id: String, interrupted: Boolean) = js("window.__ttsDone && window.__ttsDone('$id')")
        })
    }

    private fun openExternal(uri: Uri) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (_: Exception) {
        }
    }

    inner class Bridge {
        @JavascriptInterface fun ttsStatus(): String = ttsState

        @JavascriptInterface fun ttsEngine(): String = tts?.defaultEngine ?: ""

        @JavascriptInterface fun speak(id: String, text: String, rate: Float) {
            val engine = tts ?: return
            engine.setSpeechRate(rate)
            engine.speak(text, TextToSpeech.QUEUE_FLUSH, null, id)
        }

        @JavascriptInterface fun stopSpeak() {
            tts?.stop()
        }

        /** 网页版站内接口没有跨域头，WebView 里请求不到，由这里代为请求后回传文本 */
        @JavascriptInterface fun fetch(id: String, url: String) {
            if (!url.startsWith("https://aihot.news/")) { js("window.__fetchDone && window.__fetchDone('$id', 400, '')"); return }
            io.execute {
                var code = 0
                var body = ""
                try {
                    val c = URL(url).openConnection() as HttpURLConnection
                    c.connectTimeout = 10000
                    c.readTimeout = 15000
                    c.setRequestProperty("Accept", "application/json")
                    c.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 16) AIHotApp/0.2")
                    code = c.responseCode
                    body = (if (code in 200..299) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
                    c.disconnect()
                } catch (_: Exception) {
                    code = 0
                }
                js("window.__fetchDone && window.__fetchDone('$id', $code, ${JSONObject.quote(body)})")
            }
        }

        /** 翻译用的大模型接口（OpenAI 兼容格式），Key 只存在本机 */
        @JavascriptInterface fun llmConfig(): String {
            val p = getSharedPreferences("llm", MODE_PRIVATE)
            val key = p.getString("key", "") ?: ""
            return JSONObject().put("preset", p.getString("preset", "") ?: "").put("base", p.getString("base", "") ?: "")
                .put("model", p.getString("model", "") ?: "").put("hasKey", key.isNotEmpty())
                .put("keyTail", if (key.length > 4) key.takeLast(4) else "").toString()
        }

        /** key 传空串表示不改原来的 Key */
        @JavascriptInterface fun setLlmConfig(preset: String, base: String, key: String, model: String) {
            val e = getSharedPreferences("llm", MODE_PRIVATE).edit()
                .putString("preset", preset).putString("base", base.trim()).putString("model", model.trim())
            if (key.isNotBlank()) e.putString("key", key.trim())
            e.apply()
        }

        @JavascriptInterface fun llm(id: String, system: String, user: String) {
            val p = getSharedPreferences("llm", MODE_PRIVATE)
            val base = p.getString("base", "") ?: ""
            val key = p.getString("key", "") ?: ""
            val model = p.getString("model", "") ?: ""
            io.execute {
                var code = 0
                var body = ""
                try {
                    val b = base.trimEnd('/')
                    val url = if (b.endsWith("/chat/completions")) b else "$b/chat/completions"
                    val payload = JSONObject().put("model", model).put("temperature", 0.2).put("stream", false)
                        .put("messages", org.json.JSONArray()
                            .put(JSONObject().put("role", "system").put("content", system))
                            .put(JSONObject().put("role", "user").put("content", user)))
                    val c = URL(url).openConnection() as HttpURLConnection
                    c.requestMethod = "POST"
                    c.doOutput = true
                    c.connectTimeout = 15000
                    c.readTimeout = 120000
                    c.setRequestProperty("Content-Type", "application/json")
                    c.setRequestProperty("Authorization", "Bearer $key")
                    c.outputStream.use { it.write(payload.toString().toByteArray()) }
                    code = c.responseCode
                    val raw = (if (code in 200..299) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
                    c.disconnect()
                    body = if (code in 200..299) {
                        JSONObject(raw).getJSONArray("choices").getJSONObject(0).getJSONObject("message").optString("content", "")
                    } else raw.take(400)
                } catch (e: Exception) {
                    if (code in 200..299) code = 0
                    if (body.isEmpty()) body = e.javaClass.simpleName + ": " + (e.message ?: "")
                }
                js("window.__llmDone && window.__llmDone('$id', $code, ${JSONObject.quote(body)})")
            }
        }

        /** 重置提醒的权限自检：通知、全屏提醒、悬浮窗、精确闹钟、电池不限制，还有后台上次检查的时间 */
        @JavascriptInterface fun watchStatus(): String = CodexWatch.status(this@MainActivity)

        @JavascriptInterface fun openSetting(kind: String) = runOnUiThread {
            getSharedPreferences("codex_watch", MODE_PRIVATE).edit().putLong("resumeWatch", System.currentTimeMillis()).commit()
            val granted = checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
            if (kind == "notif" && !granted) requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQ_NOTIF)
            else CodexWatch.openSetting(this@MainActivity, kind)
        }

        /** 测试提醒：delay 毫秒后发，方便先锁屏看全屏效果 */
        @JavascriptInterface fun takeResume(): Boolean = resumeWatch.also { resumeWatch = false }

        @JavascriptInterface fun setNav(depth: Int, tab: String) { navDepth = depth; navTab = tab }

        @JavascriptInterface fun alertConfig(): String = Buzzer.configJson(this@MainActivity)

        @JavascriptInterface fun setAlertConfig(key: String, value: String) = Buzzer.setConfig(this@MainActivity, key, value)

        @JavascriptInterface fun previewAlert(kind: String, style: String) = runOnUiThread { Buzzer.preview(this@MainActivity, kind, style) }

        @JavascriptInterface fun testAlert(delayMs: Int) = CodexWatch.testAlert(this@MainActivity, delayMs.toLong())

        @JavascriptInterface fun openUrl(url: String) = runOnUiThread { openExternal(Uri.parse(url)) }

        @JavascriptInterface fun share(title: String, url: String) = runOnUiThread {
            val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, "$title $url")
            startActivity(Intent.createChooser(send, "分享"))
        }

        @JavascriptInterface fun vibrate(ms: Int) {
            val v = getSystemService(Vibrator::class.java) ?: return
            v.vibrate(VibrationEffect.createOneShot(ms.toLong().coerceIn(1, 60), VibrationEffect.DEFAULT_AMPLITUDE))
        }
    }

    override fun onDestroy() {
        io.shutdownNow()
        tts?.shutdown()
        web.destroy()
        super.onDestroy()
    }
}
