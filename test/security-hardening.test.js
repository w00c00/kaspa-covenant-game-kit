"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const kaspa = require("@kluster/kaspa-wasm");
const {
  CovenantEscrowEngine,
  DEFAULT_NETWORKS,
  JsonStore,
  KaspaCovenantGameKit,
  KascovLabAdapter,
  KascovTools,
  ProofBuilder,
  SettlementEngine,
  SILVERSCRIPT_ESCROW_SOURCE_SHA256,
  SilvercAdapter,
  TRANSCRIPT_VERSION,
  assessMainnetReadiness,
  kasToSompi,
  parseKascovLabSettle,
  resolveNetworkConfig,
  sha256Hex
} = require("../src");

const SOURCE_COMPILER_MANIFEST = Object.freeze({
  compiler: "silverc",
  compilerVersion: "0.1.0",
  compilerSha256: "77".repeat(32),
  compilerFileName: "silverc",
  compilerSize: 123,
  upstreamCommit: "956868ea63a2af4176889f1331449b5f4f9e1df8",
  sourceFileName: "escrow.sil",
  sourceSha256: SILVERSCRIPT_ESCROW_SOURCE_SHA256,
  contractSourceLinked: true
});

function fakeSilverc() {
  return {
    profileManifest: () => ({ ...SOURCE_COMPILER_MANIFEST }),
    healthCheck: async () => ({ ...SOURCE_COMPILER_MANIFEST, ready: true, testVectorProgramSha256: "88".repeat(32) }),
    verifyEscrow: async (_input, expectedProgramHex) => ({ programHex: expectedProgramHex })
  };
}

function linkedProgramFingerprint(tools = new KascovTools()) {
  return tools.escrowProgramProfile({ compilerManifest: SOURCE_COMPILER_MANIFEST }).fingerprint;
}

function fundedPlayer(transactionByte, networkId = "testnet-10") {
  const keypair = kaspa.Keypair.random();
  const address = keypair.toAddress(networkId).toString();
  return {
    keypair,
    address,
    utxo: {
      address,
      outpoint: { transactionId: transactionByte.repeat(64), index: 0 },
      amount: 1_000_000_000n,
      script: kaspa.payToAddressScript(address).script,
      blockDaaScore: 1n,
      isCoinbase: false
    }
  };
}

async function fixture() {
  const first = fundedPlayer("a");
  const second = fundedPlayer("b");
  const utxos = new Map([[first.address, first.utxo], [second.address, second.utxo]]);
  const engine = new CovenantEscrowEngine({
    networkId: "tn10",
    arbiter: { arbiterHash: new KascovTools().blake2b256Hex("33".repeat(32)) },
    fetchUtxos: async (address) => [utxos.get(address)].filter(Boolean),
    submitTransaction: async () => ({ transactionId: "f".repeat(64) })
  });
  const match = {
    id: "SECURITY-TEST",
    roomId: "SECURITY-TEST",
    roundId: "ROUND-1",
    game: "duel",
    stakeKas: "5.00000001",
    players: [first, second].map((player, seat) => ({
      seat,
      role: `player-${seat + 1}`,
      address: player.address,
      publicKey: player.keypair.xOnlyPublicKey
    }))
  };
  const draft = await engine.buildPlayerFundedDeployDraft(match);
  return { engine, first, second, match, draft };
}

test("KAS amounts convert to sompi without floating-point rounding", () => {
  assert.equal(kasToSompi("0.00000001"), 1n);
  assert.equal(kasToSompi("5.00000001"), 500_000_001n);
  assert.equal(kasToSompi(5), 500_000_000n);
  assert.throws(() => kasToSompi("0.000000001"), /decimal places/);
  assert.throws(() => kasToSompi("not-a-number"), /KAS amount/);
});

test("an escrow intent fails closed when its stake is missing or invalid", async () => {
  const { engine, match } = await fixture();
  const intent = engine.createIntent({ ...match, stakeKas: 0 });
  assert.equal(intent.status, "invalid-stake");
  assert.equal(intent.deployCommand, "");
});

test("Kascov settlement output parses both TN10 and mainnet currency labels", () => {
  const txid = "6".repeat(64);
  assert.equal(parseKascovLabSettle(`tx ${txid}\n(1.25 TKAS released)`).releasedKas, 1.25);
  assert.equal(parseKascovLabSettle(`tx ${txid}\n(0.5 KAS released)`).releasedKas, 0.5);
});

test("the vendored escrow generator exposes a reproducible program profile fingerprint", () => {
  const tools = new KascovTools();
  const profile = tools.escrowProgramProfile();
  assert.match(profile.fingerprint, /^[0-9a-f]{64}$/);
  assert.match(profile.generatorSha256, /^[0-9a-f]{64}$/);
  assert.equal(profile.contractSourceLinked, false);
  assert.equal(profile.emitVerified, true);
  const linked = tools.escrowProgramProfile({ compilerManifest: SOURCE_COMPILER_MANIFEST });
  assert.equal(linked.contractSourceLinked, true);
  assert.equal(linked.sourceCompiler.sourceSha256, SILVERSCRIPT_ESCROW_SOURCE_SHA256);
  assert.notEqual(linked.fingerprint, profile.fingerprint);
  assert.deepEqual(tools.verifyEscrowProgramProfile(profile.fingerprint), profile);
  assert.throws(() => tools.verifyEscrowProgramProfile("00".repeat(32)), (error) =>
    error.code === "PROGRAM_PROFILE_MISMATCH" && error.actualFingerprint === profile.fingerprint
  );
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "covenant-profile-"));
  try {
    const disasmFile = path.join(directory, "kascov-disasm.js");
    const blake2bFile = path.join(directory, "kascov-blake2b.js");
    fs.copyFileSync(path.join(__dirname, "..", "vendor", "kascov-disasm.js"), disasmFile);
    fs.copyFileSync(path.join(__dirname, "..", "vendor", "kascov-blake2b.js"), blake2bFile);
    fs.appendFileSync(disasmFile, "\n// fingerprint mutation test\n");
    const changed = new KascovTools({ disasmFile, blake2bFile }).escrowProgramProfile();
    assert.notEqual(changed.fingerprint, profile.fingerprint);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("the pinned official SilverScript compiler reproduces the escrow skeleton", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "silverc-adapter-"));
  const compiler = path.join(directory, "silverc");
  const source = path.join(__dirname, "..", "contracts", "escrow.sil");
  const tools = new KascovTools();
  const vector = {
    arbiterHash: "11".repeat(32),
    buyerPublicKey: "22".repeat(32),
    sellerPublicKey: "33".repeat(32)
  };
  const script = Array.from(Buffer.from(tools.emitEscrowProgramHex(vector), "hex"));
  const artifact = JSON.stringify({ contract_name: "Escrow", compiler_version: "0.1.0", script });
  try {
    fs.writeFileSync(compiler, `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(artifact)});\n`, { mode: 0o700 });
    const adapter = new SilvercAdapter({
      bin: compiler,
      sourceFile: source,
      expectedBinSha256: sha256Hex(fs.readFileSync(compiler))
    });
    const health = await adapter.healthCheck(tools);
    assert.equal(health.ready, true);
    assert.equal(health.sourceSha256, SILVERSCRIPT_ESCROW_SOURCE_SHA256);
    const compiled = await adapter.compileEscrow(vector);
    assert.equal(compiled.programHex, tools.emitEscrowProgramHex(vector));
    fs.appendFileSync(compiler, "// mutation\n");
    await assert.rejects(() => adapter.compileEscrow(vector), (error) => error.code === "SILVERC_HASH_MISMATCH");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("mainnet settlement runner requires an approved network, pinned binary and capability probe", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "covenant-runner-"));
  const runner = path.join(directory, "settlement-runner");
  try {
    fs.writeFileSync(runner, `#!/bin/sh
case "$*" in
  "--help") echo 'mainnet settle-escrow runner' ;;
  "settle-escrow --help") echo 'settle-escrow --network tn10 mainnet' ;;
  *) echo "$*" >&2; echo 'tx ${"6".repeat(64)}'; echo '(0.5 KAS released)' ;;
esac
`, { mode: 0o700 });
    const expectedBinSha256 = sha256Hex(fs.readFileSync(runner));
    const adapter = new KascovLabAdapter({
      bin: runner,
      expectedBinSha256,
      approvedNetworks: ["mainnet"]
    });
    const health = await adapter.healthCheck("mainnet");
    assert.equal(health.sha256, expectedBinSha256);
    assert.equal(health.mainnetCapable, true);
    const settled = await adapter.settleEscrow({
      programHex: "00",
      releaseTo: "buyer",
      covenantId: "11".repeat(32)
    });
    assert.equal(settled.txid, "6".repeat(64));
    assert.match(settled.stderr, /--network mainnet/);
    assert.throws(() => new KascovLabAdapter({
      bin: runner,
      expectedBinSha256: "00".repeat(32),
      approvedNetworks: ["mainnet"]
    }).assertApprovedForNetwork("mainnet"), (error) => error.code === "SETTLEMENT_RUNNER_HASH_MISMATCH");
    assert.throws(() => new KascovLabAdapter({
      bin: runner,
      expectedBinSha256,
      approvedNetworks: ["tn10"]
    }).assertApprovedForNetwork("mainnet"), (error) => error.code === "SETTLEMENT_RUNNER_NETWORK_NOT_APPROVED");
    assert.throws(() => new KascovLabAdapter({
      bin: runner,
      approvedNetworks: ["tn10"]
    }).assertApprovedForNetwork("testnet-11"), (error) => error.code === "SETTLEMENT_RUNNER_NETWORK_NOT_APPROVED");
    fs.writeFileSync(runner, "#!/bin/sh\necho 'settle-escrow testnet-10 only'\n", { mode: 0o700 });
    await assert.rejects(() => adapter.settleEscrow({
      programHex: "00",
      releaseTo: "buyer",
      covenantId: "11".repeat(32)
    }), (error) => error.code === "SETTLEMENT_RUNNER_HASH_MISMATCH");
    const tn10Only = new KascovLabAdapter({
      bin: runner,
      expectedBinSha256: sha256Hex(fs.readFileSync(runner)),
      approvedNetworks: ["mainnet"]
    });
    await assert.rejects(() => tn10Only.healthCheck("mainnet"), (error) =>
      error.code === "SETTLEMENT_RUNNER_MAINNET_CAPABILITY_MISSING"
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("mainnet preflight reports every blocker and becomes ready only with all closed-test gates", async () => {
  const missing = await assessMainnetReadiness({ env: {} });
  assert.equal(missing.ready, false);
  assert.ok(missing.blockers.length >= 5);
  const stringBooleans = await assessMainnetReadiness({
    env: {},
    allowMainnet: "false",
    programProfileApproved: "false",
    runnerApproved: "false"
  });
  assert.equal(stringBooleans.checks.find((check) => check.id === "network-approved").ok, false);
  assert.equal(stringBooleans.checks.find((check) => check.id === "program-approved").ok, false);
  assert.equal(stringBooleans.checks.find((check) => check.id === "runner-approved").ok, false);

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "covenant-preflight-"));
  const runnerPath = path.join(directory, "mainnet-runner");
  try {
    fs.writeFileSync(runnerPath, "#!/bin/sh\necho 'mainnet settle-escrow --network runner'\n", { mode: 0o700 });
    const tools = new KascovTools();
    const silverc = fakeSilverc();
    const report = await assessMainnetReadiness({
      env: {},
      allowMainnet: true,
      programProfileApproved: true,
      programProfileFingerprint: linkedProgramFingerprint(tools),
      maxStakeKas: "0.1",
      runnerApproved: true,
      runnerBin: runnerPath,
      runnerSha256: sha256Hex(fs.readFileSync(runnerPath)),
      kascovTools: tools,
      silverc
    });
    assert.equal(report.ready, true);
    assert.deepEqual(report.blockers, []);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("transcript hashes are versioned and stable across object key ordering", () => {
  const { canonicalTranscript, transcriptHash } = require("../src");
  const match = {
    id: "TRANSCRIPT-1",
    roomId: "ROOM-1",
    roundId: "ROUND-1",
    game: "duel",
    stakeKas: 1,
    players: [
      { seat: 1, role: "right", address: "right" },
      { seat: 0, role: "left", address: "left" }
    ]
  };
  const first = { winner: 0, result: "win", moves: [{ row: 2, col: 3 }] };
  const reordered = { moves: [{ col: 3, row: 2 }], result: "win", winner: 0 };
  assert.equal(canonicalTranscript(match, first).version, TRANSCRIPT_VERSION);
  assert.equal(canonicalTranscript(match, first).winner, 0);
  assert.equal(transcriptHash(match, first), transcriptHash(match, reordered));
  assert.notEqual(transcriptHash(match, first), transcriptHash({ ...match, roundId: "ROUND-2" }, first));
});

test("custom configurations that point at mainnet still require explicit approval", () => {
  assert.throws(() => resolveNetworkConfig({
    network: {
      id: "production",
      kaspaNetworkId: "mainnet",
      addressPrefix: "kaspa",
      isTestnet: false,
      restApi: "https://api.kaspa.org"
    }
  }), /Mainnet is disabled/);
  assert.throws(() => new CovenantEscrowEngine({ network: DEFAULT_NETWORKS.mainnet }), /Mainnet is disabled/);
  assert.throws(() => resolveNetworkConfig({ network: DEFAULT_NETWORKS.mainnet, allowMainnet: "false" }), /Mainnet is disabled/);
});

test("mainnet test mode enforces a small per-player stake cap by default", async () => {
  const first = fundedPlayer("c", "mainnet");
  const second = fundedPlayer("d", "mainnet");
  const silverc = fakeSilverc();
  const programProfileFingerprint = linkedProgramFingerprint();
  const engine = new CovenantEscrowEngine({
    network: DEFAULT_NETWORKS.mainnet,
    allowMainnet: true,
    mainnetProgramProfileApproved: true,
    mainnetProgramProfileFingerprint: programProfileFingerprint,
    silverc,
    arbiter: { arbiterHash: new KascovTools().blake2b256Hex("44".repeat(32)) },
    fetchUtxos: async () => []
  });
  await assert.rejects(() => engine.buildPlayerFundedDeployDraft({
    id: "MAINNET-CAP",
    roundId: "ROUND-1",
    game: "duel",
    stakeKas: "1.00000001",
    players: [first, second].map((player, seat) => ({
      seat,
      role: `player-${seat + 1}`,
      address: player.address,
      publicKey: player.keypair.xOnlyPublicKey
    }))
  }), /safety cap/);
  assert.throws(() => new CovenantEscrowEngine({
    network: DEFAULT_NETWORKS.mainnet,
    allowMainnet: true,
    mainnetMaxStakeKas: "1.00000001"
  }), (error) => error.code === "MAINNET_STAKE_CAP_INVALID");
  assert.throws(() => new CovenantEscrowEngine({
    network: DEFAULT_NETWORKS.mainnet,
    allowMainnet: true,
    maxStakeSompi: 100_000_001n
  }), (error) => error.code === "MAINNET_STAKE_CAP_INVALID");
});

test("mainnet draft building requires a separately approved covenant program profile", async () => {
  const first = fundedPlayer("e", "mainnet");
  const second = fundedPlayer("f", "mainnet");
  const engine = new CovenantEscrowEngine({
    network: DEFAULT_NETWORKS.mainnet,
    allowMainnet: true,
    silverc: fakeSilverc(),
    arbiter: { arbiterHash: new KascovTools().blake2b256Hex("55".repeat(32)) },
    fetchUtxos: async () => []
  });
  await assert.rejects(() => engine.buildPlayerFundedDeployDraft({
    id: "MAINNET-PROFILE",
    roundId: "ROUND-1",
    game: "duel",
    stakeKas: "0.1",
    players: [first, second].map((player, seat) => ({
      seat,
      role: `player-${seat + 1}`,
      address: player.address,
      publicKey: player.keypair.xOnlyPublicKey
    }))
  }), /profile approval or fingerprint is missing or mismatched/);
});

test("mainnet draft building refuses a generator-only profile without the official compiler", async () => {
  const first = fundedPlayer("7", "mainnet");
  const second = fundedPlayer("8", "mainnet");
  const tools = new KascovTools();
  const engine = new CovenantEscrowEngine({
    network: DEFAULT_NETWORKS.mainnet,
    allowMainnet: true,
    mainnetProgramProfileApproved: true,
    mainnetProgramProfileFingerprint: tools.escrowProgramProfile().fingerprint,
    arbiter: { arbiterHash: tools.blake2b256Hex("77".repeat(32)) },
    fetchUtxos: async () => []
  });
  await assert.rejects(() => engine.buildPlayerFundedDeployDraft({
    id: "MAINNET-NO-COMPILER",
    roundId: "ROUND-1",
    game: "duel",
    stakeKas: "0.1",
    players: [first, second].map((player, seat) => ({
      seat,
      role: `player-${seat + 1}`,
      address: player.address,
      publicKey: player.keypair.xOnlyPublicKey
    }))
  }), (error) => error.code === "MAINNET_SOURCE_COMPILER_REQUIRED");
});

test("mainnet rejects an approval for a different program profile fingerprint", async () => {
  const first = fundedPlayer("1", "mainnet");
  const second = fundedPlayer("2", "mainnet");
  const engine = new CovenantEscrowEngine({
    network: DEFAULT_NETWORKS.mainnet,
    allowMainnet: true,
    mainnetProgramProfileApproved: true,
    mainnetProgramProfileFingerprint: "00".repeat(32),
    silverc: fakeSilverc(),
    arbiter: { arbiterHash: new KascovTools().blake2b256Hex("66".repeat(32)) },
    fetchUtxos: async () => []
  });
  await assert.rejects(() => engine.buildPlayerFundedDeployDraft({
    id: "MAINNET-PROFILE-MISMATCH",
    roundId: "ROUND-1",
    game: "duel",
    stakeKas: "0.1",
    players: [first, second].map((player, seat) => ({
      seat,
      role: `player-${seat + 1}`,
      address: player.address,
      publicKey: player.keypair.xOnlyPublicKey
    }))
  }), (error) => error.code === "MAINNET_PROGRAM_PROFILE_NOT_APPROVED" && error.actualFingerprint !== error.expectedFingerprint);
});

test("an unknown winner can never fall back to either payout path", async () => {
  const { engine, match } = await fixture();
  const record = { buyer: match.players[0], seller: match.players[1] };
  assert.throws(() => engine.releaseSideForWinner(record, "kaspatest:unknown"), /winner/i);
});

test("SDK rejects a signature submission that claims another player's input", async () => {
  const { engine, first, match, draft } = await fixture();
  const kit = new KaspaCovenantGameKit({ escrowEngine: engine });
  assert.throws(() => kit.submitPlayerSignature({
    match,
    draft,
    address: first.address,
    signerInputIndex: 1,
    signedTransactionSafeJson: draft.unsignedTransactionSafeJson
  }), /does not match signer input/i);
});

test("draft building rejects a public key that does not belong to the declared wallet", async () => {
  const { engine, match } = await fixture();
  const forged = structuredClone(match);
  forged.players[0].publicKey = kaspa.Keypair.random().xOnlyPublicKey;
  await assert.rejects(() => engine.buildPlayerFundedDeployDraft(forged), /public key does not belong/i);
});

test("signature merging rejects wallet transactions that mutate the original draft", async () => {
  const { engine, first, draft } = await fixture();
  const signed = kaspa.signTransaction(
    kaspa.Transaction.deserializeFromSafeJSON(draft.unsignedTransactionSafeJson),
    [first.keypair.privateKey],
    false
  ).serializeToSafeJSON();
  const changed = JSON.parse(signed);
  changed.outputs[0].value = String(BigInt(changed.outputs[0].value) - 1n);
  const merge = engine.mergePlayerSignedTransactions(draft.unsignedTransactionSafeJson, [{
    address: first.address,
    signerInputIndex: 0,
    signedTransactionSafeJson: JSON.stringify(changed)
  }], 2, draft.signers);
  assert.equal(merge.complete, false);
  assert.equal(merge.signedIndexes.length, 0);
  assert.match(merge.error, /does not match the unsigned draft/i);
});

test("broadcast refuses a signed transaction whose outputs differ from the stored draft", async () => {
  const { engine, first, second, match, draft } = await fixture();
  const signatures = [first, second].map((player, signerInputIndex) => ({
    address: player.address,
    signerInputIndex,
    signedTransactionSafeJson: kaspa.signTransaction(
      kaspa.Transaction.deserializeFromSafeJSON(draft.unsignedTransactionSafeJson),
      [player.keypair.privateKey],
      false
    ).serializeToSafeJSON()
  }));
  const merge = engine.mergePlayerSignedTransactions(draft.unsignedTransactionSafeJson, signatures, 2, draft.signers);
  assert.equal(merge.complete, true);
  const changed = JSON.parse(merge.mergedSignedTransactionSafeJson);
  changed.outputs[0].value = String(BigInt(changed.outputs[0].value) - 1n);
  await assert.rejects(() => engine.broadcastSignedCovenant(match, JSON.stringify(changed), {
    unsignedTransactionSafeJson: draft.unsignedTransactionSafeJson,
    covenantId: draft.covenantId,
    signers: draft.signers
  }), /does not match the approved draft/i);
  const deployed = await engine.broadcastSignedCovenant(match, merge.mergedSignedTransactionSafeJson, {
    unsignedTransactionSafeJson: draft.unsignedTransactionSafeJson,
    covenantId: draft.covenantId,
    signers: draft.signers
  });
  assert.equal(deployed.status, "deployed-player-funded-on-chain");
  assert.equal(deployed.deploy.txid, "f".repeat(64));
});

test("concurrent and repeated winner settlement runs only once per covenant", async () => {
  const store = new JsonStore();
  const engine = new CovenantEscrowEngine({ store, network: DEFAULT_NETWORKS.tn10 });
  const proofBuilder = new ProofBuilder({ network: DEFAULT_NETWORKS.tn10, contractSource: "contract Test {}" });
  let calls = 0;
  const settlementEngine = new SettlementEngine({
    escrowEngine: engine,
    proofBuilder,
    store,
    kascovLab: {
      async settleEscrow() {
        calls += 1;
        await new Promise((resolve) => setImmediate(resolve));
        return { txid: "9".repeat(64), releasedKas: 10 };
      }
    }
  });
  const match = {
    id: "IDEMPOTENT-MATCH",
    roundId: "ROUND-1",
    game: "duel",
    stakeKas: 5,
    players: [
      { seat: 0, role: "buyer", address: "buyer" },
      { seat: 1, role: "seller", address: "seller" }
    ]
  };
  store.upsertEscrow({
    id: engine.escrowId(match),
    matchId: match.id,
    roundId: match.roundId,
    programHex: "00",
    status: "deployed-player-funded-on-chain",
    buyer: match.players[0],
    seller: match.players[1],
    deploy: { covenantId: "8".repeat(64), txid: "7".repeat(64) }
  });

  const [first, second] = await Promise.all([
    settlementEngine.settleWinner({ match, winnerAddress: "seller" }),
    settlementEngine.settleWinner({ match, winnerAddress: "seller" })
  ]);
  const repeated = await settlementEngine.settleWinner({ match, winnerAddress: "seller" });
  assert.equal(calls, 1);
  assert.equal(first.settlement.id, second.settlement.id);
  assert.equal(repeated.settlement.id, first.settlement.id);
  assert.equal(repeated.settlement.status, "settled-on-chain");
});

test("JsonStore writes atomically and refuses to silently erase a corrupt ledger", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "covenant-store-"));
  const file = path.join(directory, "ledger.json");
  try {
    const store = new JsonStore(file);
    store.upsertEscrow({ id: "ESCROW-1", status: "draft" });
    const loaded = new JsonStore(file);
    assert.equal(loaded.listEscrows()[0].id, "ESCROW-1");
    assert.deepEqual(fs.readdirSync(directory), ["ledger.json"]);
    fs.writeFileSync(file, "{not-json");
    assert.throws(() => new JsonStore(file), /Unable to load covenant store/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
