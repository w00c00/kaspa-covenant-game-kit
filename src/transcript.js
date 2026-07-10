"use strict";

const { sha256Hex } = require("./utils");

function canonicalTranscript(match, gameState = {}) {
  return {
    matchId: match.id,
    roundId: match.roundId || gameState.roundId || "",
    game: match.game,
    players: (match.players || []).map((player) => ({
      seat: player.seat,
      role: player.role,
      address: player.address
    })),
    moves: gameState.moves || match.moves || [],
    positions: gameState.positions || match.positions || [],
    winner: gameState.winner || match.winner || 0,
    winnerAddress: gameState.winnerAddress || match.winnerAddress || "",
    result: gameState.result || match.result || "idle"
  };
}

function transcriptHash(match, gameState = {}) {
  return sha256Hex(JSON.stringify(canonicalTranscript(match, gameState)));
}

module.exports = {
  canonicalTranscript,
  transcriptHash
};
