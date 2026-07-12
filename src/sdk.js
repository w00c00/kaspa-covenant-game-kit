"use strict";

const { assertGameAdapter, adapterName, normalizeMatch, resolveAdapter, resolveMatch, resolveWinnerAddress } = require("./adapter");
const { CovenantEscrowEngine } = require("./escrow-engine");
const { JsonStore } = require("./json-store");
const { KascovLabAdapter } = require("./kascov-lab-adapter");
const { resolveNetworkConfig } = require("./network");
const { ProofBuilder } = require("./proof-builder");
const { SettlementEngine } = require("./settlement-engine");
const gomokuAdapter = require("./adapters/gomoku");
const { nowIso } = require("./utils");

class KaspaCovenantGameKit {
  constructor(options = {}) {
    this.network = resolveNetworkConfig(options);
    this.networkId = this.network.id;
    this.store = options.store || new JsonStore(options.storeFile || "");
    this.adapters = new Map();

    this.registerAdapter("gomoku", gomokuAdapter);
    (options.adapters || []).forEach((adapter) => this.registerAdapter(adapter));
    if (options.adapter) this.registerAdapter(options.adapter);

    this.escrow = options.escrowEngine || new CovenantEscrowEngine({
      ...options,
      network: this.network,
      store: this.store
    });
    this.proofs = options.proofBuilder || new ProofBuilder({
      network: this.network,
      contractName: options.contractName,
      contractFile: options.contractFile,
      contractSource: options.contractSource,
      docs: options.docs
    });
    this.kascovLab =
      options.kascovLab ||
      (options.kascovLabBin ? new KascovLabAdapter({
        bin: options.kascovLabBin,
        env: options.kascovLabEnv,
        keyFile: options.kascovLabKeyFile,
        expectedBinSha256: options.kascovLabExpectedSha256,
        approvedNetworks: options.kascovLabApprovedNetworks || [this.network.id]
      }) : null);
    this.settlementRunnerManifest = null;
    if (this.kascovLab) {
      if (typeof this.kascovLab.assertApprovedForNetwork === "function") {
        this.settlementRunnerManifest = this.kascovLab.assertApprovedForNetwork(this.network.id);
      } else if (this.network.id === "mainnet") {
        throw new Error("Mainnet settlement runner must implement assertApprovedForNetwork(networkId)");
      }
    }
    this.settlements = options.settlementEngine || new SettlementEngine({
      escrowEngine: this.escrow,
      proofBuilder: this.proofs,
      kascovLab: this.kascovLab,
      store: this.store
    });
  }

  registerAdapter(nameOrAdapter, maybeAdapter) {
    const adapter = maybeAdapter || nameOrAdapter;
    assertGameAdapter(adapter);
    const name = typeof nameOrAdapter === "string" ? nameOrAdapter : adapterName(adapter);
    if (!name) throw new Error("Adapter name is required");
    this.adapters.set(name, adapter);
    return adapter;
  }

  getAdapter(game) {
    const adapter = this.adapters.get(game);
    if (!adapter) throw new Error(`No adapter registered for game: ${game}`);
    return adapter;
  }

  createState(game, options = {}) {
    const adapter = this.getAdapter(game);
    return typeof adapter.createState === "function" ? adapter.createState(options) : {};
  }

  toMatch(input = {}) {
    return resolveMatch(this.adapters, input);
  }

  createEscrowIntent(input = {}) {
    return this.escrow.createIntent(this.toMatch(input));
  }

  async buildDeployDraft(input = {}) {
    const match = this.toMatch(input);
    const draft = await this.escrow.buildPlayerFundedDeployDraft(match);
    this.store.upsertEscrow({
      id: draft.intent.id,
      matchId: match.id,
      roomId: match.roomId || match.id,
      roundId: match.roundId,
      game: match.game,
      network: this.network.kaspaNetworkId,
      status: "unsigned-player-funded-draft",
      covenantId: draft.covenantId,
      programHex: draft.programHex,
      programHash: draft.programHash,
      programProfile: draft.intent.programProfile,
      stakeKas: draft.intent.stakeKas,
      totalLockedKas: draft.intent.totalLockedKas,
      buyer: draft.intent.buyer,
      seller: draft.intent.seller,
      arbiter: draft.intent.arbiter,
      unsignedTransactionSafeJson: draft.unsignedTransactionSafeJson,
      signers: draft.signers,
      playerSignatures: []
    });
    return draft;
  }

  mergePlayerSignatures({ draft, signatures }) {
    if (!draft?.unsignedTransactionSafeJson) throw new Error("draft.unsignedTransactionSafeJson is required");
    return this.escrow.mergePlayerSignedTransactions(
      draft.unsignedTransactionSafeJson,
      signatures || [],
      draft.signers?.length || 2,
      draft.signers || []
    );
  }

  submitPlayerSignature({ match, draft, address, signerInputIndex, signResult, signedTransactionSafeJson, autoBroadcast = false }) {
    const normalizedMatch = normalizeMatch(match);
    if (!draft?.unsignedTransactionSafeJson) throw new Error("draft.unsignedTransactionSafeJson is required");
    if (!address) throw new Error("address is required");
    const expectedSigner = draft.signers?.find((item) => Number(item.inputIndex) === Number(signerInputIndex));
    if (!expectedSigner || expectedSigner.address !== address) {
      throw new Error("Submitted wallet address does not match signer input in the approved draft");
    }
    const escrowId = this.escrow.escrowId(normalizedMatch);
    const existing = this.store.findEscrow((item) => item.id === escrowId) || {
      id: escrowId,
      matchId: normalizedMatch.id,
      roomId: normalizedMatch.roomId || normalizedMatch.id,
      roundId: normalizedMatch.roundId,
      game: normalizedMatch.game,
      status: "collecting-player-signatures",
      unsignedTransactionSafeJson: draft.unsignedTransactionSafeJson,
      playerSignatures: []
    };
    const nextSignature = {
      address,
      signerInputIndex,
      signResult,
      signedTransactionSafeJson,
      submittedAt: nowIso()
    };
    const playerSignatures = (existing.playerSignatures || []).filter(
      (item) => item.address !== address && Number(item.signerInputIndex) !== Number(signerInputIndex)
    );
    playerSignatures.push(nextSignature);
    const merge = this.escrow.mergePlayerSignedTransactions(
      draft.unsignedTransactionSafeJson,
      playerSignatures,
      draft.signers?.length || 2,
      draft.signers || []
    );
    const rejected = merge.rejectedSignatures?.find((item) => Number(item.signerInputIndex) === Number(signerInputIndex));
    if (rejected) throw new Error(rejected.reason);
    const escrow = this.store.upsertEscrow({
      ...existing,
      status: merge.complete ? "fully-signed-ready-to-broadcast" : "collecting-player-signatures",
      playerSignatures,
      signedIndexes: merge.signedIndexes || [],
      mergedSignedTransactionSafeJson: merge.mergedSignedTransactionSafeJson || "",
      mergeError: merge.error || ""
    });

    if (!autoBroadcast || !merge.complete) {
      return Promise.resolve({ escrow, merge });
    }
    return this.escrow
      .broadcastSignedCovenant(normalizedMatch, merge.mergedSignedTransactionSafeJson, escrow)
      .then((broadcasted) => ({ escrow: broadcasted, merge }));
  }

  broadcastSignedCovenant({ match, signedTransactionSafeJson, existingRecord = {} }) {
    return this.escrow.broadcastSignedCovenant(normalizeMatch(match), signedTransactionSafeJson, existingRecord);
  }

  createSettlementProof(input = {}) {
    const match = this.toMatch(input);
    const adapter = input.adapter || resolveAdapter(this.adapters, { ...input, match });
    const winnerAddress = resolveWinnerAddress(adapter, { match, state: input.state, winnerAddress: input.winnerAddress });
    return this.proofs.covenantPlan(match, winnerAddress, input.state || {});
  }

  settleWinner(input = {}) {
    const match = this.toMatch(input);
    const adapter = input.adapter || resolveAdapter(this.adapters, { ...input, match });
    const winnerAddress = resolveWinnerAddress(adapter, { match, state: input.state, winnerAddress: input.winnerAddress });
    if (!winnerAddress) throw new Error("winnerAddress is required");
    return this.settlements.settleWinner({
      match,
      winnerAddress,
      reason: input.reason || "win",
      gameState: input.state || {},
      settlementId: input.settlementId || ""
    });
  }

  listEscrows() {
    return this.store.listEscrows();
  }

  listSettlements() {
    return this.store.listSettlements();
  }
}

module.exports = {
  KaspaCovenantGameKit
};
