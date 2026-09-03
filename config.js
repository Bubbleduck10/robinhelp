// ============================================================
// Charity launchpad — edit this block only.
// ============================================================
const CONFIG = {
  name: "Helping Hand",
  tagline: "Memecoins whose fees can only reach a charity.",
  x: "https://x.com/Helpinghandrh",

  // ---- chain: Robinhood Chain (Arbitrum Orbit, id 4663) ----
  chain: "robinhood",       // DexScreener chainId
  gtNetwork: "robinhood",   // GeckoTerminal network
  chainName: "Robinhood Chain",
  chainId: 4663,

  rpc: "https://rpc.mainnet.chain.robinhood.com",   // sends CORS: *
  explorer: "https://robinhoodchain.blockscout.com",

  // ~10 blocks a second here, so block counts look nothing like Ethereum's.
  secondsPerBlock: 0.104,
  logsWindow: 1000000,               // ~29h
  logsFallbacks: [200000, 40000],    // ~5.8h, ~1.2h if the wide query is refused

  // ---- our contracts (fill in after deployment) ----
  factory: "0x21cA86cEc750b00509a783350218aBb6d938fEf3",  // live on Robinhood Chain
  ponsFactory: "0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e",

  // Rollup facts, used for the honest "in transit" copy.
  challengePeriodDays: 6.36,

  // ---- the project's own token ----
  // Launched separately from AD4c, not through the launchpad: its fees are the
  // project's, not a charity's. Left empty until it exists — the panel then says
  // so rather than showing a chart of nothing.
  mainToken: {
    symbol: "HAND",
    address: "",           // <-- paste the token address at launch
    launched: false,
  },

  // Campaigns the site does not list. The factory's `campaigns` array is
  // append-only and its entries are immutable, so a launch that should not be
  // promoted can only be filtered here — it still exists on chain, and anyone
  // reading the factory directly will still find it. Kept as an explicit,
  // visible list rather than a silent deletion.
  hiddenCampaigns: [
    "0xD61b931848642fE1f4E9772890a918988437533b",  // TEST, superseded deploy
  ],

  // A campaign donates roughly this share of its trading volume: pons charges
  // 1% and keeps 30% of that, so the creator share is 0.7%. We take none of it.
  donationShareOfVolume: 0.007,

  // ---- the five charities ----
  // beneficiary = the L1 forwarder holding this charity's donate.gg configId.
  // Fill in as each forwarder is deployed and test-donated.
  charities: [
    // Forwarder deployed and proven: donation 0xcb5b755a… credited this config
    // on Ethereum mainnet, block 25,893,523.
    { id: 0, name: "St. Jude Children's Research Hospital", short: "St. Jude",
      configId: "0xdc5048cf6f801b9b9a3d2d671f1869386bd455ec1fd4f2fb181c26985ec4ad46",
      forwarder: "0x2E41A9e3649FC9ECe0e3532610B87c8Ac0696F19",
      url: "https://www.donate.gg/charities/st-jude" },
    { id: 1, name: "Make-A-Wish America", short: "Make-A-Wish",
      configId: "0xe607846c92fb0a5aafcd9c063f398838421d97ecfbd34f78cc88cee8952154ef",
      forwarder: "0x38B90aF7684d34E3dFBA231B0FDc9c25A6a98cE6", url: "https://www.donate.gg/charities/make-a-wish-america" },
    { id: 2, name: "WaterAid America", short: "WaterAid",
      configId: "0x883716acf0f34171c0fa754ceea2df902091e62da1655bd57d1894355d8455ba",
      forwarder: "0x6b31F2A7EEde45a35322A5A14217a0b8A971181B", url: "https://www.donate.gg/charities/water-aid" },
    { id: 3, name: "UNICEF USA", short: "UNICEF",
      configId: "0x7fb3f9dfae76054818d090b5a8c6b628e09f74160f792b9ef299d2bc1e7d9ed3",
      // NB: same address as the retired first factory on Robinhood Chain — same
      // deployer, same nonce, different chains. It is not that factory.
      forwarder: "0xBba6f568E03Fc2F8253290c501eA4287F073Ffeb", url: "https://www.donate.gg/charities/unicef-usa" },
    { id: 4, name: "Feeding America", short: "Feeding America",
      configId: "0x63f61d5832e2b3839a7336f84c5ae00bd6759ad70dfe935f73d6eba4255f4f49",
      forwarder: "0x163a9abd07bCC0862fC3280960605Dd4DC3c211E", url: "https://www.donate.gg/charities/feeding-america" },
  ],

  pollMs: 30000,
};
