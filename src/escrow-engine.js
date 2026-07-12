"use strict";

const { DEFAULT_NETWORKS } = require("./constants");
const { KascovTools } = require("./kascov-tools");
const { resolveNetworkConfig } = require("./network");
const {
  covenantStoryUrl,
  explorerTxUrl,
  hasPublicKey,
  kasToSompi,
  normalizeXOnlyPublicKey,
  safeJson,
  shortAddress,
  sompiToKas
} = require("./utils");

const DEFAULT_COMPUTE_BUDGET = 120;
const DEFAULT_FEE_SHARE_SOMPI = 1_500_000n;

function loadKaspa(provided) {
  return provided || require("@kluster/kaspa-wasm");
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }
  if (!response.ok) {
    const message = payload?.detail || payload?.error || payload?.message || `HTTP ${response.status}`;
    const error = new Error(Array.isArray(message) ? JSON.stringify(message) : message);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function normalizeRestUtxo(item) {
  return {
    address: item.address || "",
    outpoint: {
      transactionId: item.outpoint?.transactionId || item.transactionId || "",
      index: Number(item.outpoint?.index ?? item.index ?? 0)
    },
    amount: BigInt(item.utxoEntry?.amount || item.amount || 0),
    script: item.utxoEntry?.scriptPublicKey?.scriptPublicKey || item.utxoEntry?.scriptPublicKey?.script || item.scriptPublicKey?.scriptPublicKey || item.scriptPublicKey?.script || "",
    blockDaaScore: BigInt(item.utxoEntry?.blockDaaScore || item.blockDaaScore || 0),
    isCoinbase: Boolean(item.utxoEntry?.isCoinbase || item.isCoinbase)
  };
}

function extractSignedTransactionSafeJson(payload) {
  if (!payload) return "";
  if (typeof payload === "string") return payload;
  return payload.signedTransactionSafeJson || payload.txJsonString || payload.psktJsonString || payload.transactionSafeJson || "";
}

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = stableJson(value[key]);
    return result;
  }, {});
}

function transactionCommitment(safeTransactionJson) {
  const value = JSON.parse(safeJson(safeTransactionJson));
  return stableJson({
    version: value.version,
    inputs: (value.inputs || []).map(({ signatureScript: _signatureScript, ...input }) => input),
    outputs: value.outputs || [],
    subnetworkId: value.subnetworkId,
    lockTime: value.lockTime,
    gas: value.gas,
    storageMass: value.storageMass,
    payload: value.payload
  });
}

function sameTransactionCommitment(left, right) {
  return JSON.stringify(transactionCommitment(left)) === JSON.stringify(transactionCommitment(right));
}

class CovenantEscrowEngine {
  constructor(options = {}) {
    this.kaspa = options.kaspa || null;
    this.store = options.store || null;
    this.network = resolveNetworkConfig({
      ...options,
      network: options.network || DEFAULT_NETWORKS[options.networkId || "tn10"]
    });
    this.kascovTools = options.kascovTools || new KascovTools(options.kascovToolsOptions || {});
    this.arbiter = options.arbiter || {};
    this.computeBudget = Number(options.computeBudget || DEFAULT_COMPUTE_BUDGET);
    this.feeShareSompi = BigInt(options.feeShareSompi || DEFAULT_FEE_SHARE_SOMPI);
    this.maxStakeSompi = options.maxStakeSompi
      ? BigInt(options.maxStakeSompi)
      : this.network.id === "mainnet"
        ? kasToSompi(options.mainnetMaxStakeKas || process.env.KASPA_COVENANT_MAINNET_MAX_STAKE_KAS || "1")
        : null;
    this.mainnetProgramProfileApproved = Boolean(options.mainnetProgramProfileApproved) ||
      ["1", "true", "yes", "on"].includes(String(process.env.KASPA_COVENANT_MAINNET_PROGRAM_APPROVED || "").toLowerCase());
    this.fetchUtxos = options.fetchUtxos || this.fetchSpendableUtxos.bind(this);
    this.submitTransaction = options.submitTransaction || this.submitSignedTransactionWrpc.bind(this);
  }

  escrowId(match) {
    return `ESCROW-${match.id || "MATCH"}-${match.roundId || "round"}`;
  }

  normalizePlayers(match) {
    return (match.players || []).map((player) => ({
      seat: player.seat,
      role: player.role,
      address: player.address,
      publicKey: normalizeXOnlyPublicKey(player.publicKey),
      shortAddress: shortAddress(player.address),
      hasPublicKey: hasPublicKey(player.publicKey)
    }));
  }

  createIntent(match) {
    const players = this.normalizePlayers(match);
    const missing = players.filter((player) => !player.hasPublicKey);
    let stakeSompi = 0n;
    try { stakeSompi = kasToSompi(match.stakeKas); } catch {}
    const buyer = players[0] || null;
    const seller = players[1] || null;
    const arbiterHash = this.arbiter.arbiterHash || "";
    const programHex =
      buyer?.hasPublicKey && seller?.hasPublicKey && arbiterHash
        ? this.kascovTools.emitEscrowProgramHex({
            arbiterHash,
            buyerPublicKey: buyer.publicKey,
            sellerPublicKey: seller.publicKey
          })
        : "";
    const programHash = programHex ? this.kascovTools.blake2b256Hex(programHex) : "";

    return {
      id: this.escrowId(match),
      matchId: match.id || "",
      roomId: match.roomId || match.id || "",
      roundId: match.roundId || "",
      game: match.game || "",
      network: this.network.kaspaNetworkId,
      template: "SilverScript · Escrow",
      mode: "non-custodial-covenant-escrow",
      status:
        players.length < 2
          ? "waiting-for-two-players"
          : stakeSompi <= 0n
            ? "invalid-stake"
          : missing.length
            ? "needs-player-public-keys"
            : !arbiterHash
              ? "needs-server-arbiter-key"
              : programHex
                ? "ready-for-pskt-builder"
                : "program-build-failed",
      stakeKas: Number(match.stakeKas || 0),
      totalLockedKas: Number((players.length * Number(match.stakeKas || 0)).toFixed(8)),
      stakeSompi: stakeSompi.toString(),
      totalLockedSompi: (stakeSompi * BigInt(players.length)).toString(),
      requiredWalletMethods: ["getPublicKey", "signPskt", "pushTx"],
      arbiter: {
        role: "server-game-transcript-arbiter",
        address: this.arbiter.address || "",
        publicKey: this.arbiter.publicKey || "",
        arbiterHash,
        note: "The arbiter signs only winner/seller release. The Escrow contract enforces payout to buyer or seller public key, not to the arbiter."
      },
      buyer,
      seller,
      programHex,
      programHash,
      programProfile: {
        id: "kascov-silverscript-escrow-skeleton-v1",
        generator: "vendored-kascov-disasm-skeleton",
        contractSourceLinked: false,
        mainnetApproved: this.mainnetProgramProfileApproved
      },
      missingPublicKeys: missing.map((player) => player.address),
      deployCommand: programHex && stakeSompi > 0n ? `kascov-lab deploy --program-hex ${programHex} --value ${stakeSompi * BigInt(players.length)}` : "",
      settleWinnerCommand: programHex ? `kascov-lab settle-escrow --program-hex ${programHex} --release-to <buyer|seller>` : ""
    };
  }

  txInputFromUtxo(utxo) {
    const kaspa = loadKaspa(this.kaspa);
    return {
      previousOutpoint: utxo.outpoint,
      signatureScript: "",
      sequence: 0n,
      sigOpCount: 0,
      computeBudget: this.computeBudget,
      utxo: {
        address: utxo.address,
        outpoint: utxo.outpoint,
        amount: utxo.amount,
        scriptPublicKey: new kaspa.ScriptPublicKey(0, utxo.script),
        blockDaaScore: utxo.blockDaaScore,
        isCoinbase: utxo.isCoinbase
      }
    };
  }

  async fetchSpendableUtxos(address) {
    const utxos = await fetchJson(`${this.network.restApi.replace(/\/$/, "")}/addresses/${encodeURIComponent(address)}/utxos`);
    return utxos
      .map(normalizeRestUtxo)
      .filter((item) => item.outpoint.transactionId && item.script && !item.isCoinbase)
      .sort((a, b) => Number(b.amount - a.amount));
  }

  buildPsktSignerEnvelope(inputs, outputs) {
    const kaspa = loadKaspa(this.kaspa);
    try {
      let pskt = new kaspa.PSKT(undefined).toConstructor();
      inputs.forEach((input) => {
        pskt = pskt.input(input);
      });
      outputs.forEach((output) => {
        pskt = pskt.output(output);
      });
      pskt = pskt.noMoreInputs().noMoreOutputs().toSigner();
      const serialized = pskt.serialize();
      const payload = JSON.parse(serialized);
      const covenantOutputs = (payload?.payload?.outputs || []).filter((output) => output.covenant);
      const expectedCovenantOutputs = outputs.filter((output) => output.toJSON?.().covenant);
      if (expectedCovenantOutputs.length && covenantOutputs.length !== expectedCovenantOutputs.length) {
        return {
          status: "unsupported-by-current-wasm-pskt-builder",
          error: "Native PSKT serialization dropped covenant output metadata"
        };
      }
      return {
        status: "ready",
        role: pskt.role,
        id: pskt.calculateId().toString(),
        serialized
      };
    } catch (error) {
      return {
        status: "unsupported-by-current-wasm-pskt-builder",
        error: error.message || String(error)
      };
    }
  }

  async buildPlayerFundedDeployDraft(match) {
    const kaspa = loadKaspa(this.kaspa);
    const intent = this.createIntent(match);
    if (intent.status !== "ready-for-pskt-builder" || !intent.programHex) {
      const error = new Error(`Escrow is not ready for player funding: ${intent.status}`);
      error.intent = intent;
      throw error;
    }
    const players = [intent.buyer, intent.seller].filter(Boolean);
    if (players.length !== 2) {
      const error = new Error("Two player seats are required for a covenant escrow draft");
      error.intent = intent;
      throw error;
    }
    if (new Set(players.map((player) => player.address)).size !== 2) {
      throw new Error("Escrow participants must use two distinct wallet addresses");
    }
    if (new Set(players.map((player) => player.publicKey)).size !== 2) {
      throw new Error("Escrow participants must use two distinct public keys");
    }
    for (const player of players) {
      let derivedAddress = "";
      try {
        derivedAddress = new kaspa.XOnlyPublicKey(player.publicKey).toAddress(this.network.kaspaNetworkId).toString();
      } catch (error) {
        throw new Error(`Invalid public key for ${player.shortAddress}: ${error.message || error}`);
      }
      if (derivedAddress !== player.address) {
        throw new Error(`Player public key does not belong to wallet ${player.shortAddress}`);
      }
      if (this.network.addressPrefix && !player.address.toLowerCase().startsWith(`${this.network.addressPrefix.toLowerCase()}:`)) {
        throw new Error(`Player wallet ${player.shortAddress} is not on ${this.network.label || this.network.id}`);
      }
    }

    const stakeSompi = BigInt(intent.stakeSompi);
    if (this.network.id === "mainnet" && !this.mainnetProgramProfileApproved) {
      throw new Error("Mainnet covenant program profile is not approved for testing");
    }
    if (this.maxStakeSompi && stakeSompi > this.maxStakeSompi) {
      throw new Error(`Mainnet test stake exceeds the configured safety cap of ${sompiToKas(this.maxStakeSompi)} KAS per player`);
    }
    const selected = [];
    for (const player of players) {
      const utxos = await this.fetchUtxos(player.address);
      const required = stakeSompi + this.feeShareSompi;
      const utxo = utxos.find((item) => item.amount >= required);
      if (!utxo) {
        const error = new Error(`${player.shortAddress} has no spendable UTXO >= ${sompiToKas(required)} TN10 KAS`);
        error.intent = intent;
        error.player = player;
        throw error;
      }
      selected.push({ player, utxo, required });
    }

    const escrowScript = kaspa.payToScriptHashScript(intent.programHex);
    const outputs = [new kaspa.TransactionOutput(stakeSompi * BigInt(players.length), escrowScript)];
    selected.forEach(({ player, utxo }) => {
      const change = utxo.amount - stakeSompi - this.feeShareSompi;
      if (change > 0n) {
        outputs.push(new kaspa.TransactionOutput(change, kaspa.payToAddressScript(player.address)));
      }
    });

    const inputs = selected.map(({ utxo }) => this.txInputFromUtxo(utxo));
    const transaction = new kaspa.Transaction({
      version: 1,
      inputs,
      outputs,
      lockTime: 0n,
      subnetworkId: "0000000000000000000000000000000000000000",
      gas: 0n,
      payload: ""
    });
    transaction.populateGenesisCovenants([{ authorizingInput: 0, outputs: [0] }]);
    const unsignedTransactionSafeJson = transaction.serializeToSafeJSON();
    const safe = JSON.parse(unsignedTransactionSafeJson);
    const covenantId = safe.outputs?.[0]?.covenant?.covenantId || "";
    const nativePskt = this.buildPsktSignerEnvelope(inputs, transaction.outputs);

    return {
      id: `PLAYER-DRAFT-${match.id}`,
      matchId: match.id,
      roomId: match.roomId || match.id,
      mode: "player-funded-two-party-covenant-draft",
      status: "unsigned-multi-player-signatures-required",
      network: this.network.kaspaNetworkId,
      intent,
      stakeSompi: stakeSompi.toString(),
      totalLockedSompi: (stakeSompi * BigInt(players.length)).toString(),
      estimatedFeeSompi: (this.feeShareSompi * BigInt(players.length)).toString(),
      covenantId,
      programHex: intent.programHex,
      programHash: intent.programHash,
      unsignedTransactionSafeJson,
      unsignedTransaction: safe,
      nativePskt,
      signers: selected.map(({ player, utxo }, index) => ({
        inputIndex: index,
        address: player.address,
        publicKey: player.publicKey,
        shortAddress: player.shortAddress,
        role: player.role,
        requiredSompi: (stakeSompi + this.feeShareSompi).toString(),
        selectedOutpoint: utxo.outpoint,
        selectedAmountSompi: utxo.amount.toString()
      })),
      kasware: {
        method: "signPskt",
        // KasWare's documented signPskt surface accepts the safe transaction
        // JSON and a signInputs array. Keep nativePskt as diagnostic metadata,
        // but do not send its signer envelope to the browser extension.
        preferredPayload: "unsignedTransactionSafeJson",
        param: {
          txJsonString: unsignedTransactionSafeJson,
          options: {
            signInputs: selected.map((_item, index) => ({
              index,
              sighashType: 1
            }))
          }
        }
      },
      broadcast: {
        method: "pushTx",
        status: "requires-fully-signed-transaction"
      },
      createdAt: new Date().toISOString()
    };
  }

  mergePlayerSignedTransactions(unsignedTransactionSafeJson, playerSignatures, requiredSignatures, expectedSigners = []) {
    const kaspa = loadKaspa(this.kaspa);
    if (!unsignedTransactionSafeJson) return { complete: false, error: "unsignedTransactionSafeJson is required" };
    let transaction;
    try {
      transaction = kaspa.Transaction.deserializeFromSafeJSON(unsignedTransactionSafeJson);
    } catch (error) {
      return { complete: false, error: `Invalid unsigned transaction safe JSON: ${error.message || error}` };
    }
    const signedIndexes = new Set();
    const rejectedSignatures = [];
    for (const signature of playerSignatures || []) {
      const signedSafeJson = signature.signedTransactionSafeJson || extractSignedTransactionSafeJson(signature.signResult);
      if (!signedSafeJson) {
        rejectedSignatures.push({ signerInputIndex: signature.signerInputIndex, reason: "Signed transaction JSON is missing" });
        continue;
      }
      let signedTransaction;
      try {
        signedTransaction = kaspa.Transaction.deserializeFromSafeJSON(signedSafeJson);
      } catch (error) {
        rejectedSignatures.push({ signerInputIndex: signature.signerInputIndex, reason: `Invalid signed transaction: ${error.message || error}` });
        continue;
      }
      const index = Number(signature.signerInputIndex);
      const expectedSigner = expectedSigners.find((item) => Number(item.inputIndex) === index);
      if (!Number.isInteger(index) || index < 0 || index >= transaction.inputs.length || index >= requiredSignatures) {
        rejectedSignatures.push({ signerInputIndex: signature.signerInputIndex, reason: "Signer input index is outside the approved draft" });
        continue;
      }
      if (expectedSigners.length && !expectedSigner) {
        rejectedSignatures.push({ signerInputIndex: index, reason: "Signer input is not present in the approved draft" });
        continue;
      }
      if (expectedSigner && signature.address && expectedSigner.address !== signature.address) {
        rejectedSignatures.push({ signerInputIndex: index, reason: "Signer address does not own this draft input" });
        continue;
      }
      if (!sameTransactionCommitment(unsignedTransactionSafeJson, signedSafeJson)) {
        rejectedSignatures.push({ signerInputIndex: index, reason: "Signed transaction does not match the unsigned draft" });
        continue;
      }
      const signedInput = signedTransaction.inputs?.[index];
      const signatureScript = signedInput?.signatureScript || "";
      if (!signatureScript) {
        rejectedSignatures.push({ signerInputIndex: index, reason: "Signature script is missing from the claimed input" });
        continue;
      }
      transaction.inputs[index].signatureScript = signatureScript;
      signedIndexes.add(index);
    }
    transaction.finalize();
    const complete = Array.from({ length: requiredSignatures }, (_, index) => index).every((index) => signedIndexes.has(index));
    return {
      complete,
      signedIndexes: Array.from(signedIndexes).sort((a, b) => a - b),
      rejectedSignatures,
      error: rejectedSignatures.map((item) => item.reason).join("; "),
      mergedSignedTransactionSafeJson: transaction.serializeToSafeJSON()
    };
  }

  releaseSideForWinner(record, winnerAddress) {
    if (winnerAddress && record?.buyer?.address === winnerAddress) return "buyer";
    if (winnerAddress && record?.seller?.address === winnerAddress) return "seller";
    throw new Error("Winner address does not match either escrow participant");
  }

  isEscrowDeployed(record) {
    return Boolean(record?.deploy?.covenantId && record?.programHex);
  }

  isEscrowSettled(record) {
    return record?.status === "settled-on-chain" || Boolean(record?.settle?.txid || record?.settleTxid);
  }

  async broadcastSignedCovenant(match, safeTransactionJson, existingRecord = {}) {
    const kaspa = loadKaspa(this.kaspa);
    if (!safeTransactionJson) throw new Error("signedTransactionSafeJson is required");
    const approvedRecord = existingRecord?.unsignedTransactionSafeJson
      ? existingRecord
      : this.store?.findEscrow((item) => item.id === this.escrowId(match));
    if (!approvedRecord?.unsignedTransactionSafeJson) {
      throw new Error("Approved unsigned covenant draft is required before broadcast");
    }
    if (!sameTransactionCommitment(approvedRecord.unsignedTransactionSafeJson, safeTransactionJson)) {
      throw new Error("Signed covenant transaction does not match the approved draft");
    }
    const transaction = kaspa.Transaction.deserializeFromSafeJSON(safeJson(safeTransactionJson));
    const tx = transaction.toJSON();
    const covenant = tx.outputs?.[0]?.covenant || null;
    if (Number(tx.version || 0) !== 1 || !covenant?.covenantId) {
      const error = new Error("Signed transaction must be a Toccata v1 covenant transaction");
      error.details = { version: tx.version, output0: tx.outputs?.[0] || null };
      throw error;
    }
    const intent = this.createIntent(match);
    if (!intent.programHex) {
      const error = new Error(`Escrow program is not available: ${intent.status}`);
      error.intent = intent;
      throw error;
    }
    const safeTransaction = JSON.parse(transaction.serializeToSafeJSON());
    const expectedValueSompi = BigInt(intent.stakeSompi) * 2n;
    const expectedScript = `0000${kaspa.payToScriptHashScript(intent.programHex).script}`;
    if (BigInt(safeTransaction.outputs?.[0]?.value || 0) !== expectedValueSompi) {
      throw new Error("Covenant output value does not match the approved match stake");
    }
    if (safeTransaction.outputs?.[0]?.scriptPublicKey !== expectedScript) {
      throw new Error("Covenant output script does not match the approved program");
    }
    if (approvedRecord.covenantId && covenant.covenantId.toString() !== approvedRecord.covenantId) {
      throw new Error("Covenant id does not match the approved draft");
    }
    if ((safeTransaction.inputs || []).some((input) => !input.signatureScript)) {
      throw new Error("All player inputs must be signed before covenant broadcast");
    }
    const recordBase = {
      ...existingRecord,
      id: intent.id,
      matchId: match.id,
      roomId: match.roomId || match.id,
      roundId: intent.roundId,
      game: match.game,
      network: this.network.kaspaNetworkId,
      mode: "player-funded-two-party-covenant",
      status: "broadcasting-player-signed-covenant",
      covenantId: covenant.covenantId.toString(),
      programHex: intent.programHex,
      programHash: intent.programHash,
      stakeKas: intent.stakeKas,
      totalLockedKas: intent.totalLockedKas,
      valueSompi: tx.outputs?.[0]?.value?.toString?.() || String(tx.outputs?.[0]?.value || ""),
      buyer: intent.buyer,
      seller: intent.seller,
      arbiter: intent.arbiter,
      signedTxId: transaction.id,
      signedTransactionSafeJson: safeJson(safeTransactionJson)
    };
    this.store?.upsertEscrow(recordBase);
    try {
      const result = await this.submitTransaction(transaction);
      const deployed = {
        ...recordBase,
        status: "deployed-player-funded-on-chain",
        deploy: {
          txid: result.transactionId,
          covenantId: covenant.covenantId.toString(),
          txExplorerUrl: explorerTxUrl(result.transactionId, this.network),
          covenantExplorerUrl: covenantStoryUrl(covenant.covenantId.toString(), this.network)
        }
      };
      return this.store?.upsertEscrow(deployed) || deployed;
    } catch (error) {
      const failed = {
        ...recordBase,
        status: "player-funded-broadcast-failed",
        error: error.message || String(error)
      };
      return this.store?.upsertEscrow(failed) || failed;
    }
  }

  async submitSignedTransactionWrpc(transaction) {
    const kaspa = loadKaspa(this.kaspa);
    const rpc = new kaspa.RpcClient({
      resolver: new kaspa.Resolver(),
      networkId: this.network.kaspaNetworkId
    });
    await rpc.connect();
    try {
      return await rpc.submitTransaction({ transaction, allowOrphan: false });
    } finally {
      try {
        await rpc.disconnect?.();
      } catch {}
      try {
        await rpc.stop?.();
      } catch {}
    }
  }
}

module.exports = {
  CovenantEscrowEngine,
  extractSignedTransactionSafeJson,
  fetchJson,
  normalizeRestUtxo
};
