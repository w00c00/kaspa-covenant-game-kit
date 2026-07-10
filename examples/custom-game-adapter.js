"use strict";

const { KaspaCovenantGameKit } = require("../src");

const coinFlipAdapter = {
  name: "coin-flip",

  createState(options = {}) {
    return {
      roundId: options.roundId || "round-1",
      moves: [],
      result: "idle",
      winnerAddress: ""
    };
  },

  toMatch(room, state) {
    return {
      id: room.id,
      roundId: state.roundId,
      game: "coin-flip",
      stakeKas: room.stakeKas,
      players: room.players,
      claimPaths: ["claimHeads(transcriptHash)", "claimTails(transcriptHash)", "refund(after timeout)"]
    };
  },

  applyMove(match, state, move) {
    state.moves.push(move);
    if (move.result === "heads") {
      state.winnerAddress = match.players[0].address;
      state.result = "win";
    }
    if (move.result === "tails") {
      state.winnerAddress = match.players[1].address;
      state.result = "win";
    }
    return state;
  },

  getWinnerAddress(match, state) {
    return state.winnerAddress;
  }
};

const kit = new KaspaCovenantGameKit({
  networkId: "tn10",
  adapter: coinFlipAdapter,
  arbiter: {
    address: "kaspatest:example-arbiter",
    publicKey: "11".repeat(32),
    arbiterHash: "22".repeat(32)
  }
});

const room = {
  id: "FLIP-1",
  stakeKas: 10,
  players: [
    { seat: 0, role: "heads", address: "kaspatest:heads", publicKey: "33".repeat(32) },
    { seat: 1, role: "tails", address: "kaspatest:tails", publicKey: "44".repeat(32) }
  ]
};

const state = kit.createState("coin-flip", { roundId: "round-demo" });
const match = kit.toMatch({ game: "coin-flip", room, state });
const intent = kit.createEscrowIntent({ match });
coinFlipAdapter.applyMove(match, state, { result: "heads" });
const proof = kit.createSettlementProof({ match, state });

console.log(JSON.stringify({ match, intentStatus: intent.status, proof }, null, 2));
