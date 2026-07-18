import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import { io } from "socket.io-client";

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
  const child = spawn(process.execPath, ["server/index.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  context.after(() => child.kill("SIGTERM"));
  await waitForServer(child);
  const endpoint = `http://127.0.0.1:${port}`;
  const first = io(endpoint, { transports: ["websocket"] });
  const second = io(endpoint, { transports: ["websocket"] });
  const spectator = io(endpoint, { transports: ["websocket"] });
  context.after(() => { first.close(); second.close(); spectator.close(); });
  await Promise.all([once(first, "connect"), once(second, "connect"), once(spectator, "connect")]);

  const created = await request(first, "room:create", { playerId: "PLAYER-A", name: "A", stakeKas: 25 });
  assert.equal(created.ok, true);
  assert.equal(created.seat, 0);
  const roomId = created.room.roomId;
  const joined = await request(second, "room:join", { roomId, playerId: "PLAYER-B", name: "B" });
  assert.equal(joined.seat, 1);
  const watched = await request(spectator, "room:join", { roomId, playerId: "WATCHER", name: "Watcher" });
  assert.equal(watched.role, "spectator");

  const earlyReady = await request(first, "room:ready", { roomId });
  assert.equal(earlyReady.ok, false);
  assert.match(earlyReady.error, /锁仓交易上链/);
  const fakeLock = await request(spectator, "room:lock", { roomId });
  assert.equal(fakeLock.ok, false);

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
