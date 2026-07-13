import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SnookerEngine } from "../src/game-engine.js";
import { resolveRejoiningIdentity, restoreRoom, roomHasChainCommitment, RoomStore, snapshotRoom, validateEngineSnapshot } from "../server/room-store.mjs";

function engineFactory() {
  return new SnookerEngine(null, {}, { headless: true });
}

function fixtureRoom() {
  const engine = engineFactory();
  engine.state.roundId = "ROUND-RECOVERY";
  engine.finishCuePlacement({ x: 220, y: 279 });
  engine.remoteShot(0, 12, { x: 0, y: 0 });
  engine.runUntilSettled();
  return {
    id: "KSP-SAVE1",
    stakeKas: 0,
    status: "practice",
    practiceMode: true,
    players: [{
      playerId: "PLAYER-A",
      seat: 0,
      name: "A",
      address: "",
      publicKey: "",
      socketId: "socket",
      online: true,
      ready: true,
      locked: false,
      lockStatus: "unsigned"
    }],
    roundId: "ROUND-RECOVERY",
    createdAt: new Date().toISOString(),
    turnDeadline: 123,
    engine,
    escrow: { status: "practice-no-stake", draft: null, record: null, error: "", buildPromise: Promise.resolve() },
    settlement: null,
    settlementContext: null,
    settlementAttempts: 0,
    rematchSeats: new Set([0])
  };
}

test("room store restores the exact table while clearing process-local presence and timers", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "snooker-room-store-"));
  const file = path.join(directory, "rooms.json");
  try {
    const store = new RoomStore(file, "testnet-10");
    const original = fixtureRoom();
    const before = original.engine.exportSnapshot();
    store.save([original]);
    const records = store.load();
    assert.equal(records.length, 1);
    const restored = restoreRoom(records[0], engineFactory);
    assert.deepEqual(restored.engine.exportSnapshot(), before);
    assert.equal(restored.players[0].online, false);
    assert.equal(restored.players[0].ready, false);
    assert.equal(restored.players[0].socketId, "");
    assert.equal(restored.turnDeadline, 0);
    assert.equal(restored.rematchSeats.has(0), true);
    assert.equal(restored.escrow.buildPromise, null);
    store.save([restored]);
    assert.deepEqual(fs.readdirSync(directory), ["rooms.json"]);
    assert.throws(() => new RoomStore(file, "mainnet").load(), (error) => error.code === "ROOM_STORE_LOAD_FAILED");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("room snapshots reject moving, non-finite, or corrupt table state", () => {
  const room = fixtureRoom();
  const moving = room.engine.exportSnapshot();
  moving.inMotion = true;
  assert.throws(() => validateEngineSnapshot(moving), /balls are moving/);
  const nonFinite = room.engine.exportSnapshot();
  nonFinite.balls[0].x = Number.NaN;
  assert.throws(() => validateEngineSnapshot(nonFinite), /recovery range/);
  room.engine.inMotion = true;
  assert.throws(() => snapshotRoom(room), /balls are moving/);
});

test("rooms with a draft, submitted signature, or lock transaction are never disposable", () => {
  const room = fixtureRoom();
  assert.equal(roomHasChainCommitment(room), false);
  room.players[0].lockStatus = "submitting";
  assert.equal(roomHasChainCommitment(room), true);
  room.players[0].lockStatus = "unsigned";
  room.escrow.draft = { covenantId: "1".repeat(64) };
  assert.equal(roomHasChainCommitment(room), true);
  room.escrow.draft = null;
  room.escrow.record = { deploy: { txid: "2".repeat(64) } };
  assert.equal(roomHasChainCommitment(room), true);
});

test("rejoining a committed room preserves the original wallet identity", () => {
  const previous = {
    name: "Player",
    address: "kaspa:original",
    publicKey: `02${"ab".repeat(32)}`
  };
  assert.deepEqual(resolveRejoiningIdentity(previous, { name: "Player", address: "", publicKey: "" }, true), previous);
  assert.deepEqual(
    resolveRejoiningIdentity(previous, { name: "Player", publicKey: "ab".repeat(32) }, true),
    previous
  );
  assert.throws(
    () => resolveRejoiningIdentity(previous, { address: "kaspa:attacker" }, true),
    (error) => error.code === "ROOM_PLAYER_IDENTITY_CONFLICT"
  );
  assert.throws(
    () => resolveRejoiningIdentity(previous, { publicKey: "cd".repeat(32) }, true),
    (error) => error.code === "ROOM_PLAYER_IDENTITY_CONFLICT"
  );
});

test("an active two-wallet room keeps both locked seats and its exact frame after restart", () => {
  const room = fixtureRoom();
  room.status = "playing";
  room.practiceMode = false;
  room.stakeKas = 0.001;
  room.players = [0, 1].map((seat) => ({
    playerId: `PLAYER-${seat}`,
    seat,
    name: `P${seat + 1}`,
    address: `kaspa:wallet-${seat}`,
    publicKey: String(seat + 1).repeat(64),
    socketId: `socket-${seat}`,
    online: true,
    ready: true,
    locked: true,
    lockStatus: "locked"
  }));
  room.escrow = {
    status: "locked-on-chain",
    draft: { covenantId: "1".repeat(64) },
    record: { deploy: { txid: "2".repeat(64), covenantId: "1".repeat(64) } },
    error: ""
  };
  const restored = restoreRoom(snapshotRoom(room), engineFactory);
  assert.equal(restored.status, "playing");
  assert.equal(restored.players.length, 2);
  assert.equal(restored.players.every((player) => player.locked && !player.online && !player.ready), true);
  assert.equal(roomHasChainCommitment(restored), true);
  assert.deepEqual(restored.engine.exportSnapshot(), room.engine.exportSnapshot());
});

test("corrupt room stores fail closed instead of starting with an empty lobby", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "snooker-room-corrupt-"));
  const file = path.join(directory, "rooms.json");
  try {
    fs.writeFileSync(file, "{not-json", { mode: 0o600 });
    assert.throws(() => new RoomStore(file, "testnet-10").load(), (error) => error.code === "ROOM_STORE_LOAD_FAILED");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
