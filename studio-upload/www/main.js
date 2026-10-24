// 外壳：方向切换、Tab、点击分发、数据刷新
const DIRS = { paper: window.DirPaper, signal: window.DirSignal, deck: window.DirDeck };
const D = () => DIRS[S.dir];

function tabbarHTML() {
  return `<nav class="tabbar">${TABS.map((t) => `
    <button class="tb ${S.tab === t.key ? "on" : ""}" data-tab-btn="${t.key}">${ICON[t.key]}<span>${t.label}</span></button>`).join("")}
    <i class="tb-ind"></i></nav>`;
}
function tabHTML(key) {
  const fixed = (D().fixedTabs || []).includes(key);
  return `<section class="screen tab ${fixed ? "fixed" : ""}" data-tab="${key}" ${S.tab === key ? "" : "hidden"}>
    ${fixed ? D()[key]() : `<div class="scroller"><div class="ptr"><i></i><span class="ptr-t">下拉刷新</span></div>${(D()[key] || DIRS.signal[key])()}</div>`}
  </section>`;
}
function moveIndicator(animate = true) {
  const btn = $(`[data-tab-btn="${S.tab}"]`), ind = $(".tb-ind");
  if (!btn || !ind) return;
  const r = btn.getBoundingClientRect(), p = btn.parentElement.getBoundingClientRect();
  ind.style.transition = animate ? "" : "none";
  ind.style.transform = `translateX(${r.left - p.left + r.width / 2}px)`;
}
function mountTab(key) {
  const sec = $(`.screen.tab[data-tab="${key}"]`);
  const sc = $(".scroller", sec);
  if (sc) {
    revealOnScroll(sec, sc);
    pullToRefresh(sc, $(".ptr", sc), refresh);
    sc.addEventListener("scroll", () => sec.style.setProperty("--sy", Math.min(1, sc.scrollTop / 140).toFixed(3)), { passive: true });
  }
  D().mount && D().mount(key, sec);
}

function render() {
  DIRS.paper.unmount?.(); DIRS.signal.unmount?.(); DIRS.deck.unmount?.();
  S.stack = [];
  const a = app();
  a.className = "dir-" + S.dir;
  a.innerHTML = `<div class="tabs-host">${TABS.map((t) => tabHTML(t.key)).join("")}</div>${tabbarHTML()}`;
  TABS.forEach((t) => mountTab(t.key));
  requestAnimationFrame(() => moveIndicator(false));
  $$(".studio-switch button").forEach((b) => b.setAttribute("aria-selected", b.dataset.dir === S.dir));
  $("#notes").innerHTML = D().notes;
  document.querySelector('meta[name="theme-color"]').content = D().themeColor;
  document.body.dataset.dir = S.dir;
  window.Listen?.remount();
}
function rerenderTab(key) {
  const old = $(`.screen.tab[data-tab="${key}"]`);
  const tmp = document.createElement("div");
  tmp.innerHTML = tabHTML(key);
  old.replaceWith(tmp.firstElementChild);
  mountTab(key);
}
function switchTab(key) {
  if (key === S.tab) {
    const sc = $(`.screen.tab[data-tab="${key}"] .scroller`);
    sc && sc.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  while (S.stack.length) popScreen();
  S.tab = key;
  $$(".screen.tab").forEach((s) => (s.hidden = s.dataset.tab !== key));
  $$(".tb").forEach((b) => b.classList.toggle("on", b.dataset.tabBtn === key));
  moveIndicator();
  const sec = $(`.screen.tab[data-tab="${key}"]`);
  if (!reduceMotion) sec.animate([{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }], { duration: 320, easing: "cubic-bezier(.22,.9,.18,1)" });
  D().onTab && D().onTab(key, sec);
}

async function refresh() {
  try {
    await Promise.all([loadLive(), loadSite().catch(() => {})]);
    setStatus();
    TABS.forEach((t) => rerenderTab(t.key));
    toast("已是最新");
    prefetchStories();
  } catch { toast("没连上 aihot.news，先看快照"); }
}
function setStatus() {
  const el = $("#dataStatus");
  el.textContent = S.live ? `实时 · aihot.news · ${hm(S.fetchedAt)}` : `离线快照 · ${md(S.data.fetchedAt)} ${hm(S.data.fetchedAt)}`;
  el.classList.toggle("live", S.live);
}
function prefetchStories() {
  S.data.hot.forEach((h, i) => h.storyId && setTimeout(() => getStory(h.storyId).catch(() => {}), 200 * i));
}

// ── 打开详情 ──
function dailyEntry(si, ii) {
  const sec = S.data.daily.sections[si];
  const e = si === -1 ? S.data.daily.flashes[ii] : sec.items[ii];
  const id = e.links.aihot.split("/").pop();
  return S.data.items.find((x) => x.id === id) || {
    id, title: e.title, summary: e.summary || "", source: e.source.name, publishedAt: e.publishedAt || S.data.daily.generatedAt,
    category: null, score: null, reason: null, url: e.links.original,
  };
}
function openItem(it, from) {
  (S.opened = S.opened || {})[it.id] = it;
  markRead(it.id);
  from && from.classList.add("read");
  const scr = pushScreen(D().item(it), { from, mode: D().push, radius: D().radius, onMount: (el) => D().mountDetail?.(el, null, it) });
  edgeSwipe(scr);
}
async function openStory(h, from) {
  let s = S.data.stories[h.storyId];
  if (!s) {
    from && from.classList.add("loading");
    try { s = await getStory(h.storyId); } catch { s = null; }
    from && from.classList.remove("loading");
  }
  if (!s) return toast("这个事件暂时打不开");
  const scr = pushScreen(D().story(s, h), { from, mode: D().push, radius: D().radius, onMount: (el) => D().mountDetail?.(el, s) });
  edgeSwipe(scr);
}

document.addEventListener("click", (e) => {
  const sw = e.target.closest(".studio-switch button");
  if (sw) {
    S.dir = sw.dataset.dir;
    try { localStorage.setItem("dir", S.dir); } catch {}
    return render();
  }
  if (!e.target.closest("#app")) return;
  const tb = e.target.closest("[data-tab-btn]");
  if (tb) return switchTab(tb.dataset.tabBtn);
  const act = e.target.closest("[data-act]");
  if (act) {
    const a = act.dataset.act;
    if (a === "back") return popScreen();
    if (a === "share") return share(act.dataset.title, act.dataset.url);
    if (a === "orig") return openOriginal(act.dataset.url);
    if (a === "cat") {
      S.cat = act.dataset.cat;
      try { D().onCat ? D().onCat() : rerenderTab("feed"); } catch (err) { console.error(err); rerenderTab("feed"); }
      return;
    }
    if (a === "tab") return switchTab(act.dataset.tab);
    if (a === "report") return openReport(act);
    if (a === "listen") {
      const k = act.dataset.kind;
      if (k === "hot") Listen.hot(act);
      if (k === "daily") Listen.daily(act);
      if (k === "story") Listen.story(S.data.stories[act.dataset.id], act);
      if (k === "item") Listen.item(S.opened[act.dataset.id], act);
      return;
    }
    return D().act && D().act(a, act, e);
  }
  const op = e.target.closest("[data-open]");
  if (op) {
    if (op.dataset.dragged === "1") return;
    const [kind, ...rest] = op.dataset.open.split(":");
    if (kind === "item") { const it = S.data.items.find((x) => x.id === rest[0]); if (it) openItem(it, op); }
    if (kind === "story") { const h = S.data.hot.find((x) => x.storyId === rest[0]); if (h) openStory(h, op); }
    if (kind === "ditem") openItem(dailyEntry(+rest[0], +rest[1]), op);
  }
});
addEventListener("resize", () => moveIndicator(false));

// 安卓返回键：先关预览，再关详情页，再回到精选，最后才退出
window.__back = () => {
  const pk = $(".sg-peek");
  if (pk) { pk.remove(); return true; }
  if (S.stack.length) { popScreen(); return true; }
  if (S.tab !== "feed") { switchTab("feed"); return true; }
  return false;
};

function clock() { $("#sbTime").textContent = hm(new Date().toISOString()); }
clock(); setInterval(clock, 30000);

S.data = window.SNAPSHOT;
render();
setStatus();
Promise.all([loadLive(), loadSite().catch(() => {})]).then(() => {
  setStatus();
  if (!S.stack.length) TABS.forEach((t) => rerenderTab(t.key));
  prefetchStories();
}).catch(() => {});
