/* Presentation layer.
   ------------------------------------------------------------------
   Deliberately separate from app.js: everything here is decoration, and
   none of it may change or invent a number. It listens for the events
   app.js fires once real data has landed and renders what it is given.

   If this file fails to load, the site loses motion and keeps every fact.
*/
(() => {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const $ = (id) => document.getElementById(id);

  /* ---------------- the hero tile ----------------
     One real campaign. The launchpad's whole claim is that fees can only
     reach the charity, and a live vault holding fees for a named charity is
     that claim as an object rather than a sentence. */
  const heroTile = (list) => {
    const box = $("hero-campaign");
    if (!box) return;
    const c = (list || []).find((x) => x && x.charity) || (list || [])[0];
    if (!c) {
      box.innerHTML = '<p class="hp-wait">No campaign launched yet.</p>';
      return;
    }
    const held = typeof c.held === "bigint" || typeof c.held === "number"
      ? (Number(c.held) / 1e18).toFixed(4)
      : null;
    box.innerHTML =
      '<div class="hp-row"><span class="hp-tok">$' + c.sym + '</span>' +
      '<span class="hp-arrow">&rarr;</span>' +
      '<span class="hp-cha">' + (c.charity ? c.charity.short : "charity " + c.cid) + '</span></div>' +
      (held !== null
        ? '<div class="hp-amt">' + held + ' ETH<span>held in its vault</span></div>' : "") +
      '<div class="hp-note">The vault has no function that pays anyone else. Not the ' +
      'launcher, not us.</div>' +
      '<a class="hp-open" href="campaign.html?t=' + c.token + '">Open this campaign &rsaquo;</a>';
  };

  /* ---------------- the campaign marquee ----------------
     A drifting row of every live campaign. The row is duplicated so the
     translate can loop seamlessly; the copy is hidden from screen readers so
     the list is not announced twice. Hidden entirely when there is nothing
     to show — an empty rail that scrolls is worse than no rail. */
  const marquee = (list) => {
    const rail = $("camp-pills"), box = $("camp-marquee");
    if (!rail || !box) return;
    const live = (list || []).filter((c) => c && c.sym);
    if (!live.length) { box.hidden = true; return; }

    const one = live.map((c) => {
      const held = typeof c.held === "bigint" || typeof c.held === "number"
        ? (Number(c.held) / 1e18).toFixed(4) + " ETH"
        : "";
      return '<a class="tpill" href="campaign.html?t=' + c.token + '">' +
             '<b>$' + c.sym + '</b>' +
             '<span class="px">' + (c.charity ? c.charity.short : "charity " + c.cid) + '</span>' +
             (held ? '<span class="kind">' + held + '</span>' : "") +
             "</a>";
    }).join("");

    // A short list would finish its travel and leave a gap. Repeat it until
    // one run is wide enough to cover the rail before the loop restarts.
    const reps = Math.max(2, Math.ceil(8 / live.length) * 2);
    rail.innerHTML = new Array(reps).fill(one).join("");
    box.hidden = false;
  };

  document.addEventListener("hh:campaigns", (e) => {
    heroTile(e.detail);
    marquee(e.detail);
  });

  /* ---------------- the story ----------------
     A sticky frame the page scrolls through. Progress through the section
     lights the phrases one at a time and fills the bar underneath.

     Below the breakpoint the section is a plain stack rather than a sticky
     frame, so there is no scroll progress to read. There each card and phrase
     is observed on its own and arrives as it comes into view — the point of
     the section is that it is a sequence, and showing all three at once
     throws that away. */
  const story = $("story");
  if (story) {
    story.classList.add("js");        // hands the frames' visibility to us
    const phrases = [...story.querySelectorAll(".story-copy p")];
    const frames = [...story.querySelectorAll(".frame")];
    const fill = $("storybar-fill");
    const lightAll = () => {
      phrases.forEach((p) => p.classList.add("on"));
      frames.forEach((f) => f.classList.add("in"));
      if (fill) fill.style.transform = "scaleX(1)";
    };

    /* The stacked path: one observer, each element revealed as it arrives. */
    let io = null;
    const stacked = () => {
      if (io || !("IntersectionObserver" in window)) { if (!io) lightAll(); return; }
      io = new IntersectionObserver((entries) => {
        // Two cards often cross the line in the same batch. Without a stagger
        // they pop together, which reads as "two at once" rather than as the
        // sequence the section is trying to tell.
        let k = 0;
        for (const en of entries) {
          if (!en.isIntersecting) continue;
          const el = en.target;
          el.style.transitionDelay = k++ * 130 + "ms";
          el.classList.add(el.classList.contains("frame") ? "in" : "on");
          io.unobserve(el);
        }
      }, { rootMargin: "0px 0px -18% 0px", threshold: 0.25 });
      [...phrases, ...frames].forEach((el) => io.observe(el));
    };
    const unstacked = () => { if (io) { io.disconnect(); io = null; } };

    if (reduced.matches) {
      lightAll();
    } else {
      let queued = false;
      const tick = () => {
        queued = false;
        const stuck = getComputedStyle(story.querySelector(".story-sticky")).position === "sticky";
        if (!stuck) { stacked(); return; }
        unstacked();

        const r = story.getBoundingClientRect();
        const travel = r.height - window.innerHeight;
        // 0 before the section pins, 1 once it has been scrolled through.
        const p = travel <= 0 ? 1 : Math.min(Math.max(-r.top / travel, 0), 1);

        if (fill) fill.style.transform = "scaleX(" + p.toFixed(4) + ")";
        // Each phrase takes its share of the travel, and lights a little
        // before its share begins so the first one is on as the frame pins.
        phrases.forEach((el, i) => {
          el.classList.toggle("on", p >= (i / phrases.length) * 0.92);
        });
        frames.forEach((el, i) => {
          el.classList.toggle("in", p >= (i / frames.length) * 0.92);
        });
      };
      const onScroll = () => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(tick);
      };
      addEventListener("scroll", onScroll, { passive: true });
      addEventListener("resize", onScroll);
      tick();
    }
  }

  /* ---------------- stat count-up ----------------
     When a number arrives from chain it counts up to the value app.js wrote
     rather than snapping.

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
