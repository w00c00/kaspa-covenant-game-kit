"use strict";

const { covenantStoryUrl, explorerTxUrl, nowIso, randomId } = require("./utils");

class SettlementEngine {
  constructor(options = {}) {
    this.escrowEngine = options.escrowEngine;
    this.store = options.store || this.escrowEngine?.store || null;
    this.proofBuilder = options.proofBuilder;
    this.kascovLab = options.kascovLab;
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
    const settlement = {
      id: randomId(`GAME-${match.id || "MATCH"}`),
      matchId: match.id,
      roomId: match.roomId || match.id,
      game: match.game,
      winnerAddress,
      winner: winnerAddress,
      stakeKas,
      potKas: hasChainEscrow ? Number((players.length * stakeKas).toFixed(8)) : 0,
      status: hasChainEscrow ? "pending-chain-covenant-settlement" : "settlement-needs-chain-escrow",
      reason,
      settledAt: nowIso(),
      covenantProof: this.proofBuilder.covenantPlan(match, winnerAddress, gameState),
      chainEscrowId: escrowRecord?.id || "",
      chainCovenantId: escrowRecord?.deploy?.covenantId || "",
      releaseTo: hasChainEscrow ? this.escrowEngine.releaseSideForWinner(escrowRecord, winnerAddress) : ""
    };
    return this.store?.upsertSettlement(settlement) || settlement;
  }

  async settleWinner({ match, winnerAddress, reason = "win", gameState = {}, settlementId = "" }) {
    const escrowRecord = this.findEscrowForMatch(match);
    const pending =
      (settlementId && this.store?.findSettlement((item) => item.id === settlementId)) ||
      this.createPendingSettlement({ match, winnerAddress, reason, gameState, escrowRecord });

    if (!this.escrowEngine.isEscrowDeployed(escrowRecord)) {
      return {
        settlement: pending,
        escrow: escrowRecord,
        visible: this.proofBuilder.visibleSettlement(pending, escrowRecord)
      };
    }
    if (this.escrowEngine.isEscrowSettled(escrowRecord)) {
      return {
        settlement: pending,
        escrow: escrowRecord,
        visible: this.proofBuilder.visibleSettlement(pending, escrowRecord)
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
