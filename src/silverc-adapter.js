"use strict";

const { execFile } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { executableManifest } = require("./executable-manifest");
const { isHex32, normalizeHex, normalizeXOnlyPublicKey, sha256Hex } = require("./utils");

const SILVERSCRIPT_UPSTREAM_COMMIT = "956868ea63a2af4176889f1331449b5f4f9e1df8";
const SILVERSCRIPT_ESCROW_SOURCE_SHA256 = "1b943812d68f674d36bf409d8118c38128ebf57d8098be995bab487b56b5a975";
const SILVERC_COMPILER_VERSION = "0.1.0";
const DEFAULT_ESCROW_SOURCE_FILE = path.join(__dirname, "..", "contracts", "escrow.sil");

function byteArrayExpression(hex) {
  return {
    kind: "array",
    data: Array.from(Buffer.from(hex, "hex"), (value) => ({ kind: "byte", data: value }))
  };
}

class SilvercAdapter {
  constructor(options = {}) {
    this.bin = options.bin || process.env.SILVERC_BIN || "";
    this.env = options.env || process.env;
    this.sourceFile = options.sourceFile || DEFAULT_ESCROW_SOURCE_FILE;
    this.expectedBinSha256 = normalizeHex(
      options.expectedBinSha256 || process.env.KASPA_COVENANT_MAINNET_SILVERC_SHA256 || ""
    );
    this.expectedSourceSha256 = SILVERSCRIPT_ESCROW_SOURCE_SHA256;
    this.compilerVersion = SILVERC_COMPILER_VERSION;
    this.upstreamCommit = SILVERSCRIPT_UPSTREAM_COMMIT;
  }

  profileManifest() {
    if (!this.bin) {
      const error = new Error("Official SilverScript compiler is not configured");
      error.code = "SILVERC_NOT_CONFIGURED";
      throw error;
    }
    if (!isHex32(this.expectedBinSha256)) {
      const error = new Error("Official SilverScript compiler requires a pinned executable SHA-256");
      error.code = "SILVERC_HASH_REQUIRED";
      throw error;
    }
    const binary = executableManifest(this.bin, this.env);
    if (binary.sha256 !== this.expectedBinSha256) {
      const error = new Error("SilverScript compiler executable hash does not match the approved SHA-256");
      error.code = "SILVERC_HASH_MISMATCH";
      error.expectedSha256 = this.expectedBinSha256;
      error.actualSha256 = binary.sha256;
      throw error;
    }
    const sourcePath = fs.realpathSync(this.sourceFile);
    const sourceSha256 = sha256Hex(fs.readFileSync(sourcePath));
    if (sourceSha256 !== this.expectedSourceSha256) {
      const error = new Error("SilverScript Escrow source hash does not match the pinned upstream source");
      error.code = "SILVERC_SOURCE_HASH_MISMATCH";
      error.expectedSha256 = this.expectedSourceSha256;
      error.actualSha256 = sourceSha256;
      throw error;
    }
    return {
      compiler: "silverc",
      compilerVersion: this.compilerVersion,
      compilerSha256: binary.sha256,
      compilerFileName: binary.fileName,
      compilerSize: binary.size,
      upstreamCommit: this.upstreamCommit,
      sourceFileName: path.basename(sourcePath),
      sourceSha256,
      contractSourceLinked: true
    };
  }

  run(args, timeoutMs = 30_000) {
    const binary = executableManifest(this.bin, this.env);
    if (binary.sha256 !== this.expectedBinSha256) {
      const error = new Error("SilverScript compiler changed after it was approved");
      error.code = "SILVERC_HASH_MISMATCH";
      throw error;
    }
    return new Promise((resolve, reject) => {
      execFile(binary.path, args, { timeout: timeoutMs, env: this.env }, (error, stdout, stderr) => {
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

  async compileEscrow({ arbiterHash, buyerPublicKey, sellerPublicKey, timeoutMs = 30_000 }) {
    const arbiter = normalizeHex(arbiterHash);
    const buyer = normalizeXOnlyPublicKey(buyerPublicKey);
    const seller = normalizeXOnlyPublicKey(sellerPublicKey);
    if (!isHex32(arbiter) || !buyer || !seller) throw new TypeError("Escrow compiler requires a hash32 arbiter and two x-only public keys");
    const manifest = this.profileManifest();
    const source = fs.readFileSync(this.sourceFile);
    if (sha256Hex(source) !== manifest.sourceSha256) {
      const error = new Error("SilverScript Escrow source changed after it was approved");
      error.code = "SILVERC_SOURCE_HASH_MISMATCH";
      throw error;
    }
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "silverc-escrow-"));
    const constructorFile = path.join(directory, "constructor.json");
    const sourceFile = path.join(directory, "escrow.sil");
    try {
      fs.writeFileSync(sourceFile, source, { mode: 0o600 });
      fs.writeFileSync(constructorFile, JSON.stringify([
        byteArrayExpression(arbiter),
        byteArrayExpression(buyer),
        byteArrayExpression(seller)
      ]), { mode: 0o600 });
      const run = await this.run([
        sourceFile,
        "--constructor-args",
        constructorFile,
        "--stdout"
      ], timeoutMs);
      let artifact;
      try {
        artifact = JSON.parse(run.stdout);
      } catch {
        const error = new Error("SilverScript compiler did not return a JSON artifact");
        error.code = "SILVERC_OUTPUT_INVALID";
        throw error;
      }
      if (artifact.contract_name !== "Escrow" || artifact.compiler_version !== this.compilerVersion ||
          !Array.isArray(artifact.script) || artifact.script.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) {
        const error = new Error("SilverScript compiler artifact metadata or script is invalid");
        error.code = "SILVERC_ARTIFACT_INVALID";
        throw error;
      }
      return {
        ...manifest,
        contractName: artifact.contract_name,
        programHex: Buffer.from(artifact.script).toString("hex"),
        programSha256: sha256Hex(Buffer.from(artifact.script))
      };
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }

  async verifyEscrow(input, expectedProgramHex) {
    const compiled = await this.compileEscrow(input);
    if (compiled.programHex !== normalizeHex(expectedProgramHex)) {
      const error = new Error("Official SilverScript compiler output differs from the approved escrow program");
      error.code = "SILVERC_PROGRAM_MISMATCH";
      error.expectedProgramHex = normalizeHex(expectedProgramHex);
      error.actualProgramHex = compiled.programHex;
      throw error;
    }
    return compiled;
  }

  async healthCheck(kascovTools) {
    const vector = {
      arbiterHash: "11".repeat(32),
      buyerPublicKey: "22".repeat(32),
      sellerPublicKey: "33".repeat(32)
    };
    const expected = kascovTools.emitEscrowProgramHex(vector);
    const compiled = await this.verifyEscrow(vector, expected);
    return { ...this.profileManifest(), testVectorProgramSha256: compiled.programSha256, ready: true };
  }
}

module.exports = {
  DEFAULT_ESCROW_SOURCE_FILE,
  SILVERC_COMPILER_VERSION,
  SILVERSCRIPT_ESCROW_SOURCE_SHA256,
  SILVERSCRIPT_UPSTREAM_COMMIT,
  SilvercAdapter,
  byteArrayExpression
};
