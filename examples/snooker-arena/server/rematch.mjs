import crypto from "node:crypto";

export function settlementComplete(result) {
  return result?.settlement?.status === "settled-on-chain" || result?.escrow?.status === "settled-on-chain";
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
  }
  return room;
}
