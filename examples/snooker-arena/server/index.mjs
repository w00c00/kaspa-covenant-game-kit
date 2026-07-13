import "dotenv/config";
import cors from "cors";
import crypto from "node:crypto";
import express from "express";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import { SnookerEngine } from "../src/game-engine.js";
import { FaucetService } from "./faucet-service.mjs";
import { CONTENT_SECURITY_POLICY, createOriginPolicy } from "./origin-policy.mjs";
import { prepareRematchRoom, rematchReady, settlementComplete } from "./rematch.mjs";
import { resolveRejoiningIdentity, restoreRoom, roomHasChainCommitment, RoomStore } from "./room-store.mjs";
import { SettlementFundingMonitor } from "./settlement-funding.mjs";
import { ensureSettlementVerifier } from "./settlement-verifier.mjs";

const require = createRequire(import.meta.url);
const kaspa = require("@kluster/kaspa-wasm");
const { JsonStore, KaspaCovenantGameKit } = require("kaspa-covenant-game-kit");
const sdkRoot = path.resolve(path.dirname(require.resolve("kaspa-covenant-game-kit")), "..");
const snookerAdapter = require("./snooker-adapter.cjs");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(root, "data");
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "0.0.0.0";
const networkId = process.env.KASPA_COVENANT_NETWORK || "tn10";
const mainnetRequested = ["mainnet", "kaspa", "kaspa-mainnet"].includes(networkId.toLowerCase());
const mainnetProgramProfileApproved = process.env.KASPA_COVENANT_MAINNET_PROGRAM_APPROVED === "true";
const mainnetProgramProfileFingerprint = process.env.KASPA_COVENANT_MAINNET_PROGRAM_FINGERPRINT || "";
const mainnetSettlementRunnerApproved = process.env.KASPA_COVENANT_MAINNET_SETTLEMENT_RUNNER_APPROVED === "true";
const mainnetSettlementRunnerSha256 = process.env.KASPA_COVENANT_MAINNET_SETTLEMENT_RUNNER_SHA256 || "";
const mainnetSilvercSha256 = process.env.KASPA_COVENANT_MAINNET_SILVERC_SHA256 || "";
const silvercBin = mainnetRequested ? process.env.SILVERC_BIN || "" : "";
const mainnetMaxStakeKas = process.env.KASPA_COVENANT_MAINNET_MAX_STAKE_KAS || "1";
const configuredOrigins = String(process.env.PUBLIC_ORIGINS || (process.env.NODE_ENV === "production" ? "" : "http://localhost:5173"))
  .split(",").map((value) => value.trim()).filter(Boolean);
const originPolicy = createOriginPolicy({ production: process.env.NODE_ENV === "production", allowedOrigins: configuredOrigins });
const corsOptions = { origin: originPolicy.corsOrigin, credentials: true };
const faucet = mainnetRequested ? null : new FaucetService({
  dataDir,
  networkId: "testnet-10",
  restApi: process.env.TN10_REST_API || "https://api-tn10.kaspa.org"
});
const verifier = ensureSettlementVerifier(dataDir, mainnetRequested ? "mainnet" : "testnet-10");
const bundledKascovLab = path.join(root, "bin", "kascov-lab");
const configuredKascovLabBin = process.env.KASCOV_LAB_BIN || (fs.existsSync(bundledKascovLab) ? bundledKascovLab : "");
const kascovLabBin = mainnetRequested && !mainnetSettlementRunnerApproved ? "" : configuredKascovLabBin;

const kit = new KaspaCovenantGameKit({
  networkId,
  allowMainnet: process.env.KASPA_COVENANT_ALLOW_MAINNET === "true",
  mainnetProgramProfileApproved,
  mainnetProgramProfileFingerprint,
  mainnetMaxStakeKas,
  adapter: snookerAdapter,
  store: new JsonStore(path.join(dataDir, "ledger.json")),
  arbiter: {
    address: process.env.ARBITER_ADDRESS || verifier.address,
    publicKey: process.env.ARBITER_PUBLIC_KEY || verifier.publicKey,
    arbiterHash: process.env.ARBITER_HASH || verifier.arbiterHash
  },
  contractName: "escrow.sil",
  contractFile: path.join(sdkRoot, "contracts", "escrow.sil"),
  silvercBin,
  silvercExpectedSha256: mainnetSilvercSha256,
  silvercSourceFile: path.join(sdkRoot, "contracts", "escrow.sil"),
  kascovLabBin,
  kascovLabExpectedSha256: mainnetRequested ? mainnetSettlementRunnerSha256 : process.env.KASCOV_LAB_EXPECTED_SHA256,
  kascovLabApprovedNetworks: [mainnetRequested ? "mainnet" : "tn10"],
  kascovLabKeyFile: process.env.KASCOV_LAB_KEY_FILE || verifier.keyFile,
  kascovLabJournalDir: path.join(dataDir, "settlement-journal")
});
const settlementFunding = mainnetRequested ? new SettlementFundingMonitor({
  address: verifier.address,
  restApi: kit.network.restApi,
  cacheMs: 15_000
}) : null;

async function requireSettlementFunding() {
  if (!settlementFunding) return null;
  const funding = await settlementFunding.status({ force: true });
  if (!funding.ready) {
    const messageZh = funding.code === "VERIFIER_FUNDING_REQUIRED"
      ? `结算验证者资金不足，需要一笔至少 ${funding.minimumUtxoKas} KAS 的 UTXO`
      : "暂时无法验证结算手续费余额，请稍后重试";
    const messageEn = funding.code === "VERIFIER_FUNDING_REQUIRED"
      ? `Settlement verifier needs one UTXO of at least ${funding.minimumUtxoKas} KAS`
      : "Unable to verify settlement fee funding; please retry shortly";
    const error = new Error(messageZh);
    error.code = funding.code;
    error.messageEn = messageEn;
    error.operational = true;
    error.status = 503;
    throw error;
  }
  return funding;
}

let sourceCompilerHealth = { ready: false, reason: mainnetRequested ? "compiler-not-configured" : "not-required-on-tn10" };
if (mainnetRequested) {
  if (!kit.escrow.silverc) throw new Error("Mainnet startup requires SILVERC_BIN and a pinned compiler SHA-256");
  sourceCompilerHealth = { ready: true, ...(await kit.escrow.silverc.healthCheck(kit.escrow.kascovTools)) };
}

let settlementRunnerHealth = { ready: false, reason: kascovLabBin ? "not-checked" : "runner-not-configured" };
if (kit.kascovLab) {
  try {
    settlementRunnerHealth = { ready: true, ...(await kit.kascovLab.healthCheck(kit.network.id)) };
  } catch (error) {
    settlementRunnerHealth = { ready: false, reason: error.message || String(error), code: error.code || "RUNNER_HEALTH_FAILED" };
    if (mainnetRequested) throw error;
    console.error("Settlement runner disabled:", settlementRunnerHealth.reason);
    kit.kascovLab = null;
    kit.settlements.kascovLab = null;
  }
}

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: corsOptions,
  allowRequest: (req, callback) => callback(null, originPolicy.isAllowed(req.headers.origin))
});
const roomStore = new RoomStore(path.join(dataDir, "rooms.json"), kit.network.kaspaNetworkId);
const liveRooms = new Map(roomStore.load().map((record) => {
  const room = restoreRoom(record, () => new SnookerEngine(null, {}, { headless: true }));
  return [room.id, room];
}));
app.use((_req, res, next) => {
  res.setHeader("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
});
app.use(cors(corsOptions));
app.use(express.json({ limit: "2mb" }));

function persistRooms() {
  roomStore.save(liveRooms.values());
}

function hasChainCommitment(room) {
  return roomHasChainCommitment(room);
}

function publicRoom(roomId) {
  const room = liveRooms.get(roomId);
  const escrow = room?.escrow || {};
  return {
    roomId,
    stakeKas: room?.stakeKas || 0,
    status: room?.status || "missing",
    practiceMode: Boolean(room?.practiceMode),
    createdAt: room?.createdAt || "",
    turnDeadline: room?.turnDeadline || 0,
    players: (room?.players || []).map(({ socketId: _socketId, playerId: _playerId, ...player }) => player),
    gameState: room?.engine?.snapshot() || null,
    gameSnapshot: room?.engine?.exportSnapshot() || null,
    escrow: {
      status: escrow.status || "waiting-for-wallets",
      covenantId: escrow.draft?.covenantId || escrow.record?.deploy?.covenantId || "",
      lockTxid: escrow.record?.deploy?.txid || "",
      signedSeats: (room?.players || []).filter((player) => player.lockStatus === "signed" || player.locked).map((player) => player.seat),
      error: escrow.error || ""
    },
    settlement: room?.settlement || null,
    rematchSeats: Array.from(room?.rematchSeats || []).sort()
  };
}

function lobbyRooms() {
  return Array.from(liveRooms.values())
    .filter((room) => room.status === "waiting" && room.players.length < 2)
    .map((room) => publicRoom(room.id));
}

function emitLobby() {
  io.emit("lobby:rooms", lobbyRooms());
}

function createRoomId() {
  let id;
  do id = `KSP-${Math.random().toString(36).slice(2, 7).toUpperCase()}`; while (liveRooms.has(id));
  return id;
}

function ensureRoomEngine(room) {
  if (room.engine) return room.engine;
  room.engine = new SnookerEngine(null, {}, { headless: true });
  room.engine.state.roundId = room.roundId;
  return room.engine;
}

function liveMatch(room, state = {}) {
  return kit.toMatch({
    game: "snooker",
    room: {
      id: room.id,
      stakeKas: room.stakeKas,
      players: room.players.slice().sort((a, b) => a.seat - b.seat).map((player) => ({
        seat: player.seat,
        role: `player-${player.seat + 1}`,
        address: player.address,
        publicKey: player.publicKey
      }))
    },
    state: { roundId: room.roundId, ...state }
  });
}

function assertEscrowPlayers(room) {
  if (room.players.length !== 2) throw new Error("需要两位玩家加入后才能创建共同锁仓交易");
  const sorted = room.players.slice().sort((a, b) => a.seat - b.seat);
  for (const player of sorted) {
    if (!player.address?.startsWith(`${kit.network.addressPrefix}:`)) throw new Error(`Player ${player.seat + 1} 需要连接 ${kit.network.addressPrefix} 钱包`);
    if (!/^(02|03)?[0-9a-f]{64}$/i.test(player.publicKey || "")) throw new Error(`Player ${player.seat + 1} 尚未授权读取钱包公钥`);
  }
  if (new Set(sorted.map((player) => player.address)).size !== 2) throw new Error("双方必须使用两个不同的钱包地址");
  if (!kit.kascovLab) throw new Error("自动结算服务尚未就绪，禁止锁入资金");
  return sorted;
}

async function prepareRoomEscrow(room) {
  assertEscrowPlayers(room);
  if (room.escrow?.draft) return room.escrow.draft;
  if (room.escrow?.buildPromise) return room.escrow.buildPromise;
  room.escrow.status = "building-lock-transaction";
  persistRooms();
  room.escrow.buildPromise = kit.buildDeployDraft({ match: liveMatch(room) })
    .then((draft) => {
      room.escrow.draft = draft;
      room.escrow.status = "awaiting-player-signatures";
      room.escrow.error = "";
      persistRooms();
      return draft;
    })
    .catch((error) => {
      room.escrow.status = "lock-build-failed";
      room.escrow.error = error.message || String(error);
      persistRooms();
      throw error;
    })
    .finally(() => { room.escrow.buildPromise = null; });
  return room.escrow.buildPromise;
}

async function submitRoomSignature(room, player, signedTransactionSafeJson) {
  const draft = room.escrow?.draft;
  if (!draft) throw new Error("锁仓草案不存在，请重新发起锁仓");
  const signer = draft.signers.find((item) => item.address === player.address);
  if (!signer || signer.inputIndex !== player.seat) throw new Error("钱包与锁仓输入不匹配");
  player.lockStatus = "submitting";
  persistRooms();
  const result = await kit.submitPlayerSignature({
    match: liveMatch(room),
    draft,
    address: player.address,
    signerInputIndex: signer.inputIndex,
    signedTransactionSafeJson,
    autoBroadcast: true
  });
  room.escrow.record = result.escrow;
  if (result.escrow?.status === "deployed-player-funded-on-chain") {
    room.escrow.status = "confirming-lock-on-chain";
    room.players.forEach((item) => { item.lockStatus = "signed"; });
    confirmRoomEscrow(room);
  } else if (result.escrow?.status === "player-funded-broadcast-failed") {
    room.escrow.status = "lock-broadcast-failed";
    room.escrow.error = result.escrow.error || "锁仓交易广播失败";
    player.lockStatus = "signed";
  } else {
    room.escrow.status = "awaiting-player-signatures";
    player.lockStatus = "signed";
  }
  persistRooms();
  return result;
}

async function covenantOutputIsLive(record) {
  if (!record?.programHex || !record?.deploy?.txid) return false;
  const script = kaspa.payToScriptHashScript(record.programHex);
  const address = kaspa.addressFromScriptPublicKey(script, kit.network.kaspaNetworkId)?.toString();
  if (!address) return false;
  const response = await fetch(`${kit.network.restApi.replace(/\/$/, "")}/addresses/${encodeURIComponent(address)}/utxos`);
  if (!response.ok) return false;
  const utxos = await response.json();
  return utxos.some((item) => (item.outpoint?.transactionId || item.transactionId) === record.deploy.txid);
}

async function confirmRoomEscrow(room) {
  if (room.escrow.confirmPromise || room.escrow.status === "locked-on-chain") return room.escrow.confirmPromise;
  room.escrow.confirmPromise = (async () => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      let confirmed = false;
      try { confirmed = await covenantOutputIsLive(room.escrow.record); } catch {}
      if (confirmed) {
        room.escrow.status = "locked-on-chain";
        room.escrow.error = "";
        room.players.forEach((item) => { item.locked = true; item.lockStatus = "locked"; });
        persistRooms();
        io.to(room.id).emit("room:state", publicRoom(room.id));
        io.to(room.id).emit("room:escrow-locked", {
          lockTxid: room.escrow.record?.deploy?.txid || "",
          room: publicRoom(room.id)
        });
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 3_000));
    }
    room.escrow.status = "lock-confirmation-timeout";
    room.escrow.error = `锁仓交易已广播，但暂未在 ${kit.network.label} UTXO 集中确认`;
    persistRooms();
    io.to(room.id).emit("room:state", publicRoom(room.id));
    return false;
  })().finally(() => { room.escrow.confirmPromise = null; });
  return room.escrow.confirmPromise;
}

function joinRoom(socket, room, { playerId, name = "访客球手", address = "", publicKey = "" } = {}) {
  if (!playerId) return { ok: false, error: "playerId is required" };
  for (const joinedRoom of socket.rooms) if (joinedRoom !== socket.id) socket.leave(joinedRoom);
  const previous = room.players.find((player) => player.playerId === playerId);
  let identity;
  try {
    identity = resolveRejoiningIdentity(previous, { name, address, publicKey }, hasChainCommitment(room));
  } catch (error) {
    return { ok: false, error: error.message || String(error), code: error.code };
  }
  let seat = previous?.seat;
  if (!Number.isInteger(seat)) seat = [0, 1].find((candidate) => !room.players.some((player) => player.seat === candidate));
  room.players = room.players.filter((player) => player.playerId !== playerId && player.socketId !== socket.id);
  const role = Number.isInteger(seat) ? "player" : "spectator";
  if (role === "player") {
    room.players.push({
      playerId, seat, ...identity, socketId: socket.id, online: true,
      ready: previous?.ready || false,
      locked: previous?.locked || false,
      lockStatus: previous?.lockStatus || "unsigned"
    });
  }
  socket.data.roomId = room.id;
  socket.data.playerId = playerId;
  socket.data.seat = seat;
  socket.data.role = role;
  socket.join(room.id);
  persistRooms();
  io.to(room.id).emit("room:state", publicRoom(room.id));
  if (!previous && role === "player") {
    socket.to(room.id).emit("room:player-joined", {
      player: { seat, name: identity.name, address: identity.address, online: true },
      room: publicRoom(room.id)
    });
  }
  emitLobby();
  startRematchIfReady(room);
  return { ok: true, role, seat, room: publicRoom(room.id) };
}

function canAct(socket, room) {
  return room && socket.data.role === "player" && Number.isInteger(socket.data.seat) &&
    room.players.some((player) => player.seat === socket.data.seat && player.socketId === socket.id) &&
    (room.practiceMode || room.engine?.state.currentPlayer === socket.data.seat);
}

function gameIsActive(room) {
  return room?.status === "playing" || room?.status === "practice";
}

function resumeRoomRuntime(room) {
  if (["confirming-lock-on-chain", "lock-confirmation-timeout"].includes(room?.escrow?.status) && room.escrow?.record?.deploy?.txid) {
    confirmRoomEscrow(room);
  }
  if (room?.status === "finished" && room.settlementContext && !settlementComplete(room.settlement)) {
    scheduleRoomSettlementRetry(room);
  }
  if (room?.status === "playing" && room.players?.length === 2 && room.players.every((player) => player.online) && !room.turnTimer) {
    startTurnTimer(room);
  }
}

function resetRoomForRematch(room) {
  clearTurnTimer(room);
  if (room.settlementTimer) clearTimeout(room.settlementTimer);
  room.settlementTimer = null;
  prepareRematchRoom(room);
  persistRooms();
  return publicRoom(room.id);
}

function startRematchIfReady(room) {
  if (!rematchReady(room)) return false;
  const nextRoom = resetRoomForRematch(room);
  io.to(room.id).emit("game:rematch-start", { room: nextRoom });
  io.to(room.id).emit("room:state", nextRoom);
  emitLobby();
  return true;
}

function scheduleRoomSettlementRetry(room) {
  if (!room.settlementContext || settlementComplete(room.settlement) || room.settlementTimer) return;
  const attempt = Number(room.settlementAttempts || 0);
  const delay = Math.min(60_000, 5_000 * 2 ** Math.min(attempt, 4));
  room.settlementTimer = setTimeout(async () => {
    room.settlementTimer = null;
    room.settlementAttempts = attempt + 1;
    persistRooms();
    const context = room.settlementContext;
    try {
      room.settlement = await kit.settleWinner({
        match: context.match,
        state: context.state,
        winnerAddress: context.winnerAddress,
        reason: "authoritative-snooker-result-retry",
        settlementId: room.settlement?.settlement?.id || ""
      });
    } catch (error) {
      room.settlement = { status: "settlement-retrying", error: error.message || String(error), winnerAddress: context.winnerAddress };
    }
    persistRooms();
    io.to(room.id).emit("game:settlement", { settlement: room.settlement, room: publicRoom(room.id) });
    if (settlementComplete(room.settlement)) startRematchIfReady(room);
    else scheduleRoomSettlementRetry(room);
  }, delay);
  room.settlementTimer.unref?.();
}

function clearTurnTimer(room) {
  if (room.turnTimer) clearTimeout(room.turnTimer);
  room.turnTimer = null;
  room.turnDeadline = 0;
}

function startTurnTimer(room) {
  clearTurnTimer(room);
  if (room.status !== "playing" || room.engine?.state.winner !== null) return;
  room.turnDeadline = Date.now() + 30_000;
  persistRooms();
  room.turnTimer = setTimeout(() => {
    if (room.status !== "playing" || room.engine?.inMotion || room.engine?.state.winner !== null) return;
    const timedOutSeat = room.engine.state.currentPlayer;
    room.engine.timeoutFoul();
    persistRooms();
    const snapshot = room.engine.exportSnapshot();
    io.to(room.id).emit("game:timeout", { seat: timedOutSeat, snapshot });
    io.to(room.id).emit("game:state", { snapshot, sequence: room.engine.state.shot, turnDeadline: Date.now() + 30_000 });
    startTurnTimer(room);
  }, 30_000);
}

async function finalizeRoom(room) {
  if (!room.engine || room.engine.state.winner === null || room.status === "finished") return;
  if (room.practiceMode) {
    room.status = "practice-finished";
    clearTurnTimer(room);
    const winnerSeat = room.engine.state.winner;
    room.settlement = { status: "practice-no-settlement", potKas: 0 };
    persistRooms();
    io.to(room.id).emit("game:finished", { room: publicRoom(room.id), winnerSeat, settlement: room.settlement, practiceMode: true });
    return;
  }
  clearTurnTimer(room);
  room.status = "finished";
  const winnerSeat = room.engine.state.winner;
  const winner = room.players.find((player) => player.seat === winnerSeat);
  const state = room.engine.snapshot();
  if (!winner?.address?.startsWith(`${kit.network.addressPrefix}:`)) {
    room.settlementContext = null;
    room.settlement = {
      status: "settlement-invalid-winner-identity",
      error: "胜者钱包身份缺失，已停止自动结算",
      errorEn: "Winner wallet identity is missing; automatic settlement has stopped"
    };
    persistRooms();
    io.to(room.id).emit("game:finished", { room: publicRoom(room.id), winnerSeat, settlement: room.settlement });
    return;
  }
  state.winnerAddress = winner.address;
  state.result = "win";
  const match = liveMatch(room, state);
  room.settlementContext = { match, state, winnerAddress: state.winnerAddress };
  room.settlement ||= { status: "settlement-pending", winnerAddress: state.winnerAddress };
  persistRooms();
  try {
    room.settlement = await kit.settleWinner({ match, state, winnerAddress: state.winnerAddress, reason: "authoritative-snooker-result" });
  } catch (error) {
    room.settlement = { status: "settlement-pending", error: error.message || String(error), winnerAddress: state.winnerAddress };
  }
  persistRooms();
  io.to(room.id).emit("game:finished", { room: publicRoom(room.id), winnerSeat, settlement: room.settlement });
  if (!settlementComplete(room.settlement)) scheduleRoomSettlementRetry(room);
  emitLobby();
}

let settlementRecoveryRunning = false;
async function recoverPendingSettlements() {
  if (settlementRecoveryRunning) return;
  settlementRecoveryRunning = true;
  const escrows = kit.listEscrows();
  const pending = kit.listSettlements().filter((item) => item.status !== "settled-on-chain" && item.chainCovenantId);
  try {
    for (const settlement of pending) {
      const escrow = escrows.find((item) => item.id === settlement.chainEscrowId || item.deploy?.covenantId === settlement.chainCovenantId);
      if (!escrow?.deploy?.covenantId || !settlement.winnerAddress) continue;
      const match = {
        id: escrow.matchId,
        roomId: escrow.roomId,
        roundId: escrow.roundId,
        game: escrow.game || "snooker",
        stakeKas: escrow.stakeKas,
        players: [escrow.buyer, escrow.seller].filter(Boolean).map((player, seat) => ({ ...player, seat }))
      };
      try {
        await kit.settleWinner({
          match,
          state: {},
          winnerAddress: settlement.winnerAddress,
          reason: "service-restart-recovery",
          settlementId: settlement.id
        });
      } catch (error) {
        console.error(`Settlement recovery failed for ${settlement.id}:`, error.message || error);
      }
    }
  } finally {
    settlementRecoveryRunning = false;
  }
}

io.on("connection", (socket) => {
  socket.emit("lobby:rooms", lobbyRooms());

  socket.on("lobby:list", (_payload, acknowledge) => acknowledge?.({ ok: true, rooms: lobbyRooms() }));

  socket.on("room:create", ({ playerId, name, address, publicKey, stakeKas = 25 } = {}, acknowledge) => {
    const id = createRoomId();
    const defaultStake = kit.network.id === "mainnet" ? 0.1 : 25;
    const maximumStake = kit.network.id === "mainnet" ? Number(mainnetMaxStakeKas) : 10_000;
    const room = {
      id,
      stakeKas: Math.max(0.00000001, Math.min(maximumStake, Number(stakeKas) || defaultStake)),
      status: "waiting",
      players: [],
      roundId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      engine: null,
      escrow: { status: "waiting-for-wallets", draft: null, record: null, error: "" },
      settlement: null,
      rematchSeats: new Set()
    };
    liveRooms.set(id, room);
    acknowledge?.(joinRoom(socket, room, { playerId, name, address, publicKey }));
  });

  socket.on("room:join", ({ roomId, playerId, name, address, publicKey } = {}, acknowledge) => {
    const room = liveRooms.get(String(roomId || "").toUpperCase());
    if (!room) return acknowledge?.({ ok: false, error: "房间不存在或已结束" });
    const returningPlayer = room.players.some((player) => player.playerId === playerId);
    if (room.status !== "waiting" && !returningPlayer) return acknowledge?.({ ok: false, error: "该房间已经开始比赛" });
    acknowledge?.(joinRoom(socket, room, { playerId, name, address, publicKey }));
    resumeRoomRuntime(room);
  });

  socket.on("room:practice", ({ roomId } = {}, acknowledge) => {
    const room = liveRooms.get(roomId);
    const player = room?.players.find((item) => item.seat === socket.data.seat && item.socketId === socket.id);
    if (!player) return acknowledge?.({ ok: false, error: "无权操作该房间" });
    if (room.status !== "waiting") return acknowledge?.({ ok: false, error: "当前房间不能进入练习模式" });
    if (room.players.length !== 1) return acknowledge?.({ ok: false, error: "已有对手加入，请进行双人对战" });
    if (player.locked || player.lockStatus !== "unsigned") return acknowledge?.({ ok: false, error: "已经开始链上锁仓，不能切换为练习" });
    room.practiceMode = true;
    room.status = "practice";
    room.stakeKas = 0;
    room.escrow.status = "practice-no-stake";
    ensureRoomEngine(room);
    persistRooms();
    io.to(roomId).emit("room:game-start", {
      room: publicRoom(roomId),
      snapshot: room.engine.exportSnapshot(),
      turnDeadline: 0,
      practiceMode: true
    });
    emitLobby();
    acknowledge?.({ ok: true, room: publicRoom(roomId) });
  });

  socket.on("room:lock", async ({ roomId } = {}, acknowledge) => {
    const room = liveRooms.get(roomId);
    const player = room?.players.find((item) => item.seat === socket.data.seat && item.socketId === socket.id);
    if (!player) return acknowledge?.({ ok: false, error: "无权操作该房间" });
    if (player.locked) return acknowledge?.({ ok: true, status: "locked-on-chain", room: publicRoom(roomId) });
    if (player.lockStatus === "signed") {
      if (room.escrow?.record?.deploy?.txid) confirmRoomEscrow(room);
      return acknowledge?.({ ok: true, status: room.escrow?.record?.deploy?.txid ? "confirming-lock-on-chain" : "waiting-for-opponent-signature", room: publicRoom(roomId) });
    }
    try {
      await requireSettlementFunding();
      const draft = await prepareRoomEscrow(room);
      const signer = draft.signers.find((item) => item.address === player.address);
      if (!signer) throw new Error("当前钱包不在该锁仓交易中");
      player.lockStatus = "signing";
      persistRooms();
      io.to(roomId).emit("room:state", publicRoom(roomId));
      acknowledge?.({
        ok: true,
        status: "signature-required",
        signing: {
          txJsonString: draft.unsignedTransactionSafeJson,
          inputIndex: signer.inputIndex,
          sighashType: 1,
          covenantId: draft.covenantId,
          amountKas: room.stakeKas
        }
      });
    } catch (error) {
      player.lockStatus = "unsigned";
      persistRooms();
      io.to(roomId).emit("room:state", publicRoom(roomId));
      acknowledge?.({ ok: false, error: error.message || String(error), errorEn: error.messageEn, code: error.code });
    }
  });

  socket.on("room:lock:submit", async ({ roomId, signedTransactionSafeJson } = {}, acknowledge) => {
    const room = liveRooms.get(roomId);
    const player = room?.players.find((item) => item.seat === socket.data.seat && item.socketId === socket.id);
    if (!player) return acknowledge?.({ ok: false, error: "无权操作该房间" });
    if (typeof signedTransactionSafeJson !== "string" || signedTransactionSafeJson.length < 100) {
      return acknowledge?.({ ok: false, error: "钱包没有返回有效的签名交易" });
    }
    try {
      await requireSettlementFunding();
    } catch (error) {
      return acknowledge?.({ ok: false, error: error.message || String(error), errorEn: error.messageEn, code: error.code });
    }
    try {
      const result = await submitRoomSignature(room, player, signedTransactionSafeJson);
      io.to(roomId).emit("room:state", publicRoom(roomId));
      socket.to(roomId).emit("room:player-signed", { seat: player.seat, room: publicRoom(roomId) });
      acknowledge?.({ ok: true, status: room.escrow.status, escrow: publicRoom(roomId).escrow, merge: result.merge });
    } catch (error) {
      player.lockStatus = "unsigned";
      room.escrow.error = error.message || String(error);
      persistRooms();
      io.to(roomId).emit("room:state", publicRoom(roomId));
      acknowledge?.({ ok: false, error: error.message || String(error) });
    }
  });

  socket.on("room:lock:cancel", ({ roomId } = {}) => {
    const room = liveRooms.get(roomId);
    const player = room?.players.find((item) => item.seat === socket.data.seat && item.socketId === socket.id);
    if (player && player.lockStatus === "signing") {
      player.lockStatus = "unsigned";
      persistRooms();
      io.to(roomId).emit("room:state", publicRoom(roomId));
    }
  });

  socket.on("room:ready", ({ roomId } = {}, acknowledge) => {
    const room = liveRooms.get(roomId);
    const player = room?.players.find((item) => item.seat === socket.data.seat && item.socketId === socket.id);
    if (!player) return acknowledge?.({ ok: false, error: "无权操作该房间" });
    if (!player.locked || room.escrow?.status !== "locked-on-chain") return acknowledge?.({ ok: false, error: "请等待双方押金锁仓交易上链" });
    player.ready = true;
    persistRooms();
    if (room.players.length === 2 && room.escrow.status === "locked-on-chain" && room.players.every((item) => item.locked && item.ready)) {
      room.status = "playing";
      ensureRoomEngine(room);
      startTurnTimer(room);
      io.to(roomId).emit("room:game-start", { room: publicRoom(roomId), snapshot: room.engine.exportSnapshot(), turnDeadline: room.turnDeadline });
    } else {
      io.to(roomId).emit("room:state", publicRoom(roomId));
    }
    acknowledge?.({ ok: true });
  });

  socket.on("room:leave", ({ roomId } = {}, acknowledge) => {
    const room = liveRooms.get(roomId);
    if (room) {
      const player = room.players.find((item) => item.socketId === socket.id);
      if (player && hasChainCommitment(room)) {
        player.online = false;
        player.ready = false;
        player.socketId = "";
      } else {
        room.players = room.players.filter((item) => item.socketId !== socket.id);
      }
      if (!room.players.length && !hasChainCommitment(room)) liveRooms.delete(roomId);
      else io.to(roomId).emit("room:state", publicRoom(roomId));
      if (room.status === "playing" && room.players.some((item) => !item.online)) clearTurnTimer(room);
      persistRooms();
    }
    socket.leave(roomId);
    socket.data.roomId = "";
    socket.data.seat = undefined;
    socket.data.role = "";
    emitLobby();
    acknowledge?.({ ok: true });
  });

  socket.on("game:shot", ({ roomId, angle, power, spin, nominatedColor, shot } = {}) => {
    const room = liveRooms.get(roomId);
    if (!roomId || socket.data.roomId !== roomId || !gameIsActive(room) || !canAct(socket, room) || !Number.isFinite(angle) || !Number.isFinite(power)) {
      return socket.emit("game:rejected", { reason: "当前座位无权击球", snapshot: room?.engine?.exportSnapshot() || null });
    }
    const safeSpin = {
      x: Math.max(-1, Math.min(1, Number(spin?.x) || 0)),
      y: Math.max(-1, Math.min(1, Number(spin?.y) || 0))
    };
    const safeNomination = ["yellow", "green", "brown", "blue", "pink", "black"].includes(nominatedColor) ? nominatedColor : null;
    const accepted = room.engine.remoteShot(angle, Math.max(5, Math.min(100, Number(power))), safeSpin, safeNomination);
    if (!accepted) return socket.emit("game:rejected", { reason: "台面尚未静止或需要先摆白球", snapshot: room.engine.exportSnapshot() });
    socket.to(roomId).emit("game:shot", { angle, power, spin: safeSpin, nominatedColor: safeNomination, shot, seat: socket.data.seat });
    clearTurnTimer(room);
    const snapshot = room.engine.runUntilSettled();
    if (room.engine.state.winner === null && !room.practiceMode) startTurnTimer(room);
    persistRooms();
    io.to(roomId).emit("game:state", { snapshot, sequence: room.engine.state.shot, turnDeadline: room.turnDeadline });
    finalizeRoom(room);
  });

  socket.on("game:cue-placement", ({ roomId, placement } = {}) => {
    const room = liveRooms.get(roomId);
    if (!roomId || socket.data.roomId !== roomId || !gameIsActive(room) || !canAct(socket, room)) return;
    const x = Number(placement?.x);
    const y = Number(placement?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (!room.engine.applyRemoteCuePlacement({ x, y })) return;
    persistRooms();
    socket.to(roomId).emit("game:cue-placement", {
      placement: { x, y, player: socket.data.seat, beforeShot: Number(placement?.beforeShot || 1), reason: placement?.reason || "cue-ball-in-hand" }
    });
    io.to(roomId).emit("game:state", { snapshot: room.engine.exportSnapshot(), sequence: room.engine.state.shot, turnDeadline: room.turnDeadline });
  });

  socket.on("game:settlement:status", ({ roomId } = {}, acknowledge) => {
    const room = liveRooms.get(roomId);
    if (!room || socket.data.roomId !== roomId) return acknowledge?.({ ok: false, error: "房间不存在" });
    acknowledge?.({ ok: true, settlement: room.settlement, room: publicRoom(roomId) });
  });

  socket.on("game:rematch", ({ roomId } = {}, acknowledge) => {
    const room = liveRooms.get(roomId);
    const player = room?.players.find((item) => item.seat === socket.data.seat && item.socketId === socket.id);
    if (!player) return acknowledge?.({ ok: false, error: "无权操作该房间" });
    if (room.practiceMode || room.status === "practice-finished") {
      return acknowledge?.({ ok: false, error: "练习模式请直接重新摆球" });
    }
    if (room.status !== "finished") return acknowledge?.({ ok: false, error: "本局尚未结束" });
    room.rematchSeats ||= new Set();
    room.rematchSeats.add(player.seat);
    persistRooms();
    const seats = Array.from(room.rematchSeats).sort();
    const required = 2;
    const waitingForSettlement = !settlementComplete(room.settlement);
    io.to(roomId).emit("game:rematch-status", { seats, required, waitingForSettlement });
    const started = startRematchIfReady(room);
    acknowledge?.({ ok: true, seats, required, waitingForSettlement, started });
  });

  socket.on("practice:reset", ({ roomId } = {}, acknowledge) => {
    const room = liveRooms.get(roomId);
    const player = room?.players.find((item) => item.seat === socket.data.seat && item.socketId === socket.id);
    if (!player || !room?.practiceMode) return acknowledge?.({ ok: false, error: "当前不是你的练习房间" });
    room.engine = new SnookerEngine(null, {}, { headless: true });
    room.engine.state.roundId = room.roundId;
    room.status = "practice";
    room.settlement = null;
    persistRooms();
    io.to(roomId).emit("game:reset", { snapshot: room.engine.exportSnapshot(), practiceMode: true });
    acknowledge?.({ ok: true });
  });

  socket.on("disconnect", () => {
    const roomId = socket.data.roomId;
    const room = roomId && liveRooms.get(roomId);
    if (!room) return;
    const player = room.players.find((item) => item.socketId === socket.id);
    if (player) { player.online = false; player.socketId = ""; player.ready = false; }
    if (room.status === "playing" && room.players.some((item) => !item.online)) clearTurnTimer(room);
    liveRooms.set(roomId, room);
    persistRooms();
    io.to(roomId).emit("room:state", publicRoom(roomId));
    emitLobby();
  });
});

function roomFrom(body = {}) {
  return {
    id: body.roomId || "KSP-SNOOKER-001",
    stakeKas: Number(body.stakeKas || 25),
    players: (body.players || []).map((player, seat) => ({
      seat,
      role: seat === 0 ? "challenger" : "opponent",
      address: player.address || "",
      publicKey: player.publicKey || ""
    }))
  };
}

function stateFrom(body = {}) {
  return snookerAdapter.createState({ ...body.state, roundId: body.roundId || body.state?.roundId });
}

function matchFrom(body = {}) {
  const room = roomFrom(body);
  const state = stateFrom(body);
  return { room, state, match: kit.toMatch({ game: "snooker", room, state }) };
}

app.get("/api/health", async (_req, res) => {
  const funding = settlementFunding ? await settlementFunding.status() : null;
  res.json({ ok: true, network: kit.network, settlementFunding: funding });
});

app.get("/api/config", async (_req, res) => {
  const isMainnet = kit.network.id === "mainnet";
  const funding = settlementFunding ? await settlementFunding.status() : { ready: true, code: "NOT_REQUIRED" };
  const mainnetStakeCap = Math.min(1, Number(mainnetMaxStakeKas));
  const mainnetStakeOptions = [...new Set([0.001, 0.005, 0.01, 0.05, 0.1, mainnetStakeCap])]
    .filter((stake) => Number.isFinite(stake) && stake > 0 && stake <= mainnetStakeCap)
    .sort((left, right) => left - right);
  const publicRunnerHealth = settlementRunnerHealth.ready
    ? {
        ready: true,
        fileName: settlementRunnerHealth.fileName,
        sha256: settlementRunnerHealth.sha256,
        size: settlementRunnerHealth.size,
        network: settlementRunnerHealth.network,
        settleEscrow: settlementRunnerHealth.settleEscrow,
        mainnetCapable: settlementRunnerHealth.mainnetCapable,
        durableJournal: settlementRunnerHealth.durableJournal
      }
    : { ready: false, code: settlementRunnerHealth.code || "RUNNER_UNAVAILABLE", reason: settlementRunnerHealth.reason };
  const staticEscrowReady = settlementRunnerHealth.ready && (!isMainnet || (
    sourceCompilerHealth.ready && kit.escrow.mainnetProgramProfileApproved && mainnetSettlementRunnerApproved
  ));
  const escrowReady = staticEscrowReady && funding.ready;
  res.json({
    network: {
      id: kit.network.id,
      label: kit.network.label,
      symbol: kit.network.currencySymbol,
      isTestnet: kit.network.isTestnet,
      addressPrefix: kit.network.addressPrefix,
      explorer: kit.network.kascovExplorerBase
    },
    chainMode: !staticEscrowReady ? "unavailable" : funding.ready ? "live" : "needs-funding",
    escrowReady,
    faucetAvailable: kit.network.isTestnet,
    stakeOptions: isMainnet ? mainnetStakeOptions : [5, 25, 50, 100],
    mainnetGuarded: true,
    mainnetReadiness: {
      mode: isMainnet ? "closed-test" : "tn10",
      programProfileApproved: !isMainnet || kit.escrow.mainnetProgramProfileApproved,
      programProfileFingerprint: kit.escrow.programProfile.fingerprint,
      configuredProgramProfileFingerprint: isMainnet ? mainnetProgramProfileFingerprint : "",
      sourceCompiler: isMainnet ? {
        ready: sourceCompilerHealth.ready,
        compilerVersion: sourceCompilerHealth.compilerVersion,
        compilerSha256: sourceCompilerHealth.compilerSha256,
        upstreamCommit: sourceCompilerHealth.upstreamCommit,
        sourceSha256: sourceCompilerHealth.sourceSha256,
        testVectorProgramSha256: sourceCompilerHealth.testVectorProgramSha256
      } : { ready: false, reason: sourceCompilerHealth.reason },
      settlementRunnerApproved: !isMainnet || mainnetSettlementRunnerApproved,
      settlementRunnerHealth: publicRunnerHealth,
      settlementFunding: funding,
      maxStakeKas: isMainnet ? Number(mainnetMaxStakeKas) : null
    }
  });
});

app.get("/api/faucet", async (_req, res) => {
  if (!kit.network.isTestnet) return res.status(404).json({ error: "Faucet is available on TN10 only" });
  let balanceKas = null;
  try { balanceKas = await faucet.balanceKas(); } catch {}
  res.json({ ...faucet.publicInfo(), balanceKas });
});

app.post("/api/faucet/claim", async (req, res, next) => {
  try {
    if (!kit.network.isTestnet) return res.status(404).json({ error: "Faucet is available on TN10 only" });
    const claim = await faucet.claim(String(req.body?.address || "").trim(), Number(req.body?.amountKas || 200));
    res.json({ ok: true, claim });
  } catch (error) {
    next(error);
  }
});

app.post("/api/escrow/intent", (req, res, next) => {
  try {
    const { match } = matchFrom(req.body);
    res.json({ match, intent: kit.createEscrowIntent({ match }) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/escrow/draft", async (req, res, next) => {
  try {
    await requireSettlementFunding();
    const { match } = matchFrom(req.body);
    const draft = await kit.buildDeployDraft({ match });
    res.json({ match, draft });
  } catch (error) {
    next(error);
  }
});

app.post("/api/settlement/prepare", async (req, res, next) => {
  try {
    const { match, state } = matchFrom(req.body);
    state.scores = req.body.state?.scores || state.scores;
    state.moves = req.body.state?.moves || state.moves;
    state.winnerAddress = req.body.winnerAddress || state.winnerAddress;
    state.result = state.winnerAddress ? "win" : state.result;
    const proof = kit.createSettlementProof({ match, state, winnerAddress: state.winnerAddress });
    const result = state.winnerAddress
      ? await kit.settleWinner({ match, state, winnerAddress: state.winnerAddress, reason: "snooker-frame-win" })
      : null;
    res.json({ proof, result });
  } catch (error) {
    next(error);
  }
});

app.get("/api/ledger", (_req, res) => {
  res.json({ escrows: kit.listEscrows(), settlements: kit.listSettlements() });
});

app.use(express.static(path.join(root, "dist")));
app.get("/{*splat}", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(root, "dist", "index.html"));
});

app.use((error, _req, res, _next) => {
  const status = error.status || 400;
  if (status >= 500 && !error.operational) console.error(error);
  res.status(status).json({
    error: error.message || "Request failed",
    errorEn: error.messageEn || error.message || "Request failed",
    code: error.code || "REQUEST_FAILED",
    status: error.intent?.status || "error",
    intent: error.intent || null
  });
});

httpServer.listen(port, host, () => {
  console.log(`Kaspa Snooker API · ${kit.network.label} · http://${host}:${port}`);
  if (liveRooms.size) console.log(`Recovered ${liveRooms.size} persisted room(s)`);
  persistRooms();
  for (const room of liveRooms.values()) resumeRoomRuntime(room);
  recoverPendingSettlements();
  const recoveryTimer = setInterval(recoverPendingSettlements, 60_000);
  recoveryTimer.unref?.();
});
