"use strict";

const { execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { executableManifest } = require("./executable-manifest");
const { normalizeHex } = require("./utils");

const JOURNAL_MAX_BYTES = 4096;
const JOURNAL_RETRY_AFTER_MS = 10 * 60 * 1000;

function normalizeRunnerNetwork(value) {
  const network = String(value || "").trim().toLowerCase();
  if (["testnet-10", "testnet10"].includes(network)) return "tn10";
  if (["kaspa", "kaspa-mainnet"].includes(network)) return "mainnet";
  return network;
}

function parseKascovLabDeploy(stdout) {
  const covenantId = stdout.match(/BIRTH\s+covenant\s+([0-9a-f]{64})/i)?.[1] || "";
  const txid = stdout.match(/\btx\s+([0-9a-f]{64})/i)?.[1] || "";
  const programHash = stdout.match(/program blake2b\s+([0-9a-f]{64})/i)?.[1] || "";
  return { covenantId, txid, programHash };
}

function parseKascovLabSettle(stdout) {
  const txid = stdout.match(/\btx\s+([0-9a-f]{64})/i)?.[1] || "";
  const releasedKas = Number(stdout.match(/\(([0-9.]+)\s+T?KAS released\)/i)?.[1] || 0);
  return { txid, releasedKas };
}

function parseSettlementJournal(text) {
  const fields = {};
  for (const line of String(text || "").split(/\r?\n/).filter(Boolean)) {
    const separator = line.indexOf("=");
    if (separator <= 0) throw new Error("Settlement journal contains an invalid line");
    const key = line.slice(0, separator);
    if (Object.hasOwn(fields, key)) throw new Error(`Settlement journal repeats ${key}`);
    fields[key] = line.slice(separator + 1);
  }
  if (fields.version !== "1") throw new Error("Settlement journal version is not supported");
  if (!/^[0-9a-f]{64}$/i.test(fields.covenant_id || "")) throw new Error("Settlement journal covenant ID is invalid");
  if (!/^[0-9a-f]{64}$/i.test(fields.txid || "")) throw new Error("Settlement journal transaction ID is invalid");
  if (!["buyer", "seller"].includes(fields.release_to)) throw new Error("Settlement journal release side is invalid");
  if (!["prepared", "submitted"].includes(fields.status)) throw new Error("Settlement journal status is invalid");
  if (!/^\d+$/.test(fields.released_sompi || "")) throw new Error("Settlement journal released amount is invalid");
  return {
    version: 1,
    network: normalizeRunnerNetwork(fields.network),
    covenantId: fields.covenant_id.toLowerCase(),
    releaseTo: fields.release_to,
    txid: fields.txid.toLowerCase(),
    releasedSompi: BigInt(fields.released_sompi),
    status: fields.status
  };
}

class KascovLabAdapter {
  constructor(options = {}) {
    this.bin = options.bin || process.env.KASCOV_LAB_BIN || "kascov-lab";
    this.env = options.env || process.env;
    this.keyFile = options.keyFile || process.env.KASCOV_LAB_KEY_FILE || "";
    this.expectedBinSha256 = normalizeHex(options.expectedBinSha256 || process.env.KASCOV_LAB_EXPECTED_SHA256 || "");
    this.approvedNetworks = new Set((options.approvedNetworks || ["tn10"]).map(normalizeRunnerNetwork));
    this.journalDir = path.resolve(options.journalDir || process.env.KASCOV_LAB_JOURNAL_DIR || ".");
    this.journalEnabled = Boolean(options.journalDir || process.env.KASCOV_LAB_JOURNAL_DIR);
    this.restApi = String(options.restApi || process.env.KASPA_REST_API || "").replace(/\/$/, "");
    this.fetch = options.fetch || globalThis.fetch;
    this.journalRetryAfterMs = Math.max(60_000, Number(options.journalRetryAfterMs) || JOURNAL_RETRY_AFTER_MS);
    this.approvedNetwork = "";
  }

  binaryManifest() {
    return executableManifest(this.bin, this.env);
  }

  assertApprovedForNetwork(networkId) {
    const network = normalizeRunnerNetwork(networkId);
    const manifest = this.binaryManifest();
    if (!this.approvedNetworks.has(network)) {
      const error = new Error(`Settlement runner is not approved for ${network}`);
      error.code = "SETTLEMENT_RUNNER_NETWORK_NOT_APPROVED";
      throw error;
    }
    if (network === "mainnet" && !this.expectedBinSha256) {
      const error = new Error("Mainnet settlement runner requires a pinned executable SHA-256");
      error.code = "SETTLEMENT_RUNNER_HASH_REQUIRED";
      throw error;
    }
    if (this.expectedBinSha256 && this.expectedBinSha256 !== manifest.sha256) {
      const error = new Error("Settlement runner executable hash does not match the approved SHA-256");
      error.code = "SETTLEMENT_RUNNER_HASH_MISMATCH";
      error.expectedSha256 = this.expectedBinSha256;
      error.actualSha256 = manifest.sha256;
      throw error;
    }
    this.approvedNetwork = network;
    return { ...manifest, network, approved: true };
  }

  run(args, timeoutMs = 120000) {
    if (!this.approvedNetwork) {
      if (this.approvedNetworks.size !== 1) {
        const error = new Error("Settlement runner network must be selected before execution");
        error.code = "SETTLEMENT_RUNNER_NETWORK_NOT_SELECTED";
        throw error;
      }
      this.approvedNetwork = this.approvedNetworks.values().next().value;
    }
    const manifest = this.assertApprovedForNetwork(this.approvedNetwork);
    return new Promise((resolve, reject) => {
      execFile(manifest.path, args, { timeout: timeoutMs, env: this.env }, (error, stdout, stderr) => {
        if (error) {
          error.stdout = stdout;
          error.stderr = stderr;
          reject(error);
          return;
        }
        resolve({ stdout, stderr });
      });
    });
  }

  async settleEscrow({ programHex, releaseTo, covenantId, timeoutMs = 120000 }) {
    this.assertApprovedForNetwork(this.approvedNetwork || this.approvedNetworks.values().next().value);
    const journalPath = this.settlementJournalPath(covenantId);
    const recovered = await this.recoverSettlementJournal({ journalPath, covenantId, releaseTo, timeoutMs });
    if (recovered) return recovered;
    const globalArgs = this.keyFile ? ["--key", this.keyFile] : [];
    const networkArgs = this.approvedNetwork === "mainnet" ? ["--network", "mainnet"] : [];
    const journalArgs = journalPath ? ["--journal", journalPath] : [];
    const run = await this.run(
      [
        ...globalArgs,
        "settle-escrow",
        "--program-hex",
        programHex,
        "--release-to",
        releaseTo,
        "--covenant",
        covenantId,
        ...networkArgs,
        ...journalArgs
      ],
      timeoutMs
    );
    const parsed = parseKascovLabSettle(run.stdout);
    if (journalPath) {
      const journal = this.readSettlementJournal(journalPath, covenantId, releaseTo);
      if (!journal || journal.status !== "submitted" || journal.txid !== parsed.txid) {
        const error = new Error("Settlement runner output does not match its durable journal");
        error.code = "SETTLEMENT_JOURNAL_MISMATCH";
        throw error;
      }
    }
    return {
      ...parsed,
      stdout: run.stdout,
      stderr: run.stderr
    };
  }

  settlementJournalPath(covenantId) {
    if (!this.journalEnabled) return "";
    const id = normalizeHex(covenantId);
    if (!/^[0-9a-f]{64}$/.test(id)) throw new Error("A 32-byte covenant ID is required for settlement journaling");
    return path.join(this.journalDir, `${id}.journal`);
  }

  readSettlementJournal(journalPath, covenantId, releaseTo) {
    if (!journalPath) return null;
    let stat;
    try {
      stat = fs.lstatSync(journalPath);
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > JOURNAL_MAX_BYTES) {
      const error = new Error("Settlement journal is not a small regular file");
      error.code = "SETTLEMENT_JOURNAL_INVALID";
      throw error;
    }
    let journal;
    try {
      journal = parseSettlementJournal(fs.readFileSync(journalPath, "utf8"));
    } catch (cause) {
      const error = new Error("Settlement journal cannot be verified");
      error.code = "SETTLEMENT_JOURNAL_INVALID";
      error.cause = cause;
      throw error;
    }
    const expectedNetwork = normalizeRunnerNetwork(this.approvedNetwork);
    if (journal.network !== expectedNetwork || journal.covenantId !== normalizeHex(covenantId) || journal.releaseTo !== releaseTo) {
      const error = new Error("Settlement journal does not match the approved operation");
      error.code = "SETTLEMENT_JOURNAL_CONFLICT";
      throw error;
    }
    return { ...journal, mtimeMs: stat.mtimeMs };
  }

  async recoverSettlementJournal({ journalPath, covenantId, releaseTo, timeoutMs }) {
    const journal = this.readSettlementJournal(journalPath, covenantId, releaseTo);
    if (!journal) return null;
    if (!this.restApi || typeof this.fetch !== "function") {
      const error = new Error("A durable settlement journal exists but transaction verification is unavailable");
      error.code = "SETTLEMENT_BROADCAST_PENDING";
      throw error;
    }
    let response;
    try {
      response = await this.fetch(`${this.restApi}/transactions/${journal.txid}`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(Math.min(10_000, timeoutMs || 10_000))
      });
    } catch (cause) {
      const error = new Error("Settlement transaction verification is temporarily unavailable");
      error.code = "SETTLEMENT_BROADCAST_PENDING";
      error.cause = cause;
      throw error;
    }
    if (response.ok) {
      const transaction = await response.json();
      const transactionId = normalizeHex(transaction?.transaction_id || transaction?.transactionId || transaction?.id || "");
      if (transactionId !== journal.txid || transaction?.is_accepted === false) {
        const error = new Error("Kaspa REST response does not verify the journaled settlement transaction");
        error.code = "SETTLEMENT_JOURNAL_TRANSACTION_MISMATCH";
        throw error;
      }
      return {
        txid: journal.txid,
        releasedKas: Number(journal.releasedSompi) / 100_000_000,
        stdout: "",
        stderr: "",
        recoveredFromJournal: true
      };
    }
    if (response.status !== 404 || Date.now() - journal.mtimeMs < this.journalRetryAfterMs) {
      const error = new Error("The journaled settlement transaction is awaiting index confirmation");
      error.code = "SETTLEMENT_BROADCAST_PENDING";
      throw error;
    }
    return null;
  }

  async healthCheck(networkId, timeoutMs = 10_000) {
    const manifest = this.assertApprovedForNetwork(networkId);
    const run = await this.run(["--help"], timeoutMs);
    const help = `${run.stdout || ""}\n${run.stderr || ""}`;
    if (!/settle-escrow/i.test(help)) throw new Error("Settlement runner does not expose settle-escrow capability");
    const capability = await this.run(["settle-escrow", "--help"], timeoutMs);
    const capabilityHelp = `${capability.stdout || ""}\n${capability.stderr || ""}`;
    const durableJournal = /--journal/i.test(capabilityHelp);
    if (manifest.network === "mainnet") {
      if (!/mainnet/i.test(help) || !/--network/i.test(capabilityHelp) || !/mainnet/i.test(capabilityHelp) || !/--journal/i.test(capabilityHelp) ||
          /testnet-10\s+only/i.test(help) || /mainnet.{0,24}(?:unsupported|disabled|not supported)/i.test(help)) {
        const error = new Error("Settlement runner help does not prove explicit mainnet settlement capability");
        error.code = "SETTLEMENT_RUNNER_MAINNET_CAPABILITY_MISSING";
        throw error;
      }
      if (!this.journalEnabled || !this.restApi) {
        const error = new Error("Mainnet settlement recovery requires a journal directory and Kaspa REST API");
        error.code = "SETTLEMENT_JOURNAL_NOT_CONFIGURED";
        throw error;
      }
    }
    return { ...manifest, settleEscrow: true, mainnetCapable: manifest.network === "mainnet", durableJournal };
  }
}

module.exports = {
  KascovLabAdapter,
  parseKascovLabDeploy,
  parseKascovLabSettle,
  parseSettlementJournal
};
