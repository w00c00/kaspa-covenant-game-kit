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

function applyNetworkEnvOverrides(network) {
  const prefix = network.id === "mainnet" ? "KASPA_MAINNET" : "KASPA_TN10";
  return {
    ...network,
    restApi: process.env[`${prefix}_REST_API`] || network.restApi,
    explorerApi: process.env[`${prefix}_EXPLORER_API`] || network.explorerApi,
    kascovExplorerBase: process.env[`${prefix}_KASCOV_EXPLORER`] || network.kascovExplorerBase
  };
}

function resolveNetworkConfig(options = {}) {
  const selected = options.network ? { ...options.network } : DEFAULT_NETWORKS[networkIdFrom(options)];
  if (!selected) {
    throw new Error(`Unsupported Kaspa network: ${networkIdFrom(options)}. Use "tn10" or "mainnet".`);
  }
  const network = applyNetworkEnvOverrides(selected);
  if (network.id === "mainnet" && network.requiresMainnetConfirmation !== false && !mainnetAllowed(options)) {
    throw new Error(
      `Mainnet is disabled by default. Pass allowMainnet: true or set ${ENV_ALLOW_MAINNET_KEY}=true to use real KAS.`
    );
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

module.exports = {
  ENV_ALLOW_MAINNET_KEY,
  ENV_NETWORK_KEY,
  mainnetAllowed,
  networkIdFrom,
  networkSwitchConfig,
  normalizeNetworkId,
  resolveNetworkConfig
};
