import fs from "node:fs";
import path from "node:path";

export const ROOM_STORE_VERSION = 1;
const MAX_STORE_BYTES = 32 * 1024 * 1024;
const ROOM_STATUSES = new Set(["waiting", "practice", "playing", "finished", "practice-finished"]);

function fail(message, code = "ROOM_STORE_INVALID") {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function jsonClone(value, label) {
  try {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  } catch (cause) {
    const error = new Error(`${label} is not JSON serializable`);
    error.code = "ROOM_STORE_INVALID";
    error.cause = cause;
    throw error;
  }
}

function finite(value, label, minimum = -10_000, maximum = 10_000) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) fail(`${label} is outside the recovery range`);
}

export function validateEngineSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) fail("Room engine snapshot must be an object");
  if (!snapshot.state || typeof snapshot.state !== "object" || Array.isArray(snapshot.state)) fail("Room engine state is missing");
  if (!Array.isArray(snapshot.balls) || snapshot.balls.length !== 22) fail("Room engine snapshot must contain all 22 balls");
  if (snapshot.inMotion) fail("A room snapshot cannot be persisted while balls are moving");
  const ids = new Set();
  for (const [index, ball] of snapshot.balls.entries()) {
    if (!ball || typeof ball !== "object" || typeof ball.id !== "string" || !ball.id || ids.has(ball.id)) fail(`Ball ${index} has an invalid ID`);
    ids.add(ball.id);
    if (typeof ball.type !== "string" || !ball.type) fail(`Ball ${index} has an invalid type`);
    for (const field of ["x", "y", "vx", "vy"]) finite(Number(ball[field]), `Ball ${index}.${field}`);
    finite(Number(ball.r), `Ball ${index}.r`, 0.1, 100);
  }
  const state = snapshot.state;
  if (!Array.isArray(state.scores) || state.scores.length !== 2) fail("Room scores are invalid");
  state.scores.forEach((score, index) => finite(Number(score), `Score ${index}`, 0, 10_000));
  if (![0, 1].includes(state.currentPlayer)) fail("Current player is invalid");
  if (![null, 0, 1].includes(state.winner)) fail("Winner is invalid");
  if (!Number.isInteger(state.shot) || state.shot < 0) fail("Shot sequence is invalid");
  return snapshot;
}

export function validateRoomRecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) fail("Room record must be an object");
  if (!/^KSP-[A-Z0-9]{4,12}$/.test(record.id || "")) fail("Room ID is invalid");
  if (!ROOM_STATUSES.has(record.status)) fail(`Room ${record.id} has an invalid status`);
  finite(Number(record.stakeKas), `Room ${record.id} stake`, 0, 10_000);
  if (typeof record.roundId !== "string" || !record.roundId || record.roundId.length > 128) fail(`Room ${record.id} round ID is invalid`);
  if (!Number.isFinite(Date.parse(record.createdAt || ""))) fail(`Room ${record.id} creation time is invalid`);
  if (!Array.isArray(record.players) || record.players.length > 2) fail(`Room ${record.id} players are invalid`);
  const seats = new Set();
  for (const player of record.players) {
    if (!player || typeof player !== "object" || typeof player.playerId !== "string" || !player.playerId || player.playerId.length > 128) fail(`Room ${record.id} player ID is invalid`);
    if (![0, 1].includes(player.seat) || seats.has(player.seat)) fail(`Room ${record.id} player seat is invalid`);
    seats.add(player.seat);
    if (typeof player.name !== "string" || player.name.length > 128) fail(`Room ${record.id} player name is invalid`);
    if (typeof player.address !== "string" || player.address.length > 128) fail(`Room ${record.id} player address is invalid`);
    if (typeof player.publicKey !== "string" || player.publicKey.length > 130) fail(`Room ${record.id} player key is invalid`);
    if (typeof player.online !== "boolean" || typeof player.ready !== "boolean" || typeof player.locked !== "boolean") fail(`Room ${record.id} player flags are invalid`);
    if (player.exitRequested !== undefined && typeof player.exitRequested !== "boolean") fail(`Room ${record.id} player exit flag is invalid`);
    if (!["unsigned", "signing", "submitting", "signed", "locked"].includes(player.lockStatus)) fail(`Room ${record.id} lock status is invalid`);
  }
  if (!record.escrow || typeof record.escrow !== "object" || Array.isArray(record.escrow)) fail(`Room ${record.id} escrow state is invalid`);
  if (typeof record.escrow.status !== "string" || !record.escrow.status || record.escrow.status.length > 128) fail(`Room ${record.id} escrow status is invalid`);
  if (typeof record.escrow.error !== "string" || record.escrow.error.length > 4_096) fail(`Room ${record.id} escrow error is invalid`);
  if (record.engineSnapshot) validateEngineSnapshot(record.engineSnapshot);
  if (record.status !== "waiting" && !record.engineSnapshot) fail(`Active room ${record.id} has no engine snapshot`);
  if (!Array.isArray(record.rematchSeats) || record.rematchSeats.some((seat) => ![0, 1].includes(seat))) fail(`Room ${record.id} rematch seats are invalid`);
  if (!Number.isInteger(record.settlementAttempts) || record.settlementAttempts < 0) fail(`Room ${record.id} settlement attempts are invalid`);
  if (roomHasChainCommitment(record) && record.players.length !== 2) fail(`Committed room ${record.id} must preserve both player seats`);
  return record;
}

export function snapshotRoom(room) {
  const engineSnapshot = room.engine?.exportSnapshot?.() || room.engineSnapshot || null;
  if (engineSnapshot) validateEngineSnapshot(engineSnapshot);
  return validateRoomRecord(jsonClone({
    id: room.id,
    stakeKas: Number(room.stakeKas),
    status: room.status,
    practiceMode: Boolean(room.practiceMode),
    players: (room.players || []).map((player) => ({
      playerId: player.playerId,
      seat: player.seat,
      name: player.name || "",
      address: player.address || "",
      publicKey: player.publicKey || "",
      online: Boolean(player.online),
      ready: Boolean(player.ready),
      locked: Boolean(player.locked),
      exitRequested: Boolean(player.exitRequested),
      lockStatus: player.lockStatus || "unsigned"
    })),
    roundId: room.roundId,
    createdAt: room.createdAt,
    turnDeadline: Number(room.turnDeadline || 0),
    escrow: {
      status: room.escrow?.status || "waiting-for-wallets",
      draft: room.escrow?.draft || null,
      record: room.escrow?.record || null,
      error: room.escrow?.error || ""
    },
    settlement: room.settlement || null,
    settlementContext: room.settlementContext || null,
    settlementAttempts: Number(room.settlementAttempts || 0),
    rematchSeats: Array.from(room.rematchSeats || []).sort(),
    engineSnapshot
  }, `Room ${room.id}`));
}

export function roomHasChainCommitment(room) {
  return Boolean(
    room?.escrow?.record?.deploy?.txid ||
    room?.escrow?.draft ||
    room?.players?.some((player) => player.locked || ["signed", "submitting"].includes(player.lockStatus))
  );
}

function normalizedPublicKey(value) {
  return String(value || "").trim().toLowerCase().replace(/^(02|03)(?=[0-9a-f]{64}$)/, "");
}

export function resolveRejoiningIdentity(previous, incoming = {}, committed = false) {
  if (!previous) {
    return {
      name: String(incoming.name || "访客球手"),
      address: String(incoming.address || ""),
      publicKey: String(incoming.publicKey || "")
    };
  }
  const nextAddress = String(incoming.address || "");
  const nextPublicKey = String(incoming.publicKey || "");
  if (committed) {
    if (nextAddress && nextAddress !== previous.address) fail("A committed room cannot change the player wallet", "ROOM_PLAYER_IDENTITY_CONFLICT");
    if (nextPublicKey && normalizedPublicKey(nextPublicKey) !== normalizedPublicKey(previous.publicKey)) {
      fail("A committed room cannot change the player public key", "ROOM_PLAYER_IDENTITY_CONFLICT");
    }
  }
  return {
    name: String(incoming.name || previous.name || "访客球手"),
    address: committed ? previous.address : nextAddress || previous.address || "",
    publicKey: committed ? previous.publicKey : nextPublicKey || previous.publicKey || ""
  };
}

export function restoreRoom(record, createEngine) {
  const saved = jsonClone(validateRoomRecord(record), `Room ${record?.id || "unknown"}`);
  const engineSnapshot = saved.engineSnapshot;
  delete saved.engineSnapshot;
  const room = {
    ...saved,
    players: saved.players.map((player) => ({ ...player, online: false, ready: false, exitRequested: Boolean(player.exitRequested), socketId: "" })),
    rematchSeats: new Set(saved.rematchSeats),
    engine: null,
    turnTimer: null,
    turnDeadline: 0,
    settlementTimer: null,
    escrow: { ...saved.escrow, buildPromise: null, confirmPromise: null }
  };
  if (engineSnapshot) {
    room.engine = createEngine();
    room.engine.importSnapshot(engineSnapshot);
    room.engine.inMotion = false;
  }
  return room;
}

export class RoomStore {
  constructor(file, networkId) {
    this.file = file;
    this.networkId = networkId;
  }

  load() {
    let text;
    try {
      const stat = fs.statSync(this.file);
      if (!stat.isFile() || stat.size > MAX_STORE_BYTES) fail("Room store is not a bounded regular file", "ROOM_STORE_LOAD_FAILED");
      text = fs.readFileSync(this.file, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return [];
      if (error.code === "ROOM_STORE_LOAD_FAILED") throw error;
      const wrapped = new Error(`Unable to load room store ${this.file}: ${error.message || error}`);
      wrapped.code = "ROOM_STORE_LOAD_FAILED";
      wrapped.cause = error;
      throw wrapped;
    }
    try {
      const payload = JSON.parse(text);
      if (payload.version !== ROOM_STORE_VERSION) fail("Room store version is unsupported");
      if (payload.networkId !== this.networkId) fail(`Room store belongs to ${payload.networkId}, not ${this.networkId}`);
      if (!Array.isArray(payload.rooms)) fail("Room store rooms must be an array");
      const ids = new Set();
      return payload.rooms.map((room) => {
        validateRoomRecord(room);
        if (ids.has(room.id)) fail(`Room store repeats ${room.id}`);
        ids.add(room.id);
        return jsonClone(room, `Room ${room.id}`);
      });
    } catch (error) {
      const wrapped = new Error(`Unable to verify room store ${this.file}: ${error.message || error}`);
      wrapped.code = "ROOM_STORE_LOAD_FAILED";
      wrapped.cause = error;
      throw wrapped;
    }
  }

  save(rooms) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const payload = {
      version: ROOM_STORE_VERSION,
      networkId: this.networkId,
      updatedAt: new Date().toISOString(),
      rooms: Array.from(rooms || []).map(snapshotRoom)
    };
    const temporary = `${this.file}.${process.pid}.${Date.now()}.tmp`;
    let descriptor;
    try {
      descriptor = fs.openSync(temporary, "wx", 0o600);
      fs.writeFileSync(descriptor, JSON.stringify(payload, null, 2));
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = undefined;
      fs.renameSync(temporary, this.file);
      const directory = fs.openSync(path.dirname(this.file), "r");
      try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
    } catch (error) {
      if (descriptor !== undefined) try { fs.closeSync(descriptor); } catch {}
      try { fs.unlinkSync(temporary); } catch {}
      const wrapped = new Error(`Unable to save room store ${this.file}: ${error.message || error}`);
      wrapped.code = "ROOM_STORE_SAVE_FAILED";
      wrapped.cause = error;
      throw wrapped;
    }
  }
}
