"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CovenantEscrowEngine,
  DEFAULT_NETWORKS,
  JsonStore,
  ProofBuilder,
  SettlementEngine,
  adapters,
  transcriptHash
} = require("../src");

test("proof builder creates deterministic transcript and visible settlement proof", () => {
  const state = adapters.gomoku.createState({ roundId: "round-proof" });
  const room = {
    id: "GOMOKU-PROOF",
    stake: 25,
    occupants: [
      { seat: 0, role: "black", address: "kaspatest:black", publicKey: "11".repeat(32) },
      { seat: 1, role: "white", address: "kaspatest:white", publicKey: "22".repeat(32) }
    ]
  };
  const match = adapters.gomoku.toMatch(room, state);
  const proofBuilder = new ProofBuilder({
    network: DEFAULT_NETWORKS.tn10,
    contractSource: "contract Example {}"
  });
  const plan = proofBuilder.covenantPlan(match, "kaspatest:black", state);

  assert.equal(plan.matchId, "GOMOKU-PROOF");
  assert.equal(plan.potKas, 50);
  assert.equal(plan.transcriptHash, transcriptHash(match, state));
  assert.equal(plan.players.length, 2);
});

test("settlement engine maps winner to buyer or seller release path", () => {
  const store = new JsonStore();
  const escrowEngine = new CovenantEscrowEngine({
    store,
    network: DEFAULT_NETWORKS.tn10,
    arbiter: { arbiterHash: "aa".repeat(32) }
  });
  const proofBuilder = new ProofBuilder({ network: DEFAULT_NETWORKS.tn10, contractSource: "contract Example {}" });
  const settlementEngine = new SettlementEngine({ escrowEngine, proofBuilder, store });
  const match = {
    id: "MATCH-1",
    roundId: "ROUND-1",
    game: "demo",
    stakeKas: 5,
    players: [
      { seat: 0, role: "buyer", address: "buyer", publicKey: "11".repeat(32) },
      { seat: 1, role: "seller", address: "seller", publicKey: "22".repeat(32) }
    ]
  };
  const escrow = store.upsertEscrow({
    id: escrowEngine.escrowId(match),
    matchId: match.id,
    roundId: match.roundId,
    programHex: "00",
    programHash: "55".repeat(32),
    programProfile: { fingerprint: "66".repeat(32) },
    status: "deployed-player-funded-on-chain",
    buyer: match.players[0],
    seller: match.players[1],
    deploy: { covenantId: "33".repeat(32), txid: "44".repeat(32) }
  });
  const pending = settlementEngine.createPendingSettlement({
    match,
    winnerAddress: "seller",
    reason: "demo-win",
    escrowRecord: escrow
  });

  assert.equal(pending.status, "pending-chain-covenant-settlement");
  assert.equal(pending.releaseTo, "seller");
  assert.equal(pending.potKas, 10);
  assert.equal(pending.covenantProof.programHash, "55".repeat(32));
  assert.equal(pending.covenantProof.programProfileFingerprint, "66".repeat(32));
});

test("settlement refresh stores Kascov evidence without treating the indexer as consensus", async () => {
  const store = new JsonStore();
  const escrowEngine = new CovenantEscrowEngine({ store, network: DEFAULT_NETWORKS.tn10 });
  const proofBuilder = new ProofBuilder({ network: DEFAULT_NETWORKS.tn10 });
  const indexer = {
    observeSettlement: async ({ covenantId, txid }) => ({
      source: "kascov",
      observed: true,
      covenantId,
      txid,
      event: { kind: "burn", txid }
    })
  };
  const engine = new SettlementEngine({ escrowEngine, proofBuilder, store, indexer });
  const record = store.upsertSettlement({
    id: "SETTLEMENT-1",
    status: "settled-on-chain",
    chainCovenantId: "55".repeat(32),
    chainSettlementTxid: "66".repeat(32)
  });

  const refreshed = await engine.refreshSettlement(record.id);
  assert.equal(refreshed.status, "settled-on-chain");
  assert.equal(refreshed.confirmationStatus, "confirmed-by-indexer");
  assert.equal(refreshed.indexerEvidence.source, "kascov");
});
