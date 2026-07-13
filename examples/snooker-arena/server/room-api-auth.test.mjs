import assert from "node:assert/strict";
import test from "node:test";
import { authorizeRoomApi } from "./room-api-auth.mjs";

function fixture() {
  return new Map([["KSP-SAFE1", {
    id: "KSP-SAFE1",
    players: [{ playerId: "secret-player-token", online: true, socketId: "socket-1", seat: 0 }]
  }]]);
}

test("room API authorization requires the persisted player token", () => {
  const result = authorizeRoomApi(fixture(), { roomId: "ksp-safe1", playerId: "secret-player-token" });
  assert.equal(result.room.id, "KSP-SAFE1");
  assert.equal(result.player.seat, 0);
  assert.throws(
    () => authorizeRoomApi(fixture(), { roomId: "KSP-SAFE1", playerId: "wrong-token" }),
    (error) => error.status === 403 && error.code === "ROOM_API_FORBIDDEN"
  );
});

test("room API authorization rejects missing and offline identities", () => {
  assert.throws(
    () => authorizeRoomApi(fixture(), { roomId: "KSP-SAFE1" }),
    (error) => error.status === 401 && error.code === "ROOM_API_AUTH_REQUIRED"
  );
  const rooms = fixture();
  rooms.get("KSP-SAFE1").players[0].online = false;
  assert.throws(
    () => authorizeRoomApi(rooms, { roomId: "KSP-SAFE1", playerId: "secret-player-token" }),
    (error) => error.status === 409 && error.code === "ROOM_API_RECONNECT_REQUIRED"
  );
});
