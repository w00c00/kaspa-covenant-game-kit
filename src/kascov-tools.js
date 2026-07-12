"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { isHex32, normalizeHex, normalizeXOnlyPublicKey, sha256Hex } = require("./utils");

const DEFAULT_BLAKE2B_FILE = path.join(__dirname, "..", "vendor", "kascov-blake2b.js");
const DEFAULT_DISASM_FILE = path.join(__dirname, "..", "vendor", "kascov-disasm.js");
const ESCROW_PROFILE_ID = "kascov-silverscript-escrow-skeleton-v1";
const ESCROW_SKELETON_NAME = "SilverScript · Escrow";

function bytesFromHex(hex) {
  return Array.from(Buffer.from(normalizeHex(hex), "hex"));
}

class KascovTools {
  constructor(options = {}) {
    this.blake2bFile = options.blake2bFile || DEFAULT_BLAKE2B_FILE;
    this.disasmFile = options.disasmFile || DEFAULT_DISASM_FILE;
    this.cache = null;
  }

  load() {
    if (this.cache) return this.cache;
    const context = { window: {}, console };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(this.blake2bFile, "utf8"), context, { filename: this.blake2bFile });
    vm.runInContext(fs.readFileSync(this.disasmFile, "utf8"), context, { filename: this.disasmFile });
    this.cache = {
      blake2b256: context.window.kascovBlake2b256,
      disasm: context.window.kascovDisasm
    };
    return this.cache;
  }

  blake2b256Hex(hex) {
    const { blake2b256 } = this.load();
    return Buffer.from(blake2b256(Uint8Array.from(bytesFromHex(hex)))).toString("hex");
  }

  escrowProgramProfile() {
    const { disasm } = this.load();
    const skeleton = disasm.skeletonInfo(ESCROW_SKELETON_NAME);
    if (!skeleton?.emitVerified) throw new Error("Vendored Kascov escrow skeleton failed its reproduction self-check");
    const manifest = {
      id: ESCROW_PROFILE_ID,
      version: 1,
      skeletonName: ESCROW_SKELETON_NAME,
      generator: "vendored-kascov-disasm-skeleton",
      generatorSha256: sha256Hex(fs.readFileSync(this.disasmFile)),
      blake2bSha256: sha256Hex(fs.readFileSync(this.blake2bFile)),
      parameters: (skeleton.params || []).map(({ name, kind, source }) => ({ name, kind, source })),
      emitVerified: true,
      contractSourceLinked: false
    };
    return {
      ...manifest,
      fingerprint: sha256Hex(JSON.stringify(manifest))
    };
  }

  verifyEscrowProgramProfile(expectedFingerprint) {
    const profile = this.escrowProgramProfile();
    if (!isHex32(expectedFingerprint) || normalizeHex(expectedFingerprint) !== profile.fingerprint) {
      const error = new Error("Covenant program profile fingerprint does not match the current vendored generator");
      error.code = "PROGRAM_PROFILE_MISMATCH";
      error.expectedFingerprint = normalizeHex(expectedFingerprint);
      error.actualFingerprint = profile.fingerprint;
      throw error;
    }
    return profile;
  }

  emitEscrowProgramHex({ arbiterHash, buyerPublicKey, sellerPublicKey }) {
    const buyer = normalizeXOnlyPublicKey(buyerPublicKey);
    const seller = normalizeXOnlyPublicKey(sellerPublicKey);
    if (!isHex32(arbiterHash) || !buyer || !seller) return "";
    const { disasm } = this.load();
    const emitted = disasm.emitFromSkeleton(ESCROW_SKELETON_NAME, {
      arbiter_hash: bytesFromHex(arbiterHash),
      buyer: bytesFromHex(buyer),
      seller: bytesFromHex(seller)
    });
    return emitted ? disasm.toHex(emitted) : "";
  }
}

module.exports = {
  ESCROW_PROFILE_ID,
  ESCROW_SKELETON_NAME,
  KascovTools,
  bytesFromHex
};
