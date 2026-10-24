/* 英文正文翻译：数英文和汉字的比例判断是不是英文页，点一下按段落交给大模型，译好一段换掉一段 */
(function () {
  const PRESETS = [
    { k: "deepseek", n: "DeepSeek", base: "https://api.deepseek.com", model: "deepseek-chat" },
    { k: "qwen", n: "通义千问", base: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus" },
    { k: "glm", n: "智谱", base: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4-flash" },
    { k: "custom", n: "自定义", base: "", model: "" },
  ];
  const SYSTEM = "你是专业的科技新闻译者。用户发来一个 JSON 字符串数组，每一项是一段 HTML。把每一项里的文字译成自然流畅的简体中文：" +
    "HTML 标签和属性原样保留；产品名、公司名、模型名、人名、代码保留原文；不要增删内容。" +
    "只输出一个同样长度、同样顺序的 JSON 字符串数组，不要解释，不要代码块。";
  const BLOCKS = "p,h1,h2,h3,h4,h5,h6,li,blockquote,figcaption,td,th,dt,dd";
  const CACHE_MAX = 40;

  const ready = () => IN_APP && !!AndroidBridge.llm;
  function cfg() {
    try { return JSON.parse(AndroidBridge.llmConfig()); } catch { return {}; }
  }
  const configured = () => { const c = cfg(); return !!(c.base && c.model && c.hasKey); };

  // ── 判断英文：汉字太少、英文字母很多就算英文页 ──
  function isEnglish(text) {
    const cjk = (text.match(/[一-鿿]/g) || []).length;
    const latin = (text.match(/[A-Za-z]/g) || []).length;
    if (latin < 120) return false;
    // 一个英文词大约 5 个字母，按词和汉字比
    return cjk / (cjk + latin / 5) < 0.3;
  }

  // ── 原生请求 ──
  let n = 0;
  const pending = new Map();
  window.__llmDone = (id, code, body) => {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    code >= 200 && code < 300 ? p.ok(body) : p.fail(errText(code, body));
  };
  function errText(code, body) {
    if (code === 401 || code === 403) return "Key 不对或没权限";
    if (code === 402) return "账户余额不足";
    if (code === 429) return "请求太频繁或额度用完了";
    if (code === 404) return "接口地址或模型名不对";
    if (code === 0) return "连不上接口";
    let m = "";
    try { const j = JSON.parse(body); m = j.error?.message || j.message || ""; } catch {}
    return `出错 ${code}${m ? "：" + String(m).slice(0, 60) : ""}`;
  }
  function ask(user, ms = 130000) {
    return new Promise((ok, fail) => {
      const id = "l" + ++n;
      pending.set(id, { ok, fail });
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); fail("等太久了，没有回应"); } }, ms);
      AndroidBridge.llm(id, SYSTEM, user);
    });
  }
  function parseArray(s, len) {
    const a = s.indexOf("["), b = s.lastIndexOf("]");
    if (a < 0 || b < a) throw "模型返回的格式不对";
    const arr = JSON.parse(s.slice(a, b + 1));
    if (!Array.isArray(arr) || arr.length !== len) throw "模型返回的段数对不上";
    return arr.map((x) => String(x ?? ""));
  }

  // ── 缓存：按文章 id 存译文 ──
  const cacheKey = (id) => "tr:" + id;
  function loadCache(id) {
    try { return JSON.parse(localStorage.getItem(cacheKey(id)) || "null"); } catch { return null; }
  }
  function saveCache(id, data) {
    try {
      const idx = JSON.parse(localStorage.getItem("tr:index") || "[]").filter((x) => x !== id);
      idx.push(id);
      while (idx.length > CACHE_MAX) localStorage.removeItem(cacheKey(idx.shift()));
      localStorage.setItem(cacheKey(id), JSON.stringify(data));
      localStorage.setItem("tr:index", JSON.stringify(idx));
    } catch {}
  }

  // 要翻的段落：块级元素里最里层、带英文的那些
  function units(box) {
    return $$(BLOCKS, box).filter((e) => !e.closest(".sg-k,.tr-bar") && !e.querySelector(BLOCKS) && /[A-Za-z]{2}/.test(e.textContent));
  }
  function chunks(list, max = 1800) {
    const out = [];
    let cur = [], size = 0;
    list.forEach((u, i) => {
      const len = u.html.length;
      if (cur.length && size + len > max) { out.push(cur); cur = []; size = 0; }
      cur.push(i); size += len;
    });
    if (cur.length) out.push(cur);
    return out;
  }

  // ── 详情页：正文插进去之后调这里 ──
  function attach(el, id) {
    if (!IN_APP) return;
    const box = $(".sg-article", el);
    const orig = $(".sg-orig", el);
    if (!box) return;
    const text = box.textContent + " " + (orig?.textContent || "");
    if (!isEnglish(text)) return;
    const head = $(".sg-k", box);
    const bar = document.createElement("div");
    bar.className = "tr-bar";
    bar.innerHTML = `<button class="tr-go" data-act="trgo">译成中文</button>`;
    head ? head.after(bar) : box.prepend(bar);
    const list = units(box).map((e) => ({ el: e, html: e.innerHTML }));
    if (orig && orig.textContent.trim()) list.unshift({ el: orig, html: esc(orig.textContent.trim()) });
    const st = { id, list, done: new Array(list.length).fill(null), showing: "orig", busy: false };
    el.__tr = st;
    const c = ready() && loadCache(id);
    if (c && c.length === list.length) { st.done = c; show(el, "zh"); }
  }

  function show(el, mode) {
    const st = el.__tr;
    st.showing = mode;
    st.list.forEach((u, i) => { u.el.innerHTML = mode === "zh" && st.done[i] != null ? (u.el.matches(".sg-orig") ? esc(st.done[i]) : cleanHTML(st.done[i])) : u.html; });
    btn(el);
  }
  function btn(el, label) {
    const st = el.__tr, b = $(".tr-go", el);
    if (!b) return;
    const got = st.done.filter((x) => x != null).length;
    b.classList.toggle("busy", st.busy);
    b.textContent = label || (st.busy ? `翻译中 ${got}/${st.list.length}` : st.showing === "zh" ? "看原文" : got === st.list.length ? "看译文" : "译成中文");
  }

  async function run(el) {
    const st = el.__tr;
    if (st.busy) return;
    if (!configured()) { toast("先填一下翻译接口"); return openSettings(); }
    const todo = st.list.map((_, i) => i).filter((i) => st.done[i] == null);
    if (!todo.length) return show(el, st.showing === "zh" ? "orig" : "zh");
    st.busy = true;
    show(el, "zh");
    const groups = chunks(todo.map((i) => st.list[i])).map((g) => g.map((k) => todo[k]));
    let failMsg = "";
    const one = async (g) => {
      const user = JSON.stringify(g.map((i) => st.list[i].html));
      for (let t = 0; t < 2; t++) {
        try {
          const arr = parseArray(await ask(user), g.length);
          g.forEach((i, k) => {
            st.done[i] = arr[k];
            const u = st.list[i];
            if (!el.isConnected || st.showing !== "zh") return;
            u.el.innerHTML = u.el.matches(".sg-orig") ? esc(arr[k]) : cleanHTML(arr[k]);
            if (!reduceMotion) u.el.animate([{ opacity: 0.25 }, { opacity: 1 }], { duration: 360, easing: "ease-out" });
          });
          btn(el);
          return;
        } catch (e) { failMsg = String(e); if (/Key|余额|地址|连不上/.test(failMsg)) break; }
      }
    };
    // 同时发 3 段，前面的先回来先换
    const queue = groups.slice();
    await Promise.all([0, 1, 2].map(async () => { while (queue.length) await one(queue.shift()); }));
    st.busy = false;
    const all = st.done.every((x) => x != null);
    if (all) saveCache(st.id, st.done);
    btn(el);
    if (!all) toast(`有几段没翻成：${failMsg || "再点一次试试"}`);
  }

  // ── 设置页 ──
  function settingsHTML() {
    const c = cfg();
    const p = PRESETS.find((x) => x.k === c.preset) || (c.base ? PRESETS[3] : PRESETS[0]);
    const base = c.base || p.base, model = c.model || p.model;
    return `<header class="dt-bar"><button data-act="back" aria-label="返回">${ICON.back}</button><span>设置</span><span></span></header>
      <div class="scroller pad-bottom"><div class="tr-page">
        <section class="wt">
          <div class="wt-head"><b>英文翻译</b><span>文章是英文时用这个大模型翻译 · Key 只存在这台手机上</span></div>
          <div class="wt-opt"><b>服务商</b><div class="wt-seg tr-presets">${PRESETS.map((x) => `<button class="${x.k === p.k ? "on" : ""}" data-act="trpreset" data-k="${x.k}">${x.n}</button>`).join("")}</div></div>
          <label class="tr-field"><b>接口地址</b><input id="trBase" type="url" inputmode="url" autocomplete="off" spellcheck="false" value="${esc(base)}" placeholder="https://…/v1"></label>
          <label class="tr-field"><b>API Key</b><input id="trKey" type="password" autocomplete="off" spellcheck="false" placeholder="${c.hasKey ? `已保存（尾号 ${esc(c.keyTail)}），不改就留空` : "sk-…"}"></label>
          <label class="tr-field"><b>模型</b><input id="trModel" type="text" autocomplete="off" spellcheck="false" value="${esc(model)}" placeholder="模型名"></label>
          <p class="tr-msg" id="trMsg"></p>
        </section>
        <button class="wt-test tr-save" data-act="trsave">保存并试一下</button>
      </div></div>`;
  }
  function openSettings() {
    edgeSwipe(pushScreen(settingsHTML(), { mode: "slide" }));
  }
  async function save(btnEl) {
    const page = btnEl.closest(".screen");
    const k = $(".tr-presets .on", page)?.dataset.k || "custom";
    const base = $("#trBase", page).value.trim(), key = $("#trKey", page).value.trim(), model = $("#trModel", page).value.trim();
    const msg = $("#trMsg", page);
    if (!/^https?:\/\//.test(base)) { msg.textContent = "接口地址要以 https:// 开头"; return; }
    if (!model) { msg.textContent = "模型名不能空"; return; }
    if (!key && !cfg().hasKey) { msg.textContent = "要填 API Key"; return; }
    AndroidBridge.setLlmConfig(k, base, key, model);
    $("#trKey", page).value = "";
    $("#trKey", page).placeholder = `已保存（尾号 ${cfg().keyTail}），不改就留空`;
    msg.className = "tr-msg"; msg.textContent = "保存好了，正在试翻一句…";
    btnEl.disabled = true;
    try {
      const out = parseArray(await ask(JSON.stringify(["Hello, world."]), 40000), 1)[0];
      msg.className = "tr-msg ok"; msg.textContent = `能用：Hello, world. → ${out.replace(/<[^>]+>/g, "")}`;
    } catch (e) {
      msg.className = "tr-msg bad"; msg.textContent = `保存了，但试翻失败：${e}`;
    }
    btnEl.disabled = false;
  }

  const GEAR = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/></svg>';

  function act(a, el) {
    const scr = el.closest(".screen");
    if (a === "trgo") return run(scr);
    if (a === "trset") return openSettings();
    if (a === "trsave") return save(el);
    if (a === "trpreset") {
      const p = PRESETS.find((x) => x.k === el.dataset.k);
      $$(".tr-presets button", scr).forEach((b) => b.classList.toggle("on", b === el));
      if (p.k !== "custom") { $("#trBase", scr).value = p.base; $("#trModel", scr).value = p.model; }
      return;
    }
  }

  window.Translate = { attach, act, isEnglish, openSettings, GEAR };
})();
