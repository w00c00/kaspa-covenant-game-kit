# Reviewed-mainnet runner build

The upstream `kascov-lab` at commit
`fdc0396aaa990e72b8b81c5f459650bcec4041e9` is intentionally TN10-only. This
directory contains the minimal reviewed patch used by the game kit to build a
mainnet-capable settlement runner without enabling mainnet deployment or demo
commands.

The patch:

- adds `settle-escrow --network tn10|mainnet`;
- checks the connected node reports the requested network;
- derives the arbiter, P2SH and buyer/seller addresses with the selected
  network prefix;
- prints the correct KAS/TKAS symbol and network-specific Kascov link;
- leaves every other lab command on TN10.

Build from the pinned upstream commit:

```bash
scripts/build-mainnet-runner.sh "$PWD/dist/kascov-lab"
```

The script runs all `kascov-labkit` offline contract-engine tests, builds a
release binary, checks both help surfaces and prints its SHA-256. Linux release
artifacts can also be produced by the `Mainnet runner build` GitHub Actions
workflow.

This runner is still a closed-test artifact. Before it is approved in a
mainnet environment, independently review the patch and binary hash, run
`settle-escrow --network mainnet --dry-run` against the exact deployed Escrow,
and keep the verifier key balance limited to fees.
