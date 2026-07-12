"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const adapter = require("./snooker-adapter.cjs");

test("snooker adapter maps a room and records a legal scoring visit", () => {
  const room = {
    id: "ROOM-1",
    stakeKas: 25,
    players: [
      { seat: 0, address: "kaspatest:one" },
      { seat: 1, address: "kaspatest:two" }
    ]
  };
  const state = adapter.createState({ roundId: "ROUND-1" });
  const match = adapter.toMatch(room, state);
  adapter.applyMove(match, state, { address: "kaspatest:one", points: 8, potted: ["red", "black"] });
  assert.equal(state.scores[0], 8);
  assert.equal(state.currentPlayer, 0);
  assert.equal(state.moves.length, 1);
});

test("frame end resolves the wallet address of the higher score", () => {
  const room = {
    id: "ROOM-2",
    players: [
      { seat: 0, address: "kaspatest:one" },
      { seat: 1, address: "kaspatest:two" }
    ]
  };
  const state = adapter.createState({ scores: [55, 48] });
  const match = adapter.toMatch(room, state);
  adapter.applyMove(match, state, { frameEnded: true, turnEnded: true });
  assert.equal(state.winnerAddress, "kaspatest:one");
});

test("a tied frame enters respotted-black state instead of choosing an arbitrary winner", () => {
  const room = {
    id: "ROOM-3",
    players: [
      { seat: 0, address: "kaspatest:one" },
      { seat: 1, address: "kaspatest:two" }
    ]
  };
  const state = adapter.createState({ scores: [50, 43], currentPlayer: 1, target: "black", phase: "colors" });
  const match = adapter.toMatch(room, state);
  adapter.applyMove(match, state, { points: 7, frameEnded: true });
  assert.deepEqual(state.scores, [50, 50]);
  assert.equal(state.result, "playing");
  assert.equal(state.winnerAddress, "");
  assert.equal(state.respottedBlack, true);
  assert.equal(state.target, "black");
  assert.equal(state.currentPlayer, 0);
  assert.equal(state.cueBallInHand, true);
});
