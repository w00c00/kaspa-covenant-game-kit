"use strict";

const { covenantStoryUrl, explorerTxUrl, nowIso, randomId } = require("./utils");

class SettlementEngine {
  constructor(options = {}) {
    this.escrowEngine = options.escrowEngine;
    this.store = options.store || this.escrowEngine?.store || null;
    this.proofBuilder = options.proofBuilder;
    this.kascovLab = options.kascovLab;
    this.inFlight = new Map();
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
    const settlement = {
      id: randomId(`GAME-${match.id || "MATCH"}`),
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
    return this.store?.upsertSettlement(settlement) || settlement;
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
    const started = this.store?.upsertEscrow({
      ...escrowRecord,
      status: "settling",
      releaseTo,
      settlementId: pending.id
    });

    try {
      const settle = await this.kascovLab.settleEscrow({
        programHex: escrowRecord.programHex,
        releaseTo,
        covenantId: escrowRecord.deploy.covenantId
      });
      const settled = this.store?.upsertEscrow({
        ...started,
        status: settle.txid ? "settled-on-chain" : "settle-output-unparsed",
        releaseTo,
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
        releasedKas: settle.releasedKas || 0
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
    }
  }
}

module.exports = {
  SettlementEngine
};
