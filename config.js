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

  // The first donation landed at Ethereum block 25,893,523. Nothing our relay
  // query cares about exists before this, so the backwards walk stops here
  // rather than scanning the chain.
  // Donations are read from Blockscout's index, not an RPC: no free RPC
  // will serve a log more than a few hours old.
  l1Index: "https://eth.blockscout.com/api",
  l1FirstBlock: 25000000,

  // Our forwarders all carry this as creditedTo. donate.gg's relay is shared
  // with every other user of it, so this is what separates a donation our
  // contracts caused from a stranger's to the same charity.
  creditedTo: "0xb7558a46F3c791302fF7ba4DC051390c8F359F37",

  // Rollup facts, used for the honest "in transit" copy.
  challengePeriodDays: 6.36,

  // ---- the project's own token ----
  // Launched separately from AD4c, not through the launchpad: its fees are the
  // project's, not a charity's. Left empty until it exists — the panel then says
  // so rather than showing a chart of nothing.
  mainToken: {
    symbol: "Helpinghand",
    address: "",           // <-- paste the token address at launch
    launched: false,
  },

  // Campaigns the site does not list. The factory's `campaigns` array is
  // append-only and its entries are immutable, so a launch that should not be
  // promoted can only be filtered here — it still exists on chain, and anyone
  // reading the factory directly will still find it. Kept as an explicit,
  // visible list rather than a silent deletion.
  // Empty on purpose: the Campaigns tab shows everything the launchpad has
  // deployed. Listing a campaign is not an endorsement of it — anyone can
  // launch one, and hiding the ones we did not like would make the list a
  // curated feed rather than a reading of the contract.
  hiddenCampaigns: [],

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

    // Added with the eight-charity launchpad. configIds read from each charity's
    // own donate.gg page. `forwarder` stays empty until its L1 contract is
    // deployed and test-donated — the card says "not yet routed" until then,
    // and the factory cannot be deployed without all eight addresses.
    { id: 5, name: "American Cancer Society", short: "Cancer Society",
      configId: "0x8be9a2cc06f0679fa5502431e417c3286fab0291a837c42a30085e9a785578b6",
      forwarder: "", url: "https://www.donate.gg/charities/american-cancer-society" },
    { id: 6, name: "charity: water", short: "charity: water",
      configId: "0xc4efc42eeccfcac047b95d4e219108ca2b83c9cfb5e4aafe567d3daced3a928c",
      forwarder: "", url: "https://www.donate.gg/charities/charity-water" },
    { id: 7, name: "Direct Relief", short: "Direct Relief",
      configId: "0x5aee11e17119e3f6e02aec76da1d497d4fcb3e2905ea0e4559d2b4fc233b59b0",
      forwarder: "", url: "https://www.donate.gg/charities/direct-relief" },
  ],

  pollMs: 30000,
};
