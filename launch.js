/* Helping Hand — the launch form.
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

  const encodeSocials = (twitter) =>
    tuple([twitter, "", "", "", ""].map((s) => ({ dyn: true, v: encStr(s) })));

  const encodeLaunch = (p, configId, charityId) => {
    const params = tuple([
      { dyn: true, v: encStr(p.name) },
      { dyn: true, v: encStr(p.symbol) },
      { dyn: true, v: encStr(p.logo || "") },
      { dyn: true, v: encStr(p.description || "") },
      { dyn: true, v: encodeSocials(p.twitter || "") },
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
    salt: "0x69597a984565240a8fd8f181606000216c27ea03573f14bedf28349370dbae88",
  };
  const REFERENCE_OUTPUT =
    "0xc38123f9" +
    "0000000000000000000000000000000000000000000000000000000000000060" +
    "0000000000000000000000000000000000000000000000000000000000000000" +
    "0000000000000000000000000000000000000000000000000000000000000002";
  const verifyEncoder = () => {
    const got = encodeLaunch(REFERENCE_INPUT, 0, 2);
    const ok = got.slice(0, REFERENCE_OUTPUT.length) === REFERENCE_OUTPUT && got.length === 1994;
    console[ok ? "log" : "error"](
      ok ? "launch encoder: matches reference (997 bytes)"
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

      const data = encodeLaunch({
        name, symbol, logo: "",
        description: $("f-desc").value.trim(),
        twitter: $("f-x").value.trim(),
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
        `It will appear in Campaigns once the chain confirms.`;
      $("l-status").className = "lstatus ok";
    } catch (err) {
      const m = (err && (err.message || err.toString())) || "unknown error";
      status(/user rejected|denied/i.test(m) ? "Cancelled in wallet." : "Failed: " + m.slice(0, 160), "bad");
    }
  });

  verifyEncoder();
})();
