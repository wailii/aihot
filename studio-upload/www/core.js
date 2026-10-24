// 共用：数据、格式化、页面栈、转场、下拉刷新
const API = "https://aihot.news/api/v1";
const CAT = { "ai-models": "模型", "ai-products": "产品", industry: "行业", paper: "论文", tip: "技巧", opinion: "观点" };
const CAT_ORDER = ["all", "ai-models", "ai-products", "industry", "paper", "tip", "opinion"];
const WEEK = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const WEEK_CN = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];

// 装进安卓壳以后：只用 B 方向，安全区和返回键由外壳传进来
const IN_APP = !!window.AndroidBridge;
if (IN_APP) {
  document.documentElement.classList.add("app");
  window.__insets = (top, bottom) => {
    document.documentElement.style.setProperty("--st", top + "px");
    document.documentElement.style.setProperty("--sb", bottom + "px");
  };
  try { Object.defineProperty(navigator, "vibrate", { value: (ms) => { AndroidBridge.vibrate(ms | 0); return true; }, configurable: true }); } catch {}
}

// Studio 打包的 App：页面跑在阶跃的容器里，原生能力走 window.capsule.invoke，朗读走 window.mcp
const IN_STUDIO = !IN_APP && !!window.CapsuleBridge;
async function capsuleInvoke(name, params = {}) {
  for (let k = 0; k < 40 && !window.capsule; k++) await new Promise((r) => setTimeout(r, 50));
  if (!window.capsule) throw new Error("capsule-unavailable");
  return window.capsule.invoke(name, params);
}
if (IN_STUDIO) {
  document.documentElement.classList.add("app");
  window.__insets = (top, bottom) => {
    document.documentElement.style.setProperty("--st", top + "px");
    document.documentElement.style.setProperty("--sb", bottom + "px");
  };
  capsuleInvoke("getSafeArea").then((a) => {
    const d = a.density || devicePixelRatio || 1;
    const px = (v) => (v > 64 ? v / d : v) || 0;
    window.__insets(px(a.top), px(a.bottom));
  }).catch(() => {});
  try { Object.defineProperty(navigator, "vibrate", { value: () => { capsuleInvoke("vibrateShort", { type: "light" }).catch(() => {}); return true; }, configurable: true }); } catch {}
}

const S = {
  dir: "signal", tab: "feed", cat: "all", live: false, data: null,
  stack: [], read: new Set(),
};
try { S.read = new Set(JSON.parse(localStorage.getItem("read") || "[]")); } catch {}
try { S.dir = localStorage.getItem("dir") || "signal"; } catch {}
if (!["paper", "signal", "deck"].includes(S.dir) || IN_APP || IN_STUDIO) S.dir = "signal";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = (n) => String(n).padStart(2, "0");
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

function shortSource(name) {
  let s = String(name || "");
  const m = s.match(/^(X|公众号)：(.+)$/);
  if (m) s = m[2];
  else if (s.includes("：")) s = s.split("：")[0];
  s = s.replace(/（[^）]*）/g, "").replace(/\s*\(@[^)]*\)/g, "").replace(/\s*\([^)]*\)/g, "");
  if (s.includes("·")) s = s.split("·")[0];
  return s.trim();
}
const isX = (name) => /^X：/.test(name || "");

function dayKey(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function hm(iso) { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function md(iso) { const d = new Date(iso); return `${d.getMonth() + 1}月${d.getDate()}日`; }
function ago(iso) {
  const diff = (Date.now() - new Date(iso)) / 60000;
  if (diff < 1) return "刚刚";
  if (diff < 60) return `${Math.floor(diff)} 分钟前`;
  if (diff < 60 * 24 && new Date(iso).getDate() === new Date().getDate()) return hm(iso);
  if (diff < 60 * 48) return `昨天 ${hm(iso)}`;
  return `${md(iso)} ${hm(iso)}`;
}
function dayLabel(key) {
  const today = dayKey(new Date());
  const y = new Date(); y.setDate(y.getDate() - 1);
  const d = new Date(key + "T00:00:00");
  const tail = `${d.getMonth() + 1}月${d.getDate()}日 ${WEEK[d.getDay()]}`;
  if (key === today) return { head: "今天", tail };
  if (key === dayKey(y)) return { head: "昨天", tail };
  return { head: `${d.getMonth() + 1}月${d.getDate()}日`, tail: WEEK[d.getDay()] };
}
function groupByDay(items) {
  const groups = new Map();
  for (const it of items) {
    const k = dayKey(new Date(it.publishedAt));
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(it);
  }
  return [...groups.entries()];
}
function feedItems() {
  const items = [...S.data.items].sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  return S.cat === "all" ? items : items.filter((x) => x.category === S.cat);
}
function catCounts() {
  const c = { all: S.data.items.length };
  for (const it of S.data.items) c[it.category] = (c[it.category] || 0) + 1;
  return c;
}
function markRead(id) {
  S.read.add(id);
  try { localStorage.setItem("read", JSON.stringify([...S.read].slice(-800))); } catch {}
}

// ── 数据：先用快照立刻出图，再去拉 aihot.news 实时接口 ──
function normalizeLive(hot, items, daily) {
  return {
    hot: hot.items.map((h) => ({ ...h, storyId: h.links.story ? h.links.story.split("/").pop() : null })),
    items: items.items.map((x) => ({
      id: x.id, title: x.title, summary: x.summary, source: x.source.name, publishedAt: x.publishedAt,
      category: x.category, score: x.score, reason: x.reason, url: x.links.original,
    })),
    daily: daily.report,
    stories: { ...(S.data?.stories || {}) },
    site: S.data?.site || { hot: {}, details: {}, media: {} },
  };
}
function normalizeStory(s) {
  return {
    publicId: s.publicId, title: s.title, sourceCount: s.sourceCount, reportCount: s.reportCount,
    firstReportAt: s.firstReportAt, latestAt: s.latestAt, digest: s.digest, latest: s.latest,
    reports: s.reports.map((r) => ({ id: r.id, title: r.title, summary: r.summary, source: r.source.name, firstParty: !!r.source.firstParty, publishedAt: r.publishedAt, url: r.links.original })),
  };
}
async function getJSON(path, ms = 7000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(API + path, { signal: ctl.signal, headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error(r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}
async function loadLive() {
  const [hot, items, daily] = await Promise.all([
    getJSON("/hot-topics"), getJSON("/items?mode=selected&window=7d&limit=100"), getJSON("/dailies/latest"),
  ]);
  S.data = normalizeLive(hot, items, daily);
  S.live = true;
  S.fetchedAt = new Date().toISOString();
}
// ── 网页版站内接口（/api/site）：封面、全文、配图。没有跨域头，App 里由原生代为请求 ──
const SITE = "https://aihot.news";
const img = (u) => (!u ? "" : u.startsWith("/") ? SITE + u : u);
const nativeFetches = new Map();
let nfid = 0;
window.__fetchDone = (id, status, body) => {
  const r = nativeFetches.get(id);
  if (!r) return;
  nativeFetches.delete(id);
  status >= 200 && status < 300 ? r.ok(body) : r.fail(new Error("HTTP " + status));
};
function siteGet(path, ms = 12000) {
  if (IN_STUDIO) {
    return capsuleInvoke("request", { url: SITE + path, method: "GET", dataType: "json", timeout: ms }).then((r) => {
      if (r.statusCode < 200 || r.statusCode >= 300) throw new Error("HTTP " + r.statusCode);
      return typeof r.data === "string" ? JSON.parse(r.data) : r.data;
    });
  }
  if (!IN_APP) return Promise.reject(new Error("no-cors"));
  return new Promise((ok, fail) => {
    const id = "f" + ++nfid;
    nativeFetches.set(id, { ok: (b) => { try { ok(JSON.parse(b)); } catch (e) { fail(e); } }, fail });
    setTimeout(() => { if (nativeFetches.has(id)) { nativeFetches.delete(id); fail(new Error("timeout")); } }, ms);
    AndroidBridge.fetch(id, SITE + path);
  });
}
function trimMedia(m) {
  return (m || []).filter((x) => x.kind === "image").map(({ kind, url, fullUrl, width, height }) => ({ kind, url, fullUrl, width, height }));
}
function trimDetail(v) {
  const b = v.body || {};
  return {
    originalTitle: v.originalTitle, author: v.author, tags: v.tags || [],
    body: b.zh || b.original || null, bodyKind: b.zhKind || (b.original ? "original" : null), outline: v.outline || [],
    x: v.x ? { authorName: v.x.authorName, handle: v.x.handle, avatarUrl: v.x.avatarUrl, media: trimMedia(v.x.media) } : null,
  };
}
async function loadSite() {
  if (!IN_APP && !IN_STUDIO) return;
  const hot = await siteGet("/api/site/hot");
  const map = {};
  for (const e of hot.entries || []) {
    map[e.story.publicId] = { cover: e.cover, spark: e.spark, heat: e.heat, trend: e.trend, summary: e.summary, latest: e.latest,
      people: (e.participants || []).slice(0, 6).map((p) => ({ name: p.name, icon: p.iconUrl })) };
  }
  S.data.site.hot = map;
  siteGet("/api/site/timeline?limit=100").then((t) => {
    for (const c of t.cards || []) { const m = trimMedia(c.item.x?.media); if (m.length) S.data.site.media[c.item.id] = m; }
  }).catch(() => {});
  await Promise.all([loadLeaderboard().catch(() => {}), loadCodex().catch(() => {})]);
}

// ── 模型榜：五个榜的分数并到一张表里（字段和 bundle.py 的 norm_lb 一致）──
const BOARD_KEYS = ["overall", "coding", "reasoning", "professional", "knowledge"];
function normalizeLb(boards) {
  const models = {}, out = {};
  for (const k of BOARD_KEYS) {
    const b = boards[k];
    out[k] = { name: b.board.name, rows: [...b.entries, ...(b.filterEntries || [])].map((e) => {
      const m = e.model, p = e.price;
      if (!models[m.slug]) {
        models[m.slug] = { slug: m.slug, name: m.name, provider: m.provider, releasedAt: m.releasedAt, logo: m.brand?.src, mono: m.brand?.monogram,
          domestic: !!e.access?.domestic, open: !!e.access?.weightsUrl,
          price: p ? { in: p.inputCny, out: p.outputCny, cached: p.cachedCny } : null };
      }
      return { slug: m.slug, rank: e.rank, score: e.score };
    }) };
  }
  const ov = boards.overall;
  return { updatedAt: ov.run.generatedAt, about: ov.board.description, howToRead: ov.board.howToRead, boards: out, models,
    waiting: (ov.pending || []).map((x) => ({ name: x.model.name, provider: x.model.provider, reason: x.reason || "评测还在补" })),
    details: S.data.site.lb?.details || {} };
}
async function loadLeaderboard() {
  const all = await Promise.all(BOARD_KEYS.map((k) => siteGet("/api/site/leaderboard/boards/" + k)));
  S.data.site.lb = normalizeLb(Object.fromEntries(BOARD_KEYS.map((k, i) => [k, all[i]])));
}
async function getModelDetail(slug) {
  const c = S.data.site.lb?.details?.[slug];
  if (c) return c;
  const d = await siteGet("/api/site/leaderboard/models/" + slug);
  const t = { context: d.model?.contextWindowTokens, evidence: (d.evidence || []).map((g) => ({ key: g.key, name: g.name, score: g.score,
    items: (g.items || []).map((i) => ({ name: i.name, operator: i.operator, display: i.display, config: i.configurationLabel })) })) };
  S.data.site.lb.details[slug] = t;
  return t;
}

// ── Codex 重置监控（Tibo 的额度重置消息）──
function trimEvent(e) {
  if (!e) return null;
  return { id: e.id, title: e.title, label: e.displayLabel || e.label, status: e.status, updatedAt: e.updatedAt, confirmedAt: e.confirmedAt,
    schedule: e.schedule, posts: (e.posts || []).map((p) => ({ stage: p.stage, text: p.text, at: p.publishedAt, url: p.url })) };
}
async function loadCodex() {
  const [site, recent] = await Promise.all([siteGet("/api/site/codex-reset"), getJSON("/codex-resets/recent")]);
  S.data.site.codex = { checkedAt: site.checkedAt, monitor: site.monitor?.status, current: trimEvent(site.current),
    lastLanded: trimEvent(site.lastLanded), recent: (recent.events || []).map(trimEvent) };
}
async function getDetail(id) {
  const c = S.data.site.details[id];
  if (c) return c;
  const d = trimDetail(await siteGet("/api/site/items/" + id));
  S.data.site.details[id] = d;
  return d;
}
// 正文是服务端白名单过的 HTML；这里再去掉脚本和事件属性，图片补成绝对地址并延迟加载
function cleanHTML(html) {
  const doc = new DOMParser().parseFromString(`<div>${html || ""}</div>`, "text/html");
  const root = doc.body.firstElementChild;
  root.querySelectorAll("script,style,iframe,object,embed,form,input,button").forEach((n) => n.remove());
  root.querySelectorAll("*").forEach((n) => {
    [...n.attributes].forEach((a) => { if (/^on/i.test(a.name) || a.name === "style") n.removeAttribute(a.name); });
    if (n.tagName === "IMG") { n.src = img(n.getAttribute("src")); n.removeAttribute("srcset"); n.loading = "lazy"; n.decoding = "async"; }
    if (n.tagName === "A") n.setAttribute("data-ext", n.getAttribute("href") || "");
  });
  return root.innerHTML;
}

async function getStory(id) {
  if (S.data.stories[id]) return S.data.stories[id];
  const s = normalizeStory((await getJSON("/stories/" + id)).story);
  S.data.stories[id] = s;
  return s;
}

// ── 页面栈：详情页压在 Tab 页上，Tab 页的滚动位置不丢 ──
const app = () => $("#app");
function relRect(el) {
  const a = app().getBoundingClientRect(), r = el.getBoundingClientRect();
  return { top: r.top - a.top, left: r.left - a.left, right: a.right - r.right, bottom: a.bottom - r.bottom, w: r.width, h: r.height };
}

/**
 * from: 被点的元素。mode: slide（右侧推入）、expand（从被点的卡片展开）、sheet（底部升起）
 */
function pushScreen(html, { from, mode = "slide", radius = 0, onMount } = {}) {
  const host = app();
  const screen = document.createElement("section");
  screen.className = "screen detail";
  screen.innerHTML = html;
  host.appendChild(screen);
  const under = S.stack.length ? S.stack[S.stack.length - 1].el : $(".tabs-host", host);
  const entry = { el: screen, mode, from, radius, under };
  S.stack.push(entry);
  history.pushState({ depth: S.stack.length }, "");
  onMount && onMount(screen);
  host.dispatchEvent(new Event("stackchange"));
  if (reduceMotion) return screen;
  const ease = "cubic-bezier(.22,.9,.18,1)";
  // 底下那层的终点直接写进 style，动画只负责过渡（WebView 里取消 fill: forwards 后样式会卡住）
  const UNDER = { slide: "translate3d(-22%,0,0)", expand: "scale(.96)", sheet: "scale(.94)" };
  entry.underTf = UNDER[mode] || UNDER.slide;
  under.style.transform = entry.underTf;
  if (mode === "slide") {
    screen.animate([{ transform: "translate3d(100%,0,0)" }, { transform: "translate3d(0,0,0)" }], { duration: 380, easing: ease });
    under.animate([{ transform: "translate3d(0,0,0)" }, { transform: entry.underTf }], { duration: 380, easing: ease });
  } else if (mode === "expand" && from) {
    screen.animate([{ opacity: 0, transform: "translate3d(0,24px,0) scale(.98)" }, { opacity: 1, transform: "none" }], { duration: 360, easing: ease });
    under.animate([{ transform: "none" }, { transform: entry.underTf }], { duration: 360, easing: ease });
  } else {
    screen.animate([{ transform: "translate3d(0,100%,0)" }, { transform: "translate3d(0,0,0)" }], { duration: 420, easing: ease });
    under.animate([{ transform: "none" }, { transform: entry.underTf }], { duration: 420, easing: ease });
  }
  return screen;
}
function popScreen(fromHistory = false) {
  const entry = S.stack.pop();
  if (!entry) return;
  if (!fromHistory) { S.ignorePop = (S.ignorePop || 0) + 1; history.back(); }
  const { el, mode, under, underTf } = entry;
  const ease = "cubic-bezier(.4,0,.2,1)";
  under.style.transform = "";
  const done = () => { el.remove(); app().dispatchEvent(new Event("stackchange")); };
  if (reduceMotion) return done();
  const dur = mode === "slide" ? 300 : 320;
  const out = mode === "slide" ? "translate3d(100%,0,0)" : mode === "expand" ? "translate3d(0,24px,0) scale(.98)" : "translate3d(0,100%,0)";
  const anim = el.animate([{ transform: "none", opacity: 1 }, { transform: out, opacity: mode === "expand" ? 0 : 1 }], { duration: dur, easing: ease, fill: "forwards" });
  under.animate([{ transform: underTf || "none" }, { transform: "translate3d(0,0,0)" }], { duration: dur, easing: ease });
  anim.onfinish = done;
}
addEventListener("popstate", () => {
  if (S.ignorePop) { S.ignorePop--; return; }
  if (S.stack.length) popScreen(true);
});

// 左缘右滑返回（安卓全面屏手势在 App 壳里交给系统，这里给网页预览用）
function edgeSwipe(screen) {
  let x0 = null, y0 = 0, dx = 0;
  screen.addEventListener("pointerdown", (e) => { if (e.clientX - app().getBoundingClientRect().left < 24) { x0 = e.clientX; y0 = e.clientY; dx = 0; } });
  screen.addEventListener("pointermove", (e) => {
    if (x0 === null) return;
    dx = Math.max(0, e.clientX - x0);
    if (Math.abs(e.clientY - y0) > 40 && dx < 20) { x0 = null; return; }
    screen.style.transform = `translateX(${dx}px)`;
  });
  const end = () => {
    if (x0 === null) return;
    x0 = null;
    if (dx > 90) { screen.style.transform = ""; popScreen(); }
    else screen.animate([{ transform: `translateX(${dx}px)` }, { transform: "translateX(0)" }], { duration: 220, easing: "ease-out" }).onfinish = () => (screen.style.transform = "");
  };
  screen.addEventListener("pointerup", end);
  screen.addEventListener("pointercancel", end);
}

// ── 下拉刷新 ──
function pullToRefresh(scroller, indicator, onRefresh) {
  let y0 = null, dy = 0, busy = false;
  const set = (v) => { indicator.style.setProperty("--pull", v); scroller.style.setProperty("--pull", v); };
  scroller.addEventListener("touchstart", (e) => { if (scroller.scrollTop <= 0 && !busy) { y0 = e.touches[0].clientY; dy = 0; } }, { passive: true });
  scroller.addEventListener("touchmove", (e) => {
    if (y0 === null) return;
    dy = Math.max(0, e.touches[0].clientY - y0);
    const p = Math.min(1, dy / 90);
    indicator.classList.toggle("ready", p >= 1);
    set(p);
  }, { passive: true });
  scroller.addEventListener("touchend", async () => {
    if (y0 === null) return;
    y0 = null;
    if (dy >= 90) {
      busy = true;
      indicator.classList.add("busy");
      try { await onRefresh(); } finally {
        busy = false;
        indicator.classList.remove("busy", "ready");
        set(0);
      }
    } else set(0);
  });
}

// ── 提示 ──
function toast(text) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = text;
  app().appendChild(t);
  t.animate([{ opacity: 0, transform: "translate(-50%, 8px)" }, { opacity: 1, transform: "translate(-50%, 0)" }], { duration: 220, easing: "ease-out" });
  setTimeout(() => t.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200 }).onfinish = () => t.remove(), 1600);
}
async function share(title, url) {
  if (IN_APP) return AndroidBridge.share(title, url);
  if (IN_STUDIO) return capsuleInvoke("shareText", { title, text: `${title} ${url}` }).catch(() => {});
  if (navigator.share) { try { await navigator.share({ title, url }); } catch {} return; }
  try { await navigator.clipboard.writeText(`${title} ${url}`); toast("链接已复制"); } catch { toast(url); }
}
// 正文里的链接一律交给外部浏览器
document.addEventListener("click", (e) => {
  const a = e.target.closest("a[data-ext]");
  if (!a) return;
  e.preventDefault();
  openOriginal(a.dataset.ext);
}, true);
function openOriginal(url) {
  if (!url) return;
  if (IN_APP) return AndroidBridge.openUrl(url);
  if (IN_STUDIO) return capsuleInvoke("openUrl", { url }).catch(() => toast("打不开这个链接"));
  window.open(url, "_blank", "noopener");
}

// 数字滚动
function countUp(el, to, ms = 900) {
  if (reduceMotion) { el.textContent = to; return; }
  const t0 = performance.now();
  const tick = (t) => {
    const p = Math.min(1, (t - t0) / ms);
    el.textContent = Math.round(to * (1 - Math.pow(1 - p, 3)));
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
// 进入视口时出现
function revealOnScroll(root, scroller) {
  if (reduceMotion || !("IntersectionObserver" in window)) return;
  const io = new IntersectionObserver((ents) => {
    for (const e of ents) if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
  }, { root: scroller, rootMargin: "0px 0px -8% 0px" });
  $$("[data-reveal]", root).forEach((el) => { el.classList.add("pre"); io.observe(el); });
}
// 标题逐字浮现（中文按字切）
function splitChars(el, delay = 0, step = 22) {
  if (reduceMotion) return;
  const text = el.textContent;
  // 英文和数字整词一起动，不拆开；空格保留成普通空格，换行规则不变
  const tokens = text.match(/[A-Za-z0-9][A-Za-z0-9.\-_'’+]*|\s+|./gu) || [];
  let i = 0;
  el.innerHTML = tokens.map((t) => /^\s+$/.test(t) ? " " : `<span class="ch" style="animation-delay:${delay + i++ * step}ms">${esc(t)}</span>`).join("");
}

const ICON = {
  feed: '<svg viewBox="0 0 24 24"><path d="M5 5h14M5 10h14M5 15h9M5 20h6"/></svg>',
  hot: '<svg viewBox="0 0 24 24"><path d="M12 21c-4 0-7-2.7-7-6.6 0-3.4 2.4-5.3 3.6-8.4.4 1.9 1.4 3 2.6 3.6C11.6 6.4 13.4 4 15.6 3c-.3 2.6.6 4.4 1.9 6.1A7.4 7.4 0 0 1 19 14.4C19 18.3 16 21 12 21Z"/></svg>',
  reset: '<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4.5h4.5"/><path d="M12 8v4.2l2.8 1.8"/></svg>',
  models: '<svg viewBox="0 0 24 24"><path d="M5 20V11M10 20V5M15 20v-6M20 20V9"/></svg>',
  daily: '<svg viewBox="0 0 24 24"><rect x="4.5" y="3.5" width="15" height="17" rx="1.5"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  share: '<svg viewBox="0 0 24 24"><path d="M12 15V3M7.5 7.5 12 3l4.5 4.5M5 12v7.5h14V12"/></svg>',
  out: '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M8 5h3v14H8zM13 5h3v14h-3z" fill="currentColor" stroke="none"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M6 6l9 6-9 6z" fill="currentColor" stroke="none"/><path d="M18 6v12"/></svg>',
  prev: '<svg viewBox="0 0 24 24"><path d="M18 6l-9 6 9 6z" fill="currentColor" stroke="none"/><path d="M6 6v12"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>',
  ear: '<svg viewBox="0 0 24 24"><path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3.5" y="13.5" width="4" height="6.5" rx="1.5"/><rect x="16.5" y="13.5" width="4" height="6.5" rx="1.5"/></svg>',
};
const TABS = [{ key: "feed", label: "精选" }, { key: "hot", label: "热点" }, { key: "daily", label: "日报" }, { key: "models", label: "模型" }, { key: "reset", label: "重置" }];
