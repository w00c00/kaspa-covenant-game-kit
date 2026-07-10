"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const gomoku = require("../src/adapters/gomoku");

test("gomoku adapter detects five in a row and records winner", () => {
  const room = {
    id: "GOMOKU-TEST",
    stake: 25,
    occupants: [
      { seat: 0, role: "black", address: "black" },
      { seat: 1, role: "white", address: "white" }
    ]
  };
  const state = gomoku.createState({ roundId: "round-test" });
  const match = gomoku.toMatch(room, state);
  gomoku.applyMove(match, state, { row: 7, col: 7, address: "black" });
  gomoku.applyMove(match, state, { row: 8, col: 7, address: "white" });
  gomoku.applyMove(match, state, { row: 7, col: 8, address: "black" });
  gomoku.applyMove(match, state, { row: 8, col: 8, address: "white" });
  gomoku.applyMove(match, state, { row: 7, col: 9, address: "black" });
  gomoku.applyMove(match, state, { row: 8, col: 9, address: "white" });
  gomoku.applyMove(match, state, { row: 7, col: 10, address: "black" });
  gomoku.applyMove(match, state, { row: 8, col: 10, address: "white" });
  gomoku.applyMove(match, state, { row: 7, col: 11, address: "black" });

  assert.equal(state.result, "win");
  assert.equal(state.winner, gomoku.BLACK);
  assert.equal(state.winnerAddress, "black");
  assert.equal(state.moves.length, 9);
});

test("gomoku adapter rejects wrong turn wallet", () => {
  const room = {
    id: "GOMOKU-TEST",
    stake: 25,
    occupants: [
      { seat: 0, role: "black", address: "black" },
      { seat: 1, role: "white", address: "white" }
    ]
  };
  const state = gomoku.createState({ roundId: "round-test" });
  const match = gomoku.toMatch(room, state);

  assert.throws(() => gomoku.applyMove(match, state, { row: 7, col: 7, address: "white" }), /not this wallet/);
});
