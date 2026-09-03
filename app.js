/* Robin Help — everything on this page is read from chain, not typed in. */
(() => {
  const $ = (id) => document.getElementById(id);
  const short = (a) => a.slice(0, 6) + "…" + a.slice(-4);

  const L1_RPC = "https://eth.drpc.org";          // serves getLogs over a useful range
  const RELAY = "0x02A0d2a39732082b824a5A3D3b026C54d581DCC8";  // donate.gg, Ethereum
  const ETH_SECONDS_PER_BLOCK = 12;

  // Topics and selectors are computed from signatures, never recalled: a wrong
  // one fails silently, because the call simply reverts and the list looks empty.
  const TOPIC = {
    releasedFast: "0x599ac48a6b909e7a3910a227f52677cd1b37f26d40ea229b3697074d698fcfea",
    releasedCanonical: "0x13713570af345cfea0b3aaea60175e30abb40dd23efcc294496177f7a41b9090",
    donationMade: "0xd8e70e726414c0696085c89f19916df42c131dd051341e82d3eb198faa8b1bdc",
  };
  const SEL = {
    campaignCount: "0x7274e30d", campaigns: "0x141961bc",
    vaultOf: "0x0709df45", charityOf: "0xac6f2f8a", symbol: "0x95d89b41",
  };

  /* ---------------- plumbing ---------------- */
  const call = async (url, method, params) => {
    const r = await fetch(url, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    const j = await r.json();
    if (j.error) throw new Error(j.error.message);
    return j.result;
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
  $("contracts").innerHTML = CONFIG.factory
    ? ` · Launchpad <a href="${CONFIG.explorer}/address/${CONFIG.factory}" target="_blank" rel="noopener">${short(CONFIG.factory)}</a>`
    : "";

  const grid = $("charity-grid");
  grid.innerHTML = "";
  CONFIG.charities.forEach((c) => {
    const live = !!c.forwarder;
    const el = document.createElement("div");
    el.className = "card";
    el.innerHTML =
      `<span class="badge ${live ? "live" : "wait"}">${live ? "routing live" : "not yet routed"}</span>` +
      `<div class="name">${c.name}</div>` +
      `<div class="cid">config ${c.configId.slice(0, 20)}…${c.configId.slice(-6)}</div>` +
      (live ? `<div class="cid">payout <a href="https://etherscan.io/address/${c.forwarder}" target="_blank" rel="noopener">${short(c.forwarder)}</a></div>`
            : `<div class="cid">payout contract not deployed</div>`) +
      `<a href="${c.url}" target="_blank" rel="noopener" style="font-size:.86rem">Charity page ›</a>`;
    grid.appendChild(el);
  });

  /* ---------------- campaigns ---------------- */
  const campaignCache = [];

  const loadCampaigns = async () => {
    if (!CONFIG.factory) return;
    const list = $("campaign-list");
    let n = 0;
    try { n = Number(big(await ethCall(CONFIG.factory, SEL.campaignCount))); }
    catch { list.innerHTML = '<p class="empty">Chain unreachable — could not read campaigns.</p>'; return; }
    $("s-campaigns").textContent = n;
    if (!n) return;

    list.innerHTML = "";
    campaignCache.length = 0;
    for (let i = 0; i < Math.min(n, 24); i++) {
      try {
        const token = addrAt(await ethCall(CONFIG.factory, SEL.campaigns + padUint(i)));
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
    if (!list.children.length) {
      list.innerHTML = `<p class="empty">${n} campaign${n > 1 ? "s" : ""} on chain, but none could be read.</p>`;
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

    // outbound, from every campaign vault
    for (const c of campaignCache) {
      try {
        const { logs, head, secondsPerBlock } = await getLogs(
          CONFIG.rpc, c.vault, [[TOPIC.releasedFast, TOPIC.releasedCanonical]],
          [CONFIG.logsWindow, ...CONFIG.logsFallbacks], CONFIG.secondsPerBlock);
        logs.forEach((l) => {
          const amount = big("0x" + wordAt(l.data, 0));
          released += amount;
          const fast = l.topics[0].toLowerCase() === TOPIC.releasedFast;
          rows.push({
            kind: "sent", amount,
            title: `$${c.sym} → ${c.charity ? c.charity.short : "charity"}`,
            note: fast ? "fast route" : "canonical bridge",
            secs: (head - Number(big(l.blockNumber))) * secondsPerBlock,
            href: `${CONFIG.explorer}/tx/${l.transactionHash}`,
          });
        });
      } catch { /* vault unreadable; skip */ }
    }

    // inbound, at donate.gg's relay, restricted to our five configs
    for (const c of CONFIG.charities) {
      if (!c.forwarder) continue;
      try {
        const { logs, head } = await getLogs(
          L1_RPC, RELAY, [TOPIC.donationMade, c.configId],
          [40000, 10000, 2000], ETH_SECONDS_PER_BLOCK);
        logs.forEach((l) => {
          const amount = big("0x" + wordAt(l.data, 1));
          delivered += amount;
          rows.push({
            kind: "done", amount,
            title: `Donated to ${c.short}`,
            note: "credited on Ethereum",
            secs: (head - Number(big(l.blockNumber))) * ETH_SECONDS_PER_BLOCK,
            href: `https://etherscan.io/tx/${l.transactionHash}`,
          });
        });
      } catch { /* relay unreadable; skip */ }
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
      el.className = "led";
      el.innerHTML =
        `<span class="pill ${r.kind === "done" ? "done" : "transit"}">${r.kind === "done" ? "delivered" : "in transit"}</span>` +
        `<div class="who"><b>${r.title}</b><span>${r.note}</span></div>` +
        `<span class="amt">${eth(r.amount)} ETH</span>` +
        `<a class="tx" href="${r.href}" target="_blank" rel="noopener">${ago(r.secs)} ↗</a>`;
      box.appendChild(el);
    });
    $("ledger-src").textContent = `${rows.length} event${rows.length > 1 ? "s" : ""} on chain`;
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
