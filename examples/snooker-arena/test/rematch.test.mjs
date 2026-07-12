import assert from "node:assert/strict";
import test from "node:test";
import { prepareRematchRoom, rematchReady, settlementComplete } from "../server/rematch.mjs";

test("rematch requires completed settlement and creates a clean escrow round", () => {
  assert.equal(settlementComplete({ settlement: { status: "settlement-retrying" } }), false);
  assert.equal(settlementComplete({ settlement: { status: "settled-on-chain" } }), true);
  const room = {
    roundId: "ROUND-1",
    status: "finished",
    practiceMode: false,
    engine: {},
    escrow: { status: "settled-on-chain" },
    settlement: { settlement: { status: "settled-on-chain" } },
    settlementContext: {},
    settlementAttempts: 3,
    rematchSeats: new Set([0, 1]),
    players: [0, 1].map((seat) => ({ seat, ready: true, locked: true, lockStatus: "locked" }))
  };
  prepareRematchRoom(room, { roundId: "ROUND-2", createdAt: "2026-07-12T00:00:00.000Z" });
  assert.equal(room.roundId, "ROUND-2");
  assert.equal(room.status, "waiting");
  assert.equal(room.engine, null);
  assert.equal(room.settlement, null);
  assert.equal(room.settlementContext, null);
  assert.deepEqual(room.escrow, { status: "waiting-for-wallets", draft: null, record: null, error: "" });
  assert.deepEqual(Array.from(room.rematchSeats), []);
  for (const player of room.players) {
    assert.equal(player.ready, false);
    assert.equal(player.locked, false);
    assert.equal(player.lockStatus, "unsigned");
  }
});

test("players can reserve a rematch before settlement and it starts only when both are ready", () => {
  const room = {
    status: "finished",
    settlement: { settlement: { status: "settlement-retrying" } },
    rematchSeats: new Set([0, 1]),
    players: [{ seat: 0, online: true }, { seat: 1, online: true }]
  };
  assert.equal(rematchReady(room), false);
  room.settlement = { settlement: { status: "settled-on-chain" } };
  assert.equal(rematchReady(room), true);
  room.players[1].online = false;
  assert.equal(rematchReady(room), false);
});
