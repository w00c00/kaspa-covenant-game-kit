import crypto from "node:crypto";

export function settlementComplete(result) {
  return result?.settlement?.status === "settled-on-chain" || result?.escrow?.status === "settled-on-chain";
}

export function settledRoomCanClose(room) {
  const players = room?.players || [];
  return room?.status === "finished" && settlementComplete(room.settlement) &&
    players.length === 2 && players.every((player) => player.exitRequested === true);
}

export function rematchReady(room) {
  if (room?.status !== "finished" || !settlementComplete(room.settlement)) return false;
  const players = room.players || [];
  if (players.length !== 2 || players.some((player) => player.online === false)) return false;
  const seats = new Set(room.rematchSeats || []);
  return players.every((player) => seats.has(player.seat));
}

export function prepareRematchRoom(room, options = {}) {
  const previousRoundId = room.roundId;
  room.roundId = options.roundId || crypto.randomUUID();
  if (room.roundId === previousRoundId) throw new Error("A rematch requires a new roundId");
  room.engine = null;
  room.status = "waiting";
  room.practiceMode = false;
  room.createdAt = options.createdAt || new Date().toISOString();
  room.escrow = { status: "waiting-for-wallets", draft: null, record: null, error: "" };
  room.settlement = null;
  room.settlementContext = null;
  room.settlementAttempts = 0;
  room.rematchSeats = new Set();
  for (const player of room.players || []) {
    player.ready = false;
    player.locked = false;
    player.lockStatus = "unsigned";
    player.exitRequested = false;
  }
  return room;
}
