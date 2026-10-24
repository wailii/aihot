// C 卡堆：刷着看。热点是一摞能甩开的卡，日报是一页一页点过去的快读。
(() => {
  const CATC = { "ai-models": "#2F43E8", "ai-products": "#D9480F", industry: "#0B7A52", paper: "#7A3BE0", tip: "#A86A00", opinion: "#C2255C" };
  let timers = [];
  const clearTimers = () => { timers.forEach((t) => (t.kill ? t.kill() : clearTimeout(t))); timers = []; };
  const firstPara = (t) => String(t || "").split(/\n+/)[0] || "";

  function card(it) {
    return `<article class="dk-card ${S.read.has(it.id) ? "read" : ""}" data-open="item:${it.id}" data-reveal>
      <div class="tp"><span class="cat" style="--c:${CATC[it.category] || "#111"}">${CAT[it.category] || ""}</span><b class="sc">${it.score ?? ""}</b></div>
      <h3>${esc(it.title)}</h3>
      <p>${esc(it.summary)}</p>
      <div class="ft"><span>${esc(shortSource(it.source))}</span><span>${ago(it.publishedAt)}</span></div>
    </article>`;
  }
  function feedList() {
    const groups = groupByDay(feedItems());
    if (!groups.length) return `<p class="empty">这个分类最近 7 天没有精选</p>`;
    return groups.map(([k, list]) => {
      const l = dayLabel(k);
      return `<h2 class="dk-dayhead"><b>${l.head}</b><span>${l.tail}</span></h2>${list.map(card).join("")}`;
    }).join("");
  }
  function cats() {
    const c = catCounts();
    return `<nav class="dk-cats">${CAT_ORDER.filter((k) => c[k]).map((k) => `<button data-act="cat" data-cat="${k}" class="${S.cat === k ? "on" : ""}" style="--c:${CATC[k] || "#111"}">${k === "all" ? "全部" : CAT[k]}</button>`).join("")}</nav>`;
  }
  const dots = (n, cls) => Array.from({ length: Math.min(n, 40) }, () => `<i class="${cls}"></i>`).join("");

  function storyPages() {
    const d = S.data.daily;
    const pages = [{ kind: "cover" }];
    d.sections.forEach((s, si) => s.items.forEach((e, ii) => pages.push({ kind: "item", label: s.label, e, si, ii })));
    if (d.flashes?.length) pages.push({ kind: "flash" });
    pages.push({ kind: "end" });
    return pages;
  }
  function pageHTML(p, i, total) {
    const d = S.data.daily;
    const dt = new Date(d.date + "T00:00:00");
    if (p.kind === "cover") return `<div class="pg cover"><div class="k">AI 日报</div><div class="big">${dt.getMonth() + 1}.${dt.getDate()}</div>
      <div class="wk">${WEEK_CN[dt.getDay()]} · ${total - 2} 条</div><h2>${esc(d.lead.title)}</h2><p>${esc(d.lead.leadParagraph)}</p><div class="hint">点右侧翻页 · 按住暂停</div></div>`;
    if (p.kind === "item") return `<div class="pg"><div class="k">${esc(p.label)}</div><div class="num">${pad(i)}</div><h2>${esc(p.e.title)}</h2><p>${esc(p.e.summary)}</p>
      <div class="src">${esc(shortSource(p.e.source.name))}</div><button class="lnk" data-act="ditem" data-si="${p.si}" data-ii="${p.ii}">看详情</button></div>`;
    if (p.kind === "flash") return `<div class="pg"><div class="k">快讯</div><div class="num">${pad(i)}</div>
      ${d.flashes.map((f, fi) => `<button class="fl" data-act="ditem" data-si="-1" data-ii="${fi}"><b>${esc(f.title)}</b><span>${esc(shortSource(f.source.name))}</span></button>`).join("")}</div>`;
    return `<div class="pg end"><div class="big">看完了</div><p>明早 08:00 出新一期</p><button class="again" data-act="restart">再看一遍</button></div>`;
  }

  function mountStories(el) {
    const pages = storyPages();
    const stage = $(".st-stage", el), bars = $$(".st-bars i", el);
    const DUR = 6500;
    let idx = 0, t0 = 0, paused = false, pausedAt = 0, raf = 0, alive = true;
    function show(i, dir = 1) {
      idx = Math.max(0, Math.min(pages.length - 1, i));
      stage.innerHTML = pageHTML(pages[idx], idx, pages.length);
      const pg = stage.firstElementChild;
      if (!reduceMotion) {
        pg.animate([{ opacity: 0, transform: `translateX(${dir * 36}px)` }, { opacity: 1, transform: "none" }], { duration: 380, easing: "cubic-bezier(.22,.9,.18,1)" });
        $$("h2, p, .src, .lnk, .fl, .num, .big, .wk", pg).forEach((n, k) => n.animate([{ opacity: 0, transform: "translateY(14px)" }, { opacity: 1, transform: "none" }], { duration: 460, delay: 60 + k * 45, easing: "cubic-bezier(.22,.9,.18,1)", fill: "backwards" }));
      }
      bars.forEach((b, k) => b.style.setProperty("--p", k < idx ? 1 : 0));
      t0 = performance.now();
    }
    function tick(now) {
      if (!alive || !el.isConnected) return;
      if (!paused) {
        const p = Math.min(1, (now - t0) / DUR);
        bars[idx].style.setProperty("--p", p);
        if (p >= 1 && idx < pages.length - 1) show(idx + 1);
      }
      raf = requestAnimationFrame(tick);
    }
    let downAt = 0;
    stage.addEventListener("pointerdown", () => { downAt = performance.now(); paused = true; pausedAt = downAt; el.classList.add("paused"); });
    stage.addEventListener("pointerup", (e) => {
      const held = performance.now() - downAt;
      paused = false; el.classList.remove("paused");
      t0 += performance.now() - pausedAt;
      if (held > 280 || e.target.closest("button")) return;
      const r = stage.getBoundingClientRect();
      if (e.clientX - r.left < r.width / 3) show(idx - 1, -1); else if (idx < pages.length - 1) show(idx + 1);
    });
    el.addEventListener("click", (e) => { if (e.target.closest('[data-act="restart"]')) { e.stopPropagation(); show(0); } }, true);
    show(0);
    raf = requestAnimationFrame(tick);
    timers.push({ kill() { alive = false; cancelAnimationFrame(raf); } });
  }

  function mountDeck(sec) {
    const stack = $(".dk-stack", sec);
    const cards = $$(".dk-hcard", stack);
    const N = cards.length;
    const counter = $(".dk-count b", sec);
    let top = 0;
    const pos = (i) => (i - top + N) % N;
    function layout(anim = true) {
      cards.forEach((c, i) => {
        const p = pos(i);
        c.style.transition = anim ? "transform .5s cubic-bezier(.22,.9,.18,1), opacity .4s" : "none";
        c.style.zIndex = N - p;
        c.style.opacity = p > 2 ? 0 : 1;
        c.style.transform = `translateY(${Math.min(p, 3) * 14}px) scale(${1 - Math.min(p, 3) * 0.05})`;
        c.style.pointerEvents = p === 0 ? "auto" : "none";
        c.classList.toggle("top", p === 0);
      });
      counter.textContent = pad(top + 1);
      $$(".dk-prog i", sec).forEach((d, k) => d.classList.toggle("on", k === top));
    }
    layout(false);
    let drag = null;
    stack.addEventListener("pointerdown", (e) => {
      const c = e.target.closest(".dk-hcard.top");
      if (!c) return;
      c.dataset.dragged = "0";
      drag = { c, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0, t: performance.now(), id: e.pointerId };
      c.style.transition = "none";
    });
    stack.addEventListener("pointermove", (e) => {
      if (!drag) return;
      drag.dx = e.clientX - drag.x0; drag.dy = e.clientY - drag.y0;
      if (Math.abs(drag.dx) > 6) { drag.c.dataset.dragged = "1"; try { drag.c.setPointerCapture(drag.id); } catch {} }
      drag.c.style.transform = `translate(${drag.dx}px, ${drag.dy * 0.25}px) rotate(${drag.dx * 0.05}deg)`;
      const next = cards.find((_, i) => pos(i) === 1);
      if (next) { const k = Math.min(1, Math.abs(drag.dx) / 140); next.style.transition = "none"; next.style.transform = `translateY(${14 - 14 * k}px) scale(${0.95 + 0.05 * k})`; }
    });
    const end = () => {
      if (!drag) return;
      const { c, dx } = drag;
      const v = Math.abs(dx) / Math.max(1, performance.now() - drag.t);
      drag = null;
      if (Math.abs(dx) > 90 || (v > 0.6 && Math.abs(dx) > 30)) {
        const dir = Math.sign(dx);
        c.style.transition = "transform .42s cubic-bezier(.3,.7,.3,1), opacity .42s";
        c.style.transform = `translate(${dir * 520}px, 40px) rotate(${dir * 22}deg)`;
        c.style.opacity = 0;
        setTimeout(() => {
          top = (top + (dir < 0 ? 1 : N - 1)) % N;
          if (dir > 0) { // 右滑回到上一条：上一张从右侧飞回
            const prev = cards[top];
            prev.style.transition = "none"; prev.style.opacity = 1; prev.style.zIndex = N + 1;
            prev.style.transform = "translate(520px, 40px) rotate(22deg)";
            void prev.offsetWidth;
          }
          layout(true);
        }, 260);
      } else layout(true);
      setTimeout(() => (c.dataset.dragged = "0"), 30);
    };
    stack.addEventListener("pointerup", end);
    stack.addEventListener("pointercancel", end);
    $(".dk-nav", sec).addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      top = (top + (b.dataset.d === "1" ? 1 : N - 1)) % N;
      layout(true);
    });
  }

  const DirDeck = {
    push: "expand", radius: 22, themeColor: "#ECEAE4", fixedTabs: ["hot"],
    notes: `<h3>C 卡堆</h3><p>按刷手机的习惯来：热点是一摞卡，左滑下一条、右滑回上一条；日报是一页一页点过去的快读，6.5 秒自动翻页。</p>
      <ul><li>卡片底部的黑点是来源数，灰点是讨论数</li><li>点卡片从卡片本身展开成详情</li><li>日报点右侧翻页、点左侧回退、按住暂停</li></ul>`,
    unmount: clearTimers,

    feed() {
      const d = new Date();
      return `<header class="dk-head" data-reveal>
          <div class="dk-date"><b>${d.getDate()}</b><span>${d.getMonth() + 1}月<br>${WEEK[d.getDay()]}</span></div>
          <h1>精选</h1></header>
        <section class="dk-strip">${S.data.hot.slice(0, 6).map((h) => `
          <button class="dk-mini" data-open="story:${h.storyId}"><span class="rk">${pad(h.rank)}</span><b>${esc(h.title)}</b><span class="m">${h.sourceCount} 源 · ${h.signalCount} 讨论</span></button>`).join("")}
          <button class="dk-mini more" data-act="tab" data-tab="hot"><b>全部热点</b><span class="m">${S.data.hot.length} 条</span></button></section>
        <div class="dk-sticky">${cats()}</div>
        <div class="dk-feed">${feedList()}</div>
        <footer class="dk-end">内容来自 AIHOT · aihot.news</footer>`;
    },

    hot() {
      const hot = S.data.hot;
      return `<div class="dk-hot">
        <header class="dk-hot-head"><h1>热点</h1><span class="dk-count"><b>01</b> / ${pad(hot.length)}</span></header>
        <div class="dk-prog">${hot.map(() => "<i></i>").join("")}</div>
        <div class="dk-stack">${hot.map((h, i) => {
          const st = S.data.stories[h.storyId];
          return `<article class="dk-hcard" data-open="story:${h.storyId}" data-i="${i}">
            <div class="rk">${pad(h.rank)}</div>
            <h2>${esc(h.title)}</h2>
            <p>${esc(firstPara(st?.digest) || "")}</p>
            <div class="who">${esc(h.sourceNames.slice(0, 4).map(shortSource).join("、"))}${h.sourceNames.length > 4 ? ` 等 ${h.sourceCount} 家在报道` : " 在报道"}</div>
            <div class="viz"><div class="dots">${dots(h.sourceCount, "s")}${dots(h.signalCount - h.sourceCount, "g")}</div>
              <div class="ft"><span><b>${h.sourceCount}</b> 家来源</span><span><b>${h.signalCount}</b> 条讨论</span><span>${ago(h.latestAt)}</span></div></div>
          </article>`;
        }).join("")}</div>
        <div class="dk-nav"><button data-d="-1" aria-label="上一条">${ICON.back}</button><span>左右滑，点开看全部报道</span><button data-d="1" aria-label="下一条" class="fw">${ICON.back}</button></div>
      </div>`;
    },

    daily() {
      const d = S.data.daily;
      const dt = new Date(d.date + "T00:00:00");
      const n = d.sections.reduce((a, s) => a + s.items.length, 0) + (d.flashes?.length || 0);
      return `<div class="dk-dwrap">
        <header class="dk-head" data-reveal><div class="dk-date"><b>${dt.getDate()}</b><span>${dt.getMonth() + 1}月<br>${WEEK[dt.getDay()]}</span></div><h1>日报</h1></header>
        <button class="dk-cover" data-act="stories">
          <span class="k">今日一读 · ${n} 条 · 约 ${Math.max(1, Math.round(n * 6.5 / 60))} 分钟</span>
          <h2>${esc(d.lead.title)}</h2>
          <p>${esc(d.lead.leadParagraph)}</p>
          <span class="go">开始看</span>
        </button>
        <h2 class="dk-dayhead"><b>目录</b></h2>
        ${d.sections.map((s, si) => s.items.map((e, ii) => `<article class="dk-card" data-open="ditem:${si}:${ii}" data-reveal>
          <div class="tp"><span class="cat">${esc(s.label)}</span></div><h3>${esc(e.title)}</h3><div class="ft"><span>${esc(shortSource(e.source.name))}</span></div></article>`).join("")).join("")}
        ${(d.flashes || []).map((f, i) => `<article class="dk-card" data-open="ditem:-1:${i}" data-reveal><div class="tp"><span class="cat">快讯</span></div><h3>${esc(f.title)}</h3><div class="ft"><span>${esc(shortSource(f.source.name))}</span></div></article>`).join("")}
        <footer class="dk-end">每天 08:00 出新一期</footer></div>`;
    },

    story(s, h) {
      return `<header class="dt-bar"><button data-act="back" aria-label="返回">${ICON.back}</button><span></span>
          <button data-act="share" data-title="${esc(s.title)}" data-url="https://aihot.news/story/${s.publicId}" aria-label="分享">${ICON.share}</button></header>
        <div class="scroller">
          <div class="dk-dt-rk" data-rise>${h ? pad(h.rank) : ""}</div>
          <h1 class="dk-dt-title" data-rise>${esc(s.title)}</h1>
          <div class="dk-dt-meta" data-rise><span><b>${s.sourceCount}</b> 家来源</span><span><b>${s.reportCount}</b> 篇报道</span><span>最新 ${ago(s.latestAt)}</span></div>
          <div class="dk-body" data-rise>${String(s.digest || "").split(/\n+/).filter(Boolean).map((p) => `<p>${esc(p)}</p>`).join("")}</div>
          <h2 class="dk-dayhead" data-rise><b>各家报道</b></h2>
          ${s.reports.map((r, i) => `<article class="dk-card rep" data-act="report" data-sid="${s.publicId}" data-i="${i}" data-rise>
            <div class="tp"><span class="cat">${esc(shortSource(r.source))}${r.firstParty ? " · 一手" : ""}</span><span class="tm">${md(r.publishedAt)} ${hm(r.publishedAt)}</span></div>
            <h3>${esc(r.title)}</h3></article>`).join("")}
        </div>`;
    },

    item(it) {
      return `<header class="dt-bar"><button data-act="back" aria-label="返回">${ICON.back}</button><span></span>
          <button data-act="share" data-title="${esc(it.title)}" data-url="https://aihot.news/items/${it.id}" aria-label="分享">${ICON.share}</button></header>
        <div class="scroller pad-bottom">
          <div class="dk-dt-top" data-rise><span class="cat" style="--c:${CATC[it.category] || "#111"}">${CAT[it.category] || "精选"}</span>${it.score ? `<b>${it.score}</b>` : ""}</div>
          <h1 class="dk-dt-title" data-rise>${esc(it.title)}</h1>
          <div class="dk-dt-meta" data-rise><span>${esc(shortSource(it.source))}</span><span>${md(it.publishedAt)} ${hm(it.publishedAt)}</span></div>
          <div class="dk-body" data-rise>${String(it.summary || "").split(/\n+/).filter(Boolean).map((p) => `<p>${esc(p)}</p>`).join("")}</div>
          ${it.reason ? `<aside class="dk-why" data-rise><b>为什么入选</b><p>${esc(it.reason)}</p></aside>` : ""}
        </div>
        <div class="dt-actions"><button class="primary" data-act="orig" data-url="${esc(it.url)}">阅读原文 ${ICON.out}</button></div>`;
    },

    mount(key, sec) { if (key === "hot") mountDeck(sec); },
    onTab(key, sec) {
      if (key === "hot") $$(".dk-hcard.top", sec).forEach((c) => c.animate([{ transform: "translateY(40px) scale(.94)", opacity: 0 }, { transform: c.style.transform, opacity: 1 }], { duration: 520, easing: "cubic-bezier(.22,.9,.18,1)" }));
    },
    onCat() {
      const sec = $('.screen.tab[data-tab="feed"]');
      $$(".dk-cats button", sec).forEach((b) => b.classList.toggle("on", b.dataset.cat === S.cat));
      const box = $(".dk-feed", sec);
      box.innerHTML = feedList();
      revealOnScroll(box, $(".scroller", sec));
      const st = $(".dk-sticky", sec), sc = $(".scroller", sec);
      if (sc.scrollTop > st.offsetTop) sc.scrollTo({ top: st.offsetTop });
    },
    act(a, el) {
      if (a === "report") return openReport(el);
      if (a === "stories") {
        const scr = pushScreen(`<div class="st"><div class="st-bars">${storyPages().map(() => "<i></i>").join("")}</div>
          <button class="st-x" data-act="back" aria-label="关闭">${ICON.close}</button><div class="st-stage"></div></div>`,
          { from: el, mode: "expand", radius: 26, onMount: mountStories });
        scr.classList.add("stories");
      }
      if (a === "ditem") openItem(dailyEntry(+el.dataset.si, +el.dataset.ii), el);
    },
  };
  window.DirDeck = DirDeck;
})();
