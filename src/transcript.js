"use strict";

const { sha256Hex } = require("./utils");

const TRANSCRIPT_PROTOCOL = "kaspa-covenant-game-kit/transcript";
const TRANSCRIPT_VERSION = 1;

function canonicalValue(value) {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = canonicalValue(value[key]);
    return result;
  }, {});
}

function canonicalTranscript(match, gameState = {}) {
  return {
    protocol: TRANSCRIPT_PROTOCOL,
    version: TRANSCRIPT_VERSION,
    network: match.network || gameState.network || "",
    matchId: match.id,
    roomId: match.roomId || match.id,
    roundId: match.roundId || gameState.roundId || "",
    covenantId: match.covenantId || gameState.covenantId || "",
    programHash: match.programHash || gameState.programHash || "",
    game: match.game,
    players: (match.players || []).map((player) => ({
      seat: player.seat,
      role: player.role,
      address: player.address
    })).sort((left, right) => Number(left.seat) - Number(right.seat)),
    moves: gameState.moves || match.moves || [],
    positions: gameState.positions || match.positions || [],
    scores: gameState.scores || match.scores || [],
    winner: gameState.winner ?? match.winner ?? null,
    winnerAddress: gameState.winnerAddress || match.winnerAddress || "",
    result: gameState.result || match.result || "idle",
    reason: gameState.reason || match.reason || ""
  };
}

function transcriptHash(match, gameState = {}) {
  return sha256Hex(JSON.stringify(canonicalValue(canonicalTranscript(match, gameState))));
}

module.exports = {
  TRANSCRIPT_PROTOCOL,
  TRANSCRIPT_VERSION,
  canonicalValue,
  canonicalTranscript,
  transcriptHash
};
