// A 报刊：衬线大标题、细线分隔、头版式日报。动效是排字和画线。
(() => {
  const today = () => { const d = new Date(); return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${WEEK_CN[d.getDay()]}`; };
  const paras = (t) => String(t || "").split(/\n+/).filter(Boolean).map((p) => `<p>${esc(p)}</p>`).join("");
  const maxSignal = () => Math.max(...S.data.hot.map((h) => h.signalCount));

  function cats() {
    const c = catCounts();
    return `<nav class="pp-cats" data-reveal>${CAT_ORDER.filter((k) => c[k]).map((k) => `
      <button data-act="cat" data-cat="${k}" class="${S.cat === k ? "on" : ""}">${k === "all" ? "全部" : CAT[k]}<sup>${c[k]}</sup></button>`).join("")}</nav>`;
  }
  function itemRow(it, lead) {
    return `<article class="pp-item ${lead ? "lead" : ""} ${S.read.has(it.id) ? "read" : ""}" data-open="item:${it.id}" data-reveal>
      <div class="pp-meta"><span class="src">${esc(shortSource(it.source))}</span><span>${hm(it.publishedAt)}</span>${it.category ? `<span>${CAT[it.category] || ""}</span>` : ""}<b class="score">${it.score ?? ""}</b></div>
      <h3 class="pp-h">${esc(it.title)}</h3>
      <p class="pp-sum">${esc(it.summary)}</p>
    </article>`;
  }
  function feedList() {
    const groups = groupByDay(feedItems());
    if (!groups.length) return `<p class="empty">这个分类最近 7 天没有精选</p>`;
    return groups.map(([k, list]) => {
      const l = dayLabel(k);
      const top = list.reduce((a, b) => ((b.score || 0) > (a.score || 0) ? b : a));
      return `<section class="pp-day"><h2 class="pp-dayhead" data-reveal><b>${l.head}</b><span>${l.tail}</span><em>${list.length} 条</em></h2>
        ${list.map((it) => itemRow(it, it === top && list.length > 2)).join("")}</section>`;
    }).join("");
  }

  const DirPaper = {
    push: "slide", radius: 0, themeColor: "#F4F0E8",
    notes: `<h3>A 报刊</h3><p>当成一份每天更新的报纸来读。标题用宋体衬线，信息靠细线和字号分层，几乎不用框。</p>
      <ul><li>报头往上滑会收成一行</li><li>热点数字、头条标题有排字动画</li><li>详情页从右侧推入，左缘右滑返回</li><li>日报是头版排法，首字下沉</li></ul>`,

    feed() {
      const hot3 = S.data.hot.slice(0, 3);
      return `<header class="pp-mast">
          <div class="pp-mast-top"><span>${today()}</span><span>${S.data.items.length} 条精选 · 7 天</span></div>
          <h1 class="pp-title" data-split>AI 热点</h1>
          <div class="pp-rule double"></div>
        </header>
        <div class="pp-condensed"><b>AI 热点</b><span>${md(new Date().toISOString())}</span></div>
        <section class="pp-hot3" data-reveal>
          <div class="pp-label"><span>当前热点</span><button data-act="tab" data-tab="hot">全部 ${S.data.hot.length} 条</button></div>
          ${hot3.map((h) => `<div class="pp-hot3-row" data-open="story:${h.storyId}">
            <span class="n">${h.rank}</span><span class="t">${esc(h.title)}</span><span class="c">${h.sourceCount}<small>源</small></span></div>`).join("")}
        </section>
        ${cats()}
        <div class="pp-feed">${feedList()}</div>
        <footer class="pp-end">内容来自 AIHOT · aihot.news</footer>`;
    },

    hot() {
      const max = maxSignal();
      return `<header class="pp-sechead"><div class="pp-kick">热点榜</div><h1 data-split>当前热点</h1>
          <p>48 小时内，每个独立来源只算一次</p><div class="pp-rule"></div></header>
        <ol class="pp-hotlist">${S.data.hot.map((h) => `
          <li data-open="story:${h.storyId}" data-reveal>
            <span class="n">${pad(h.rank)}</span>
            <div class="b">
              <h3>${esc(h.title)}</h3>
              <div class="m"><span><b data-count="${h.sourceCount}">${h.sourceCount}</b> 家来源</span><span>${h.signalCount} 条讨论</span><span>${ago(h.latestAt)}</span></div>
              <div class="who">${esc(h.sourceNames.slice(0, 3).map(shortSource).join("、"))}${h.sourceNames.length > 3 ? " 等" : ""}</div>
              <i class="bar" style="--w:${(h.signalCount / max).toFixed(3)}"></i>
            </div>
          </li>`).join("")}</ol>
        <footer class="pp-end">每分钟更新 · 内容来自 AIHOT</footer>`;
    },

    daily() {
      const d = S.data.daily;
      const dt = new Date(d.date + "T00:00:00");
      const ws = new Date(d.windowStart);
      return `<header class="pp-dmast">
          <div class="pp-mast-top"><span>${dt.getFullYear()}年${dt.getMonth() + 1}月${dt.getDate()}日 ${WEEK_CN[dt.getDay()]}</span><span>收录 ${ws.getMonth() + 1}月${ws.getDate()}日全天</span></div>
          <h1 class="pp-title" data-split>AI 日报</h1>
          <div class="pp-rule double"></div>
        </header>
        <article class="pp-lead" data-open="ditem:0:0" data-reveal>
          <div class="pp-kick">头条</div>
          <h2>${esc(d.lead.title)}</h2>
          <p class="drop">${esc(d.lead.leadParagraph)}</p>
        </article>
        ${d.sections.map((s, si) => `<section class="pp-dsec" data-reveal>
          <div class="pp-label red"><span>${esc(s.label)}</span><em>${s.items.length}</em></div>
          ${s.items.map((e, ii) => (si === 0 && ii === 0) ? "" : `<article class="pp-ditem" data-open="ditem:${si}:${ii}">
            <h3>${esc(e.title)}</h3><p>${esc(e.summary)}</p><div class="src">${esc(shortSource(e.source.name))}</div></article>`).join("") || `<p class="pp-same">见头条</p>`}
        </section>`).join("")}
        ${d.flashes?.length ? `<section class="pp-dsec" data-reveal><div class="pp-label red"><span>快讯</span><em>${d.flashes.length}</em></div>
          ${d.flashes.map((f, i) => `<article class="pp-flash" data-open="ditem:-1:${i}"><h3>${esc(f.title)}</h3><span>${esc(shortSource(f.source.name))}</span></article>`).join("")}</section>` : ""}
        <footer class="pp-end">每天 08:00 出新一期</footer>`;
    },

    story(s, h) {
      const ps = String(s.digest || "").split(/\n+/).filter(Boolean);
      return `<header class="dt-bar"><button data-act="back" aria-label="返回">${ICON.back}</button><span>事件</span>
          <button data-act="share" data-title="${esc(s.title)}" data-url="https://aihot.news/story/${s.publicId}" aria-label="分享">${ICON.share}</button></header>
        <div class="scroller">
          <div class="pp-kick">${s.sourceCount} 家来源 · ${s.reportCount} 篇报道</div>
          <h1 class="pp-dt-title" data-split>${esc(s.title)}</h1>
          <div class="pp-dt-meta">首报 ${md(s.firstReportAt)} ${hm(s.firstReportAt)}　最新 ${ago(s.latestAt)}</div>
          <div class="pp-rule draw"></div>
          <div class="pp-body">${ps.map((p, i) => `<p class="${i === 0 ? "drop" : ""}">${esc(p)}</p>`).join("")}</div>
          <div class="pp-label"><span>各家报道</span><em>按时间</em></div>
          <ol class="pp-reports">${s.reports.map((r, i) => `
            <li data-act="report" data-sid="${s.publicId}" data-i="${i}">
              <time>${md(r.publishedAt)}<br>${hm(r.publishedAt)}</time>
              <div><div class="src">${esc(shortSource(r.source))}${r.firstParty ? `<b>一手</b>` : ""}</div><h4>${esc(r.title)}</h4></div>
            </li>`).join("")}</ol>
          <footer class="pp-end">内容来自 AIHOT</footer>
        </div>`;
    },

    item(it) {
      return `<header class="dt-bar"><button data-act="back" aria-label="返回">${ICON.back}</button><span>${it.category ? CAT[it.category] : "精选"}</span>
          <button data-act="share" data-title="${esc(it.title)}" data-url="https://aihot.news/items/${it.id}" aria-label="分享">${ICON.share}</button></header>
        <div class="scroller pad-bottom">
          <div class="pp-kick">${esc(shortSource(it.source))} · ${md(it.publishedAt)} ${hm(it.publishedAt)}${it.score ? ` · <b>${it.score}</b> 分` : ""}</div>
          <h1 class="pp-dt-title" data-split>${esc(it.title)}</h1>
          <div class="pp-rule draw"></div>
          <div class="pp-body">${String(it.summary || "").split(/\n+/).filter(Boolean).map((p, i) => `<p class="${i === 0 ? "drop" : ""}">${esc(p)}</p>`).join("")}</div>
          ${it.reason ? `<aside class="pp-why"><div class="pp-kick">为什么入选</div><p>${esc(it.reason)}</p></aside>` : ""}
        </div>
        <div class="dt-actions"><button class="primary" data-act="orig" data-url="${esc(it.url)}">阅读原文 ${ICON.out}</button></div>`;
    },

    mount(key, sec) {
      const cond = $(".pp-condensed", sec);
      if (cond) sec.appendChild(cond);
      $$("[data-split]", sec).forEach((el) => splitChars(el, 80, 60));
      $$("[data-count]", sec).forEach((el) => countUp(el, +el.dataset.count));
    },
    mountDetail(el) {
      $$("[data-split]", el).forEach((t) => splitChars(t, 120, 18));
      const sc = $(".scroller", el);
      sc && revealOnScroll(el, sc);
    },
    onTab(key, sec) {
      $$("[data-split]", sec).forEach((el) => { el.textContent = el.textContent; splitChars(el, 40, 50); });
    },
    onCat() {
      const sec = $('.screen.tab[data-tab="feed"]');
      $$(".pp-cats button", sec).forEach((b) => b.classList.toggle("on", b.dataset.cat === S.cat));
      const box = $(".pp-feed", sec);
      box.innerHTML = feedList();
      revealOnScroll(box, $(".scroller", sec));
      const cats = $(".pp-cats", sec), sc = $(".scroller", sec);
      if (sc.scrollTop > cats.offsetTop - 50) sc.scrollTo({ top: cats.offsetTop - 50 });
    },
    act(a, el) { if (a === "report") openReport(el); },
  };

  window.openReport = function (el) {
    const s = S.data.stories[el.dataset.sid];
    const r = s.reports[+el.dataset.i];
    const it = S.data.items.find((x) => x.id === r.id) || { id: r.id, title: r.title, summary: r.summary, source: r.source, publishedAt: r.publishedAt, category: null, score: null, reason: null, url: r.url };
    openItem(it, el);
  };
  window.DirPaper = DirPaper;
})();
