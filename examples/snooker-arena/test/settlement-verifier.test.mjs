import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { ensureSettlementVerifier } from "../server/settlement-verifier.mjs";

const require = createRequire(import.meta.url);
const kaspa = require("@kluster/kaspa-wasm");

test("settlement verifier keys are network-correct and data directories cannot be reused across networks", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "snooker-verifier-"));
  try {
    const mainnet = ensureSettlementVerifier(directory, "mainnet");
    assert.equal(mainnet.networkId, "mainnet");
    assert.match(mainnet.address, /^kaspa:/);
    const wallet = JSON.parse(fs.readFileSync(path.join(directory, "settlement-verifier.json"), "utf8"));
    assert.equal(wallet.networkId, "mainnet");
    assert.throws(() => ensureSettlementVerifier(directory, "testnet-10"), /separate DATA_DIR/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("TN10 may reuse its faucet key but mainnet never does", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "snooker-verifier-faucet-"));
  try {
    const faucetKey = kaspa.Keypair.random().privateKey;
    fs.writeFileSync(path.join(directory, "faucet-wallet.json"), JSON.stringify({ privateKey: faucetKey }), { mode: 0o600 });
    const testnet = ensureSettlementVerifier(directory, "testnet-10");
    assert.equal(fs.readFileSync(testnet.keyFile, "utf8").trim(), faucetKey);
    assert.match(testnet.address, /^kaspatest:/);

    const mainnetDirectory = path.join(directory, "mainnet");
    fs.mkdirSync(mainnetDirectory);
    fs.writeFileSync(path.join(mainnetDirectory, "faucet-wallet.json"), JSON.stringify({ privateKey: faucetKey }), { mode: 0o600 });
    const mainnet = ensureSettlementVerifier(mainnetDirectory, "mainnet");
    assert.notEqual(fs.readFileSync(mainnet.keyFile, "utf8").trim(), faucetKey);
    assert.match(mainnet.address, /^kaspa:/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
