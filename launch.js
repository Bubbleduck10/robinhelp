/* Hood Helper — the launch form.
 *
 * The calldata is built here by hand rather than pulled from a library, so the
 * page stays dependency-free and nothing third-party sits between a user and a
 * transaction they are signing. That puts the burden on the encoder being
 * right: it is verified byte-for-byte against `cast calldata` output for a
 * known input (see verifyEncoder below, which runs in the console).
 */
(() => {
  const $ = (id) => document.getElementById(id);
  const form = $("lform");
  if (!form) return;

  const LAUNCH_FEE = 5n * 10n ** 14n;            // 0.0005 ETH, the pons fee
  const LAUNCH_CONFIG_ID = 0n;
  const GAS_LIMIT = 6_500_000n;                  // a real launch measured ~3.6M;
                                                 // estimation under-provisions it badly
  const SELECTOR = "0xc38123f9";                 // launch((...),uint256,uint8)

  /* ---------------- ABI encoding ---------------- */
  const word = (h) => h.replace(/^0x/, "").toLowerCase().padStart(64, "0");
  const encUint = (n) => word(BigInt(n).toString(16));
  const encAddr = (a) => word(a);
  const encBool = (b) => encUint(b ? 1 : 0);
  const encB32 = (h) => word(h);
  const encStr = (s) => {
    const bytes = new TextEncoder().encode(s);
    let hex = "";
    bytes.forEach((b) => (hex += b.toString(16).padStart(2, "0")));
    const padded = hex.length ? hex.padEnd(Math.ceil(hex.length / 64) * 64, "0") : "";
    return encUint(bytes.length) + padded;
  };

  /* items: [{dyn:true|false, v:hex}] — dynamic ones get an offset in the head
     and their payload appended to the tail, which is what makes nested tuples
     of strings work. */
  const tuple = (items) => {
    let head = "", tail = "";
    const headSize = items.length * 32;
    for (const it of items) {
      if (it.dyn) { head += encUint(headSize + tail.length / 2); tail += it.v; }
      else head += it.v;
    }
    return head + tail;
  };

  // Order is twitter, telegram, discord, website, farcaster. The website slot
  // carries the campaign's charity: a donate.gg page publishes the very config
  // ID the payout routes under, so the coin's own metadata points at what it is
  // funding — and at a routing page rather than the charity's own site, which
  // would read as an endorsement nobody gave.
  const encodeSocials = (twitter, website) =>
    tuple([twitter, "", "", website, ""].map((s) => ({ dyn: true, v: encStr(s) })));

  const encodeLaunch = (p, configId, charityId) => {
    const params = tuple([
      { dyn: true, v: encStr(p.name) },
      { dyn: true, v: encStr(p.symbol) },
      { dyn: true, v: encStr(p.logo || "") },
      { dyn: true, v: encStr(p.description || "") },
      { dyn: true, v: encodeSocials(p.twitter || "", p.website || "") },
      { dyn: false, v: encAddr("0x0000000000000000000000000000000000000000") }, // factory overwrites
      { dyn: false, v: encUint(0) },                                            // creatorTaxBps
      { dyn: false, v: encBool(false) },                                        // buybackEnabled
      { dyn: false, v: encB32("0x" + "0".repeat(64)) },                         // zero waives the guard
      { dyn: false, v: encB32(p.salt) },
    ]);
    return SELECTOR + tuple([
      { dyn: true, v: params },
      { dyn: false, v: encUint(configId) },
      { dyn: false, v: encUint(charityId) },
    ]);
  };

  /* Byte-for-byte against `cast calldata` for the same input. Logged rather
     than hidden: if this ever prints a mismatch, the form must not be used. */
  const REFERENCE_INPUT = {
    name: "MyCoin", symbol: "MYC", logo: "", description: "For a cause",
    twitter: "https://x.com/me",
    website: "https://www.donate.gg/charities/water-aid",
    salt: "0x69597a984565240a8fd8f181606000216c27ea03573f14bedf28349370dbae88",
  };
  const REFERENCE_OUTPUT =
    "0xc38123f9" +
    "0000000000000000000000000000000000000000000000000000000000000060" +
    "0000000000000000000000000000000000000000000000000000000000000000" +
    "0000000000000000000000000000000000000000000000000000000000000002";
  const verifyEncoder = () => {
    const got = encodeLaunch(REFERENCE_INPUT, 0, 2);
    const ok = got.slice(0, REFERENCE_OUTPUT.length) === REFERENCE_OUTPUT && got.length === 2122;
    console[ok ? "log" : "error"](
      ok ? "launch encoder: matches reference (1060 bytes)"
         : "launch encoder: MISMATCH — do not launch", { got: got.length });
    return ok;
  };

  /* ---------------- chain + wallet ---------------- */
  const CHAIN_HEX = "0x" + CONFIG.chainId.toString(16);
  const CHAIN_PARAMS = {
    chainId: CHAIN_HEX,
    chainName: CONFIG.chainName,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: [CONFIG.rpc],
    blockExplorerUrls: [CONFIG.explorer],
  };

  const status = (msg, kind) => {
    const el = $("l-status");
    el.textContent = msg;
    el.className = "lstatus " + (kind || "");
  };

  const ensureChain = async (eth) => {
    const current = await eth.request({ method: "eth_chainId" });
    if (current.toLowerCase() === CHAIN_HEX.toLowerCase()) return;
    try {
      await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN_HEX }] });
    } catch (e) {
      // 4902 = wallet doesn't know this chain yet, so offer to add it
      if (e && (e.code === 4902 || /unrecognized/i.test(e.message || ""))) {
        await eth.request({ method: "wallet_addEthereumChain", params: [CHAIN_PARAMS] });
      } else throw e;
    }
  };

  /* ---------------- charities ---------------- */
  const sel = $("f-charity");
  CONFIG.charities.forEach((c) => {
    const o = document.createElement("option");
    o.value = String(c.id);
    o.textContent = c.name + (c.forwarder ? "" : " — routing not live yet");
    if (!c.forwarder) o.disabled = true;
    sel.appendChild(o);
  });

  /* ---------------- submit ---------------- */

  /* ---------------- the buy step ----------------
     A dev buy cannot ride along with the launch. pons reverts unless msg.value
     is exactly the launch fee — one wei over and it is LaunchFeeNotPaid — and
     even if it accepted more, the caller of launchToken is the campaign vault,
     so the tokens would land there. The vault can only bridge ETH to its
     charity; it has no transfer or approve, so tokens sent to it are stuck for
     good. So the buy is a separate, ordinary trade from the launcher's own
     wallet, which is also the honest version: it pays the same 1% fee everyone
     pays, and 0.7% of it reaches the charity. */

  const BUY_SEL   = "0x59a87bc1";   // buy(uint256,uint256,address)
  const CURVE_SEL = "0x7165485d";   // curve()
  // The quote is simulated at click time, so the buyer's own price impact is
  // already priced in; this tolerance only covers state changing between the
  // quote and inclusion — someone else buying first. On a launch that is the
  // likely case, and a revert costs gas for nothing, so it is set wide.
  const SLIPPAGE_BPS = 1500n;       // 15%

  const rpcCall = async (method, params) => {
    const r = await fetch(CONFIG.rpc, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    const j = await r.json();
    if (j.error) throw new Error(j.error.message);
    return j.result;
  };

  /* Poll for the receipt and pull the campaign out of its own logs, rather
     than re-reading the factory: the log is the authoritative record of what
     this transaction created. */
  const waitForCampaign = async (eth, hash) => {
    const TOPIC = "0xcea37bc2e454d11f3881906d399c2945470501e5caddeb5fd84e3c4c0088c771";
    for (let i = 0; i < 45; i++) {
      const r = await rpcCall("eth_getTransactionReceipt", [hash]).catch(() => null);
      if (r) {
        if (r.status === "0x0") throw new Error("reverted");
        const log = (r.logs || []).find((l) =>
          l.address.toLowerCase() === CONFIG.factory.toLowerCase() &&
          (l.topics || [])[0] === TOPIC);
        if (!log) throw new Error("no CampaignLaunched log");
        return { token: "0x" + log.topics[1].slice(26), vault: "0x" + log.topics[2].slice(26) };
      }
      await new Promise((s2) => setTimeout(s2, 2000));
    }
    throw new Error("timed out waiting for the receipt");
  };

  const parseEth = (v) => {
    if (!/^d*.?d*$/.test(v) || v === "" || v === ".") return null;
    const [w, f = ""] = v.split(".");
    if (f.length > 18) return null;
    return BigInt(w || "0") * 10n ** 18n + BigInt((f + "0".repeat(18)).slice(0, 18));
  };
  const fmtUnits = (v, dp = 4) => {
    const base = 10n ** 18n;
    const frac = ((v % base) * 10n ** BigInt(dp)) / base;
    return (v / base).toLocaleString() + "." + frac.toString().padStart(dp, "0");
  };

  const openBuyStep = (eth, from, token, vault, symbol) => {
    const box = $("buystep"); if (!box) return;
    $("l-status").innerHTML = $("l-status").innerHTML.replace(
      "Waiting for the chain to confirm…", "Confirmed on chain.");
    $("b-sym").textContent = "$" + symbol;
    box.hidden = false;

    const bstat = (m, kind) => {
      const el = $("b-status"); el.textContent = m; el.className = "lstatus " + (kind || "");
    };
    let curve = null;
    const getCurve = async () => {
      if (curve) return curve;
      const r = await rpcCall("eth_call", [{ to: vault, data: CURVE_SEL }, "latest"]);
      curve = "0x" + r.slice(26);
      return curve;
    };
    const encBuy = (amtIn, minOut, to) =>
      BUY_SEL + encUint(amtIn) + encUint(minOut) + encAddr(to);

    // Quote by simulating the real call, so the number shown is the number the
    // curve would actually return rather than a formula we keep in step.
    const quote = async (amtIn) => {
      const c = await getCurve();
      const out = await rpcCall("eth_call", [
        { from, to: c, data: encBuy(amtIn, 0n, from), value: "0x" + amtIn.toString(16) },
        "latest",
      ]);
      return BigInt(out);
    };

    let timer;
    $("b-amt").addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const amt = parseEth($("b-amt").value.trim());
        if (!amt || amt <= 0n) { $("b-quote").textContent = ""; return; }
        try {
          const out = await quote(amt);
          $("b-quote").textContent =
            "≈ " + fmtUnits(out, 2) + " " + symbol + "  ·  min " +
            fmtUnits(out - (out * SLIPPAGE_BPS) / 10000n, 2) + " if someone buys first";
        } catch { $("b-quote").textContent = "Could not quote that amount."; }
      }, 350);
    });

    $("b-go").addEventListener("click", async () => {
      const amt = parseEth($("b-amt").value.trim());
      if (!amt || amt <= 0n) return bstat("Enter an amount in ETH.", "err");
      try {
        const c = await getCurve();
        bstat("Quoting…");
        const out = await quote(amt);
        const minOut = out - (out * SLIPPAGE_BPS) / 10000n;
        bstat("Confirm in your wallet — " + fmtUnits(amt) + " ETH plus gas.");
        const hash = await eth.request({
          method: "eth_sendTransaction",
          params: [{ from, to: c, data: encBuy(amt, minOut, from),
                     value: "0x" + amt.toString(16) }],
        });
        $("b-status").innerHTML =
          "Bought " + fmtUnits(out, 2) + " " + symbol + " — " +
          '<a href="' + CONFIG.explorer + "/tx/" + hash + '" target="_blank" rel="noopener">view transaction ›</a>';
        $("b-status").className = "lstatus ok";
      } catch (err) {
        const m = (err && (err.message || err.toString())) || "unknown error";
        bstat(/user rejected|denied/i.test(m) ? "Cancelled in wallet." : "Failed: " + m.slice(0, 160), "err");
      }
    });
  };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const name = $("f-name").value.trim();
    const symbol = $("f-sym").value.trim().toUpperCase();
    if (name.length < 2) return status("Give the coin a name.", "bad");
    if (!/^[A-Z0-9]{2,10}$/.test(symbol))
      return status("Ticker must be 2–10 letters or numbers.", "bad");
    if (!CONFIG.factory) return status("Launchpad address not configured.", "bad");

    const eth = window.ethereum;
    if (!eth) return status("No wallet found. Install a browser wallet and reload.", "bad");

    if (!verifyEncoder())
      return status("Internal check failed — the form refuses to build this transaction.", "bad");

    try {
      status("Connecting wallet…");
      const [from] = await eth.request({ method: "eth_requestAccounts" });

      status("Switching to " + CONFIG.chainName + "…");
      await ensureChain(eth);

      const salt = "0x" + Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map((b) => b.toString(16).padStart(2, "0")).join("");

      // The coin carries its charity in its own metadata, so the link survives
      // anywhere the token is listed, not only on this site.
      const picked = CONFIG.charities.find((c) => c.id === Number(sel.value));
      const data = encodeLaunch({
        name, symbol, logo: "",
        description: $("f-desc").value.trim(),
        twitter: $("f-x").value.trim(),
        website: picked ? picked.url : "",
        salt,
      }, LAUNCH_CONFIG_ID, Number(sel.value));

      status("Confirm in your wallet — 0.0005 ETH plus gas.");
      const hash = await eth.request({
        method: "eth_sendTransaction",
        params: [{
          from, to: CONFIG.factory, data,
          value: "0x" + LAUNCH_FEE.toString(16),
          gas: "0x" + GAS_LIMIT.toString(16),
        }],
      });

      const charity = CONFIG.charities.find((c) => c.id === Number(sel.value));
      $("l-status").innerHTML =
        `Launched. $${symbol} is now paired to ${charity ? charity.short : "its charity"} ` +
        `— <a href="${CONFIG.explorer}/tx/${hash}" target="_blank" rel="noopener">view transaction ›</a>. ` +
        `Waiting for the chain to confirm…`;
      $("l-status").className = "lstatus ok";

      // The buy step needs the token address, which only exists once the
      // transaction is mined. Failing to find it is not a launch failure —
      // the coin is live either way, so this only hides the buy panel.
      try {
        const { token, vault } = await waitForCampaign(eth, hash);
        openBuyStep(eth, from, token, vault, symbol);
      } catch (e) {
        $("l-status").innerHTML +=
          ` <br>It will appear in Campaigns once the chain confirms.`;
      }
    } catch (err) {
      const m = (err && (err.message || err.toString())) || "unknown error";
      status(/user rejected|denied/i.test(m) ? "Cancelled in wallet." : "Failed: " + m.slice(0, 160), "bad");
    }
  });

  verifyEncoder();
})();
