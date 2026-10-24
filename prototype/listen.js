// 播报：把热点、日报、单条新闻读出来。
// 网页预览用浏览器的 speechSynthesis；打成 APK 后换成 Android 系统 TextToSpeech（手机自带的本地语音引擎），
// 接口一样：speak(一句话) → 读完 resolve。按句子切开读，高亮、暂停、跳转都按句子走。
(() => {
  const CHARS_PER_SEC = 4.2;
  let simTimer = null, boundaryTimer = null;

  // 安卓壳：AndroidBridge.speak 调系统 TextToSpeech，读完回调 window.__ttsDone(id)
  const pending = new Map();
  let uid = 0;
  window.__ttsDone = (id) => { const r = pending.get(id); if (r) { pending.delete(id); r(); } };
  const Native = window.AndroidBridge ? {
    status: () => AndroidBridge.ttsStatus(),
    speak(text, rate) {
      return new Promise((resolve) => {
        const id = "u" + ++uid;
        const t = setTimeout(() => window.__ttsDone(id), (text.length / CHARS_PER_SEC / rate) * 2500 + 6000);
        pending.set(id, () => { clearTimeout(t); resolve(); });
        AndroidBridge.speak(id, text, rate);
      });
    },
    stop() { AndroidBridge.stopSpeak(); [...pending.keys()].forEach((id) => window.__ttsDone(id)); },
  } : null;

  // Studio 容器：手机自带的 speak_text（系统 MCP 工具）。每调一次弹一次授权，所以一条新闻整条一次读完
  const Studio = !Native && window.CapsuleBridge ? {
    stopTool: undefined,
    until: 0, // 估算的这段朗读结束时间；只有在这之前暂停才需要调停止（停止也要授权一次）
    async findStop() {
      if (this.stopTool !== undefined) return this.stopTool;
      try {
        const r = await window.mcp.listTools();
        const tools = r?.tools || r?.result?.tools || (Array.isArray(r) ? r : []);
        this.stopTool = tools.map((t) => t.name).find((n) => /stop/i.test(n) && /(speak|tts|voice|broadcast)/i.test(n)) || null;
      } catch { this.stopTool = null; }
      return this.stopTool;
    },
    async speakAll(text) {
      if (!window.mcp?.callTool) throw new Error("mcp-unavailable");
      const r = await window.mcp.callTool("speak_text", { text });
      if (r?.isError) throw new Error("speak_text " + (r.errorCode ?? "error"));
      return r;
    },
    async stop() {
      if (performance.now() > this.until) return;
      this.until = 0;
      const t = await this.findStop();
      if (t) window.mcp.callTool(t, {}).catch(() => {});
    },
  } : null;

  const Speaker = {
    web: !Native && !Studio && "speechSynthesis" in window,
    voice: null,
    pickVoice() {
      if (!this.web) return null;
      const vs = speechSynthesis.getVoices().filter((v) => /^zh(-|_)?(CN|Hans)?/i.test(v.lang));
      this.voice = vs.find((v) => v.localService && /Tingting|Ting-Ting|婷婷|Xiaoxiao|晓晓/i.test(v.name)) || vs.find((v) => v.localService) || vs[0] || null;
      return this.voice;
    },
    speak(text, rate, onBeat) {
      return new Promise((resolve) => {
        const est = (text.length / CHARS_PER_SEC / rate) * 1000;
        clearInterval(boundaryTimer);
        // 本地语音不一定给逐字回调，统一用节拍驱动画面
        boundaryTimer = setInterval(() => onBeat && onBeat(), 260 / rate);
        const done = () => { clearInterval(boundaryTimer); clearTimeout(simTimer); resolve(); };
        if (Native) { Native.speak(text, rate).then(done); return; }
        if (!this.web || !(this.voice || this.pickVoice())) { simTimer = setTimeout(done, Math.max(900, est)); return; }
        const u = new SpeechSynthesisUtterance(text);
        u.lang = "zh-CN"; u.voice = this.voice; u.rate = rate;
        u.onend = done; u.onerror = done;
        // 有的浏览器不触发 onend，按估算时长兜底
        simTimer = setTimeout(done, est * 1.8 + 4000);
        speechSynthesis.speak(u);
      });
    },
    stop() {
      clearInterval(boundaryTimer); clearTimeout(simTimer);
      if (Native) Native.stop();
      if (this.web) speechSynthesis.cancel();
    },
  };
  if (Speaker.web) speechSynthesis.addEventListener?.("voiceschanged", () => Speaker.pickVoice());

  const sentences = (t) => String(t || "").replace(/\s+/g, " ").split(/(?<=[。！？；!?])/).map((s) => s.trim()).filter((s) => s.length > 1);
  const firstPara = (t) => String(t || "").split(/\n+/)[0] || "";

  // ── 播放列表 ──
  function hotList() {
    return S.data.hot.map((h, i) => {
      const st = S.data.stories[h.storyId];
      const body = firstPara(st?.digest) || st?.latest || "";
      return { key: "h" + h.storyId, kicker: `热点 ${pad(i + 1)}`, title: h.title, sents: [`第 ${i + 1} 条。`, h.title + "。", ...sentences(body)], focus: h, open: (from) => openStory(h, from) };
    });
  }
  function dailyList() {
    const d = S.data.daily;
    const dt = new Date(d.date + "T00:00:00");
    const out = [{ key: "d-lead", kicker: "头条", title: d.lead.title, sents: [`${dt.getMonth() + 1} 月 ${dt.getDate()} 日 AI 日报。头条：`, d.lead.title + "。", ...sentences(d.lead.leadParagraph)], focus: null, open: (from) => openItem(dailyEntry(0, 0), from) }];
    d.sections.forEach((s, si) => s.items.forEach((e, ii) => {
      if (e.title === d.lead.title) return;
      out.push({ key: `d${si}-${ii}`, kicker: s.label, title: e.title, sents: [`${s.label}。`, e.title + "。", ...sentences(e.summary)], focus: { sourceCount: 3, signalCount: 8, sourceNames: [e.source.name] }, open: (from) => openItem(dailyEntry(si, ii), from) });
    }));
    (d.flashes || []).forEach((f, i) => out.push({ key: "f" + i, kicker: "快讯", title: f.title, sents: [i === 0 ? "快讯。" : "", f.title + "。"].filter(Boolean), focus: { sourceCount: 2, signalCount: 4, sourceNames: [f.source.name] }, open: (from) => openItem(dailyEntry(-1, i), from) }));
    out.push({ key: "d-end", kicker: "结束", title: "今天的日报读完了", sents: ["今天的日报就到这里，明早八点见。"], focus: null, open: null });
    return out;
  }
  function storyList(s) {
    return [{ key: "s" + s.publicId, kicker: "事件", title: s.title, sents: [s.title + "。", ...sentences(s.digest)], focus: { sourceCount: s.sourceCount, signalCount: s.reportCount * 3, sourceNames: s.reports.map((r) => r.source) }, open: null }];
  }
  function itemList(it) {
    // 有全文就接着读正文前一千多字，太长的文章不全读
    const body = S.data.site?.details?.[it.id]?.body;
    const text = body ? new DOMParser().parseFromString(body, "text/html").body.textContent.replace(/\s+/g, " ").slice(0, 1400) : "";
    return [{ key: "i" + it.id, kicker: CAT[it.category] || "精选", title: it.title, sents: [it.title + "。", ...sentences(it.summary), ...sentences(text)], focus: { sourceCount: 2, signalCount: 6, sourceNames: [it.source] }, open: null }];
  }
  const LABEL = { hot: "热点", daily: "日报", story: "事件", item: "单条" };
  function minutes(list) {
    const chars = list.reduce((a, s) => a + s.sents.join("").length, 0);
    return Math.max(1, Math.round(chars / CHARS_PER_SEC / 60));
  }

  // ── 播放器 ──
  const P = { list: [], kind: "", i: 0, j: 0, playing: false, gen: 0, rate: 1, field: null };
  const RATES = [1, 1.25, 1.5, 0.85];

  // Studio：整条交给 speak_text。它在开始播放时返回（不等读完），所以拿到返回再按字数估算往下高亮
  async function runStudioSeg(seg, gen) {
    const rest = seg.sents.slice(P.j);
    try { await Studio.speakAll(rest.join("")); }
    catch (e) { if (gen === P.gen) toast("朗读没有成功：" + (e.message || "")); return false; }
    if (gen !== P.gen) return false;
    const dur = rest.map((t) => Math.max(700, (t.length / CHARS_PER_SEC / P.rate) * 1000));
    Studio.until = performance.now() + dur.reduce((x, y) => x + y, 0);
    for (let k = 0; k < rest.length; k++) {
      update();
      const end = performance.now() + dur[k];
      while (performance.now() < end) {
        if (gen !== P.gen) return false;
        P.field?.kick(0.25);
        await new Promise((r) => setTimeout(r, 260));
      }
      P.j++;
    }
    return gen === P.gen;
  }

  async function run(gen) {
    while (P.playing && gen === P.gen) {
      const seg = P.list[P.i];
      if (!seg) break;
      if (Studio) {
        if (P.j < seg.sents.length) {
          const ok = await runStudioSeg(seg, gen);
          if (!ok) { if (gen === P.gen) { P.playing = false; update(); } return; }
        }
        if (P.i + 1 >= P.list.length) { P.playing = false; update(); break; }
        P.i++; P.j = 0; segChanged(); continue;
      }
      if (P.j >= seg.sents.length) {
        if (P.i + 1 >= P.list.length) { P.playing = false; update(); break; }
        P.i++; P.j = 0; segChanged(); continue;
      }
      update();
      await Speaker.speak(seg.sents[P.j], P.rate, () => P.field?.kick(0.35));
      if (gen !== P.gen) return;
      P.j++;
    }
    update();
  }
  function play() { Speaker.stop(); P.gen++; P.playing = true; run(P.gen); update(); }
  function pause() { P.gen++; P.playing = false; Speaker.stop(); Studio?.stop(); update(); }
  function jump(i) { P.i = Math.max(0, Math.min(P.list.length - 1, i)); P.j = 0; segChanged(); play(); }
  async function start(kind, list, from) {
    if (Native) {
      let st = Native.status();
      for (let k = 0; k < 20 && st === "init"; k++) { await new Promise((r) => setTimeout(r, 150)); st = Native.status(); }
      if (st === "none") return toast("这台手机没有可用的语音引擎");
      if (st === "nolang") return toast("手机的语音引擎不支持中文");
    }
    P.kind = kind; P.list = list; P.i = 0; P.j = 0;
    ensureMini();
    if (from) flyFrom(from);
    segChanged(); play();
    if (!Native && !Studio && !Speaker.web) toast("这个浏览器没有语音，用演示节奏播放");
    if (Studio) toast("每读一条，手机会请你授权一次");
  }
  function stopAll() { pause(); P.list = []; const m = $(".lp-mini"); if (m) m.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(20px)" }], { duration: 220, fill: "forwards" }).onfinish = () => m.remove(); }

  function segChanged() {
    const seg = P.list[P.i];
    if (P.field && seg) P.field.setFocus({ ...(seg.focus || { sourceCount: 6, signalCount: 14 }), sourceCount: seg.focus?.sourceCount || 6, signalCount: seg.focus?.signalCount || 14, names: (seg.focus?.sourceNames || []).map(shortSource) }, { seed: P.i + 3 });
    const full = $(".lp-full");
    if (full) renderFullSeg(full, true);
  }

  // ── 迷你播放条 ──
  function ensureMini() {
    let m = $(".lp-mini");
    if (m) return m;
    m = document.createElement("div");
    m.className = "lp-mini";
    m.innerHTML = `<button class="lp-mini-main" data-lp="full"><span class="lp-wave"><i></i><i></i><i></i><i></i></span>
        <span class="t"><small></small><b></b></span></button>
      <button class="lp-ic" data-lp="toggle" aria-label="播放或暂停"></button>
      <button class="lp-ic" data-lp="next" aria-label="下一条">${ICON.next}</button>
      <button class="lp-ic sm" data-lp="close" aria-label="关闭">${ICON.close}</button>
      <i class="lp-mini-prog"></i>`;
    app().appendChild(m);
    m.animate([{ opacity: 0, transform: "translateY(24px) scale(.96)" }, { opacity: 1, transform: "none" }], { duration: 420, easing: "cubic-bezier(.3,1.3,.4,1)" });
    placeMini();
    return m;
  }
  function placeMini() {
    const m = $(".lp-mini");
    if (!m) return;
    const top = S.stack[S.stack.length - 1];
    m.classList.toggle("over-detail", !!top);
    m.classList.toggle("hidden", !!top && top.el.classList.contains("lp-full"));
    m.classList.toggle("has-actions", !!top && !!$(".dt-actions", top.el));
  }
  function flyFrom(el) {
    // 从被点的按钮飞一个光点到播放条
    const m = $(".lp-mini");
    if (!m || reduceMotion) return;
    const a = relRect(el), b = relRect(m);
    const dot = document.createElement("i");
    dot.className = "lp-fly";
    app().appendChild(dot);
    const x0 = a.left + a.w / 2, y0 = a.top + a.h / 2, x1 = b.left + 26, y1 = b.top + b.h / 2;
    dot.animate([
      { transform: `translate(${x0}px, ${y0}px) scale(1)` },
      { transform: `translate(${(x0 + x1) / 2}px, ${Math.min(y0, y1) - 60}px) scale(1.4)`, offset: 0.5 },
      { transform: `translate(${x1}px, ${y1}px) scale(.6)` },
    ], { duration: 620, easing: "cubic-bezier(.4,0,.2,1)" }).onfinish = () => dot.remove();
  }

  function update() {
    const seg = P.list[P.i];
    const m = $(".lp-mini");
    if (m && seg) {
      $("small", m).textContent = `${LABEL[P.kind]}播报 · ${P.i + 1}/${P.list.length}${P.kind === "daily" ? ` · ${seg.kicker}` : ""}`;
      $("b", m).textContent = seg.title;
      $('[data-lp="toggle"]', m).innerHTML = P.playing ? ICON.pause : ICON.play;
      m.classList.toggle("playing", P.playing);
      const total = P.list.reduce((a, s) => a + s.sents.length, 0);
      const done = P.list.slice(0, P.i).reduce((a, s) => a + s.sents.length, 0) + P.j;
      m.style.setProperty("--p", (done / Math.max(1, total)).toFixed(3));
    }
    const full = $(".lp-full");
    if (full) {
      $('[data-lp="toggle"]', full).innerHTML = P.playing ? ICON.pause : ICON.play;
      full.classList.toggle("playing", P.playing);
      $$(".lp-script span", full).forEach((s, k) => { s.classList.toggle("on", k === P.j); s.classList.toggle("done", k < P.j); });
      const on = $(".lp-script span.on", full);
      const box = $(".lp-script", full);
      if (on && box) box.scrollTo({ top: on.offsetTop - box.clientHeight * 0.35, behavior: "smooth" });
      $('[data-lp="rate"]', full).textContent = `${P.rate}×`;
    }
  }

  // ── 全屏播报台 ──
  function fullHTML() {
    return `<div class="lp-full-in">
      <header class="lp-top"><button data-act="back" aria-label="收起">${ICON.down}</button><span class="lp-kind"></span><button class="lp-rate" data-lp="rate">1×</button></header>
      <div class="lp-stage"><canvas></canvas><div class="lp-now"></div></div>
      <div class="lp-script"></div>
      <div class="lp-ctrl">
        <button class="lp-ic" data-lp="prev" aria-label="上一条">${ICON.prev}</button>
        <button class="lp-big" data-lp="toggle" aria-label="播放或暂停"></button>
        <button class="lp-ic" data-lp="next" aria-label="下一条">${ICON.next}</button>
      </div>
      <div class="lp-qhead"><b>播放列表</b><span></span></div>
      <ol class="lp-queue"></ol>
    </div>`;
  }
  function renderFullSeg(full, animate) {
    const seg = P.list[P.i];
    if (!seg) return;
    $(".lp-kind", full).textContent = `${LABEL[P.kind]}播报 · ${P.i + 1} / ${P.list.length}`;
    const now = $(".lp-now", full);
    now.innerHTML = `<small>${esc(seg.kicker)}</small><h2>${esc(seg.title)}</h2>${seg.open ? `<button data-lp="open">看详情</button>` : ""}`;
    if (animate) splitChars($("h2", now), 0, 14);
    $(".lp-script", full).innerHTML = seg.sents.map((s) => `<span>${esc(s)}</span>`).join("");
    $(".lp-qhead span", full).textContent = `约 ${minutes(P.list)} 分钟 · ${P.list.length} 条`;
    $(".lp-queue", full).innerHTML = P.list.map((s, k) => `<li data-lp="jump" data-i="${k}" class="${k === P.i ? "on" : k < P.i ? "done" : ""}"><span>${pad(k + 1)}</span><b>${esc(s.title)}</b><em>${P.kind === "daily" ? esc(s.kicker) : ""}</em></li>`).join("");
    if (animate && !reduceMotion) $(".lp-script", full).animate([{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }], { duration: 380, easing: "cubic-bezier(.22,.9,.18,1)" });
    update();
  }
  function openFull(from) {
    const scr = pushScreen(fullHTML(), { from, mode: "sheet", onMount: (el) => {
      el.classList.add("lp-full");
      P.field = window.SignalField($(".lp-stage canvas", el), { focal: [0.5, 0.46] });
      const seg = P.list[P.i];
      P.field.setFocus({ sourceCount: seg?.focus?.sourceCount || 6, signalCount: seg?.focus?.signalCount || 14, names: (seg?.focus?.sourceNames || []).map(shortSource) }, { immediate: true, seed: P.i + 3 });
      renderFullSeg(el, true);
    } });
    placeMini();
    return scr;
  }

  // ── 点击 ──
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-lp]");
    if (!b || !b.closest("#app")) return;
    e.stopPropagation();
    const a = b.dataset.lp;
    if (a === "toggle") return P.playing ? pause() : play();
    if (a === "next") return P.i + 1 < P.list.length ? jump(P.i + 1) : null;
    if (a === "prev") return P.j > 1 ? (P.j = 0, play()) : jump(P.i - 1);
    if (a === "jump") return jump(+b.dataset.i);
    if (a === "close") return stopAll();
    if (a === "full") return openFull(b);
    if (a === "rate") { P.rate = RATES[(RATES.indexOf(P.rate) + 1) % RATES.length]; update(); if (P.playing) play(); return; }
    if (a === "open") { const seg = P.list[P.i]; seg?.open && seg.open(b); }
  }, true);
  app().addEventListener("stackchange", () => {
    placeMini();
    if (!$(".lp-full")) P.field = null;
  });

  window.Listen = {
    hot: (from) => start("hot", hotList(), from),
    daily: (from) => start("daily", dailyList(), from),
    story: (s, from) => start("story", storyList(s), from),
    item: (it, from) => start("item", itemList(it), from),
    remount() { if (P.list.length) { ensureMini(); update(); } },
    minutes: (kind) => minutes(kind === "hot" ? hotList() : dailyList()),
    state: P,
  };
})();
