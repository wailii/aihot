// B 汇流：很多家来源说同一件事，汇成一个事件。首页顶部是热点舞台：粒子从四周绕成漩涡汇向这件事，
// 线的多少、粒子的快慢、飘过的名字都来自接口里这件事的真实来源。左右滑换一件，按住拨开粒子流。
(() => {
  let loops = [];
  let hero = null;
  const stopAll = () => { loops.forEach((l) => l.stop()); loops = []; hero = null; };
  const TAU = Math.PI * 2;
  const rnd = (seed) => { const x = Math.sin(seed * 9301 + 49297) * 233280; return x - Math.floor(x); };
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);

  // ── 粒子场 ──
  function Field(canvas, { compact = false, focal = [0.7, 0.3], delay = 0 } = {}) {
    const ctx = canvas.getContext("2d");
    const dpr = Math.min(2, devicePixelRatio || 1);
    let W = 0, H = 0, raf = 0, alive = true, visible = true, last = performance.now(), time = 0;
    let speed = 1, targetSpeed = 1, parX = 0, tParX = 0;
    let fx = 0, fy = 0, tfx = focal[0], tfy = focal[1], pulse = 0;
    const sets = [], parts = [];
    const finger = { x: 0, y: 0, on: 0, target: 0 };
    let labelCount = 0;
    const startAt = performance.now() + delay;

    function resize() {
      const r = canvas.getBoundingClientRect();
      if (!r.width) return;
      W = r.width; H = r.height;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!fx) { fx = tfx; fy = tfy; }
    }
    function makeSet(h, seed) {
      const n = compact ? Math.min(3 + h.sourceCount, 12) : Math.round(10 + Math.min(h.sourceCount, 16) * 1.25);
      const streams = Array.from({ length: n }, (_, k) => {
        const u = (k + rnd(seed + k) * 0.8) / n;
        return {
          th: compact ? Math.PI * (0.78 + 0.44 * u) : Math.PI * (0.5 + 1.15 * u) + (rnd(seed * 3 + k) - 0.5) * 0.2,
          sw: compact ? 0.25 : 0.75 + rnd(seed + k * 7) * 0.5,
          w: 0.6 + rnd(seed + k * 13) * 0.9,
        };
      });
      return { streams, alpha: 0, dir: 1, rate: compact ? 1.2 + h.signalCount * 0.12 : 12 + h.signalCount * 0.5, names: (h.names || []).filter(Boolean), acc: 0 };
    }
    // 三次贝塞尔：从画布外，经过两次偏转，绕进焦点
    function pt(st, t, out) {
      const R = Math.max(W, H) * (compact ? 1.05 : 0.8);
      const ax = fx * W + parX, ay = fy * H;
      const a0 = st.th, a1 = st.th + st.sw * 0.45, a2 = st.th + st.sw;
      const p0x = ax + Math.cos(a0) * R, p0y = ay + Math.sin(a0) * R;
      const p1x = ax + Math.cos(a1) * R * 0.62, p1y = ay + Math.sin(a1) * R * 0.62;
      const p2x = ax + Math.cos(a2) * R * 0.22, p2y = ay + Math.sin(a2) * R * 0.22;
      const u = 1 - t, b0 = u * u * u, b1 = 3 * u * u * t, b2 = 3 * u * t * t, b3 = t * t * t;
      out.x = b0 * p0x + b1 * p1x + b2 * p2x + b3 * ax;
      out.y = b0 * p0y + b1 * p1y + b2 * p2y + b3 * ay;
      if (finger.on > 0.01) {
        const dx = out.x - finger.x, dy = out.y - finger.y, d = Math.hypot(dx, dy) || 1, R0 = 74;
        if (d < R0) { const k = ((R0 - d) / R0) * 30 * finger.on; out.x += (dx / d) * k; out.y += (dy / d) * k; }
      }
      return out;
    }
    const P = { x: 0, y: 0 }, Q = { x: 0, y: 0 };

    function spawn(s, v) {
      const st = s.streams[(Math.random() * s.streams.length) | 0];
      let label = null;
      if (!compact && s.names.length && labelCount < 3 && Math.random() < 0.18) { label = s.names[(Math.random() * s.names.length) | 0]; labelCount++; }
      parts.push({ s, st, t: 0, v: (compact ? 0.16 + Math.random() * 0.12 : 0.13 + Math.random() * 0.1) * v, ink: Math.random() < 0.28, label });
    }
    function emit(dt) {
      for (const s of sets) {
        if (s.dir < 0) continue;
        s.acc += dt * s.rate * speed;
        while (s.acc > 1) { s.acc -= 1; spawn(s, 1); }
      }
    }

    function frame(now) {
      if (!alive) return;
      if (!canvas.isConnected) return api.stop();
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      // 被详情页盖住、还没到开始时间、或不在屏幕里时不画
      const top = S.stack[S.stack.length - 1]?.el;
      if (!visible || (top && !top.contains(canvas)) || now < startAt) { raf = requestAnimationFrame(frame); return; }
      if (!W) resize();
      time += dt;
      speed += (targetSpeed - speed) * Math.min(1, dt * 5);
      parX += (tParX - parX) * Math.min(1, dt * 10);
      fx += (tfx - fx) * Math.min(1, dt * 3.2);
      fy += (tfy - fy) * Math.min(1, dt * 3.2);
      finger.on += (finger.target - finger.on) * Math.min(1, dt * 8);
      pulse *= Math.pow(0.04, dt);
      for (let i = sets.length - 1; i >= 0; i--) {
        const s = sets[i];
        s.alpha = Math.max(0, Math.min(1, s.alpha + s.dir * dt * 1.8));
        if (s.dir < 0 && s.alpha <= 0) sets.splice(i, 1);
      }
      emit(dt);
      ctx.clearRect(0, 0, W, H);
      const ax = fx * W + parX, ay = fy * H;

      // 焦点光晕
      if (!compact) {
        const gr = 150 + Math.sin(time * 1.4) * 8 + pulse * 30;
        const g = ctx.createRadialGradient(ax, ay, 0, ax, ay, gr);
        g.addColorStop(0, `rgba(255,110,30,${0.28 + pulse * 0.12})`);
        g.addColorStop(0.45, "rgba(255,140,70,.10)");
        g.addColorStop(1, "rgba(255,160,90,0)");
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      }
      // 线
      for (const s of sets) {
        for (const st of s.streams) {
          ctx.beginPath();
          for (let k = 0; k <= 26; k++) { pt(st, k / 26, P); k ? ctx.lineTo(P.x, P.y) : ctx.moveTo(P.x, P.y); }
          ctx.strokeStyle = `rgba(60,36,20,${(compact ? 0.12 : 0.085) * s.alpha * st.w})`;
          ctx.lineWidth = compact ? 0.8 : 1;
          ctx.stroke();
        }
      }
      // 粒子
      ctx.lineCap = "round";
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.t += p.v * dt * speed * (1.3 - p.t * 0.6);
        if (p.t >= 1) {
          if (p.label) labelCount--;
          pulse = Math.min(1, pulse + (compact ? 0.4 : 0.12));
          parts.splice(i, 1);
          continue;
        }
        const a = p.s.alpha;
        pt(p.st, p.t, P);
        pt(p.st, Math.max(0, p.t - (compact ? 0.06 : 0.075)), Q);
        const c = p.ink ? "40,28,20" : "255,90,0";
        ctx.strokeStyle = `rgba(${c},${0.32 * a})`; ctx.lineWidth = compact ? 1.4 : 2;
        ctx.beginPath(); ctx.moveTo(Q.x, Q.y); ctx.lineTo(P.x, P.y); ctx.stroke();
        ctx.fillStyle = `rgba(${c},${a})`;
        ctx.beginPath(); ctx.arc(P.x, P.y, compact ? 1.3 : 2.3, 0, TAU); ctx.fill();
        if (p.label) {
          const edge = Math.max(0, Math.min(1, (P.x - 6) / 40, (W - P.x - 70) / 40, (P.y - 14) / 30));
          const la = Math.sin(Math.PI * Math.min(1, p.t * 1.25)) * a * edge;
          ctx.font = "500 10px 'JetBrains Mono', ui-monospace, monospace";
          ctx.fillStyle = `rgba(60,40,28,${0.62 * la})`;
          ctx.fillText(p.label, P.x + 7, P.y - 6);
        }
      }
      // 焦点：一圈圈往外的波纹 + 实心核
      const r0 = compact ? 3.2 : 7;
      if (!compact) {
        for (let k = 0; k < 3; k++) {
          const ph = (time * 0.32 + k / 3) % 1;
          ctx.strokeStyle = `rgba(255,90,0,${(1 - ph) * 0.32})`;
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(ax, ay, r0 + 6 + ph * 70, 0, TAU); ctx.stroke();
        }
      }
      ctx.fillStyle = "#16100C";
      ctx.beginPath(); ctx.arc(ax, ay, r0 * (1 + pulse * 0.22), 0, TAU); ctx.fill();
      ctx.fillStyle = "#FF5A00";
      ctx.beginPath(); ctx.arc(ax, ay, r0 * 0.38, 0, TAU); ctx.fill();
      // 手指
      if (finger.on > 0.02) {
        ctx.strokeStyle = `rgba(22,16,12,${0.18 * finger.on})`;
        ctx.setLineDash([2, 4]);
        ctx.beginPath(); ctx.arc(finger.x, finger.y, 30 + finger.on * 12, 0, TAU); ctx.stroke();
        ctx.setLineDash([]);
      }
      raf = requestAnimationFrame(frame);
    }

    const ro = new ResizeObserver(() => canvas.isConnected && resize());
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => { if (e) visible = e.isIntersecting; });
    io.observe(canvas);
    resize();
    raf = requestAnimationFrame(frame);

    const api = {
      setFocus(h, { immediate = false, seed = 1 } = {}) {
        sets.forEach((s) => (s.dir = -1));
        const s = makeSet(h, seed);
        if (immediate) s.alpha = 1;
        sets.push(s);
        if (!compact) {
          tfx = focal[0] + (rnd(seed * 5) - 0.5) * 0.14;
          tfy = focal[1] + (rnd(seed * 11) - 0.5) * 0.1;
          for (let k = 0; k < 14; k++) spawn(s, 1.8 + Math.random());
        } else {
          for (let k = 0; k < 3; k++) { spawn(s, 1); parts[parts.length - 1].t = Math.random() * 0.8; }
        }
      },
      finger(x, y, on) { finger.x = x; finger.y = y; finger.target = on; },
      kick(k = 0.4) {
        pulse = Math.min(1, pulse + k);
        const s = sets.find((x) => x.dir > 0);
        if (s) for (let n = 0; n < 2; n++) { spawn(s, 2.4); parts[parts.length - 1].t = 0.35 + Math.random() * 0.25; }
      },
      speed(k) { targetSpeed = k; },
      parallax(px) { tParX = px; },
      stop() { alive = false; cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); },
    };
    loops.push(api);
    return api;
  }

  // ── 事件的报道时间轴：每篇报道按时间落点，线汇进右侧；手指拖动看每一篇 ──
  function Timeline(canvas, s, tip, onPick) {
    const ctx = canvas.getContext("2d");
    const dpr = Math.min(2, devicePixelRatio || 1);
    const t0 = new Date(s.firstReportAt).getTime(), span = Math.max(1, new Date(s.latestAt).getTime() - t0);
    let W = 0, H = 0, raf = 0, alive = true, hl = -1;
    const start = performance.now();
    const pos = [];
    function draw(now) {
      if (!alive || !canvas.isConnected) return;
      const r = canvas.getBoundingClientRect();
      if (r.width !== W) { W = r.width; H = r.height; canvas.width = W * dpr; canvas.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
      ctx.clearRect(0, 0, W, H);
      const p = reduceMotion ? 1 : easeOut(Math.min(1, (now - start) / 1600));
      const ex = W - 12, ey = (H - 22) / 2, axisY = H - 18;
      ctx.strokeStyle = "rgba(60,36,20,.14)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(6, axisY); ctx.lineTo(ex - 22, axisY); ctx.stroke();
      s.reports.forEach((rep, i) => {
        const x = 8 + ((new Date(rep.publishedAt) - t0) / span) * (ex - 64);
        const y = 10 + rnd(i + 3) * (axisY - 30);
        pos[i] = { x, y };
        const local = Math.max(0, Math.min(1, p * 1.6 - (i / s.reports.length) * 0.6));
        const on = i === hl;
        ctx.strokeStyle = on ? "rgba(255,90,0,.9)" : "rgba(60,36,20,.2)";
        ctx.lineWidth = on ? 1.8 : 1;
        ctx.beginPath(); ctx.moveTo(x, y);
        for (let k = 1; k <= 30 * local; k++) {
          const t = k / 30, u = 1 - t, c1x = x + (ex - x) * 0.45, c2x = x + (ex - x) * 0.7;
          ctx.lineTo(u * u * u * x + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * ex, u * u * u * y + 3 * u * u * t * y + 3 * u * t * t * ey + t * t * t * ey);
        }
        ctx.stroke();
        ctx.fillStyle = rep.firstParty ? "#FF5A00" : "#16100C";
        ctx.beginPath(); ctx.arc(x, y, (on ? 5 : 3.2) * Math.min(1, local * 3), 0, TAU); ctx.fill();
        if (on) { ctx.strokeStyle = "rgba(255,90,0,.35)"; ctx.beginPath(); ctx.arc(x, y, 10, 0, TAU); ctx.stroke(); }
        ctx.strokeStyle = "rgba(60,36,20,.14)"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, axisY - 3); ctx.lineTo(x, axisY + 3); ctx.stroke();
      });
      ctx.fillStyle = "#16100C"; ctx.beginPath(); ctx.arc(ex, ey, 6 + p * 2, 0, TAU); ctx.fill();
      ctx.fillStyle = "#FF5A00"; ctx.beginPath(); ctx.arc(ex, ey, 2.6, 0, TAU); ctx.fill();
      ctx.fillStyle = "rgba(60,40,28,.5)"; ctx.font = "500 10px 'JetBrains Mono', monospace";
      ctx.fillText(`${md(s.firstReportAt)} ${hm(s.firstReportAt)}`, 6, H - 2);
      const lt = `${md(s.latestAt)} ${hm(s.latestAt)}`; ctx.fillText(lt, ex - 20 - ctx.measureText(lt).width, H - 2);
      raf = requestAnimationFrame(draw);
    }
    function pick(clientX) {
      const r = canvas.getBoundingClientRect(), x = clientX - r.left;
      let best = -1, bd = 1e9;
      pos.forEach((p, i) => { const d = Math.abs(p.x - x); if (d < bd) { bd = d; best = i; } });
      return best;
    }
    function showTip(i) {
      hl = i;
      if (i < 0) { tip.classList.remove("on"); return; }
      const rep = s.reports[i], p = pos[i];
      tip.innerHTML = `<b>${esc(shortSource(rep.source))}${rep.firstParty ? " · 一手" : ""}</b><span>${md(rep.publishedAt)} ${hm(rep.publishedAt)}</span><p>${esc(rep.title)}</p>`;
      tip.classList.add("on");
      const w = tip.offsetWidth, cw = canvas.offsetWidth;
      tip.style.left = Math.max(0, Math.min(cw - w, p.x - w / 2)) + "px";
      tip.style.top = p.y - tip.offsetHeight - 14 + "px";
    }
    let down = false;
    canvas.addEventListener("pointerdown", (e) => { down = true; try { canvas.setPointerCapture(e.pointerId); } catch {} showTip(pick(e.clientX)); });
    canvas.addEventListener("pointermove", (e) => { if (down || e.pointerType === "mouse") showTip(pick(e.clientX)); });
    canvas.addEventListener("pointerup", () => { down = false; if (hl >= 0) onPick(hl); });
    canvas.addEventListener("pointerleave", () => { if (!down) showTip(-1); });
    raf = requestAnimationFrame(draw);
    const api = { stop() { alive = false; cancelAnimationFrame(raf); }, highlight: (i) => (hl = i) };
    loops.push(api);
    return api;
  }

  // ── 首页热点舞台：只放第一条，点开看详情 ──
  function mountHero(sec) {
    const el = $(".sg-hero", sec);
    if (!el) return;
    const h = S.data.hot[0];
    const field = Field($("canvas", el), { focal: [0.72, 0.36] });
    field.setFocus({ ...h, names: h.sourceNames.map(shortSource) }, { immediate: true, seed: 1 });
    splitChars($(".sg-ht h2", el), 260, 20);
    const local = (e) => { const r = el.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    el.addEventListener("pointermove", (e) => { if (e.pointerType === "mouse") field.finger(...local(e), 0.55); });
    el.addEventListener("pointerleave", () => field.finger(0, 0, 0));
  }
  const coverOf = (h) => S.data.site?.hot?.[h.storyId]?.cover?.url;
  const latestOf = (h) => {
    const sh = S.data.site?.hot?.[h.storyId], st = S.data.stories[h.storyId];
    const l = sh?.latest || st?.latest;
    return l && l !== h.title ? l : String(sh?.summary || st?.digest || "").split(/[。\n]/)[0];
  };
  function spark(h, w = 64, hgt = 20) {
    const pts = (S.data.site?.hot?.[h.storyId]?.spark || []).map((v, i) => [i, v]).filter(([, v]) => v != null);
    if (pts.length < 3) return "";
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys) || 1;
    const P = pts.map(([x, y]) => `${(((x - x0) / Math.max(1, x1 - x0)) * w).toFixed(1)},${(hgt - 2 - ((y - y0) / Math.max(1e-6, y1 - y0)) * (hgt - 4)).toFixed(1)}`);
    return `<svg class="sg-spark" viewBox="0 0 ${w} ${hgt}" width="${w}" height="${hgt}"><polyline points="${P.join(" ")}"/></svg>`;
  }
  const people = (h, n = 4) => {
    const ps = (S.data.site?.hot?.[h.storyId]?.people || []).filter((p) => p.icon).slice(0, n);
    return ps.length ? `<span class="sg-faces">${ps.map((p) => `<img src="${esc(img(p.icon))}" alt="" loading="lazy">`).join("")}</span>` : "";
  };

  // ── 长按预览 ──
  function peek(it, from) {
    const host = app();
    const r = relRect(from);
    const ov = document.createElement("div");
    ov.className = "sg-peek";
    ov.innerHTML = `<div class="sg-peek-bg"></div><div class="sg-peek-card">
      <div class="sg-meta"><span class="cat">${CAT[it.category] || "精选"}</span><span>${esc(shortSource(it.source))}</span><span>${ago(it.publishedAt)}</span></div>
      <h3>${esc(it.title)}</h3><p>${esc(it.summary)}</p>
      ${it.reason ? `<div class="why"><b>为什么入选</b>${esc(it.reason)}</div>` : ""}
      <div class="acts"><button data-peek="open">打开</button><button data-peek="orig">原文 ${ICON.out}</button></div></div>`;
    host.appendChild(ov);
    const card = $(".sg-peek-card", ov), bg = $(".sg-peek-bg", ov);
    const cr = relRect(card);
    const sx = r.w / cr.w, dy = r.top - cr.top + (r.h - cr.h * sx) / 2;
    card.animate([{ transform: `translate(${r.left - cr.left}px, ${dy}px) scale(${sx})`, opacity: 0.6 }, { transform: "none", opacity: 1 }], { duration: 420, easing: "cubic-bezier(.3,1.25,.4,1)" });
    bg.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260 });
    const close = () => {
      card.animate([{ transform: "none", opacity: 1 }, { transform: "scale(.94)", opacity: 0 }], { duration: 200, easing: "ease-in", fill: "forwards" });
      bg.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, fill: "forwards" }).onfinish = () => ov.remove();
    };
    ov.addEventListener("click", (e) => {
      e.stopPropagation();
      const b = e.target.closest("[data-peek]");
      if (b?.dataset.peek === "orig") return openOriginal(it.url);
      close();
      if (b?.dataset.peek === "open") setTimeout(() => openItem(it, from), 120);
    });
  }
  function longPress(root) {
    let timer = null, start = null;
    root.addEventListener("pointerdown", (e) => {
      const row = e.target.closest(".sg-item");
      if (!row) return;
      start = { x: e.clientX, y: e.clientY, row };
      row.classList.add("pressing");
      timer = setTimeout(() => {
        row.classList.remove("pressing");
        row.dataset.dragged = "1";
        setTimeout(() => (row.dataset.dragged = "0"), 500);
        navigator.vibrate && navigator.vibrate(12);
        const it = S.data.items.find((x) => x.id === row.dataset.open.split(":")[1]);
        if (it) peek(it, row);
        start = null;
      }, 430);
    });
    const cancel = (e) => {
      if (!start) return;
      if (e.type === "pointermove" && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 8) return;
      clearTimeout(timer); start.row.classList.remove("pressing"); start = null;
    };
    root.addEventListener("pointermove", cancel);
    root.addEventListener("pointerup", cancel);
    root.addEventListener("pointercancel", cancel);
    root.addEventListener("contextmenu", (e) => { if (e.target.closest(".sg-item")) e.preventDefault(); });
  }

  // ── 分类：滑动的底块 ──
  function placePill(sec, animate = true) {
    const nav = $(".sg-cats", sec), on = $(".sg-cats button.on", sec), pill = $(".sg-pill", sec);
    if (!nav || !on || !pill) return;
    pill.style.transition = animate ? "" : "none";
    pill.style.transform = `translateX(${on.offsetLeft}px)`;
    pill.style.width = on.offsetWidth + "px";
    const target = on.offsetLeft - nav.clientWidth / 2 + on.offsetWidth / 2;
    nav.scrollTo({ left: target, behavior: animate ? "smooth" : "auto" });
  }

  const bars5 = (v) => {
    const n = v ? Math.max(1, Math.min(5, Math.round((v - 58) / 8))) : 0;
    return `<span class="sg-sig" title="精选分 ${v ?? ""}">${[1, 2, 3, 4, 5].map((k) => `<i class="${k <= n ? "on" : ""}"></i>`).join("")}</span>`;
  };
  const MAJOR = 75;
  function itemRow(it) {
    const major = (it.score || 0) >= MAJOR;
    const th = S.data.site?.media?.[it.id]?.[0]?.url;
    return `<article class="sg-item ${major ? "major" : "minor"} ${S.read.has(it.id) ? "read" : ""}" data-open="item:${it.id}" data-reveal>
      <time>${hm(it.publishedAt)}</time><i class="dot"></i>
      <div class="bd">
        ${major ? `<div class="sg-meta"><span class="cat">${CAT[it.category] || ""}</span><span class="src">${esc(shortSource(it.source))}</span><span class="tag">重点</span></div>` : ""}
        ${th && major ? `<img class="sg-thumb" src="${esc(img(th))}" alt="" loading="lazy">` : ""}
        <h3>${esc(it.title)}</h3>
        ${major ? `<p>${esc(it.summary)}</p>` : `<div class="sg-meta sm"><span class="src">${esc(shortSource(it.source))}</span><span>${CAT[it.category] || ""}</span></div>`}
      </div>
    </article>`;
  }
  function feedList() {
    const groups = groupByDay(feedItems());
    if (!groups.length) return `<p class="empty">这个分类最近 7 天没有精选</p>`;
    return groups.map(([k, list]) => {
      const l = dayLabel(k);
      const nMajor = list.filter((x) => (x.score || 0) >= MAJOR).length;
      return `<section class="sg-day"><h2 class="sg-dayhead"><span>${l.head}</span><small>${l.tail}</small><em>${list.length} 条${nMajor ? ` · 重点 ${nMajor}` : ""}</em></h2>${list.map(itemRow).join("")}</section>`;
    }).join("");
  }
  function cats() {
    return `<nav class="sg-cats"><i class="sg-pill"></i>${CAT_ORDER.filter((k) => k === "all" || S.data.items.some((x) => x.category === k)).map((k) => `<button data-act="cat" data-cat="${k}" class="${S.cat === k ? "on" : ""}">${k === "all" ? "全部" : CAT[k]}</button>`).join("")}</nav>`;
  }
  const whoSays = (h) => `${h.sourceNames.slice(0, 2).map(shortSource).join("、")}${h.sourceNames.length > 2 ? " 等" : ""}`;

  async function fillItem(el, it) {
    const box = $(".sg-article", el);
    const t0 = performance.now();
    let d = S.data.site?.details?.[it.id];
    if (!d) { try { d = await getDetail(it.id); } catch { d = null; } }
    // 等推入动画走完再插正文，长文一次性排版会掉帧
    const wait = 400 - (performance.now() - t0);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    if (!el.isConnected) return;
    if (!d) { box.innerHTML = `<p class="sg-nobody">全文要在 App 里联网加载，可以先看原文</p>`; return; }
    if (d.originalTitle && d.originalTitle !== it.title) $(".sg-orig", el).textContent = d.originalTitle;
    if (d.tags?.length) $(".sg-orig", el).insertAdjacentHTML("afterend", `<div class="sg-tags">${d.tags.map((t) => `<span>${esc(t)}</span>`).join("")}</div>`);
    if (d.x) {
      $(".sg-xpost", el).innerHTML = `<div class="sg-xa">${d.x.avatarUrl ? `<img src="${esc(img(d.x.avatarUrl))}" alt="">` : ""}<b>${esc(d.x.authorName || "")}</b><span>@${esc(d.x.handle || "")}</span></div>
        ${d.x.media?.length ? `<div class="sg-gallery">${d.x.media.map((m) => `<img src="${esc(img(m.url))}" data-full="${esc(img(m.fullUrl || m.url))}" alt="" loading="lazy" style="aspect-ratio:${m.width && m.height ? m.width + "/" + m.height : "4/3"}">`).join("")}</div>` : ""}`;
    }
    if (d.body) {
      box.innerHTML = `<div class="sg-k">${d.bodyKind === "translation" ? "正文 · 中文译文" : "正文"}${d.author ? ` · ${esc(d.author)}` : ""}</div>${cleanHTML(d.body)}`;
      if (!reduceMotion) box.animate([{ opacity: 0, transform: "translateY(12px)" }, { opacity: 1, transform: "none" }], { duration: 420, easing: "cubic-bezier(.22,.9,.18,1)" });
    } else box.innerHTML = "";
    $$(".sg-gallery img, .sg-article img", el).forEach((im) => im.addEventListener("click", () => openOriginal(im.dataset.full || im.src)));
  }

  // ── 模型页：Codex 重置监控 + 五项分数总表 ──
  const COLS = [["overall", "综合"], ["coding", "编程"], ["reasoning", "科研"], ["professional", "办公"], ["knowledge", "问答"]];
  const STATUS_ZH = { confirmed: "已落地", announced: "已预告", forecast: "已预告", pending: "待确认", in_progress: "进行中", retracted: "已撤回", cancelled: "已撤回" };
  const scoreMap = (lb) => {
    const m = {};
    for (const [k] of COLS) for (const r of lb.boards[k]?.rows || []) (m[r.slug] = m[r.slug] || {})[k] = r;
    return m;
  };
  const logo = (m, cls = "lb-logo") => m.logo ? `<img class="${cls}" src="${esc(img(m.logo))}" alt="" loading="lazy">` : `<span class="${cls} mono">${esc(m.mono || m.name[0])}</span>`;
  const yuan = (v) => (v == null ? "待核验" : v >= 10 ? `¥${v.toFixed(1)}` : `¥${+v.toFixed(2)}`);
  const until = (iso) => {
    const d = (new Date(iso) - Date.now()) / 60000;
    if (d <= 0) return "";
    return d < 60 ? `约 ${Math.round(d)} 分钟后` : d < 60 * 36 ? `约 ${Math.round(d / 60)} 小时后` : `约 ${Math.round(d / 1440)} 天后`;
  };
  function notifyRow() {
    if (IN_APP && AndroidBridge.notifStatus) {
      const st = AndroidBridge.notifStatus();
      if (st === "on") return `<div class="cx-notify"><i class="on"></i><span>有新的重置消息会用最高优先级通知你，每 15 分钟查一次</span><button data-act="cxtest">试一条</button></div>`;
      return `<div class="cx-notify off"><i></i><span>重置通知还没开</span><button data-act="cxperm">开启通知</button></div>`;
    }
    if (IN_STUDIO) return `<div class="cx-notify off"><i></i><span>重置通知要用安卓原生版，这个版本收不到</span></div>`;
    return "";
  }
  function eventBlock(e, live) {
    const posts = (e.posts || []).slice().reverse();
    return `<article class="cx-ev ${live ? "live" : ""}" data-reveal>
      <div class="cx-tag ${live ? "" : "idle"}"><i></i>${esc(STATUS_ZH[e.status] || e.label || "")}${e.confirmedAt ? ` · ${md(e.confirmedAt)} ${hm(e.confirmedAt)} 确认` : ""}</div>
      <h3>${esc(e.title || e.label)}</h3>
      <p class="when">${esc(e.label || "")}${e.schedule?.label ? ` · ${esc(e.schedule.label)}` : ""}${live && e.schedule?.from && until(e.schedule.from) ? ` · ${until(e.schedule.from)}` : ""}</p>
      ${posts.length ? `<ol class="cx-posts">${posts.map((p) => `<li><time>${p.at ? `${md(p.at)} ${hm(p.at)}` : ""}${p.stage ? ` · ${esc(p.stage)}` : ""}</time><p>${esc(p.text || "")}</p></li>`).join("")}</ol>` : ""}
    </article>`;
  }
  function resetPage() {
    const cx = S.data.site?.codex;
    if (!cx) return `<p class="empty">还没拿到重置监控数据</p>`;
    const cur = cx.current;
    const rest = (cx.recent || []).filter((e) => e && e.id !== cur?.id);
    return `${notifyRow()}
      <section class="cx-hero ${cur ? "live" : ""}">
        ${cur ? eventBlock(cur, true) : `<div class="cx-idle"><div class="cx-tag idle"><i></i>暂无新的重置预告</div><h3>Tibo 一发预告或确认，这里和通知会第一时间出现</h3></div>`}
      </section>
      <h2 class="sg-sec">最近的重置<small>近 7 天</small></h2>
      <div class="cx-history">${rest.map((e) => eventBlock(e, false)).join("") || `<p class="empty">最近 7 天没有重置</p>`}</div>`;
  }
  function lbTable() {
    const lb = S.data.site?.lb;
    if (!lb) return `<p class="empty">模型榜还没加载</p>`;
    const sm = scoreMap(lb), key = S.lbSort || "overall";
    const ext = {};
    for (const [k] of COLS) { const v = Object.values(sm).map((x) => x[k]?.score).filter((x) => x != null); ext[k] = [Math.min(...v), Math.max(...v)]; }
    const slugs = Object.keys(lb.models).filter((sl) => sm[sl]);
    slugs.sort((a, b) => (sm[b][key]?.score ?? -1) - (sm[a][key]?.score ?? -1));
    const cell = (sl, k) => {
      const r = sm[sl][k];
      if (!r) return `<i class="na">–</i>`;
      const [lo, hi] = ext[k], t = (r.score - lo) / Math.max(0.1, hi - lo);
      return `<i class="${r.score === ext[k][1] ? "best" : ""}" style="--h:${(0.05 + t * 0.32).toFixed(3)}">${r.score.toFixed(1)}</i>`;
    };
    const rows = slugs.map((sl, idx) => {
      const m = lb.models[sl];
      return `<div class="lb-tr" data-act="model" data-slug="${esc(sl)}">
        <span class="rk">${sm[sl][key] ? pad(idx + 1) : "–"}</span>
        <span class="m">${logo(m)}<span><b>${esc(m.name)}</b><small><span class="pv">${esc(m.provider || "")}</span>${m.domestic ? `<em>国产</em>` : ""}${m.open ? `<em class="o">开源</em>` : ""}</small></span></span>
        ${COLS.map(([k]) => cell(sl, k)).join("")}
      </div>`;
    }).join("");
    return `<div class="lb-table">
        <div class="lb-tr lb-th"><span>#</span><span>模型</span>${COLS.map(([k, n]) => `<button data-act="lbsort" data-k="${k}" class="${k === key ? "on" : ""}">${n}</button>`).join("")}</div>
        ${rows}
      </div>
      ${lb.waiting?.length ? `<div class="lb-wait"><b>评测还不够、暂不排名</b>${lb.waiting.map((w) => `<span>${esc(w.name)}<small>${esc(w.reason)}</small></span>`).join("")}</div>` : ""}`;
  }
  function modelHTML(slug) {
    const lb = S.data.site.lb, m = lb.models[slug], sm = scoreMap(lb)[slug] || {};
    return `<header class="dt-bar"><button data-act="back" aria-label="返回">${ICON.back}</button><span>模型</span><span></span></header>
      <div class="scroller pad-bottom">
        <div class="md-top" data-rise>${logo(m, "md-logo")}<div><h1>${esc(m.name)}</h1>
          <p>${esc(m.provider || "")}${m.releasedAt ? ` · ${esc(m.releasedAt)} 发布` : ""}${m.domestic ? " · 国产" : ""}${m.open ? " · 开源权重" : ""}</p></div></div>
        <div class="md-scores" data-rise>${COLS.map(([k, n]) => { const r = sm[k];
          return `<div class="md-row"><span>${n}</span><i style="--v:${r ? Math.max(0, Math.min(1, (r.score - 40) / 40)).toFixed(3) : 0}"></i><b>${r ? r.score.toFixed(1) : "–"}</b><em>${r ? "#" + r.rank : "未上榜"}</em></div>`; }).join("")}</div>
        <div class="md-price" data-rise><div><small>缓存</small><b>${yuan(m.price?.cached)}</b></div><div><small>输入</small><b>${yuan(m.price?.in)}</b></div><div><small>输出</small><b>${yuan(m.price?.out)}</b></div><p>人民币 / 百万 Token<span class="md-ctx"></span></p></div>
        <div class="md-ev"><div class="sg-loading"><i></i><i></i><i></i></div></div>
        <p class="md-note" data-rise>${esc(lb.howToRead || "")}</p>
      </div>`;
  }
  async function fillModel(el, slug) {
    let d = null;
    try { d = await getModelDetail(slug); } catch {}
    if (!el.isConnected) return;
    const box = $(".md-ev", el);
    if (!d) { box.innerHTML = `<p class="sg-nobody">各项评测要联网加载</p>`; return; }
    if (d.context) $(".md-ctx", el).textContent = ` · 上下文 ${d.context >= 1e6 ? d.context / 1e6 + "M" : Math.round(d.context / 1000) + "K"}`;
    box.innerHTML = d.evidence.map((g) => `<section><h4>${esc(g.name)}<b>${g.score != null ? g.score.toFixed(1) : "–"}</b></h4>
      ${g.items.map((i) => `<div class="ev"><span>${esc(i.name)}<small>${esc(i.operator || "")}${i.config ? ` · ${esc(i.config)}` : ""}</small></span><b>${esc(i.display || "–")}</b></div>`).join("")}</section>`).join("");
    box.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300 });
  }

  const DirSignal = {
    push: "slide", radius: 0, themeColor: "#FAF8F4",
    notes: `<h3>B 汇流</h3><p>顶部是热点舞台：粒子从屏幕外绕成漩涡汇向这件事，线的多少、粒子的快慢、飘过的名字都来自这件事的真实来源。</p>
      <ul><li>左右滑换一件，7 秒自动换</li><li>按住拨开粒子流，粒子会加速</li><li>点舞台从卡片展开成详情</li><li>长按任意一条先看摘要和入选理由</li><li>详情页的时间轴可以拖着看每一篇报道</li></ul>`,
    unmount: stopAll,

    feed() {
      const d = new Date();
      const hot = S.data.hot;
      return `<header class="sg-top">
          <div class="sg-brand"><b>AI 热点</b><span class="sg-date"><i class="${S.live ? "live" : ""}"></i>${d.getMonth() + 1}月${d.getDate()}日 ${WEEK[d.getDay()]} · ${S.live ? "实时" : "快照"}</span></div>
          <button class="sg-listen" data-act="listen" data-kind="hot">${ICON.ear}<span>听热点</span><em>${Listen.minutes("hot")} 分钟</em></button>
        </header>
        <section class="sg-hero" data-open="story:${hot[0].storyId}">
          <canvas></canvas>
          <div class="sg-hero-text"><div class="sg-ht">
            <div class="sg-ht-rk"><b>热点 01</b><em>${ago(hot[0].latestAt)}更新</em></div>
            <h2>${esc(hot[0].title)}</h2><p>${esc(latestOf(hot[0]))}</p></div></div>
        </section>
        <section class="sg-hl">
          ${hot.slice(1, 6).map((h, i) => `<article class="sg-hl-row" data-open="story:${h.storyId}" data-reveal>
            <span class="rk">${pad(i + 2)}</span>
            <div class="bd"><h3>${esc(h.title)}</h3><p>${esc(latestOf(h))}</p></div>
            ${coverOf(h) ? `<img class="th" src="${esc(img(coverOf(h)))}" alt="" loading="lazy">` : `<span class="th none"></span>`}
          </article>`).join("")}
          <button class="sg-more" data-act="tab" data-tab="hot">全部 ${hot.length} 条热点</button>
        </section>
        <h2 class="sg-sec">精选<small>最近 7 天 · 按时间</small></h2>
        <div class="sg-sticky">${cats()}</div>
        <div class="sg-feed">${feedList()}</div>
        <footer class="sg-end">内容来自 AIHOT · aihot.news</footer>`;
    },

    hot() {
      return `<header class="sg-head"><h1>热点</h1><p>同一件事只算一次，越多人在说越靠前</p></header>
        <ol class="sg-hot">${S.data.hot.map((h) => `
          <li data-open="story:${h.storyId}" data-reveal>
            <span class="rk">${pad(h.rank)}</span>
            <div class="bd"><h3>${esc(h.title)}</h3><p>${esc(latestOf(h))}</p>
              <div class="mt">${people(h)}<span>${ago(h.latestAt)}</span>${spark(h)}</div></div>
            ${coverOf(h) ? `<img class="th" src="${esc(img(coverOf(h)))}" alt="" loading="lazy">` : ""}
          </li>`).join("")}</ol>
        <footer class="sg-end">每分钟更新</footer>`;
    },

    daily() {
      const d = S.data.daily;
      const dt = new Date(d.date + "T00:00:00");
      let n = 0;
      return `<header class="sg-head row"><div><h1>日报</h1><p>${dt.getMonth() + 1}月${dt.getDate()}日 ${WEEK[dt.getDay()]} · 每天 08:00 出刊</p></div>
          <button class="sg-listen" data-act="listen" data-kind="daily">${ICON.ear}<span>听日报</span><em>${Listen.minutes("daily")} 分钟</em></button></header>
        <article class="sg-dlead" data-open="ditem:0:0" data-reveal><div class="sg-k">头条</div><h2>${esc(d.lead.title)}</h2><p>${esc(d.lead.leadParagraph)}</p></article>
        ${d.sections.map((s, si) => `<section class="sg-dsec" data-reveal><h4><span>${pad(++n)}</span>${esc(s.label)}</h4>
          ${s.items.map((e, ii) => `<article data-open="ditem:${si}:${ii}"><h3>${esc(e.title)}</h3><p>${esc(e.summary)}</p><small>${esc(shortSource(e.source.name))}</small></article>`).join("")}</section>`).join("")}
        ${d.flashes?.length ? `<section class="sg-dsec" data-reveal><h4><span>${pad(++n)}</span>快讯</h4>${d.flashes.map((f, i) => `<article data-open="ditem:-1:${i}"><h3>${esc(f.title)}</h3><small>${esc(shortSource(f.source.name))}</small></article>`).join("")}</section>` : ""}
        <footer class="sg-end">每天 08:00 出新一期</footer>`;
    },

    reset() {
      const cx = S.data.site?.codex;
      return `<header class="sg-head"><h1>Codex 重置</h1><p>盯 OpenAI Codex 团队 Tibo 发的用量重置消息${cx?.checkedAt ? ` · ${ago(cx.checkedAt)}检查` : ""}</p></header>
        ${resetPage()}
        <footer class="sg-end">数据来自 AIHOT 重置监控</footer>`;
    },

    models() {
      const lb = S.data.site?.lb;
      return `<header class="sg-head"><h1>模型</h1><p>${lb ? `第三方实测 · ${md(lb.updatedAt)} ${hm(lb.updatedAt)} 更新` : "Codex 重置与模型排行"}</p></header>
        <h2 class="sg-sec">排行榜<small>点表头换排序</small></h2>
        ${lb?.about ? `<p class="lb-about">${esc(lb.about)}</p>` : ""}
        ${lbTable()}
        <footer class="sg-end">数据来自 AIHOT 模型榜</footer>`;
    },

    story(s) {
      return `<header class="dt-bar float"><button data-act="back" aria-label="返回">${ICON.back}</button><span class="ttl">${esc(s.title)}</span>
          <button data-act="share" data-title="${esc(s.title)}" data-url="https://aihot.news/story/${s.publicId}" aria-label="分享">${ICON.share}</button></header>
        <div class="scroller">
          <section class="sg-dhero"><canvas></canvas>
            <div class="sg-dhero-text"><div class="sg-k" data-rise>事件 · 最新 ${ago(s.latestAt)}</div><h1 class="sg-dt-title" data-rise>${esc(s.title)}</h1></div>
          </section>
          ${(() => { const h = S.data.hot.find((x) => x.storyId === s.publicId); const c = h && coverOf(h);
            return (c || (h && people(h))) ? `<div class="sg-dmeta" data-rise>${h ? people(h, 6) : ""}${h ? `<span>${esc(whoSays(h))}在说</span>` : ""}</div>${c ? `<img class="sg-cover" src="${esc(img(c))}" alt="" data-rise>` : ""}` : ""; })()}
          <div class="sg-body" data-rise>${String(s.digest || "").split(/\n+/).filter(Boolean).map((p) => `<p>${esc(p)}</p>`).join("")}</div>
          <h4 class="sg-sub" data-rise>报道时间轴<small>拖动查看每一篇</small></h4>
          <div class="sg-tl" data-rise><canvas class="sg-story"></canvas><div class="sg-tip"></div></div>
          <ol class="sg-reports pad-bottom">${s.reports.map((r, i) => `
            <li data-act="report" data-sid="${s.publicId}" data-i="${i}" data-rise>
              <div class="mt"><i class="${r.firstParty ? "fp" : ""}"></i>${esc(shortSource(r.source))}${r.firstParty ? " · 一手" : ""}<time>${md(r.publishedAt)} ${hm(r.publishedAt)}</time></div>
              <h5>${esc(r.title)}</h5></li>`).join("")}</ol>
        </div>
        <div class="dt-actions"><button class="primary" data-act="listen" data-kind="story" data-id="${s.publicId}">${ICON.ear} 听这件事</button></div>`;
    },

    item(it) {
      return `<header class="dt-bar"><button data-act="back" aria-label="返回">${ICON.back}</button><span></span>
          <button data-act="share" data-title="${esc(it.title)}" data-url="https://aihot.news/items/${it.id}" aria-label="分享">${ICON.share}</button></header>
        <div class="scroller pad-bottom">
          <div class="sg-meta big" data-rise><span class="cat">${CAT[it.category] || "精选"}</span><span>${esc(shortSource(it.source))}</span><span>${md(it.publishedAt)} ${hm(it.publishedAt)}</span></div>
          <h1 class="sg-dt-title" data-rise>${esc(it.title)}</h1>
          ${it.score ? `<div class="sg-scorebig" data-rise><b data-count="${it.score}">0</b><span>精选分<br><small>两次独立打分</small></span><i style="--v:${Math.max(0, (it.score - 50) / 50).toFixed(2)}"></i></div>` : ""}
          <div class="sg-orig" data-rise></div>
          <div class="sg-lead" data-rise>${esc(it.summary || "")}</div>
          ${it.reason ? `<aside class="sg-why" data-rise><div class="sg-k">为什么入选</div><p>${esc(it.reason)}</p></aside>` : ""}
          <div class="sg-xpost"></div>
          <article class="sg-article"><div class="sg-loading"><i></i><i></i><i></i></div></article>
        </div>
        <div class="dt-actions two"><button class="second" data-act="listen" data-kind="item" data-id="${it.id}">${ICON.ear} 听</button><button class="primary" data-act="orig" data-url="${esc(it.url)}">阅读原文 ${ICON.out}</button></div>`;
    },

    mount(key, sec) {
      if (key === "feed") {
        mountHero(sec);
        longPress(sec);
        requestAnimationFrame(() => placePill(sec, false));
      }

    },
    mountDetail(el, s, it) {
      $$("[data-count]", el).forEach((n) => countUp(n, +n.dataset.count, 900));
      if (it) return fillItem(el, it);
      if (!s) return;
      const f = Field($(".sg-dhero canvas", el), { focal: [0.74, 0.42], delay: 420 });
      f.setFocus({ sourceCount: s.sourceCount, signalCount: s.reportCount * 3, names: [...new Set(s.reports.map((r) => shortSource(r.source)))] }, { immediate: true, seed: s.reportCount });
      const bar = $(".dt-bar.float", el), sc0 = $(".scroller", el);
      sc0.addEventListener("scroll", () => bar.classList.toggle("solid", sc0.scrollTop > 230), { passive: true });
      const lis = $$(".sg-reports li", el);
      const tl = Timeline($(".sg-story", el), s, $(".sg-tip", el), (i) => {
        const li = lis[i];
        const sc = $(".scroller", el);
        sc.scrollTo({ top: li.offsetTop - sc.clientHeight / 2 + li.offsetHeight / 2, behavior: "smooth" });
        li.animate([{ background: "rgba(255,90,0,.14)" }, { background: "rgba(255,90,0,0)" }], { duration: 1400, delay: 250 });
      });
      lis.forEach((li, i) => {
        li.addEventListener("pointerenter", () => tl.highlight(i));
        li.addEventListener("pointerleave", () => tl.highlight(-1));
      });
    },
    onTab(key, sec) { if (key === "feed") placePill(sec, false); },
    onCat() {
      const sec = $('.screen.tab[data-tab="feed"]');
      $$(".sg-cats button", sec).forEach((b) => b.classList.toggle("on", b.dataset.cat === S.cat));
      placePill(sec);
      const box = $(".sg-feed", sec);
      const st = $(".sg-sticky", sec), sc = $(".scroller", sec);
      box.animate([{ opacity: 1 }, { opacity: 0, transform: "translateY(6px)" }], { duration: 140, fill: "forwards" }).onfinish = () => {
        box.innerHTML = feedList();
        box.getAnimations().forEach((a) => a.cancel());
        $$(".sg-item", box).slice(0, 8).forEach((n, k) => n.animate([{ opacity: 0, transform: "translateY(14px)" }, { opacity: 1, transform: "none" }], { duration: 480, delay: k * 35, easing: "cubic-bezier(.22,.9,.18,1)", fill: "backwards" }));
        revealOnScroll(box, sc);
        if (sc.scrollTop > st.offsetTop) sc.scrollTo({ top: st.offsetTop });
      };
    },
    act(a, el) {
      if (a === "report") return openReport(el);
      if (a === "lbsort") {
        S.lbSort = el.dataset.k;
        const box = $('.screen.tab[data-tab="models"] .lb-table');
        if (box) { box.outerHTML = lbTable().split('<div class="lb-wait">')[0].trim(); }
        return;
      }
      if (a === "model") {
        const slug = el.dataset.slug;
        const scr = pushScreen(modelHTML(slug), { from: el, mode: "slide", onMount: (e) => fillModel(e, slug) });
        edgeSwipe(scr);
        return;
      }
      if (a === "cxperm") { AndroidBridge.requestNotif(); setTimeout(() => rerenderTab("reset"), 2500); return; }
      if (a === "cxtest") { AndroidBridge.testNotify(); return toast("已发一条测试通知"); }
    },
  };
  window.SignalField = Field;
  window.DirSignal = DirSignal;
})();
