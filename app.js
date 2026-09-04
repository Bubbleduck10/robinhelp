/* Helping Hand — everything on this page is read from chain, not typed in. */
(() => {
  const $ = (id) => document.getElementById(id);
  const short = (a) => a.slice(0, 6) + "…" + a.slice(-4);

  const L1_RPC = "https://eth.drpc.org";          // serves getLogs over a useful range
  const RELAY = "0x02A0d2a39732082b824a5A3D3b026C54d581DCC8";  // donate.gg, Ethereum
  const ETH_SECONDS_PER_BLOCK = 12;
  const CHUNK = 9000;          // the free L1 endpoint refuses more than 10,000
  const MAX_CHUNKS = 24;       // ~216k blocks, about a month of history

  // Topics and selectors are computed from signatures, never recalled: a wrong
  // one fails silently, because the call simply reverts and the list looks empty.
  const TOPIC = {
    // The current vault emits Released; vaults from the retired factory emit
    // ReleasedCanonical. Both are matched, because filtering on the old one
    // alone made every payout from a current vault invisible — the stat would
    // have sat at zero through a real payout and nobody would have known.
    released: "0x4d436de77f1139fda664b657c73ad6c3bde4a1984d3aabeab7c3998556b93b63",
    releasedCanonical: "0x13713570af345cfea0b3aaea60175e30abb40dd23efcc294496177f7a41b9090",
    campaignLaunched: "0xcea37bc2e454d11f3881906d399c2945470501e5caddeb5fd84e3c4c0088c771",
    donationMade: "0xd8e70e726414c0696085c89f19916df42c131dd051341e82d3eb198faa8b1bdc",
  };
  const SEL = {
    campaignCount: "0x7274e30d", campaigns: "0x141961bc",
    vaultOf: "0x0709df45", charityOf: "0xac6f2f8a", symbol: "0x95d89b41",
  };

  /* ---------------- plumbing ---------------- */
  /* The RPC is load balanced, and some nodes in the pool answer with a
     duplicated `Access-Control-Allow-Origin: *,*`, which browsers reject
     outright. It is intermittent — the same request succeeds on the next
     connection — so a transport failure is retried rather than surfaced. A
     JSON-RPC error is not retried: that is the node answering, and asking a
     second time gets the same answer.

     Nothing here retries on a timeout budget, so a genuinely dead endpoint
     still fails in well under a second. */
  const call = async (url, method, params, tries = 3) => {
    let last;
    for (let i = 0; i < tries; i++) {
      let r;
      try {
        r = await fetch(url, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        });
      } catch (e) {                    // CORS or network: try another node
        last = e;
        if (i < tries - 1) await new Promise((s) => setTimeout(s, 120 * (i + 1)));
        continue;
      }
      const j = await r.json();
      if (j.error) throw new Error(j.error.message);
      return j.result;
    }
    throw last;
  };
  const rpc = (m, p) => call(CONFIG.rpc, m, p);
  const ethCall = (to, data) => rpc("eth_call", [{ to, data }, "latest"]);
  const big = (h) => BigInt(h && h !== "0x" ? h : "0x0");
  const pad = (a) => a.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  const padUint = (n) => n.toString(16).padStart(64, "0");
  const addrAt = (w) => "0x" + (w || "").replace(/^0x/, "").slice(24);
  const wordAt = (hex, i) => (hex || "").replace(/^0x/, "").slice(i * 64, (i + 1) * 64);

  const eth = (v, dp = 4) => {
    const base = 10n ** 18n;
    const frac = ((v % base) * 10n ** BigInt(dp)) / base;
    return (v / base).toLocaleString() + "." + frac.toString().padStart(dp, "0");
  };
  const usdish = (n) => {
    if (n == null || isNaN(n)) return "—";
    if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
    if (n >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
    if (n >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
    return "$" + n.toFixed(2);
  };
  const ago = (secs) => {
    if (secs < 90) return Math.max(1, Math.round(secs)) + "s ago";
    if (secs < 5400) return Math.round(secs / 60) + "m ago";
    if (secs < 172800) return Math.round(secs / 3600) + "h ago";
    return Math.round(secs / 86400) + "d ago";
  };
  const decodeString = (hex) => {
    const b = (hex || "").replace(/^0x/, "");
    const s = (h) => { let o = ""; for (let i = 0; i + 1 < h.length; i += 2) {
      const c = parseInt(h.substr(i, 2), 16); if (c) o += String.fromCharCode(c); } return o; };
    if (b.length <= 64) return s(b).trim();
    const len = parseInt(b.slice(64, 128), 16) || 0;
    return s(b.slice(128, 128 + len * 2)).trim();
  };

  /* Log queries with a shrinking horizon. Two lessons are baked in: the node
     answering getLogs can lag the one answering blockNumber, so toBlock is
     pinned short of the head; and a busy window can return a truncated body,
     so the range shrinks and retries rather than giving up. */
  const getLogs = async (url, address, topics, windows, secondsPerBlock) => {
    const head = Number(big(await call(url, "eth_blockNumber", [])));
    const to = Math.max(0, head - 50);
    for (const win of windows) {
      try {
        const logs = await call(url, "eth_getLogs", [{
          fromBlock: "0x" + Math.max(0, to - win).toString(16),
          toBlock: "0x" + to.toString(16),
          ...(address ? { address } : {}), topics,
        }]);
        return { logs, head, secondsPerBlock };
      } catch { /* try a shorter horizon */ }
    }
    return { logs: [], head, secondsPerBlock };
  };

  /* ---------------- static bits ---------------- */
  $("chain-chip").innerHTML = '<i class="pulse"></i>' + CONFIG.chainName;
  $("lim-days").textContent = CONFIG.challengePeriodDays;
  $("t-sym").textContent = CONFIG.mainToken.symbol;
  if (CONFIG.mainToken.tradeFeeNote) $("t-fee").textContent = CONFIG.mainToken.tradeFeeNote;
  $("contracts").innerHTML = CONFIG.factory
    ? ` · Launchpad <a href="${CONFIG.explorer}/address/${CONFIG.factory}" target="_blank" rel="noopener">${short(CONFIG.factory)}</a>`
    : "";

  /* One glyph per cause, drawn rather than fetched: a remote logo would be a
     third-party request on every load, and these charities' marks are theirs,
     not ours to re-host. Keyed by the same id the contract uses. */
  const ICON = {
    0: '<path d="M9.5 2h5v5.5H20v5h-5.5V18h-5v-5.5H4v-5h5.5z"/>',                       // cross
    1: '<path d="M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.4 6.2 20.5l1.1-6.5L2.6 9.4l6.5-.9z"/>', // star
    2: '<path d="M12 2.2s7 7.6 7 11.4a7 7 0 1 1-14 0C5 9.8 12 2.2 12 2.2z"/>',          // droplet
    3: '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 2c1.7 0 3.2 2.7 3.2 6S13.7 16 12 16s-3.2-2.7-3.2-6S10.3 4 12 4zM3.6 9h16.8M3.6 15h16.8"/>', // globe
    4: '<path d="M3 10.5h18a9 9 0 0 1-18 0zM12 8.5c0-2 2.5-2 2.5-4M8 8.5c0-1.4 1.6-1.6 1.6-3"/>',   // bowl
    5: '<path d="M12 20.5s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4a4.3 4.3 0 0 1 7.5 3.1c0 5.4-7.5 10-7.5 10z"/>', // heart
    6: '<path d="M12 2.4s6.6 7.3 6.6 11a6.6 6.6 0 1 1-13.2 0C5.4 9.7 12 2.4 12 2.4z"/><path d="M8.6 13.6a3.4 3.4 0 0 0 3.4 3.4"/>', // droplet + arc
    7: '<path d="M12 3.2 14 9h6l-4.9 3.5 1.9 5.8L12 14.8 7 18.3l1.9-5.8L4 9h6z"/>',                  // relief star
  };

  const grid = $("charity-grid");
  grid.innerHTML = "";
  CONFIG.charities.forEach((c) => {
    const live = !!c.forwarder;
    const el = document.createElement("div");
    el.className = "card ch";
    el.innerHTML =
      `<div class="ch-top">` +
        `<span class="ch-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round">${ICON[c.id] || ""}</svg></span>` +
        `<span class="badge ${live ? "live" : "wait"}">${live ? "routing live" : "not yet routed"}</span>` +
      `</div>` +
      `<div class="name">${c.name}</div>` +
      `<div class="ch-raised"><b id="ct-${c.id}">—</b><span>received on Ethereum</span></div>` +
      `<div class="cid">config ${c.configId.slice(0, 14)}…${c.configId.slice(-6)}</div>` +
      (live ? `<div class="cid">payout <a href="https://etherscan.io/address/${c.forwarder}" target="_blank" rel="noopener">${short(c.forwarder)}</a></div>`
            : `<div class="cid">payout contract not deployed</div>`) +
      `<a class="ch-link" href="${c.url}" target="_blank" rel="noopener">Charity page ›</a>`;
    grid.appendChild(el);
  });

  /* ---------------- campaigns ---------------- */
  const campaignCache = [];

  const loadCampaigns = async () => {
    if (!CONFIG.factory) return;
    const list = $("campaign-list");
    let n = 0;
    try { n = Number(big(await ethCall(CONFIG.factory, SEL.campaignCount))); }
    catch {
      list.innerHTML = '<p class="empty">Chain unreachable — could not read campaigns.</p>';
      if ($("campaign-src")) $("campaign-src").textContent = "chain unreachable";
      return;
    }
    if (!n) {
      $("s-campaigns").textContent = 0;
      if ($("campaign-src")) $("campaign-src").textContent = "nothing launched yet";
      return;
    }

    // Hidden campaigns still exist on chain; they are only left off this list.
    const hidden = (CONFIG.hiddenCampaigns || []).map((a) => a.toLowerCase());
    let shown = 0;

    list.innerHTML = "";
    campaignCache.length = 0;
    for (let i = 0; i < Math.min(n, 24); i++) {
      try {
        const token = addrAt(await ethCall(CONFIG.factory, SEL.campaigns + padUint(i)));
        if (hidden.includes(token.toLowerCase())) continue;
        shown++;
        const vault = addrAt(await ethCall(CONFIG.factory, SEL.vaultOf + pad(token)));
        const cid = Number(big(await ethCall(CONFIG.factory, SEL.charityOf + pad(token))));
        const sym = decodeString(await ethCall(token, SEL.symbol)) || "?";
        const held = big(await rpc("eth_getBalance", [vault, "latest"]));
        const charity = CONFIG.charities.find((c) => c.id === cid);
        campaignCache.push({ token, vault, cid, sym, charity });

        const el = document.createElement("div");
        el.className = "card";
        el.innerHTML =
          `<span class="badge live">${charity ? charity.short : "charity " + cid}</span>` +
          `<div class="name">$${sym}</div>` +
          `<div class="cid">vault <a href="${CONFIG.explorer}/address/${vault}" target="_blank" rel="noopener">${short(vault)}</a></div>` +
          `<div class="cid">${eth(held)} ETH awaiting payout</div>` +
          `<a href="campaign.html?t=${token}" style="font-size:.86rem">Open campaign ›</a>`;
        list.appendChild(el);
      } catch { /* skip one we can't read */ }
    }
    // The stat counts what is listed, so it can never disagree with the cards.
    $("s-campaigns").textContent = shown;
    document.dispatchEvent(new CustomEvent("hh:campaigns", { detail: campaignCache }));
    const src = $("campaign-src");
    if (src) src.textContent = shown
      ? `${shown} campaign${shown > 1 ? "s" : ""} on chain`
      : "nothing launched yet";
    if (!list.children.length) {
      list.innerHTML = shown
        ? `<p class="empty">${shown} campaign${shown > 1 ? "s" : ""} on chain, but none could be read.</p>`
        : `<p class="empty">No campaigns yet. Launch the first one.</p>`;
    }
  };

  /* ---------------- the donation ledger ----------------
     Two halves that have to be reconciled: money leaving a vault on Robinhood
     Chain, and money arriving at a charity on Ethereum. A payout is only
     "delivered" once the second one exists; until then it is genuinely in
     transit, and the page says so rather than counting it as donated. */
  const loadLedger = async () => {
    const rows = [];
    let released = 0n, delivered = 0n;
    const byCharity = {};          // id -> total received, for the charity cards

    // outbound, from every campaign vault
    for (const c of campaignCache) {
      try {
        const { logs, head, secondsPerBlock } = await getLogs(
          CONFIG.rpc, c.vault, [[TOPIC.released, TOPIC.releasedCanonical]],
          [CONFIG.logsWindow, ...CONFIG.logsFallbacks], CONFIG.secondsPerBlock);
        logs.forEach((l) => {
          const amount = big("0x" + wordAt(l.data, 0));
          released += amount;
          rows.push({
            kind: "sent", amount,
            title: `$${c.sym} → ${c.charity ? c.charity.short : "charity"}`,
            note: "bridging to Ethereum",
            secs: (head - Number(big(l.blockNumber))) * secondsPerBlock,
            href: `${CONFIG.explorer}/tx/${l.transactionHash}`,
          });
        });
      } catch { /* vault unreadable; skip */ }
    }

    // inbound, at donate.gg's relay.
    //
    // Two things shape this. The free RPC refuses ranges over 10,000 blocks, and
    // a donation older than one window used to fall out of the ledger entirely —
    // the first real donation vanished from the site about 36 hours after it
    // landed. So the search walks backwards in chunks to a floor instead of
    // looking at one window.
    //
    // And every configId goes into topic[1] as an OR rather than one query per
    // charity: identical results, an eighth of the requests, which is what makes
    // walking back affordable at all.
    const withFwd = CONFIG.charities.filter((c) => c.forwarder);
    if (withFwd.length) {
      const byConfig = new Map(withFwd.map((c) => [c.configId.toLowerCase(), c]));
      try {
        const head = Number(big(await call(L1_RPC, "eth_blockNumber", [])));
        const floor = Math.max(CONFIG.l1FirstBlock || 0, head - CHUNK * MAX_CHUNKS);
        const ranges = [];
        for (let to = head - 30; to > floor; to -= CHUNK) {
          ranges.push([Math.max(floor, to - CHUNK + 1), to]);
        }

        // A charity we managed to query shows a real total, including zero.
        withFwd.forEach((c) => { byCharity[c.id] = 0n; });

        // Small groups: the free endpoint rate-limits a burst of 25 at once.
        for (let i = 0; i < ranges.length; i += 4) {
          const batch = await Promise.all(ranges.slice(i, i + 4).map(([from, to]) =>
            call(L1_RPC, "eth_getLogs", [{
              fromBlock: "0x" + from.toString(16),
              toBlock: "0x" + to.toString(16),
              address: RELAY,
              topics: [TOPIC.donationMade, [...byConfig.keys()]],
            }]).catch(() => [])));

          for (const logs of batch) {
            for (const l of logs) {
              const c = byConfig.get((l.topics[1] || "").toLowerCase());
              if (!c) continue;
              const amount = big("0x" + wordAt(l.data, 1));
              delivered += amount;
              byCharity[c.id] += amount;
              rows.push({
                kind: "done", amount,
                title: `Donated to ${c.short}`,
                note: "credited on Ethereum",
                secs: (head - Number(big(l.blockNumber))) * ETH_SECONDS_PER_BLOCK,
                href: `https://etherscan.io/tx/${l.transactionHash}`,
              });
            }
          }
        }
      } catch { /* relay unreadable; the cards keep their em dash */ }
    }

    // campaign launches, from the factory itself
    try {
      const { logs, head, secondsPerBlock } = await getLogs(
        CONFIG.rpc, CONFIG.factory, [TOPIC.campaignLaunched],
        [CONFIG.logsWindow, ...CONFIG.logsFallbacks], CONFIG.secondsPerBlock);
      for (const l of logs) {
        const token = "0x" + (l.topics[1] || "").slice(26);
        const c = campaignCache.find((x) => x.token.toLowerCase() === token.toLowerCase());
        rows.push({
          kind: "launch", amount: null,
          title: `${c ? c.sym : "?"} launched`,
          note: c && c.charity ? `routing to ${c.charity.short}` : "campaign created",
          secs: (head - Number(big(l.blockNumber))) * secondsPerBlock,
          href: `${CONFIG.explorer}/tx/${l.transactionHash}`,
        });
      }
    } catch { /* factory unreadable; skip */ }

    for (const [id, total] of Object.entries(byCharity)) {
      const cell = $("ct-" + id);
      if (cell) cell.textContent = eth(total) + " ETH";
    }

    // Deliberately not `released - delivered`. A delivery cannot be matched to
    // the release that caused it across two chains, and not every delivery came
    // from a vault, so subtracting produces a confident-looking wrong number.
    // Both totals are shown raw, and a release is counted in both during the
    // days it spends crossing the bridge.
    $("s-donated").textContent = eth(delivered) + " ETH";
    $("s-transit").textContent = eth(released) + " ETH";

    const box = $("ledger-list");
    if (!rows.length) {
      box.innerHTML = '<div class="led-empty">No payouts yet. The first one will appear here.</div>';
      $("ledger-src").textContent = "nothing on chain yet";
      return;
    }
    rows.sort((a, b) => a.secs - b.secs);
    box.innerHTML = "";
    rows.slice(0, 20).forEach((r) => {
      const el = document.createElement("div");
      el.className = "led is-" + r.kind;
      el.innerHTML =
        `<span class="pill ${{done: "done", sent: "transit", launch: "new"}[r.kind]}">` +
        `${{done: "delivered", sent: "in transit", launch: "launched"}[r.kind]}</span>` +
        `<div class="who"><b>${r.title}</b><span>${r.note}</span></div>` +
        `<span class="amt">${r.amount === null ? "—" : eth(r.amount) + " ETH"}</span>` +
        `<a class="tx" href="${r.href}" target="_blank" rel="noopener">${ago(r.secs)} ↗</a>`;
      box.appendChild(el);
    });
    $("ledger-src").textContent = `${rows.length} event${rows.length > 1 ? "s" : ""} on chain`;
    document.dispatchEvent(new CustomEvent("hh:ledger", { detail: rows }));
  };

  /* ---------------- the project token ---------------- */
  const drawChart = (points) => {
    const w = 1000, h = 220, pad = 10;
    const lo = Math.min(...points), hi = Math.max(...points);
    const span = hi - lo || 1;
    const x = (i) => (i / (points.length - 1)) * w;
    const y = (v) => pad + (1 - (v - lo) / span) * (h - pad * 2);
    const line = points.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
    const area = `${line}L${w},${h}L0,${h}Z`;
    const up = points[points.length - 1] >= points[0];
    const col = up ? "#00c805" : "#ff5f56";
    $("t-chart").innerHTML =
      `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="price chart">
         <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
           <stop offset="0%" stop-color="${col}" stop-opacity=".28"/>
           <stop offset="100%" stop-color="${col}" stop-opacity="0"/>
         </linearGradient></defs>
         <path d="${area}" fill="url(#g)"/>
         <path d="${line}" fill="none" stroke="${col}" stroke-width="2.5"
               stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
       </svg>`;
  };

  const loadToken = async () => {
    const t = CONFIG.mainToken;
    if (!t.address) return;                 // panel keeps its honest empty state
    // It is launched now, so the empty state must stop saying it isn't. The
    // chart still needs trades before it can draw anything.
    $("t-empty").textContent = "Launched. The chart draws itself once there are trades to plot.";
    $("t-buy").hidden = false;
    $("t-buy").href = `https://dexscreener.com/${CONFIG.chain}/${t.address}`;

    try {
      const d = await (await fetch("https://api.dexscreener.com/latest/dex/tokens/" + t.address)).json();
      const pairs = (d.pairs || []).filter((p) => p.chainId === CONFIG.chain);
      if (pairs.length) {
        const p = pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
        const price = +p.priceUsd;
        $("t-price").textContent = price >= 1 ? "$" + price.toFixed(4) : "$" + price.toPrecision(4);
        $("t-mcap").textContent = usdish(p.marketCap);
        $("t-vol").textContent = usdish(p.volume?.h24);
        const ch = p.priceChange?.h24;
        if (ch != null) {
          $("t-delta").textContent = (ch >= 0 ? "+" : "") + ch.toFixed(2) + "% 24h";
          $("t-delta").className = "delta " + (ch >= 0 ? "up" : "down");
        }
      }
    } catch { /* leave the dashes */ }

    // candles for the chart, via GeckoTerminal's pool endpoint
    try {
      const pools = await (await fetch(
        `https://api.geckoterminal.com/api/v2/networks/${CONFIG.gtNetwork}/tokens/${t.address}/pools`)).json();
      const pool = pools?.data?.[0]?.attributes?.address;
      if (!pool) return;
      const o = await (await fetch(
        `https://api.geckoterminal.com/api/v2/networks/${CONFIG.gtNetwork}/pools/${pool}/ohlcv/hour?limit=72`)).json();
      const list = o?.data?.attributes?.ohlcv_list || [];
      const closes = list.map((c) => Number(c[4])).filter((v) => v > 0).reverse();
      if (closes.length > 2) { $("t-empty").remove(); drawChart(closes); }
    } catch { /* chart stays empty; the price above still shows */ }
  };

  /* ---------------- go ---------------- */
  const refresh = async () => {
    await loadCampaigns();
    await loadLedger();
    await loadToken();
  };
  refresh();
  setInterval(refresh, CONFIG.pollMs);
})();
