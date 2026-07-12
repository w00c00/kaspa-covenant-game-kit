"use strict";

const crypto = require("node:crypto");
const { SOMPI_PER_KAS } = require("./constants");

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value || "").digest("hex");
}

function normalizeHex(value) {
  return String(value || "").trim().replace(/^0x/i, "").toLowerCase();
}

function isHex32(value) {
  return /^(0x)?[0-9a-f]{64}$/i.test(String(value || "").trim());
}

function normalizeXOnlyPublicKey(value) {
  const hex = normalizeHex(value);
  if (/^[0-9a-f]{64}$/i.test(hex)) return hex;
  if (/^(02|03)[0-9a-f]{64}$/i.test(hex)) return hex.slice(2);
  return "";
}

function hasPublicKey(value) {
  return Boolean(normalizeXOnlyPublicKey(value));
}

function shortAddress(address, head = 15, tail = 8) {
  if (!address) return "not-connected";
  if (address.length <= head + tail + 3) return address;
  return `${address.slice(0, head)}...${address.slice(-tail)}`;
}

function kasToSompi(amountKas) {
  let text;
  if (typeof amountKas === "number") {
    if (!Number.isFinite(amountKas) || amountKas <= 0) throw new TypeError("KAS amount must be a positive decimal value");
    text = amountKas.toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
  } else {
    text = String(amountKas ?? "").trim();
  }
  const match = text.match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) throw new TypeError("KAS amount must be a positive decimal value");
  const fraction = match[2] || "";
  if (fraction.length > 8) throw new RangeError("KAS amount supports at most 8 decimal places");
  const sompi = BigInt(match[1]) * SOMPI_PER_KAS + BigInt((fraction + "00000000").slice(0, 8));
  if (sompi <= 0n) throw new RangeError("KAS amount must be greater than zero");
  return sompi;
}

function sompiToKas(sompi) {
  return Number(BigInt(sompi || 0n)) / Number(SOMPI_PER_KAS);
}

function safeJson(value) {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function nowIso() {
  return new Date().toISOString();
}

function explorerTxUrl(txid, network = {}) {
  const base = network.explorerApi || network.restApi || "";
  return txid && base ? `${base.replace(/\/$/, "")}/transactions/${encodeURIComponent(txid)}` : "";
}

function covenantStoryUrl(covenantId, network = {}) {
  const base = network.kascovExplorerBase || "";
  return /^[0-9a-f]{64}$/i.test(covenantId || "") && base ? `${base.replace(/\/$/, "")}/c/${covenantId}` : "";
}

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function randomId(prefix, bytes = 3) {
  return `${prefix}-${crypto.randomBytes(bytes).toString("hex").toUpperCase()}`;
}

module.exports = {
  assertObject,
  covenantStoryUrl,
  explorerTxUrl,
  hasPublicKey,
  isHex32,
  kasToSompi,
  normalizeHex,
  normalizeXOnlyPublicKey,
  nowIso,
  randomId,
  safeJson,
  sha256Hex,
  shortAddress,
  sompiToKas
};
