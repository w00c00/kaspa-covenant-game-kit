"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { KaspaCovenantGameKit } = require("../src");

test("SDK facade registers a custom adapter and creates escrow proof inputs", () => {
  const adapter = {
    name: "duel",
    createState: () => ({ roundId: "round-sdk", winnerAddress: "" }),
    toMatch: (room, state) => ({
      id: room.id,
      roundId: state.roundId,
      game: "duel",
      stakeKas: room.stakeKas,
      players: room.players
    }),
    getWinnerAddress: (match, state) => state.winnerAddress
  };
  const kit = new KaspaCovenantGameKit({
    adapter,
    arbiter: {
      address: "kaspatest:arbiter",
      publicKey: "11".repeat(32),
      arbiterHash: "22".repeat(32)
    },
    contractSource: "contract Duel {}"
  });
  const room = {
    id: "DUEL-1",
    stakeKas: 3,
    players: [
      { seat: 0, role: "left", address: "kaspatest:left", publicKey: "33".repeat(32) },
      { seat: 1, role: "right", address: "kaspatest:right", publicKey: "44".repeat(32) }
    ]
  };
  const state = kit.createState("duel");
  state.winnerAddress = "kaspatest:right";
  const match = kit.toMatch({ game: "duel", room, state });
  const intent = kit.createEscrowIntent({ match });
  const proof = kit.createSettlementProof({ game: "duel", room, state });

  assert.equal(match.game, "duel");
  assert.equal(intent.status, "ready-for-pskt-builder");
  assert.equal(intent.totalLockedKas, 6);
  assert.equal(proof.winner, "kaspatest:right");
  assert.equal(proof.potKas, 6);
});
