"use strict";

const { execFile } = require("node:child_process");
const { executableManifest } = require("./executable-manifest");
const { normalizeHex } = require("./utils");

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

class KascovLabAdapter {
  constructor(options = {}) {
    this.bin = options.bin || process.env.KASCOV_LAB_BIN || "kascov-lab";
    this.env = options.env || process.env;
    this.keyFile = options.keyFile || process.env.KASCOV_LAB_KEY_FILE || "";
    this.expectedBinSha256 = normalizeHex(options.expectedBinSha256 || process.env.KASCOV_LAB_EXPECTED_SHA256 || "");
    this.approvedNetworks = new Set((options.approvedNetworks || ["tn10"]).map(normalizeRunnerNetwork));
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
    const globalArgs = this.keyFile ? ["--key", this.keyFile] : [];
    const networkArgs = this.approvedNetwork === "mainnet" ? ["--network", "mainnet"] : [];
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
        ...networkArgs
      ],
      timeoutMs
    );
    return {
      ...parseKascovLabSettle(run.stdout),
      stdout: run.stdout,
      stderr: run.stderr
    };
  }

  async healthCheck(networkId, timeoutMs = 10_000) {
    const manifest = this.assertApprovedForNetwork(networkId);
    const run = await this.run(["--help"], timeoutMs);
    const help = `${run.stdout || ""}\n${run.stderr || ""}`;
    if (!/settle-escrow/i.test(help)) throw new Error("Settlement runner does not expose settle-escrow capability");
    if (manifest.network === "mainnet") {
      const capability = await this.run(["settle-escrow", "--help"], timeoutMs);
      const capabilityHelp = `${capability.stdout || ""}\n${capability.stderr || ""}`;
      if (!/mainnet/i.test(help) || !/--network/i.test(capabilityHelp) || !/mainnet/i.test(capabilityHelp) ||
          /testnet-10\s+only/i.test(help) || /mainnet.{0,24}(?:unsupported|disabled|not supported)/i.test(help)) {
        const error = new Error("Settlement runner help does not prove explicit mainnet settlement capability");
        error.code = "SETTLEMENT_RUNNER_MAINNET_CAPABILITY_MISSING";
        throw error;
      }
    }
    return { ...manifest, settleEscrow: true, mainnetCapable: manifest.network === "mainnet" };
  }
}

module.exports = {
  KascovLabAdapter,
  parseKascovLabDeploy,
  parseKascovLabSettle
};
