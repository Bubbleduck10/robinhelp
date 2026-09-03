/* Campaign page. Every claim on it is checked against chain, not asserted. */
(() => {
  const $ = (id) => document.getElementById(id);
  const short = (a) => a.slice(0, 6) + "…" + a.slice(-4);
  const same = (a, b) => (a || "").toLowerCase() === (b || "").toLowerCase();

  const token = new URLSearchParams(location.search).get("t");
  if (!token || !/^0x[0-9a-fA-F]{40}$/.test(token)) {
    $("c-name").textContent = "No campaign specified.";
    return;
  }

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
  const big = (h) => BigInt(h && h !== "0x" ? h : "0x0");
  const pad = (a) => a.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  const wordAt = (hex, i) => hex.replace(/^0x/, "").slice(i * 64, (i + 1) * 64);
  const addrOf = (word) => "0x" + word.slice(24);

  const units = (v, dec = 18, dp = 4) => {
    const base = 10n ** BigInt(dec);
    const frac = ((v % base) * 10n ** BigInt(dp)) / base;
    return (v / base).toLocaleString() + "." + frac.toString().padStart(dp, "0");
  };
  const compact = (n) => {
    if (n == null || isNaN(n)) return "—";
    if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
    if (n >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
    if (n >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
    return "$" + n.toFixed(2);
  };

  // Selectors and topics computed from their signatures, never recalled.
  const SEL = {
    getLaunchedToken: "0x3cf28b5a", vaultOf: "0x0709df45", charityOf: "0xac6f2f8a",
    beneficiary: "0x38af3eed", name: "0x06fdde03", symbol: "0x95d89b41",
    totalSupply: "0x18160ddd", decimals: "0x313ce567",
  };
  const TOPIC = {
    fast: "0x599ac48a6b909e7a3910a227f52677cd1b37f26d40ea229b3697074d698fcfea",
    canonical: "0x13713570af345cfea0b3aaea60175e30abb40dd23efcc294496177f7a41b9090",
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

  $("chain-chip").textContent = CONFIG.chainName;
  $("c-address").innerHTML =
    `Token <a href="${CONFIG.explorer}/address/${token}" target="_blank" rel="noopener">${token}</a>`;

  const check = (ok, label, detail) =>
    `<li class="${ok ? "pass" : "fail"}"><span class="tick">${ok ? "✓" : "✕"}</span>` +
    `<div><strong>${label}</strong><span class="detail">${detail}</span></div></li>`;

  /* ---------------- identity + the verification that matters ---------------- */
  const load = async () => {
    // token identity
    let decimals = 18;
    try {
      $("c-symbol").textContent = "$" + (decodeString(await ethCall(token, SEL.symbol)) || "?");
      $("c-name").textContent = decodeString(await ethCall(token, SEL.name)) || "Unnamed token";
      decimals = Number(big(await ethCall(token, SEL.decimals))) || 18;
      const sup = big(await ethCall(token, SEL.totalSupply));
      $("m-supply").textContent = (sup / 10n ** BigInt(decimals)).toLocaleString();
    } catch {
      $("c-name").textContent = "Could not read this token from chain.";
      return;
    }

    // the launch record, straight from the protocol
    let deployer = "", feeRecipient = "";
    try {
      const rec = await ethCall(CONFIG.ponsFactory, SEL.getLaunchedToken + pad(token));
      deployer = addrOf(wordAt(rec, 2));
      feeRecipient = addrOf(wordAt(rec, 3));
    } catch { /* handled below */ }

    // is this one of ours?
    let vault = "", charity = null;
    if (CONFIG.factory) {
      try {
        vault = addrOf(wordAt(await ethCall(CONFIG.factory, SEL.vaultOf + pad(token)), 0));
        const cid = Number(big(await ethCall(CONFIG.factory, SEL.charityOf + pad(token))));
        charity = CONFIG.charities.find((c) => c.id === cid) || null;
      } catch { /* not ours */ }
    }
    const known = vault && !/^0x0+$/.test(vault);

    $("c-charity").textContent = charity ? charity.short : "not a launchpad campaign";

    // Three independent checks. All must hold for the claim to be true.
    const cRecipient = known && same(feeRecipient, vault);
    const cDeployer = known && same(deployer, vault);
    let cBeneficiary = false, beneficiary = "";
    if (known) {
      try {
        beneficiary = addrOf(wordAt(await ethCall(vault, SEL.beneficiary), 0));
        cBeneficiary = charity && charity.forwarder ? same(beneficiary, charity.forwarder) : false;
      } catch { /* leave false */ }
    }

    $("checks").innerHTML =
      check(cRecipient, "Fees are paid to the campaign vault",
        known ? `recipient ${short(feeRecipient)} · vault ${short(vault)}`
              : `recipient ${feeRecipient ? short(feeRecipient) : "unknown"} — no vault for this token`) +
      check(cDeployer, "The vault deployed the token",
        known ? `deployer ${short(deployer)} · vault ${short(vault)}`
              : "closes the protocol's rescue route, which pays the deployer") +
      check(cBeneficiary, "The vault pays the charity and nothing else",
        beneficiary ? `beneficiary ${short(beneficiary)}` : "vault beneficiary not readable");

    const allOk = cRecipient && cDeployer && cBeneficiary;
    $("v-badge").className = "badge " + (allOk ? "live" : "bad");
    $("v-badge").textContent = allOk ? "fees locked" : "not locked";
    $("v-text").textContent = allOk
      ? `Fees from this coin can only reach ${charity ? charity.name : "the charity"}. Not the launcher, not us.`
      : known
        ? "This campaign does not currently satisfy every check, so its fees are not provably locked."
        : `This token was not launched through the launchpad. Its fees go to ${feeRecipient ? short(feeRecipient) : "an unknown address"}, which can be redirected at any time.`;

    if (known) {
      $("v-addr").innerHTML =
        `Vault <a href="${CONFIG.explorer}/address/${vault}" target="_blank" rel="noopener">${vault}</a>`;
      try {
        $("v-bal").textContent = units(big(await rpc("eth_getBalance", [vault, "latest"]))) + " ETH";
      } catch {}
      loadPayouts(vault);
    } else {
      $("v-addr").textContent = "No vault — this token has none.";
      $("v-log").innerHTML = '<li class="idle">No vault, so no payout history.</li>';
    }

    loadMarket();
  };

  /* ---------------- payout history ---------------- */
  const loadPayouts = async (vault) => {
    try {
      const head = Number(big(await rpc("eth_blockNumber", [])));
      const to = Math.max(0, head - 50);
      let logs = null;
      for (const win of [CONFIG.logsWindow, ...CONFIG.logsFallbacks]) {
        try {
          logs = await rpc("eth_getLogs", [{
            fromBlock: "0x" + Math.max(0, to - win).toString(16),
            toBlock: "0x" + to.toString(16),
            address: vault,
            topics: [[TOPIC.fast, TOPIC.canonical]],
          }]);
          break;
        } catch { /* try a shorter horizon */ }
      }
      if (!logs || !logs.length) {
        $("v-log").innerHTML = '<li class="idle">No payouts yet.</li>';
        $("v-paid").textContent = "0.0000 ETH";
        $("v-count").textContent = "0";
        return;
      }
      let total = 0n;
      $("v-log").innerHTML = "";
      logs.slice().reverse().slice(0, 12).forEach((l) => {
        const fast = l.topics[0].toLowerCase() === TOPIC.fast;
        const amount = big("0x" + wordAt(l.data, 0));
        total += amount;
        const bn = Number(big(l.blockNumber));
        const mins = Math.round(((head - bn) * CONFIG.secondsPerBlock) / 60);
        const li = document.createElement("li");
        li.innerHTML =
          `<span class="${fast ? "ok" : "slow"}">${fast ? "FAST" : "CANONICAL"}</span> ` +
          `${units(amount)} ETH · ` +
          `<a href="${CONFIG.explorer}/tx/${l.transactionHash}" target="_blank" rel="noopener">tx</a> ` +
          `<span class="t">${mins < 60 ? mins + "m" : Math.round(mins / 60) + "h"} ago</span>`;
        $("v-log").appendChild(li);
      });
      $("v-paid").textContent = units(total) + " ETH";
      $("v-count").textContent = logs.length;
    } catch {
      $("v-log").innerHTML = '<li class="idle">Payout history unavailable.</li>';
    }
  };

  /* ---------------- market ---------------- */
  const loadMarket = async () => {
    const fromDex = async () => {
      const d = await (await fetch("https://api.dexscreener.com/latest/dex/tokens/" + token)).json();
      const pairs = (d.pairs || []).filter((p) => p.chainId === CONFIG.chain);
      if (!pairs.length) return null;
      const p = pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
      return { price: +p.priceUsd, mcap: p.marketCap, vol: p.volume?.h24, src: "DexScreener" };
    };
    const fromGecko = async () => {
      const a = (await (await fetch(
        `https://api.geckoterminal.com/api/v2/networks/${CONFIG.gtNetwork}/tokens/${token}`)).json())?.data?.attributes;
      if (!a?.price_usd) return null;
      return { price: +a.price_usd, mcap: parseFloat(a.market_cap_usd ?? a.fdv_usd),
               vol: parseFloat(a.volume_usd?.h24 ?? 0), src: "GeckoTerminal" };
    };
    let r = null;
    try { r = await fromDex(); } catch {}
    if (!r) { try { r = await fromGecko(); } catch {} }
    if (!r) { $("m-src").textContent = "No trades indexed yet."; return; }
    $("m-price").textContent = r.price >= 1 ? "$" + r.price.toFixed(4) : "$" + r.price.toPrecision(4);
    $("m-mcap").textContent = compact(r.mcap);
    $("m-vol").textContent = compact(r.vol);
    $("m-src").textContent = "Live from " + r.src + ".";
  };

  load();
  setInterval(load, CONFIG.pollMs);
})();
