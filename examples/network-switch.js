"use strict";

const { KaspaCovenantGameKit, kascovTraceCommand, networkSwitchConfig } = require("../src");

const kit = new KaspaCovenantGameKit({
  networkId: process.env.KASPA_COVENANT_NETWORK || "tn10",
  allowMainnet: process.env.KASPA_COVENANT_ALLOW_MAINNET === "true"
});

console.log(
  JSON.stringify(
    {
      selected: kit.network,
      kascov: {
        traceCommand: kascovTraceCommand("<covenant-id>", kit.network),
        liveDataUrl: kit.network.kascovLiveDataUrl
      },
      switch: networkSwitchConfig({
        networkId: kit.networkId,
        allowMainnet: kit.networkId === "mainnet"
      }).usage
    },
    null,
    2
  )
);
