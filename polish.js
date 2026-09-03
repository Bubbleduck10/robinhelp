/* Presentation layer.
   ------------------------------------------------------------------
   Deliberately separate from app.js: everything here is decoration, and
   none of it may change or invent a number. It listens for the events
   app.js fires once real data has landed and renders what it is given.

   If this file fails to load, the site loses motion and keeps every fact.
*/
(() => {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

  /* ---------------- the live ticker ----------------
     A band of what the chain actually says, so the first thing a visitor
     sees moving is evidence rather than marketing. Facts about the
     mechanism are mixed in so the band is never empty on a quiet day —
     they are labelled differently from the on-chain items, because one
     kind is a reading and the other is a claim. */
  const track = document.getElementById("tick-track");
  const items = [];

  const FACTS = [
    "0.7% of a campaign's volume reaches its charity",
    "0% taken by us — no fee parameter exists",
    "5 charities, fixed in the contract",
    "payouts settle in ~6.36 days",
    "no owner · no withdraw · no upgrade",
  ];

  const paint = () => {
    if (!track) return;
    const live = items.slice(0, 14);
    const cells = live.concat(FACTS.map((f) => ({ fact: f })));
    if (!cells.length) return;

    const html = cells.map((c) => c.fact
      ? `<span class="tick-i is-fact">${c.fact}</span>`
      : `<span class="tick-i"><b>${c.label}</b>${c.value ? `<em>${c.value}</em>` : ""}</span>`
    ).join("");

    // Duplicated so the loop has something to scroll into. aria-hidden on the
    // copy keeps a screen reader from reading everything twice.
    track.innerHTML = `<div class="tick-run">${html}</div>` +
                      `<div class="tick-run" aria-hidden="true">${html}</div>`;
    document.getElementById("ticker")?.classList.add("ready");
  };

  document.addEventListener("hh:campaigns", (e) => {
    for (const c of e.detail || []) {
      items.push({ label: `$${c.sym} launched`, value: c.charity ? `→ ${c.charity.short}` : "" });
    }
    paint();
  });

  document.addEventListener("hh:ledger", (e) => {
    for (const r of e.detail || []) {
      items.push({ label: r.title, value: r.kind === "done" ? "delivered" : "in transit" });
    }
    paint();
  });

  paint();   // facts alone until the chain answers

  /* ---------------- scroll reveal ----------------
     Sections rise as they arrive. Anything not yet observed stays visible by
     default, so a browser without IntersectionObserver shows a normal page
     rather than a blank one. */
  if (!reduced.matches && "IntersectionObserver" in window) {
    const targets = document.querySelectorAll(
      ".panel .wrap > h2, .panel .wrap > .sub, .panel .wrap > .sec-head, .grid, .cards," +
      ".diagram, .ledger, .proof, .steps, .limits, .chartwrap, .launchcard");
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        en.target.classList.add("in");
        io.unobserve(en.target);
      }
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.06 });

    targets.forEach((t, i) => {
      t.classList.add("reveal");
      t.style.setProperty("--d", Math.min(i % 4, 3) * 55 + "ms");
      io.observe(t);
    });
  }

  /* ---------------- cursor spotlight ----------------
     A faint light that follows the pointer. Pointer-only: on a touch screen
     there is no cursor to follow, and a stuck highlight looks like a defect. */
  if (window.matchMedia("(pointer: fine)").matches && !reduced.matches) {
    const spot = document.createElement("div");
    spot.className = "spotlight";
    spot.setAttribute("aria-hidden", "true");
    document.body.appendChild(spot);
    let x = 0, y = 0, queued = false;
    window.addEventListener("pointermove", (e) => {
      x = e.clientX; y = e.clientY;
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        spot.style.transform = `translate3d(${x - 300}px, ${y - 300}px, 0)`;
      });
    }, { passive: true });
  }

  /* ---------------- stat count-up ----------------
     The hero numbers arrive from chain some time after paint. When one lands,
     it counts up to the value app.js wrote rather than snapping.

     It never invents a figure: the final frame writes back the exact string it
     was given, and anything that is not a plain number (an em dash, "—") is
     left alone. */
  const animate = (el, text) => {
    const m = /^([\d,]+(?:\.\d+)?)(.*)$/.exec(text.trim());
    if (!m || reduced.matches) return false;
    const target = parseFloat(m[1].replace(/,/g, ""));
    if (!isFinite(target) || target === 0) return false;
    const dp = (m[1].split(".")[1] || "").length;
    const suffix = m[2];
    const t0 = performance.now(), dur = 750;

    el.dataset.animating = "1";
    const step = (now) => {
      const p = Math.min((now - t0) / dur, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      if (p < 1) {
        el.textContent = (target * eased).toFixed(dp) + suffix;
        requestAnimationFrame(step);
      } else {
        el.textContent = text;            // exactly what app.js said
        delete el.dataset.animating;
      }
    };
    requestAnimationFrame(step);
    return true;
  };

  document.querySelectorAll(".stat .v, .ch-raised b").forEach((el) => {
    let last = el.textContent;
    new MutationObserver(() => {
      if (el.dataset.animating) return;
      const now = el.textContent;
      if (now === last) return;
      last = now;
      animate(el, now);
    }).observe(el, { childList: true, characterData: true, subtree: true });
  });
})();
