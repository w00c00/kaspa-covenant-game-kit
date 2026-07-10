"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { KaspaCovenantGameKit, kascovTraceCommand, resolveNetworkConfig } = require("../src");

function withCleanNetworkEnv(fn) {
  const originalNetwork = process.env.KASPA_COVENANT_NETWORK;
  const originalAllow = process.env.KASPA_COVENANT_ALLOW_MAINNET;
  delete process.env.KASPA_COVENANT_NETWORK;
  delete process.env.KASPA_COVENANT_ALLOW_MAINNET;
  try {
    fn();
  } finally {
    if (originalNetwork === undefined) delete process.env.KASPA_COVENANT_NETWORK;
    else process.env.KASPA_COVENANT_NETWORK = originalNetwork;
    if (originalAllow === undefined) delete process.env.KASPA_COVENANT_ALLOW_MAINNET;
    else process.env.KASPA_COVENANT_ALLOW_MAINNET = originalAllow;
  }
}

test("network switch defaults to TN10", () => {
  withCleanNetworkEnv(() => {
    const network = resolveNetworkConfig();
    assert.equal(network.id, "tn10");
    assert.equal(network.kaspaNetworkId, "testnet-10");
    assert.equal(network.addressPrefix, "kaspatest");
    assert.equal(network.kascovNetworkId, "testnet-10");
    assert.equal(kascovTraceCommand("abc", network), "kascov --network testnet-10 trace abc");
  });
});

test("mainnet requires an explicit confirmation", () => {
  withCleanNetworkEnv(() => {
    assert.throws(() => new KaspaCovenantGameKit({ networkId: "mainnet" }), /Mainnet is disabled/);
    const kit = new KaspaCovenantGameKit({ networkId: "mainnet", allowMainnet: true });
    assert.equal(kit.network.id, "mainnet");
    assert.equal(kit.network.addressPrefix, "kaspa");
    assert.equal(kit.network.kascovNetworkId, "mainnet");
    assert.equal(kascovTraceCommand("abc", kit.network), "kascov --network mainnet trace abc");
  });
});

test("environment variables can switch to mainnet", () => {
  withCleanNetworkEnv(() => {
    process.env.KASPA_COVENANT_NETWORK = "mainnet";
    process.env.KASPA_COVENANT_ALLOW_MAINNET = "true";
    const kit = new KaspaCovenantGameKit();
    assert.equal(kit.networkId, "mainnet");
    assert.equal(kit.network.currencySymbol, "KAS");
  });
});
