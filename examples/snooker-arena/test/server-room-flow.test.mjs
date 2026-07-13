import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { io } from "socket.io-client";
import { RoomStore } from "../server/room-store.mjs";
import { SnookerEngine } from "../src/game-engine.js";

function once(socket, event) {
  return new Promise((resolve) => socket.once(event, resolve));
}

function request(socket, event, payload) {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

function waitForServer(child) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("server startup timed out")), 10_000);
    child.stdout.on("data", (chunk) => {
      if (!String(chunk).includes("Kaspa Snooker API")) return;
      clearTimeout(timer);
      resolve();
    });
    child.once("exit", (code) => reject(new Error(`server exited early: ${code}`)));
  });
}

test("room lifecycle preserves seats and refuses ready/lock claims without on-chain escrow", async (context) => {
  const port = 19_000 + Math.floor(Math.random() * 1_000);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "snooker-room-flow-"));
  const child = spawn(process.execPath, ["server/index.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir },
    stdio: ["ignore", "pipe", "pipe"]
  });
  context.after(() => child.kill("SIGTERM"));
  context.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  await waitForServer(child);
  const endpoint = `http://127.0.0.1:${port}`;
  const allowedHealth = await fetch(`${endpoint}/api/health`, { headers: { origin: endpoint } });
  assert.equal(allowedHealth.status, 200);
  assert.equal(allowedHealth.headers.get("access-control-allow-origin"), endpoint);
  assert.match(allowedHealth.headers.get("content-security-policy") || "", /frame-ancestors 'none'/);
  const deniedHealth = await fetch(`${endpoint}/api/health`, { headers: { origin: "https://evil.example" } });
  assert.equal(deniedHealth.status, 400);
  const deniedSocket = io(endpoint, {
    transports: ["websocket"],
    extraHeaders: { origin: "https://evil.example" },
    reconnection: false,
    timeout: 2_000
  });
  const deniedSocketError = await once(deniedSocket, "connect_error");
  assert.ok(deniedSocketError);
  deniedSocket.close();
  const first = io(endpoint, { transports: ["websocket"] });
  const second = io(endpoint, { transports: ["websocket"] });
  const spectator = io(endpoint, { transports: ["websocket"] });
  context.after(() => { first.close(); second.close(); spectator.close(); });
  await Promise.all([once(first, "connect"), once(second, "connect"), once(spectator, "connect")]);

  const created = await request(first, "room:create", { playerId: "PLAYER-A", name: "A", stakeKas: 25 });
  assert.equal(created.ok, true);
  assert.equal(created.seat, 0);
  assert.equal(created.room.players[0].playerId, undefined);
  const roomId = created.room.roomId;
  const lobby = await request(second, "lobby:list", {});
  assert.equal(lobby.ok, true);
  assert.equal(lobby.rooms.some((room) => room.roomId === roomId), true);
  const playerJoinedEvent = once(first, "room:player-joined");
  const joined = await request(second, "room:join", { roomId, playerId: "PLAYER-B", name: "B" });
  const playerJoined = await playerJoinedEvent;
  assert.equal(joined.seat, 1);
  assert.equal(playerJoined.player.seat, 1);
  assert.equal(playerJoined.player.name, "B");
  assert.equal(playerJoined.player.playerId, undefined);
  const watched = await request(spectator, "room:join", { roomId, playerId: "WATCHER", name: "Watcher" });
  assert.equal(watched.role, "spectator");

  const earlyReady = await request(first, "room:ready", { roomId });
  assert.equal(earlyReady.ok, false);
  assert.match(earlyReady.error, /锁仓交易上链/);
  const fakeLock = await request(spectator, "room:lock", { roomId });
  assert.equal(fakeLock.ok, false);

  const replacement = io(endpoint, { transports: ["websocket"] });
  context.after(() => replacement.close());
  await once(replacement, "connect");
  const reclaimed = await request(replacement, "room:join", { roomId, playerId: "PLAYER-A", name: "A" });
  assert.equal(reclaimed.role, "player");
  assert.equal(reclaimed.seat, 0);
  const staleSocketLock = await request(first, "room:lock", { roomId });
  assert.equal(staleSocketLock.ok, false);
  assert.match(staleSocketLock.error, /无权操作/);

  second.close();
  const reconnected = io(endpoint, { transports: ["websocket"] });
  context.after(() => reconnected.close());
  await once(reconnected, "connect");
  const rejoined = await request(reconnected, "room:join", { roomId, playerId: "PLAYER-B", name: "B" });
  assert.equal(rejoined.role, "player");
  assert.equal(rejoined.seat, 1);

  const solo = io(endpoint, { transports: ["websocket"] });
  context.after(() => solo.close());
  await once(solo, "connect");
  const soloRoom = await request(solo, "room:create", { playerId: "SOLO", name: "Solo", stakeKas: 25 });
  const startedEvent = once(solo, "room:game-start");
  const practice = await request(solo, "room:practice", { roomId: soloRoom.room.roomId });
  const started = await startedEvent;
  assert.equal(practice.ok, true);
  assert.equal(started.practiceMode, true);
  assert.equal(started.room.practiceMode, true);
  assert.equal(started.room.stakeKas, 0);
  assert.equal(started.room.escrow.status, "practice-no-stake");

  const placedState = once(solo, "game:state");
  solo.emit("game:cue-placement", { roomId: soloRoom.room.roomId, placement: { x: 220, y: 279 } });
  await placedState;
  const firstShotState = once(solo, "game:state");
  solo.emit("game:shot", { roomId: soloRoom.room.roomId, angle: 0, power: 12, spin: { x: 0, y: 0 } });
  const firstShot = await firstShotState;
  assert.equal(firstShot.snapshot.state.shot, 1);
  // The single player may continue even when the rules engine has switched
  // the logical turn to seat 1.
  const secondShotState = once(solo, "game:state");
  solo.emit("game:shot", { roomId: soloRoom.room.roomId, angle: 0.05, power: 8, spin: { x: 0.2, y: 0 } });
  const secondShot = await secondShotState;
  assert.equal(secondShot.snapshot.state.shot, 2);

  const resetEvent = once(solo, "game:reset");
  const reset = await request(solo, "practice:reset", { roomId: soloRoom.room.roomId });
  const resetPayload = await resetEvent;
  assert.equal(reset.ok, true);
  assert.equal(resetPayload.snapshot.state.shot, 0);
});

test("a crashed service restores a practice table and lets the same player reclaim the active room", async (context) => {
  const port = 20_000 + Math.floor(Math.random() * 1_000);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "snooker-room-restart-"));
  let child;
  const start = async () => {
    child = spawn(process.execPath, ["server/index.mjs"], {
      cwd: new URL("..", import.meta.url),
      env: { ...process.env, PORT: String(port), DATA_DIR: dataDir },
      stdio: ["ignore", "pipe", "pipe"]
    });
    await waitForServer(child);
    return child;
  };
  context.after(() => child?.kill("SIGTERM"));
  context.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

  await start();
  const endpoint = `http://127.0.0.1:${port}`;
  const first = io(endpoint, { transports: ["websocket"] });
  await once(first, "connect");
  const created = await request(first, "room:create", { playerId: "CRASH-PLAYER", name: "Crash test", stakeKas: 25 });
  const roomId = created.room.roomId;
  const startedEvent = once(first, "room:game-start");
  await request(first, "room:practice", { roomId });
  await startedEvent;
  const placed = once(first, "game:state");
  first.emit("game:cue-placement", { roomId, placement: { x: 220, y: 279 } });
  await placed;
  const shotEvent = once(first, "game:state");
  first.emit("game:shot", { roomId, angle: 0, power: 12, spin: { x: 0, y: 0 } });
  const beforeCrash = await shotEvent;
  assert.equal(beforeCrash.snapshot.state.shot, 1);

  const exited = once(child, "exit");
  child.kill("SIGKILL");
  await exited;
  first.close();

  await start();
  const recovered = io(endpoint, { transports: ["websocket"] });
  context.after(() => recovered.close());
  await once(recovered, "connect");
  const rejoined = await request(recovered, "room:join", { roomId, playerId: "CRASH-PLAYER", name: "Crash test" });
  assert.equal(rejoined.ok, true);
  assert.equal(rejoined.role, "player");
  assert.equal(rejoined.room.status, "practice");
  assert.equal(rejoined.room.gameSnapshot.state.shot, 1);
  assert.deepEqual(rejoined.room.gameSnapshot.balls, beforeCrash.snapshot.balls);

  const left = await request(recovered, "room:leave", { roomId });
  assert.equal(left.ok, true);
  const lobby = await request(recovered, "lobby:list", {});
  assert.equal(lobby.rooms.some((room) => room.roomId === roomId), false);
  const persisted = JSON.parse(fs.readFileSync(path.join(dataDir, "rooms.json"), "utf8"));
  assert.equal(persisted.rooms.some((room) => room.id === roomId), false);
});

test("only a live player may concede and the server derives the opponent as winner", async (context) => {
  const port = 21_000 + Math.floor(Math.random() * 1_000);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "snooker-concession-"));
  const engine = new SnookerEngine(null, {}, { headless: true });
  engine.state.roundId = "ROUND-CONCESSION";
  new RoomStore(path.join(dataDir, "rooms.json"), "testnet-10").save([{
    id: "KSP-GIVE1",
    stakeKas: 0.001,
    status: "playing",
    practiceMode: false,
    players: [0, 1].map((seat) => ({
      playerId: `PLAYER-${seat}`,
      seat,
      name: `Player ${seat + 1}`,
      address: `kaspatest:player-${seat}`,
      publicKey: String(seat + 1).repeat(64),
      socketId: `old-${seat}`,
      online: true,
      ready: true,
      locked: true,
      lockStatus: "locked"
    })),
    roundId: "ROUND-CONCESSION",
    createdAt: new Date().toISOString(),
    turnDeadline: Date.now() + 30_000,
    engine,
    escrow: { status: "locked-on-chain", draft: null, record: null, error: "" },
    settlement: null,
    settlementContext: null,
    settlementAttempts: 0,
    rematchSeats: new Set()
  }]);
  const child = spawn(process.execPath, ["server/index.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir },
    stdio: ["ignore", "pipe", "pipe"]
  });
  context.after(() => child.kill("SIGTERM"));
  context.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  await waitForServer(child);
  const endpoint = `http://127.0.0.1:${port}`;
  const first = io(endpoint, { transports: ["websocket"] });
  const second = io(endpoint, { transports: ["websocket"] });
  const spectator = io(endpoint, { transports: ["websocket"] });
  context.after(() => { first.close(); second.close(); spectator.close(); });
  await Promise.all([once(first, "connect"), once(second, "connect"), once(spectator, "connect")]);
  await request(first, "room:join", { roomId: "KSP-GIVE1", playerId: "PLAYER-0", name: "Player 1" });
  await request(second, "room:join", { roomId: "KSP-GIVE1", playerId: "PLAYER-1", name: "Player 2" });
  const watched = await request(spectator, "room:join", { roomId: "KSP-GIVE1", playerId: "WATCHER" });
  assert.equal(watched.ok, false);
  const unauthorized = await request(spectator, "game:concede", { roomId: "KSP-GIVE1", seat: 1 });
  assert.equal(unauthorized.ok, false);

  const replacement = io(endpoint, { transports: ["websocket"] });
  context.after(() => replacement.close());
  await once(replacement, "connect");
  await request(replacement, "room:join", { roomId: "KSP-GIVE1", playerId: "PLAYER-0", name: "Player 1" });
  const stale = await request(first, "game:concede", { roomId: "KSP-GIVE1" });
  assert.equal(stale.ok, false);

  const finishedEvent = once(second, "game:finished");
  const conceded = await request(replacement, "game:concede", { roomId: "KSP-GIVE1", seat: 1 });
  const finished = await finishedEvent;
  assert.equal(conceded.ok, true);
  assert.equal(conceded.winnerSeat, 1);
  assert.equal(finished.winnerSeat, 1);
  assert.equal(finished.room.status, "finished");
  assert.equal(finished.room.gameState.visits.at(-1).player, 0);
  assert.equal(finished.room.gameState.visits.at(-1).reason, "concession");
  assert.equal(finished.settlement.settlement.reason, "authoritative-player-concession");
});

test("a settled committed room is removed only after both players explicitly leave", async (context) => {
  const port = 22_000 + Math.floor(Math.random() * 1_000);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "snooker-settled-exit-"));
  const engine = new SnookerEngine(null, {}, { headless: true });
  Object.assign(engine.state, { roundId: "ROUND-SETTLED", winner: 0 });
  new RoomStore(path.join(dataDir, "rooms.json"), "testnet-10").save([{
    id: "KSP-DONE1",
    stakeKas: 0.001,
    status: "finished",
    practiceMode: false,
    players: [0, 1].map((seat) => ({
      playerId: `DONE-${seat}`,
      seat,
      name: `Done ${seat + 1}`,
      address: `kaspatest:done-${seat}`,
      publicKey: String(seat + 3).repeat(64),
      socketId: `old-done-${seat}`,
      online: true,
      ready: false,
      locked: true,
      lockStatus: "locked",
      exitRequested: false
    })),
    roundId: "ROUND-SETTLED",
    createdAt: new Date().toISOString(),
    turnDeadline: 0,
    engine,
    escrow: {
      status: "settled-on-chain",
      draft: null,
      record: { deploy: { txid: "a".repeat(64), covenantId: "b".repeat(64) } },
      error: ""
    },
    settlement: { settlement: { status: "settled-on-chain", winnerAddress: "kaspatest:done-0" } },
    settlementContext: null,
    settlementAttempts: 0,
    rematchSeats: new Set()
  }]);
  const child = spawn(process.execPath, ["server/index.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir },
    stdio: ["ignore", "pipe", "pipe"]
  });
  context.after(() => child.kill("SIGTERM"));
  context.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  await waitForServer(child);
  const endpoint = `http://127.0.0.1:${port}`;
  const first = io(endpoint, { transports: ["websocket"] });
  const second = io(endpoint, { transports: ["websocket"] });
  context.after(() => { first.close(); second.close(); });
  await Promise.all([once(first, "connect"), once(second, "connect")]);
  const joinedFirst = await request(first, "room:join", { roomId: "KSP-DONE1", playerId: "DONE-0" });
  await request(second, "room:join", { roomId: "KSP-DONE1", playerId: "DONE-1" });
  assert.equal(joinedFirst.room.players[0].exitRequested, undefined);

  await request(first, "room:leave", { roomId: "KSP-DONE1" });
  let persisted = JSON.parse(fs.readFileSync(path.join(dataDir, "rooms.json"), "utf8"));
  assert.equal(persisted.rooms.length, 1);
  assert.equal(persisted.rooms.find((room) => room.id === "KSP-DONE1").players.find((player) => player.seat === 0).exitRequested, true);

  await request(second, "room:leave", { roomId: "KSP-DONE1" });
  persisted = JSON.parse(fs.readFileSync(path.join(dataDir, "rooms.json"), "utf8"));
  assert.equal(persisted.rooms.some((room) => room.id === "KSP-DONE1"), false);
});
