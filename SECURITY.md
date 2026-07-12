# Security Policy

This repository handles transaction construction and automated covenant
settlement. Do not disclose a suspected fund-loss issue in a public issue.

Report security findings privately to the repository owner through GitHub's
private vulnerability reporting flow. Include the affected version or commit,
network, transaction/covenant identifiers when safe to share, reproduction
steps, and the maximum amount at risk.

## Current support level

- TN10 is the default development and integration network.
- Mainnet is restricted to capped, closed testing behind two explicit guards.
- The vendored escrow program profile has not yet been declared independently
  audited; production-value mainnet use is not supported yet.

## Security invariants

- A wallet-signed transaction must match the approved unsigned draft except for
  signature scripts.
- A signer may only submit the input assigned to its wallet address.
- A winner address must exactly match one of the two escrow participants.
- A covenant may have at most one in-flight settlement per process.
- Corrupt ledger data must stop the service rather than silently reset history.
