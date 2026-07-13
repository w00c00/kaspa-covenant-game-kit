"use strict";

const fs = require("node:fs");
const { DEFAULT_DOCS } = require("./constants");
const { covenantStoryUrl, explorerTxUrl, sha256Hex, shortAddress } = require("./utils");
const { transcriptHash } = require("./transcript");

class ProofBuilder {
  constructor(options = {}) {
    this.contractName = options.contractName || "gomoku_escrow.sil";
    this.contractSource = options.contractSource || "";
    this.contractFile = options.contractFile || "";
    this.programProfile = options.programProfile || null;
    this.docs = options.docs || DEFAULT_DOCS;
    this.network = options.network || {};
  }

  readContractSource() {
    if (this.contractSource) return this.contractSource;
    if (!this.contractFile) return "";
    try {
      return fs.readFileSync(this.contractFile, "utf8");
    } catch {
      return "";
    }
  }

  covenantPlan(match, winnerAddress = "", gameState = {}) {
    const source = this.readContractSource();
    const players = (match.players || []).map((player) => ({
      seat: player.seat,
      role: player.role,
      address: player.address,
      shortAddress: shortAddress(player.address),
      stakeKas: Number(match.stakeKas || 0)
    }));
    const hash = transcriptHash(match, gameState);
    return {
      id: `COVPLAN-${match.id || "MATCH"}-${sha256Hex(`${match.id || ""}:${winnerAddress}:${hash}`).slice(0, 8).toUpperCase()}`,
      matchId: match.id || "",
      game: match.game || "",
      status: "ready-for-covenant-settlement",
      currentFundsLayer: "wallet-direct-covenant",
      covenantTargetNetwork: this.network.id || "tn10",
      productionNetwork: "mainnet",
      contractName: this.contractName,
      contractSourceHash: source ? sha256Hex(source) : "",
      contractSourceLinked: Boolean(this.programProfile?.contractSourceLinked),
      contractSourceRole: this.programProfile?.contractSourceLinked
        ? "official-source-recompiled-and-byte-verified"
        : "documentation-only-until-source-compiler-is-configured",
      programProfileFingerprint: this.programProfile?.fingerprint || "",
      transcriptHash: hash,
      players,
      winner: winnerAddress,
      loserSeats: players.filter((player) => player.address !== winnerAddress).map((player) => player.seat),
      stakeKas: Number(match.stakeKas || 0),
      potKas: Number((players.length * Number(match.stakeKas || 0)).toFixed(8)),
      claimPaths: match.claimPaths || ["claimWinner(transcriptHash)", "refund(after expiresAtDaa)"],
      docs: this.docs
    };
  }

  visibleSettlement(settlement, escrow = null) {
    const covenantId = settlement.chainCovenantId || escrow?.deploy?.covenantId || settlement.covenantProof?.id || "";
    const txid = settlement.chainSettlementTxid || escrow?.settle?.txid || "";
    return {
      id: settlement.id,
      game: settlement.game,
      matchId: settlement.matchId,
      roomId: settlement.roomId || settlement.matchId,
      winner: settlement.winnerAddress || settlement.winner,
      amountKas: settlement.potKas,
      status: settlement.status,
      covenantId,
      covenantTargetNetwork: escrow?.network || settlement.covenantProof?.covenantTargetNetwork || this.network.id || "tn10",
      contractSourceHash: settlement.covenantProof?.contractSourceHash || "",
      releaseTo: settlement.releaseTo || escrow?.releaseTo || "",
      releasedKas: escrow?.settle?.releasedKas || 0,
      txid,
      txExplorerUrl: txid ? explorerTxUrl(txid, this.network) : "",
      covenantStoryUrl:
        escrow?.settle?.covenantExplorerUrl ||
        escrow?.deploy?.covenantExplorerUrl ||
        covenantStoryUrl(covenantId, this.network)
    };
  }
}

module.exports = {
  ProofBuilder
};
