"use strict";

const crypto = require("node:crypto");

const name = "snooker";

function createState(options = {}) {
  return {
    roundId: options.roundId || crypto.randomUUID(),
    frame: Number(options.frame || 1),
    scores: options.scores || [0, 0],
    currentPlayer: Number(options.currentPlayer || 0),
    redsRemaining: Number(options.redsRemaining ?? 15),
    phase: options.phase || "reds",
    target: options.target || "red",
    nominatedColor: options.nominatedColor || null,
    breakScore: Number(options.breakScore || 0),
    respottedBlack: Boolean(options.respottedBlack || false),
    winnerAddress: options.winnerAddress || "",
    result: options.result || "playing",
    cueBallInHand: Boolean(options.cueBallInHand ?? true),
    cuePlacementConfirmed: Boolean(options.cuePlacementConfirmed || false),
    cuePlacements: Array.isArray(options.cuePlacements) ? options.cuePlacements : [],
    moves: Array.isArray(options.moves) ? options.moves : [],
    updatedAt: new Date().toISOString()
  };
}

function toMatch(room, state = room.gameState || {}) {
  return {
    id: room.id,
    roomId: room.id,
    roundId: state.roundId || room.roundId || "",
    game: name,
    stakeKas: Number(room.stakeKas || room.stake || 0),
    players: (room.players || room.occupants || []).map((player, index) => ({
      seat: Number.isInteger(player.seat) ? player.seat : index,
      role: player.role || `player-${index + 1}`,
      address: player.address || "",
      publicKey: player.publicKey || ""
    })),
    claimPaths: [
      "claimPlayerOne(transcriptHash)",
      "claimPlayerTwo(transcriptHash)",
      "refund(after expiresAtDaa)"
    ]
  };
}

function applyMove(match, state, move = {}) {
  if (state.result !== "playing") throw new Error("This snooker frame is already finished");
  const expected = match.players.find((player) => player.seat === state.currentPlayer);
  if (move.address && expected?.address !== move.address) throw new Error("It is not this wallet's turn");

  const points = Math.max(0, Number(move.points || 0));
  const foul = Math.max(0, Number(move.foul || 0));
  const opponent = state.currentPlayer === 0 ? 1 : 0;
  if (foul) state.scores[opponent] += foul;
  else state.scores[state.currentPlayer] += points;
  state.breakScore = move.turnEnded || foul ? 0 : state.breakScore + points;
  state.redsRemaining = Math.max(0, Number(move.redsRemaining ?? state.redsRemaining));
  state.target = move.target || state.target;
  state.nominatedColor = move.nominatedColor || null;
  state.phase = move.phase || state.phase;
  state.moves.push({
    number: state.moves.length + 1,
    seat: state.currentPlayer,
    address: expected?.address || "",
    points,
    foul,
    potted: move.potted || [],
    target: state.target,
    at: new Date().toISOString()
  });
  if (move.turnEnded || foul) state.currentPlayer = opponent;
  if (move.frameEnded) {
    const a = state.scores[0];
    const b = state.scores[1];
    if (a === b) {
      state.respottedBlack = true;
      state.target = "black";
      state.breakScore = 0;
      state.currentPlayer = opponent;
      state.cueBallInHand = true;
      state.cuePlacementConfirmed = false;
    } else {
      const winnerSeat = a > b ? 0 : 1;
      state.winnerAddress = match.players.find((player) => player.seat === winnerSeat)?.address || "";
      state.result = "win";
    }
  }
  state.updatedAt = new Date().toISOString();
  return state;
}

function getWinnerAddress(match, state = {}) {
  return state.winnerAddress || match.winnerAddress || "";
}

module.exports = { applyMove, createState, getWinnerAddress, name, toMatch };
