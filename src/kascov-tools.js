"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { isHex32, normalizeHex, normalizeXOnlyPublicKey } = require("./utils");

const DEFAULT_BLAKE2B_FILE = path.join(__dirname, "..", "vendor", "kascov-blake2b.js");
const DEFAULT_DISASM_FILE = path.join(__dirname, "..", "vendor", "kascov-disasm.js");

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

  emitEscrowProgramHex({ arbiterHash, buyerPublicKey, sellerPublicKey }) {
    const buyer = normalizeXOnlyPublicKey(buyerPublicKey);
    const seller = normalizeXOnlyPublicKey(sellerPublicKey);
    if (!isHex32(arbiterHash) || !buyer || !seller) return "";
    const { disasm } = this.load();
    const emitted = disasm.emitFromSkeleton("SilverScript · Escrow", {
      arbiter_hash: bytesFromHex(arbiterHash),
      buyer: bytesFromHex(buyer),
      seller: bytesFromHex(seller)
    });
    return emitted ? disasm.toHex(emitted) : "";
  }
}

module.exports = {
  KascovTools,
  bytesFromHex
};
