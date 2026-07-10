"use strict";

const { execFile } = require("node:child_process");

function parseKascovLabDeploy(stdout) {
  const covenantId = stdout.match(/BIRTH\s+covenant\s+([0-9a-f]{64})/i)?.[1] || "";
  const txid = stdout.match(/\btx\s+([0-9a-f]{64})/i)?.[1] || "";
  const programHash = stdout.match(/program blake2b\s+([0-9a-f]{64})/i)?.[1] || "";
  return { covenantId, txid, programHash };
}

function parseKascovLabSettle(stdout) {
  const txid = stdout.match(/\btx\s+([0-9a-f]{64})/i)?.[1] || "";
  const releasedKas = Number(stdout.match(/\(([0-9.]+)\s+TKAS released\)/i)?.[1] || 0);
  return { txid, releasedKas };
}

class KascovLabAdapter {
  constructor(options = {}) {
    this.bin = options.bin || process.env.KASCOV_LAB_BIN || "kascov-lab";
    this.env = options.env || process.env;
  }

  run(args, timeoutMs = 120000) {
    return new Promise((resolve, reject) => {
      execFile(this.bin, args, { timeout: timeoutMs, env: this.env }, (error, stdout, stderr) => {
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
    const run = await this.run(
      ["settle-escrow", "--program-hex", programHex, "--release-to", releaseTo, "--covenant", covenantId],
      timeoutMs
    );
    return {
      ...parseKascovLabSettle(run.stdout),
      stdout: run.stdout,
      stderr: run.stderr
    };
  }
}

module.exports = {
  KascovLabAdapter,
  parseKascovLabDeploy,
  parseKascovLabSettle
};
