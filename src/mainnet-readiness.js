"use strict";

const { KascovLabAdapter } = require("./kascov-lab-adapter");
const { KascovTools } = require("./kascov-tools");
const { SilvercAdapter } = require("./silverc-adapter");
const { kasToSompi, normalizeHex, sompiToKas } = require("./utils");

function truthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

async function assessMainnetReadiness(options = {}) {
  const env = options.env || process.env;
  const tools = options.kascovTools || new KascovTools(options.kascovToolsOptions || {});
  const maxStakeInput = options.maxStakeKas ?? env.KASPA_COVENANT_MAINNET_MAX_STAKE_KAS ?? "1";
  const checks = [];
  const add = (id, ok, detail) => checks.push({ id, ok: Boolean(ok), detail });

  add(
    "network-approved",
    options.allowMainnet === undefined ? truthy(env.KASPA_COVENANT_ALLOW_MAINNET) : options.allowMainnet === true,
    "Explicit real-KAS network approval"
  );

  let sourceCompiler = null;
  let compilerManifest = null;
  try {
    const compiler = options.silverc || new SilvercAdapter({
      bin: options.silvercBin || env.SILVERC_BIN || "",
      env,
      sourceFile: options.silvercSourceFile || env.KASPA_COVENANT_SILVERC_SOURCE_FILE,
      expectedBinSha256: options.silvercSha256 || env.KASPA_COVENANT_MAINNET_SILVERC_SHA256 || ""
    });
    sourceCompiler = await compiler.healthCheck(tools);
    compilerManifest = typeof compiler.profileManifest === "function" ? compiler.profileManifest() : sourceCompiler;
    add("source-compiler", true, `silverc ${compilerManifest.compilerVersion} · ${compilerManifest.compilerSha256}`);
  } catch (error) {
    sourceCompiler = { code: error.code || "SILVERC_HEALTH_FAILED", error: error.message || String(error) };
    add("source-compiler", false, sourceCompiler.error);
  }

  const profile = tools.escrowProgramProfile({ compilerManifest });
  const configuredFingerprint = normalizeHex(
    options.programProfileFingerprint || env.KASPA_COVENANT_MAINNET_PROGRAM_FINGERPRINT || ""
  );
  add(
    "program-approved",
    options.programProfileApproved === undefined
      ? truthy(env.KASPA_COVENANT_MAINNET_PROGRAM_APPROVED)
      : options.programProfileApproved === true,
    "Operator reviewed the exact program profile"
  );
  add(
    "program-fingerprint",
    profile.contractSourceLinked && configuredFingerprint === profile.fingerprint,
    configuredFingerprint ? `Configured ${configuredFingerprint}` : "Program profile fingerprint is missing"
  );

  let maxStakeKas = null;
  try {
    const maxStakeSompi = kasToSompi(maxStakeInput);
    maxStakeKas = sompiToKas(maxStakeSompi);
    add("stake-cap", maxStakeSompi <= kasToSompi("1"), `Maximum ${maxStakeKas} KAS per player`);
  } catch (error) {
    add("stake-cap", false, error.message || String(error));
  }

  const runnerApproved = options.runnerApproved === undefined
    ? truthy(env.KASPA_COVENANT_MAINNET_SETTLEMENT_RUNNER_APPROVED)
    : options.runnerApproved === true;
  add("runner-approved", runnerApproved, "Operator approved the mainnet settlement runner");
  let runner = null;
  if (!runnerApproved) {
    add("runner-health", false, "Settlement runner approval is missing");
  } else {
    try {
      const adapter = options.runner || new KascovLabAdapter({
        bin: options.runnerBin || env.KASCOV_LAB_BIN || "kascov-lab",
        keyFile: options.runnerKeyFile || env.KASCOV_LAB_KEY_FILE || "",
        expectedBinSha256: options.runnerSha256 || env.KASPA_COVENANT_MAINNET_SETTLEMENT_RUNNER_SHA256 || "",
        approvedNetworks: ["mainnet"]
      });
      runner = await adapter.healthCheck("mainnet");
      add("runner-health", true, `SHA-256 ${runner.sha256}`);
    } catch (error) {
      runner = { code: error.code || "RUNNER_HEALTH_FAILED", error: error.message || String(error) };
      add("runner-health", false, runner.error);
    }
  }

  const blockers = checks.filter((check) => !check.ok);
  return {
    mode: "mainnet-closed-test",
    ready: blockers.length === 0,
    profile,
    sourceCompiler,
    configuredFingerprint,
    maxStakeKas,
    runner,
    checks,
    blockers
  };
}

module.exports = { assessMainnetReadiness };
