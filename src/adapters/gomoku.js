"use strict";

const crypto = require("node:crypto");

const BOARD_SIZE = 15;
const BLACK = 1;
const WHITE = 2;

function createState(options = {}) {
  return {
    roundId: options.roundId || crypto.randomUUID(),
    board: Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(0)),
    turn: BLACK,
    winner: 0,
    winnerAddress: "",
    result: "idle",
    moves: [],
    turnDurationSeconds: Number(options.turnDurationSeconds || 60),
    turnStartedAt: "",
    turnDeadlineAt: "",
    updatedAt: new Date().toISOString()
  };
}

function toMatch(room, gameState = room.gameState) {
  return {
    id: room.id,
    roomId: room.id,
    roundId: gameState?.roundId || room.roundId || "",
    game: "gomoku",
    stakeKas: Number(room.stake || room.stakeKas || 0),
    players: (room.occupants || room.players || []).map((player) => ({
      seat: player.seat,
      role: player.role || (player.seat === 0 ? "black" : "white"),
      address: player.address,
      publicKey: player.publicKey || ""
    })),
    claimPaths: ["claimBlack(transcriptHash)", "claimWhite(transcriptHash)", "refund(after expiresAtDaa)"]
  };
}

function count(board, row, col, dr, dc, player) {
  let total = 0;
  let r = row + dr;
  let c = col + dc;
  while (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE && board[r][c] === player) {
    total += 1;
    r += dr;
    c += dc;
  }
  return total;
}

function hasFive(board, row, col, player) {
  return [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1]
  ].some(([dr, dc]) => 1 + count(board, row, col, dr, dc, player) + count(board, row, col, -dr, -dc, player) >= 5);
}

function refreshDeadline(state) {
  const now = new Date();
  state.turnStartedAt = now.toISOString();
  state.turnDeadlineAt = new Date(now.getTime() + Number(state.turnDurationSeconds || 60) * 1000).toISOString();
  state.updatedAt = now.toISOString();
}

function playerForTurn(match, state) {
  return (match.players || []).find((player) => player.seat === state.turn - 1) || null;
}

function applyMove(match, state, { row, col, address, source = "player" }) {
  if (state.result === "win" || state.winner) throw new Error("Gomoku round is already finished");
  if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) {
    throw new Error("Move is outside the board");
  }
  if (state.board[row][col]) throw new Error("Cell is already occupied");
  const expectedPlayer = playerForTurn(match, state);
  if (!expectedPlayer) throw new Error("No player is assigned to this turn");
  if (address && expectedPlayer.address !== address) throw new Error("It is not this wallet's turn");

  const stone = state.turn;
  state.board[row][col] = stone;
  state.moves.push({
    row,
    col,
    stone,
    address: expectedPlayer.address,
    seat: expectedPlayer.seat,
    source,
    movedAt: new Date().toISOString()
  });

  if (hasFive(state.board, row, col, stone)) {
    state.winner = stone;
    state.winnerAddress = expectedPlayer.address;
    state.result = "win";
  } else {
    state.turn = stone === BLACK ? WHITE : BLACK;
    refreshDeadline(state);
  }
  state.updatedAt = new Date().toISOString();
  return state;
}

function emptyCells(board) {
  const cells = [];
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      if (!board[row][col]) cells.push([row, col]);
    }
  }
  return cells;
}

function randomTimeoutMove(match, state, randomInt = crypto.randomInt) {
  const cells = emptyCells(state.board);
  if (!cells.length || state.result === "win") return { moved: false };
  const [row, col] = cells[randomInt(0, cells.length)];
  applyMove(match, state, { row, col, source: "timeout-random" });
  return { moved: true, row, col, state };
}

module.exports = {
  BLACK,
  BOARD_SIZE,
  WHITE,
  applyMove,
  createState,
  hasFive,
  randomTimeoutMove,
  refreshDeadline,
  toMatch
};
