# Mainnet Readiness

The target is a capped, closed-test product first, followed by audited
production use. Network selection alone is never evidence of readiness.

Run the non-mutating preflight before starting a mainnet service:

```bash
npm run mainnet:preflight
```

It exits non-zero and prints every blocker until network approval, the exact
program fingerprint, official compiler source/output verification, a stake cap
of at most 1 KAS, runner approval, executable hash pinning and the mainnet
capability probe all pass. It does not construct or
broadcast a transaction and does not read the settlement private key.

Build and pin the official compiler before generating the program fingerprint:

```bash
git clone https://github.com/kaspanet/silverscript.git
cd silverscript
git checkout 956868ea63a2af4176889f1331449b5f4f9e1df8
cargo build -p silverscript-lang --bin silverc --release
sha256sum target/release/silverc
```

Set `SILVERC_BIN` to that binary and
`KASPA_COVENANT_MAINNET_SILVERC_SHA256` to the recorded hash. The binary hash is
platform/build specific; generate the source-linked program fingerprint on the
same deployment artifact that will construct mainnet drafts.
`scripts/build-silverc.sh` and the `Mainnet artifacts build` workflow provide
the corresponding pinned local and Linux builds.

## Implemented closed-test guards

- explicit `allowMainnet` network approval;
- separate `mainnetProgramProfileApproved` program approval;
- official SilverScript Escrow source pinned to upstream commit `956868e...`;
- hash-pinned `silverc` compiler that recompiles every mainnet Escrow instance
  and must reproduce the generator byte-for-byte;
- exact source-linked program-profile fingerprint covering the compiler,
  source, generator, hash helper and parameter schema;
- SDK-enforced closed-test maximum of 1 KAS per player;
- settlement runner network allowlist, executable SHA-256 pin and non-mutating
  root/subcommand capability probes at service startup;
- reproducible mainnet runner patch that adds only
  `settle-escrow --network mainnet`, verifies the connected node network and
  leaves deployment/demo commands on TN10;
- wallet address/public-key ownership verification;
- signed transaction commitment comparison before signature merge and broadcast;
- exact winner-to-participant payout mapping with no fallback recipient;
- per-process settlement deduplication and completed-settlement reconciliation;
- atomic JSON ledger writes that fail closed on corruption;
- versioned canonical transcript hashes.

## Required before the first real-KAS closed test

- pin the exact SDK, kaspa-wasm, SilverScript/silverc, Kascov, kascov-lab and
  program-profile hashes;
- independently review the emitted escrow bytecode and both release paths;
- independently review `tools/kascov-mainnet-runner/kascov-mainnet.patch` and
  pin the Linux artifact produced by the workflow;
- verify timeout/refund behavior and document the recovery procedure;
- run adversarial signing tests with the supported wallet version;
- deploy a durable database-backed store and a single settlement worker;
- add monitoring for lock confirmation, settlement retries and balance drift;
- use a dedicated low-balance verifier key and rehearse key rotation;
- complete a 7-day TN10 soak with forced restarts and RPC failures.

## Required before public mainnet use

- independent contract and transaction-construction audit;
- database uniqueness/locking across multiple service processes;
- incident response, pause mechanism, backups and recovery runbook;
- staged limits with explicit operator approval for every increase.
