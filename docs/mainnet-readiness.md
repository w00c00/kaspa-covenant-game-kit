# Mainnet Readiness

The target is a capped, closed-test product first, followed by audited
production use. Network selection alone is never evidence of readiness.

Run the non-mutating preflight before starting a mainnet service:

```bash
npm run mainnet:preflight
```

It exits non-zero and prints every blocker until network approval, the exact
program fingerprint, a stake cap of at most 1 KAS, runner approval, executable
hash pinning and the mainnet capability probe all pass. It does not construct or
broadcast a transaction and does not read the settlement private key.

## Implemented closed-test guards

- explicit `allowMainnet` network approval;
- separate `mainnetProgramProfileApproved` program approval;
- exact pinned program-profile fingerprint covering the generator, hash helper
  and parameter schema;
- SDK-enforced closed-test maximum of 1 KAS per player;
- settlement runner network allowlist, executable SHA-256 pin and non-mutating
  `--help` capability probe at service startup;
- wallet address/public-key ownership verification;
- signed transaction commitment comparison before signature merge and broadcast;
- exact winner-to-participant payout mapping with no fallback recipient;
- per-process settlement deduplication and completed-settlement reconciliation;
- atomic JSON ledger writes that fail closed on corruption;
- versioned canonical transcript hashes.

## Required before the first real-KAS closed test

- pin the exact SDK, kaspa-wasm, Kascov, kascov-lab and program-profile hashes;
- independently review the emitted escrow bytecode and both release paths;
- verify timeout/refund behavior and document the recovery procedure;
- run adversarial signing tests with the supported wallet version;
- deploy a durable database-backed store and a single settlement worker;
- add monitoring for lock confirmation, settlement retries and balance drift;
- use a dedicated low-balance verifier key and rehearse key rotation;
- complete a 7-day TN10 soak with forced restarts and RPC failures.

## Required before public mainnet use

- reproducible SilverScript compiler pipeline linking source to `programHex`;
- independent contract and transaction-construction audit;
- database uniqueness/locking across multiple service processes;
- incident response, pause mechanism, backups and recovery runbook;
- staged limits with explicit operator approval for every increase.
