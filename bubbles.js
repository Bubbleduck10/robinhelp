/* Rising bubble field.
   ------------------------------------------------------------------
   A canvas rather than a few dozen animated divs: the browser composites
   one layer instead of laying out many, so it stays smooth on a phone and
   never fights the sticky header for paint.

   It sits behind everything at low opacity. The rule it follows is that
   text always wins — nothing here should make a number harder to read.
*/
(() => {
  const canvas = document.getElementById("bubbles");
  if (!canvas) return;

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const ctx = canvas.getContext("2d", { alpha: true });
  let w = 0, h = 0, dpr = 1, bubbles = [], raf = null;

  // Density scales with area, so a phone doesn't render a desktop's worth.
  const targetCount = () => Math.round(Math.min(46, Math.max(14, (w * h) / 42000)));

  const make = (seeded) => {
    const r = 3 + Math.pow(Math.random(), 2.1) * 32;   // biased small, a few large
    return {
      x: Math.random() * w,
      // Seeded bubbles start scattered up the screen; later ones enter from below.
      y: seeded ? Math.random() * h : h + r + Math.random() * 120,
      r,
      // Big bubbles rise slower — reads as depth without needing a blur pass.
      vy: (10 + Math.random() * 16) / (1 + r / 14),
      drift: (Math.random() - 0.5) * 7,
      phase: Math.random() * Math.PI * 2,
      wobble: 0.25 + Math.random() * 0.7,
      alpha: 0.05 + Math.random() * 0.16,
    };
  };

  const resize = () => {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const want = targetCount();
    while (bubbles.length < want) bubbles.push(make(true));
    bubbles.length = want;
  };

  const draw = (b) => {
    // Rim plus an off-centre highlight. Filled discs read as dots; a bright
    // edge and one specular point is what makes the eye call it a bubble.
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    const g = ctx.createRadialGradient(
      b.x - b.r * 0.35, b.y - b.r * 0.4, b.r * 0.05,
      b.x, b.y, b.r);
    g.addColorStop(0, `rgba(120,255,150,${b.alpha * 0.55})`);
    g.addColorStop(0.55, `rgba(0,200,5,${b.alpha * 0.13})`);
    g.addColorStop(1, `rgba(0,200,5,0)`);
    ctx.fillStyle = g;
    ctx.fill();

    ctx.strokeStyle = `rgba(0,200,5,${b.alpha * 0.85})`;
    ctx.lineWidth = Math.max(0.6, b.r * 0.035);
    ctx.stroke();

    if (b.r > 9) {
      ctx.beginPath();
      ctx.arc(b.x - b.r * 0.33, b.y - b.r * 0.36, Math.max(0.8, b.r * 0.11), 0, Math.PI * 2);
      ctx.fillStyle = `rgba(190,255,205,${b.alpha * 1.5})`;
      ctx.fill();
    }
  };

  let last = performance.now();
  const frame = (now) => {
    // Seconds, clamped so a backgrounded tab doesn't teleport everything on return.
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    ctx.clearRect(0, 0, w, h);

    for (const b of bubbles) {
      b.y -= b.vy * dt;
      b.phase += b.wobble * dt;
      b.x += Math.sin(b.phase) * b.drift * dt;
      if (b.y + b.r < -20) Object.assign(b, make(false));
      draw(b);
    }
    raf = requestAnimationFrame(frame);
  };

  const start = () => {
    if (raf || reduced.matches) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  };
  const stop = () => { if (raf) cancelAnimationFrame(raf), (raf = null); };

  const staticFrame = () => {
    // Reduced motion still gets the texture, just not the movement.
    ctx.clearRect(0, 0, w, h);
    for (const b of bubbles) draw(b);
  };

  resize();
  let rt;
  window.addEventListener("resize", () => {
    clearTimeout(rt);
    rt = setTimeout(() => { resize(); if (reduced.matches) staticFrame(); }, 150);
  });

  // Nothing renders while the tab is hidden; no point burning a phone's battery.
  document.addEventListener("visibilitychange", () => (document.hidden ? stop() : start()));
  reduced.addEventListener?.("change", () => (reduced.matches ? (stop(), staticFrame()) : start()));

  reduced.matches ? staticFrame() : start();
})();
