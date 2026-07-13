function apiError(message, status, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

export function authorizeRoomApi(liveRooms, body = {}) {
  const roomId = String(body.roomId || "").trim().toUpperCase();
  const playerId = String(body.playerId || "").trim();
  if (!roomId || !playerId) {
    throw apiError("roomId and playerId are required", 401, "ROOM_API_AUTH_REQUIRED");
  }

  const room = liveRooms.get(roomId);
  if (!room) throw apiError("Room not found", 404, "ROOM_NOT_FOUND");

  const player = room.players?.find((item) => item.playerId === playerId);
  if (!player) throw apiError("Not authorized for this room", 403, "ROOM_API_FORBIDDEN");
  if (!player.online || !player.socketId) {
    throw apiError("Reconnect to the room before requesting escrow data", 409, "ROOM_API_RECONNECT_REQUIRED");
  }
  return { room, player };
}
