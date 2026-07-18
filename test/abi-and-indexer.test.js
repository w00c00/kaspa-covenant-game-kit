"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ABI_PROFILES,
  CovenantEscrowEngine,
  KascovCovenantReader,
  KascovIndexerAdapter,
  assertWritableAbi,
  createCovenantDescriptor
} = require("../src");

test("descriptor ABI records the compiler provenance actually pinned by the writer", () => {
  const upstreamCommit = "77".repeat(20);
  const engine = new CovenantEscrowEngine({
    networkId: "tn10",
    silverc: {
      profileManifest: () => ({
        compiler: "silverc",
        compilerVersion: "0.1.0",
        compilerSha256: "88".repeat(32),
        upstreamCommit,
        sourceFileName: "escrow.sil",
        sourceSha256: "99".repeat(32),
        contractSourceLinked: true
      })
    }
  });

  assert.equal(engine.abi.compilerCommit, upstreamCommit);
  assert.equal(engine.abi.compilerSha256, "88".repeat(32));
  assert.equal(engine.abi.contractSourceSha256, "99".repeat(32));
});

test("descriptor pins the current SilverScript ABI instead of silently adopting the KCC1 draft", () => {
  const covenantId = "11".repeat(32);
  const descriptor = createCovenantDescriptor({
    id: "COVDESC-TEST",
    network: { id: "tn10", kaspaNetworkId: "testnet-10", kascovNetworkId: "testnet-10" },
    covenantId,
    programHash: "22".repeat(32),
    entrypoints: [{ name: "releaseBuyer", selector: 0 }]
  });

  assert.equal(descriptor.abi.id, "silverscript-v0");
  assert.equal(descriptor.abi.selectorEncoding, "entrypoint-index-scriptnum");
  assert.equal(assertWritableAbi(descriptor.abi).id, "silverscript-v0");
  assert.throws(() => assertWritableAbi(ABI_PROFILES["kcc1-draft-ac13bfb"]), /read-only/);
});

test("Kascov indexer scopes every read to a concrete network and 32-byte identity", async () => {
  const calls = [];
  const covenantId = "33".repeat(32);
  const txid = "44".repeat(32);
  const fakeFetch = async (url) => {
    calls.push(url);
    const payload = url.includes("/c/")
      ? { covenant_id: covenantId, network: "testnet-10", status: "burned", events: [{ kind: "burn", txid }] }
      : { txid, network: "testnet-10" };
    return { ok: true, status: 200, text: async () => JSON.stringify(payload) };
  };
  const indexer = new KascovIndexerAdapter({ networkId: "tn10", fetch: fakeFetch });
  const reader = new KascovCovenantReader({ indexer });
  const descriptor = createCovenantDescriptor({
    id: "COVDESC-READ",
    network: indexer.network,
    covenantId,
    entrypoints: []
  });

  const read = await reader.readCovenant(descriptor);
  const evidence = await indexer.observeSettlement({ covenantId, txid });
  assert.equal(read.verifiedIdentity, true);
  assert.equal(evidence.observed, true);
  assert.match(calls[0], /\/data\/testnet-10\/c\/[0-9a-f]{64}\.json$/);
  assert.throws(() => indexer.getCovenant("*"), /32-byte hex/);
});
