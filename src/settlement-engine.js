"use strict";

const os = require("node:os");
const { covenantStoryUrl, explorerTxUrl, nowIso, sha256Hex } = require("./utils");

class SettlementEngine {
  constructor(options = {}) {
    this.escrowEngine = options.escrowEngine;
    this.store = options.store || this.escrowEngine?.store || null;
    this.proofBuilder = options.proofBuilder;
    this.kascovLab = options.kascovLab;
    this.inFlight = new Map();
    this.workerId = options.workerId || `${os.hostname()}:${process.pid}:${sha256Hex(String(Math.random())).slice(0, 12)}`;
    this.settlementLeaseTtlMs = Math.max(180_000, Number(options.settlementLeaseTtlMs) || 300_000);
    if (!this.escrowEngine) throw new Error("SettlementEngine requires escrowEngine");
    if (!this.proofBuilder) throw new Error("SettlementEngine requires proofBuilder");
  }

  findEscrowForMatch(match) {
    const id = this.escrowEngine.escrowId(match);
    return this.store?.findEscrow((record) => record.id === id && record.roundId === match.roundId) || null;
  }

  createPendingSettlement({ match, winnerAddress, reason = "win", gameState = {}, escrowRecord = null }) {
    const players = match.players || [];
    const hasChainEscrow = this.escrowEngine.isEscrowDeployed(escrowRecord);
    const stakeKas = Number(match.stakeKas || 0);
    const covenantProof = this.proofBuilder.covenantPlan(match, winnerAddress, gameState);
    covenantProof.programHash = escrowRecord?.programHash || "";
    covenantProof.programProfileFingerprint = escrowRecord?.programProfile?.fingerprint || "";
    const settlement = {
      id: `GAME-${sha256Hex([
        escrowRecord?.id || this.escrowEngine.escrowId(match),
        match.id || "MATCH",
        match.roundId || ""
      ].join("|")).slice(0, 24).toUpperCase()}`,
      matchId: match.id,
      roomId: match.roomId || match.id,
      game: match.game,
      roundId: match.roundId || "",
      winnerAddress,
      winner: winnerAddress,
      stakeKas,
      potKas: hasChainEscrow ? Number((players.length * stakeKas).toFixed(8)) : 0,
      status: hasChainEscrow ? "pending-chain-covenant-settlement" : "settlement-needs-chain-escrow",
      reason,
      settledAt: nowIso(),
      covenantProof,
      transcriptHash: covenantProof.transcriptHash,
      chainEscrowId: escrowRecord?.id || "",
      chainCovenantId: escrowRecord?.deploy?.covenantId || "",
      releaseTo: hasChainEscrow ? this.escrowEngine.releaseSideForWinner(escrowRecord, winnerAddress) : ""
    };
    return this.store?.createSettlementIfAbsent?.(settlement) || this.store?.upsertSettlement(settlement) || settlement;
  }

  assertSettlementDecision(settlement, { match, winnerAddress }) {
    const conflicts = [];
    if (settlement.winnerAddress && settlement.winnerAddress !== winnerAddress) conflicts.push("winnerAddress");
    if (settlement.matchId && settlement.matchId !== match.id) conflicts.push("matchId");
    if ((settlement.roundId || "") !== (match.roundId || "")) conflicts.push("roundId");
    if (conflicts.length) {
      const error = new Error(`Settlement decision conflicts with the persisted result: ${conflicts.join(", ")}`);
      error.code = "SETTLEMENT_DECISION_CONFLICT";
      throw error;
    }
  }

  settleWinner(input) {
    const key = this.escrowEngine.escrowId(input.match);
    const running = this.inFlight.get(key);
    if (running) return running;
    const operation = this._settleWinner(input).finally(() => {
      if (this.inFlight.get(key) === operation) this.inFlight.delete(key);
    });
    this.inFlight.set(key, operation);
    return operation;
  }

  async _settleWinner({ match, winnerAddress, reason = "win", gameState = {}, settlementId = "" }) {
    const escrowRecord = this.findEscrowForMatch(match);
    const pending =
      (settlementId && this.store?.findSettlement((item) => item.id === settlementId)) ||
      this.store?.findSettlement((item) =>
        item.chainEscrowId === escrowRecord?.id &&
        item.matchId === match.id &&
        (item.roundId || "") === (match.roundId || "")
      ) ||
      this.createPendingSettlement({ match, winnerAddress, reason, gameState, escrowRecord });
    this.assertSettlementDecision(pending, { match, winnerAddress });

    if (!this.escrowEngine.isEscrowDeployed(escrowRecord)) {
      return {
        settlement: pending,
        escrow: escrowRecord,
        visible: this.proofBuilder.visibleSettlement(pending, escrowRecord)
      };
    }
    if (this.escrowEngine.isEscrowSettled(escrowRecord)) {
      const reconciled = this.store?.upsertSettlement({
        ...pending,
        status: "settled-on-chain",
        chainSettlementTxid: pending.chainSettlementTxid || escrowRecord.settle?.txid || escrowRecord.settleTxid || "",
        chainCovenantId: pending.chainCovenantId || escrowRecord.deploy?.covenantId || "",
        releaseTo: pending.releaseTo || escrowRecord.releaseTo || "",
        releasedKas: pending.releasedKas || escrowRecord.settle?.releasedKas || 0
      }) || pending;
      return {
        settlement: reconciled,
        escrow: escrowRecord,
        visible: this.proofBuilder.visibleSettlement(reconciled, escrowRecord)
      };
    }
    if (!this.kascovLab) {
      const waiting = this.store?.upsertEscrow({
        ...escrowRecord,
        status: "settlement-waiting-for-kascov-lab",
        settlementId: pending.id
      });
      return {
        settlement: pending,
        escrow: waiting,
        visible: this.proofBuilder.visibleSettlement(pending, waiting)
      };
    }

    const releaseTo = this.escrowEngine.releaseSideForWinner(escrowRecord, winnerAddress);
    const lease = typeof this.store?.acquireSettlementLease === "function"
      ? this.store.acquireSettlementLease(pending.id, { ownerId: this.workerId, ttlMs: this.settlementLeaseTtlMs })
      : { token: "in-process-only" };
    if (!lease) {
      const currentSettlement = this.store?.findSettlement((item) => item.id === pending.id) || pending;
      const currentEscrow = this.findEscrowForMatch(match) || escrowRecord;
      return {
        settlement: currentSettlement,
        escrow: currentEscrow,
        visible: this.proofBuilder.visibleSettlement(currentSettlement, currentEscrow),
        executionDeferred: true
      };
    }

    let started = escrowRecord;
    try {
      started = this.store?.upsertEscrow({
        ...escrowRecord,
        status: "settling",
        releaseTo,
        settlementId: pending.id
      });
      const settle = await this.kascovLab.settleEscrow({
        programHex: escrowRecord.programHex,
        releaseTo,
        covenantId: escrowRecord.deploy.covenantId
      });
      const settled = this.store?.upsertEscrow({
        ...started,
        status: settle.txid ? "settled-on-chain" : "settle-output-unparsed",
        releaseTo,
        error: "",
        stdout: "",
        stderr: "",
        settle: {
          ...settle,
          txExplorerUrl: settle.txid ? explorerTxUrl(settle.txid, this.escrowEngine.network) : "",
          covenantExplorerUrl: covenantStoryUrl(escrowRecord.deploy.covenantId, this.escrowEngine.network)
        }
      });
      const updatedSettlement = this.store?.upsertSettlement({
        ...pending,
        status: settled.status,
        chainSettlementTxid: settle.txid || "",
        chainCovenantId: escrowRecord.deploy.covenantId,
        releaseTo,
        releasedKas: settle.releasedKas || 0,
        chainSettlementError: "",
        error: ""
      });
      return {
        settlement: updatedSettlement,
        escrow: settled,
        visible: this.proofBuilder.visibleSettlement(updatedSettlement, settled)
      };
    } catch (error) {
      const failedEscrow = this.store?.upsertEscrow({
        ...started,
        status: "settle-failed",
        error: error.message || String(error),
        stdout: error.stdout || "",
        stderr: error.stderr || ""
      });
      const failedSettlement = this.store?.upsertSettlement({
        ...pending,
        status: "chain-settle-failed",
        chainSettlementError: failedEscrow.error
      });
      return {
        settlement: failedSettlement,
        escrow: failedEscrow,
        visible: this.proofBuilder.visibleSettlement(failedSettlement, failedEscrow)
      };
    } finally {
      if (lease.token !== "in-process-only") this.store?.releaseSettlementLease?.(pending.id, lease.token);
    }
  }
}

module.exports = {
  SettlementEngine
};
