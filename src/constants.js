"use strict";

const SOMPI_PER_KAS = 100_000_000n;

const DEFAULT_NETWORKS = {
  tn10: {
    id: "tn10",
    kaspaNetworkId: "testnet-10",
    label: "Kaspa Testnet 10",
    addressPrefix: "kaspatest",
    restApi: "https://api-tn10.kaspa.org",
    explorerApi: "https://api-tn10.kaspa.org",
    kascovExplorerBase: "https://kascov-explorer.web.app/testnet-10",
    mode: "active"
  },
  mainnet: {
    id: "mainnet",
    kaspaNetworkId: "mainnet",
    label: "Kaspa Mainnet",
    addressPrefix: "kaspa",
    restApi: "https://api.kaspa.org",
    explorerApi: "https://api.kaspa.org",
    kascovExplorerBase: "https://kascov-explorer.web.app/mainnet",
    mode: "reserved"
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
