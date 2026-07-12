import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const kaspa = require("@kluster/kaspa-wasm");
const { KascovTools } = require("kaspa-covenant-game-kit");

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

function atomicWrite(file, value, mode = 0o600) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, value, { mode });
  fs.renameSync(temporary, file);
  fs.chmodSync(file, mode);
}

/**
 * The verifier is an automated service key, not a human referee. It can only
 * choose one of the two payout addresses committed by the escrow program.
 */
export function ensureSettlementVerifier(dataDir, requestedNetworkId = "testnet-10") {
  const networkId = ["mainnet", "kaspa", "kaspa-mainnet"].includes(String(requestedNetworkId).toLowerCase())
    ? "mainnet"
    : "testnet-10";
  const isTestnet = networkId === "testnet-10";
  const walletFile = path.join(dataDir, "settlement-verifier.json");
  const keyFile = path.join(dataDir, "kascov-lab-key.hex");
  const faucetWallet = isTestnet ? readJson(path.join(dataDir, "faucet-wallet.json")) : null;
  let wallet = readJson(walletFile);
  // TN10 uses the faucet key as the automated verifier as well. The user only
  // has to fund one backend address, and the same balance pays settlement fees.
  const preferredPrivateKey = /^[0-9a-f]{64}$/i.test(faucetWallet?.privateKey || "") ? faucetWallet.privateKey : "";
  if (preferredPrivateKey && wallet?.privateKey !== preferredPrivateKey) wallet = null;
  if (/^[0-9a-f]{64}$/i.test(wallet?.privateKey || "") && wallet.networkId && wallet.networkId !== networkId) {
    throw new Error(`Settlement verifier data belongs to ${wallet.networkId}, not ${networkId}; use a separate DATA_DIR`);
  }
  if (!/^[0-9a-f]{64}$/i.test(wallet?.privateKey || "")) {
    const keypair = preferredPrivateKey
      ? new kaspa.PrivateKey(preferredPrivateKey).toKeypair()
      : kaspa.Keypair.random();
    wallet = {
      networkId,
      address: keypair.toAddress(networkId).toString(),
      publicKey: keypair.xOnlyPublicKey,
      privateKey: keypair.privateKey,
      createdAt: new Date().toISOString()
    };
    atomicWrite(walletFile, `${JSON.stringify(wallet, null, 2)}\n`);
  }
  const derivedKeypair = new kaspa.PrivateKey(wallet.privateKey).toKeypair();
  const derivedAddress = derivedKeypair.toAddress(networkId).toString();
  if (wallet.address !== derivedAddress || wallet.publicKey !== derivedKeypair.xOnlyPublicKey) {
    throw new Error("Settlement verifier identity does not match its private key and configured network");
  }
  atomicWrite(keyFile, `${wallet.privateKey}\n`);
  const tools = new KascovTools();
  return {
    address: wallet.address,
    publicKey: wallet.publicKey,
    arbiterHash: tools.blake2b256Hex(wallet.publicKey),
    keyFile,
    networkId
  };
}
