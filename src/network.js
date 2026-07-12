"use strict";

const { DEFAULT_NETWORKS } = require("./constants");

const ENV_NETWORK_KEY = "KASPA_COVENANT_NETWORK";
const ENV_ALLOW_MAINNET_KEY = "KASPA_COVENANT_ALLOW_MAINNET";

function truthy(value) {
  return ["1", "true", "yes", "y", "on"].includes(String(value || "").trim().toLowerCase());
}

function normalizeNetworkId(value) {
  const id = String(value || "").trim().toLowerCase();
  if (!id) return "tn10";
  if (id === "testnet-10" || id === "testnet10") return "tn10";
  if (id === "kaspa-mainnet" || id === "kaspa") return "mainnet";
  return id;
}

function mainnetAllowed(options = {}) {
  return Boolean(options.allowMainnet) || truthy(process.env[ENV_ALLOW_MAINNET_KEY]);
}

function networkIdFrom(options = {}) {
  return normalizeNetworkId(
    options.network?.id ||
      options.networkId ||
      process.env[ENV_NETWORK_KEY] ||
      process.env.KASPA_NETWORK ||
      "tn10"
  );
}

function isMainnetNetwork(network = {}) {
  return normalizeNetworkId(network.id) === "mainnet" ||
    normalizeNetworkId(network.kaspaNetworkId) === "mainnet" ||
    normalizeNetworkId(network.kascovNetworkId) === "mainnet" ||
    String(network.addressPrefix || "").toLowerCase() === "kaspa" ||
    network.isTestnet === false;
}

function applyNetworkEnvOverrides(network) {
  const prefix = isMainnetNetwork(network) ? "KASPA_MAINNET" : "KASPA_TN10";
  return {
    ...network,
    restApi: process.env[`${prefix}_REST_API`] || network.restApi,
    explorerApi: process.env[`${prefix}_EXPLORER_API`] || network.explorerApi,
    kascovNetworkId: process.env[`${prefix}_KASCOV_NETWORK`] || network.kascovNetworkId,
    kascovExplorerBase: process.env[`${prefix}_KASCOV_EXPLORER`] || network.kascovExplorerBase,
    kascovLiveDataUrl: process.env[`${prefix}_KASCOV_LIVE_DATA`] || network.kascovLiveDataUrl
  };
}

function resolveNetworkConfig(options = {}) {
  const selected = options.network ? { ...options.network } : DEFAULT_NETWORKS[networkIdFrom(options)];
  if (!selected) {
    throw new Error(`Unsupported Kaspa network: ${networkIdFrom(options)}. Use "tn10" or "mainnet".`);
  }
  const network = applyNetworkEnvOverrides(selected);
  const mainnetLike = isMainnetNetwork(network);
  if (mainnetLike && !mainnetAllowed(options)) {
    throw new Error(
      `Mainnet is disabled by default. Pass allowMainnet: true or set ${ENV_ALLOW_MAINNET_KEY}=true to use real KAS.`
    );
  }
  if (mainnetLike) {
    network.id = "mainnet";
    network.kaspaNetworkId = "mainnet";
    network.kascovNetworkId = "mainnet";
    network.addressPrefix = "kaspa";
    network.isTestnet = false;
    network.requiresMainnetConfirmation = true;
  }
  return network;
}

function networkSwitchConfig(options = {}) {
  const network = resolveNetworkConfig(options);
  return {
    network,
    env: {
      network: ENV_NETWORK_KEY,
      allowMainnet: ENV_ALLOW_MAINNET_KEY
    },
    usage: {
      tn10: `${ENV_NETWORK_KEY}=tn10`,
      mainnet: `${ENV_NETWORK_KEY}=mainnet ${ENV_ALLOW_MAINNET_KEY}=true`
    }
  };
}

function kascovCliNetwork(network) {
  return network?.kascovNetworkId || (network?.id === "tn10" ? "testnet-10" : network?.id || "mainnet");
}

function kascovTraceCommand(covenantId, network) {
  const id = covenantId || "<covenant-id>";
  return `kascov --network ${kascovCliNetwork(network)} trace ${id}`;
}

module.exports = {
  ENV_ALLOW_MAINNET_KEY,
  ENV_NETWORK_KEY,
  mainnetAllowed,
  kascovCliNetwork,
  kascovTraceCommand,
  isMainnetNetwork,
  networkIdFrom,
  networkSwitchConfig,
  normalizeNetworkId,
  resolveNetworkConfig
};
