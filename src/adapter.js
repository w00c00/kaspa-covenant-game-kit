"use strict";

const { assertObject } = require("./utils");

function normalizePlayer(player, index = 0) {
  const source = assertObject(player, "player");
  return {
    seat: Number.isInteger(source.seat) ? source.seat : index,
    role: source.role || `player-${index + 1}`,
    address: source.address || "",
    publicKey: source.publicKey || ""
  };
}

function normalizeMatch(match) {
  const source = assertObject(match, "match");
  const id = source.id || source.matchId || source.roomId || "";
  if (!id) throw new Error("match.id is required");
  if (!source.game) throw new Error("match.game is required");
  const players = source.players || source.occupants || [];
  if (!Array.isArray(players)) throw new Error("match.players must be an array");
  const stakeKas = Number(source.stakeKas ?? source.stake ?? 0);
  return {
    ...source,
    id,
    matchId: id,
    roomId: source.roomId || id,
    game: source.game,
    roundId: source.roundId || "",
    stakeKas,
    players: players.map(normalizePlayer),
    claimPaths: source.claimPaths || ["claimWinner(transcriptHash)", "refund(after expiresAtDaa)"]
  };
}

function assertGameAdapter(adapter, label = "adapter") {
  const value = assertObject(adapter, label);
  if (typeof value.toMatch !== "function") {
    throw new Error(`${label}.toMatch(room, state) is required`);
  }
  return value;
}

function adapterName(adapter, fallback = "") {
  return adapter?.name || adapter?.game || fallback;
}

function resolveAdapter(registry, input = {}) {
  if (input.adapter) return assertGameAdapter(input.adapter, "input.adapter");
  const game = input.game || input.match?.game || input.room?.game || input.room?.type || "";
  if (!game) throw new Error("game or adapter is required");
  const adapter = registry.get(game);
  if (!adapter) throw new Error(`No adapter registered for game: ${game}`);
  return adapter;
}

function resolveMatch(registry, input = {}) {
  if (input.players && input.id) return normalizeMatch(input);
  if (input.match) return normalizeMatch(input.match);
  const adapter = resolveAdapter(registry, input);
  return normalizeMatch(adapter.toMatch(input.room || input.source || {}, input.state || {}));
}

function resolveWinnerAddress(adapter, { match, state = {}, winnerAddress = "" }) {
  if (winnerAddress) return winnerAddress;
  if (typeof adapter?.getWinnerAddress === "function") {
    const adapterWinner = adapter.getWinnerAddress(match, state);
    if (adapterWinner) return adapterWinner;
  }
  return state.winnerAddress || match.winnerAddress || match.winner || "";
}

module.exports = {
  adapterName,
  assertGameAdapter,
  normalizeMatch,
  normalizePlayer,
  resolveAdapter,
  resolveMatch,
  resolveWinnerAddress
};
