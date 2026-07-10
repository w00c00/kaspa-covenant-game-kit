"use strict";

const path = require("node:path");
const {
  CovenantEscrowEngine,
  DEFAULT_NETWORKS,
  JsonStore,
  ProofBuilder,
  SettlementEngine,
  adapters
} = require("../src");

const store = new JsonStore(path.join(__dirname, "..", "data", "demo-ledger.json"));

const escrowEngine = new CovenantEscrowEngine({
  store,
  network: DEFAULT_NETWORKS.tn10,
  arbiter: {
    address: "kaspatest:example-arbiter",
    publicKey: "11".repeat(32),
    arbiterHash: "22".repeat(32)
  },
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

const proofBuilder = new ProofBuilder({
  network: DEFAULT_NETWORKS.tn10,
  contractFile: path.join(__dirname, "..", "contracts", "gomoku_escrow.sil")
});

const settlementEngine = new SettlementEngine({
  escrowEngine,
  proofBuilder,
  store
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
const match = adapters.gomoku.toMatch(room, state);
const intent = escrowEngine.createIntent(match);
const pending = settlementEngine.createPendingSettlement({
  match,
  winnerAddress: room.occupants[0].address,
  reason: "gomoku-five-in-row",
  gameState: state,
  escrowRecord: null
});

console.log(JSON.stringify({ intent, pending }, null, 2));
