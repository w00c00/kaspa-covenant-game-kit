"use strict";

const { DEFAULT_NETWORKS } = require("./constants");
const { KascovTools } = require("./kascov-tools");
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

class CovenantEscrowEngine {
  constructor(options = {}) {
    this.kaspa = options.kaspa || null;
    this.store = options.store || null;
    this.network = options.network || DEFAULT_NETWORKS[options.networkId || "tn10"];
    this.kascovTools = options.kascovTools || new KascovTools(options.kascovToolsOptions || {});
    this.arbiter = options.arbiter || {};
    this.computeBudget = Number(options.computeBudget || DEFAULT_COMPUTE_BUDGET);
    this.feeShareSompi = BigInt(options.feeShareSompi || DEFAULT_FEE_SHARE_SOMPI);
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
          : missing.length
            ? "needs-player-public-keys"
            : !arbiterHash
              ? "needs-server-arbiter-key"
              : programHex
                ? "ready-for-pskt-builder"
                : "program-build-failed",
      stakeKas: Number(match.stakeKas || 0),
      totalLockedKas: Number((players.length * Number(match.stakeKas || 0)).toFixed(8)),
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
      missingPublicKeys: missing.map((player) => player.address),
      deployCommand: programHex ? `kascov-lab deploy --program-hex ${programHex} --value ${kasToSompi(Number(match.stakeKas || 0) * 2)}` : "",
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

    const stakeSompi = kasToSompi(intent.stakeKas);
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
        preferredPayload: nativePskt.status === "ready" ? "nativePskt.serialized" : "unsignedTransactionSafeJson",
        param: {
          txJsonString: nativePskt.status === "ready" ? nativePskt.serialized : unsignedTransactionSafeJson,
          options: {
            autoFinalized: false,
            toSignInputs: selected.map(({ player }, index) => ({
              index,
              address: player.address,
              publicKey: player.publicKey,
              sighashTypes: [1]
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

  mergePlayerSignedTransactions(unsignedTransactionSafeJson, playerSignatures, requiredSignatures) {
    const kaspa = loadKaspa(this.kaspa);
    if (!unsignedTransactionSafeJson) return { complete: false, error: "unsignedTransactionSafeJson is required" };
    let transaction;
    try {
      transaction = kaspa.Transaction.deserializeFromSafeJSON(unsignedTransactionSafeJson);
    } catch (error) {
      return { complete: false, error: `Invalid unsigned transaction safe JSON: ${error.message || error}` };
    }
    const signedIndexes = new Set();
    for (const signature of playerSignatures || []) {
      const signedSafeJson = signature.signedTransactionSafeJson || extractSignedTransactionSafeJson(signature.signResult);
      if (!signedSafeJson) continue;
      let signedTransaction;
      try {
        signedTransaction = kaspa.Transaction.deserializeFromSafeJSON(signedSafeJson);
      } catch {
        continue;
      }
      const index = Number(signature.signerInputIndex);
      const signedInput = signedTransaction.inputs?.[index];
      const signatureScript = signedInput?.signatureScript || "";
      if (!Number.isInteger(index) || index < 0 || !signatureScript) continue;
      transaction.inputs[index].signatureScript = signatureScript;
      signedIndexes.add(index);
    }
    transaction.finalize();
    const complete = Array.from({ length: requiredSignatures }, (_, index) => index).every((index) => signedIndexes.has(index));
    return {
      complete,
      signedIndexes: Array.from(signedIndexes).sort((a, b) => a - b),
      mergedSignedTransactionSafeJson: transaction.serializeToSafeJSON()
    };
  }

  releaseSideForWinner(record, winnerAddress, fallback = "buyer") {
    if (winnerAddress && record?.buyer?.address === winnerAddress) return "buyer";
    if (winnerAddress && record?.seller?.address === winnerAddress) return "seller";
    return fallback === "seller" ? "seller" : "buyer";
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
    const transaction = kaspa.Transaction.deserializeFromSafeJSON(safeJson(safeTransactionJson));
    const tx = transaction.toJSON();
    const covenant = tx.outputs?.[0]?.covenant || null;
    if (Number(tx.version || 0) < 1 || !covenant?.covenantId) {
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
