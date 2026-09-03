/* Charity Launchpad — everything on this page is read from chain, not typed in. */
(() => {
  const $ = (id) => document.getElementById(id);
  const short = (a) => a.slice(0, 6) + "…" + a.slice(-4);

  /* ---------------- json-rpc ---------------- */
  const rpc = async (method, params) => {
    const r = await fetch(CONFIG.rpc, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    const j = await r.json();
    if (j.error) throw new Error(j.error.message);
    return j.result;
  };
  const ethCall = (to, data) => rpc("eth_call", [{ to, data }, "latest"]);
  const big = (hex) => BigInt(hex && hex !== "0x" ? hex : "0x0");
  const pad = (a) => a.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  const padUint = (n) => n.toString(16).padStart(64, "0");   // hex, not decimal
  // Strip any 0x first: an ABI word is 64 hex chars, and the address is the
  // last 40. Passing the prefixed string here silently yields a bad address.
  const addrAt = (word) => "0x" + (word || "").replace(/^0x/, "").slice(24);

  const units = (v, dec = 18, dp = 4) => {
    const base = 10n ** BigInt(dec);
    const frac = ((v % base) * 10n ** BigInt(dp)) / base;
    return (v / base).toLocaleString() + "." + frac.toString().padStart(dp, "0");
  };

  /* ---------------- static config into the page ---------------- */
  $("chain-chip").textContent = CONFIG.chainName;
  $("s-charities").textContent = CONFIG.charities.length;
  $("lim-days").textContent = CONFIG.challengePeriodDays;

  $("contracts").innerHTML = CONFIG.factory
    ? `Launchpad <code>${CONFIG.factory}</code> · ` +
      `<a href="${CONFIG.explorer}/address/${CONFIG.factory}" target="_blank" rel="noopener">verify on the explorer ›</a>`
    : "Launchpad contract not yet deployed.";

  /* ---------------- charities ---------------- */
  // A charity is only "live" once its forwarder exists. Until then the card says
  // so rather than implying money can already reach it.
  const grid = $("charity-grid");
  grid.innerHTML = "";
  CONFIG.charities.forEach((c) => {
    const live = !!c.forwarder;
    const el = document.createElement("div");
    el.className = "card";
    el.innerHTML =
      `<span class="badge ${live ? "live" : "wait"}">${live ? "routing live" : "not yet routed"}</span>` +
      `<div class="name">${c.name}</div>` +
      `<div class="cid">config ${c.configId.slice(0, 22)}…${c.configId.slice(-6)}</div>` +
      (live
        ? `<div class="cid">payout <a href="https://etherscan.io/address/${c.forwarder}" target="_blank" rel="noopener">${short(c.forwarder)}</a></div>`
        : `<div class="cid">payout contract not deployed</div>`) +
      `<a href="${c.url}" target="_blank" rel="noopener" style="font-size:.86rem">Charity page ›</a>`;
    grid.appendChild(el);
  });

  /* ---------------- campaigns, read from the factory ---------------- */
  // Selectors computed from the signatures, not recalled. Getting one wrong
  // fails silently — the call reverts and the list just looks empty.
  const SEL = {
    campaignCount: "0x7274e30d",   // campaignCount()
    campaigns: "0x141961bc",       // campaigns(uint256)
    vaultOf: "0x0709df45",         // vaultOf(address)
    charityOf: "0xac6f2f8a",       // charityOf(address)
    symbol: "0x95d89b41",          // symbol()
  };

  const decodeString = (hex) => {
    const b = (hex || "").replace(/^0x/, "");
    const toStr = (h) => {
      let s = "";
      for (let i = 0; i + 1 < h.length; i += 2) {
        const c = parseInt(h.substr(i, 2), 16);
        if (c) s += String.fromCharCode(c);
      }
      return s;
    };
    if (b.length <= 64) return toStr(b).trim();
    const len = parseInt(b.slice(64, 128), 16) || 0;
    return toStr(b.slice(128, 128 + len * 2)).trim();
  };

  const loadCampaigns = async () => {
    if (!CONFIG.factory) return;
    const list = $("campaign-list");
    let n = 0;
    try {
      n = Number(big(await ethCall(CONFIG.factory, SEL.campaignCount)));
    } catch {
      list.innerHTML = '<p class="empty">Chain unreachable — could not read campaigns.</p>';
      return;
    }
    $("s-campaigns").textContent = n;
    if (!n) return;

    list.innerHTML = "";
    let feesTotal = 0n;

    for (let i = 0; i < Math.min(n, 24); i++) {
      try {
        const token = addrAt(await ethCall(CONFIG.factory, SEL.campaigns + padUint(i)));
        const vault = addrAt(await ethCall(CONFIG.factory, SEL.vaultOf + pad(token)));
        const cid = Number(big(await ethCall(CONFIG.factory, SEL.charityOf + pad(token))));
        const sym = decodeString(await ethCall(token, SEL.symbol)) || "?";
        const held = big(await rpc("eth_getBalance", [vault, "latest"]));
        feesTotal += held;

        const charity = CONFIG.charities.find((c) => c.id === cid);
        const el = document.createElement("div");
        el.className = "card";
        el.innerHTML =
          `<span class="badge live">${charity ? charity.short : "charity " + cid}</span>` +
          `<div class="name">$${sym}</div>` +
          `<div class="cid">vault <a href="${CONFIG.explorer}/address/${vault}" target="_blank" rel="noopener">${short(vault)}</a></div>` +
          `<div class="cid">${units(held)} ETH awaiting payout</div>` +
          `<a href="campaign.html?t=${token}" style="font-size:.86rem">Open campaign ›</a>`;
        list.appendChild(el);
      } catch { /* skip a campaign we can't read rather than blanking the list */ }
    }
    // Say so rather than showing an empty section: a silent read failure and
    // "no campaigns" look identical otherwise, which hid a bug once already.
    if (!list.children.length) {
      list.innerHTML =
        `<p class="empty">${n} campaign${n > 1 ? "s" : ""} registered on chain, but none could be read. ` +
        `The chain may be unreachable.</p>`;
      return;
    }
    $("s-fees").textContent = units(feesTotal) + " ETH";
  };

  loadCampaigns();
  setInterval(loadCampaigns, CONFIG.pollMs);
})();
