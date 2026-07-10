"use strict";

const path = require("node:path");
const {
  DEFAULT_NETWORKS,
  JsonStore,
  KaspaCovenantGameKit,
  adapters
} = require("../src");

const store = new JsonStore(path.join(__dirname, "..", "data", "demo-ledger.json"));

const kit = new KaspaCovenantGameKit({
  store,
  network: DEFAULT_NETWORKS.tn10,
  arbiter: {
    address: "kaspatest:example-arbiter",
    publicKey: "11".repeat(32),
    arbiterHash: "22".repeat(32)
  },
  contractFile: path.join(__dirname, "..", "contracts", "gomoku_escrow.sil"),
  submitTransaction: async () => ({ transactionId: "aa".repeat(32) }),
  fetchUtxos: async (address) => [
    {
      address,
      outpoint: { transactionId: "bb".repeat(32), index: 0 },
      amount: 10_000_000_000n,
      script: "20" + "33".repeat(32) + "ac",
      blockDaaScore: 1n,
      isCoinbase: false
    }
  ]
});

const room = {
  id: "GOMOKU-DEMO",
  stake: 25,
  occupants: [
    { seat: 0, role: "black", address: "kaspatest:black", publicKey: "44".repeat(32) },
    { seat: 1, role: "white", address: "kaspatest:white", publicKey: "55".repeat(32) }
  ]
};

const state = adapters.gomoku.createState({ roundId: "round-demo" });
const match = kit.toMatch({ game: "gomoku", room, state });
const intent = kit.createEscrowIntent({ match });
const pending = kit.settlements.createPendingSettlement({
  match,
  winnerAddress: room.occupants[0].address,
  reason: "gomoku-five-in-row",
  gameState: state,
  escrowRecord: null
});

console.log(JSON.stringify({ intent, pending }, null, 2));
