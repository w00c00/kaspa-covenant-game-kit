"use strict";

const { isHex32, nowIso, randomId } = require("./utils");

const DEFAULT_ABI_PROFILE = "silverscript-v0";

const ABI_PROFILES = Object.freeze({
  "silverscript-v0": Object.freeze({
    id: "silverscript-v0",
    version: 0,
    status: "current-experimental",
    selectorEncoding: "entrypoint-index-scriptnum",
    templateHash: "blake2b-256-length-bound",
    compilerRepository: "https://github.com/kaspanet/silverscript",
    compilerCommit: "9aa70b0d0215e7395e2a95b78472eba0a5b103a5b",
    transactionWriterReady: true
  }),
  "kcc1-draft-ac13bfb": Object.freeze({
    id: "kcc1-draft-ac13bfb",
    version: 1,
    status: "draft-incompatible",
    selectorEncoding: "blake3-signature-prefix-4",
    templateHash: "blake3-256-length-bound",
    specificationRepository: "https://github.com/IzioDev/kccs",
    specificationCommit: "ac13bfb6b95cf0e82ee757103b0f1d20fcdc8214",
    transactionWriterReady: false
  })
});

function resolveAbiProfile(profile = DEFAULT_ABI_PROFILE) {
  if (profile && typeof profile === "object") {
    if (!profile.id) throw new Error("Custom ABI profile requires an id");
    return Object.freeze({ ...profile });
  }
  const resolved = ABI_PROFILES[String(profile || DEFAULT_ABI_PROFILE)];
  if (!resolved) throw new Error(`Unsupported covenant ABI profile: ${profile}`);
  return resolved;
}

function assertWritableAbi(profile) {
  const resolved = resolveAbiProfile(profile);
  if (!resolved.transactionWriterReady) {
    throw new Error(
      `Covenant ABI ${resolved.id} is read-only in this SDK. Its selector/template-hash rules are incompatible with the current SilverScript writer.`
    );
  }
  return resolved;
}

function validateCovenantDescriptor(descriptor) {
  if (!descriptor || typeof descriptor !== "object" || Array.isArray(descriptor)) {
    throw new TypeError("Covenant descriptor must be an object");
  }
  if (!descriptor.id) throw new Error("Covenant descriptor id is required");
  if (!descriptor.network?.id || !descriptor.network?.kaspaNetworkId) {
    throw new Error("Covenant descriptor network.id and network.kaspaNetworkId are required");
  }
  resolveAbiProfile(descriptor.abi);
  if (descriptor.covenantId && !isHex32(descriptor.covenantId)) {
    throw new Error("Covenant descriptor covenantId must be 32-byte hex");
  }
  if (descriptor.programHash && !isHex32(descriptor.programHash)) {
    throw new Error("Covenant descriptor programHash must be 32-byte hex");
  }
  if (!Array.isArray(descriptor.entrypoints)) throw new Error("Covenant descriptor entrypoints must be an array");
  return descriptor;
}

function createCovenantDescriptor(options = {}) {
  const abi = resolveAbiProfile(options.abi || options.abiProfile);
  const network = options.network || {};
  const descriptor = {
    id: options.id || randomId("COVDESC"),
    schema: "kaspa-covenant-descriptor",
    schemaVersion: 1,
    contract: options.contract || options.contractName || "SilverScript · Escrow",
    network: {
      id: network.id || "tn10",
      kaspaNetworkId: network.kaspaNetworkId || "testnet-10",
      kascovNetworkId: network.kascovNetworkId || "testnet-10"
    },
    abi,
    covenantId: options.covenantId || "",
    programHash: options.programHash || "",
    stateLayout: Array.isArray(options.stateLayout) ? options.stateLayout : [],
    entrypoints: Array.isArray(options.entrypoints) ? options.entrypoints : [],
    metadata: options.metadata && typeof options.metadata === "object" ? { ...options.metadata } : {},
    createdAt: options.createdAt || nowIso()
  };
  return validateCovenantDescriptor(descriptor);
}

module.exports = {
  ABI_PROFILES,
  DEFAULT_ABI_PROFILE,
  assertWritableAbi,
  createCovenantDescriptor,
  resolveAbiProfile,
  validateCovenantDescriptor
};
