"use strict";

const SOMPI_PER_KAS = 100_000_000n;

const DEFAULT_NETWORKS = {
  tn10: {
    id: "tn10",
    kaspaNetworkId: "testnet-10",
    label: "Kaspa Testnet 10",
    addressPrefix: "kaspatest",
    currencySymbol: "TKAS",
    isTestnet: true,
    restApi: "https://api-tn10.kaspa.org",
    explorerApi: "https://api-tn10.kaspa.org",
    kascovNetworkId: "testnet-10",
    kascovExplorerBase: "https://kascov-explorer.web.app/testnet-10",
    kascovLiveDataUrl: "https://kascov-explorer.web.app/data/testnet-10-live.json",
    mode: "active",
    requiresMainnetConfirmation: false
  },
  mainnet: {
    id: "mainnet",
    kaspaNetworkId: "mainnet",
    label: "Kaspa Mainnet",
    addressPrefix: "kaspa",
    currencySymbol: "KAS",
    isTestnet: false,
    restApi: "https://api.kaspa.org",
    explorerApi: "https://api.kaspa.org",
    kascovNetworkId: "mainnet",
    kascovExplorerBase: "https://kascov-explorer.web.app/mainnet",
    kascovLiveDataUrl: "https://kascov-explorer.web.app/data/mainnet-live.json",
    mode: "production-guarded",
    requiresMainnetConfirmation: true
  }
};

const DEFAULT_DOCS = {
  toccata: "https://docs.kaspa.org/toccata",
  silverscript: "https://github.com/kaspanet/silverscript/",
  kascov: "https://github.com/Knitser/kascov",
  kascovLab: "https://github.com/Knitser/kascov/blob/main/docs/Covenant%20Lab.md"
};

module.exports = {
  SOMPI_PER_KAS,
  DEFAULT_NETWORKS,
  DEFAULT_DOCS
};
