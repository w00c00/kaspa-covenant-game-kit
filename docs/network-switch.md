# TN10 / Mainnet Switch

The SDK uses one code path for TN10 and mainnet. Select the target network with
`networkId` or environment variables.

## Default TN10

```js
const { KaspaCovenantGameKit } = require("kaspa-covenant-game-kit");

const kit = new KaspaCovenantGameKit({
  networkId: "tn10",
  adapter: myGame,
  arbiter
});
```

Environment version:

```bash
KASPA_COVENANT_NETWORK=tn10
```

## Mainnet

Mainnet uses the same SDK API, but it is guarded because it spends real KAS.

```js
const kit = new KaspaCovenantGameKit({
  networkId: "mainnet",
  allowMainnet: true,
  // Enable only after reviewing and pinning the generated escrow program profile.
  mainnetProgramProfileApproved: true,
  mainnetProgramProfileFingerprint: process.env.KASPA_COVENANT_MAINNET_PROGRAM_FINGERPRINT,
  silvercBin: process.env.SILVERC_BIN,
  silvercExpectedSha256: process.env.KASPA_COVENANT_MAINNET_SILVERC_SHA256,
  // Closed mainnet testing defaults to at most 1 KAS per player.
  mainnetMaxStakeKas: "1",
  adapter: myGame,
  arbiter
});
```

Environment version:

```bash
KASPA_COVENANT_NETWORK=mainnet
KASPA_COVENANT_ALLOW_MAINNET=true
KASPA_COVENANT_MAINNET_MAX_STAKE_KAS=1
KASPA_COVENANT_MAINNET_PROGRAM_APPROVED=true
KASPA_COVENANT_MAINNET_PROGRAM_FINGERPRINT=<reviewed-profile-fingerprint>
SILVERC_BIN=/absolute/path/to/silverc
KASPA_COVENANT_MAINNET_SILVERC_SHA256=<reviewed-compiler-sha256>
```

## Runtime Switch

```js
const kit = new KaspaCovenantGameKit({
  networkId: process.env.KASPA_COVENANT_NETWORK || "tn10",
  allowMainnet: process.env.KASPA_COVENANT_ALLOW_MAINNET === "true",
  adapter: myGame,
  arbiter
});
```

The adapter, match shape, escrow intent, signature collection, settlement, and
proof APIs stay the same. Only the network preset changes:

- address prefix: `kaspatest:` vs `kaspa:`
- REST / wRPC target network
- explorer and Kascov Explorer links
- Kascov CLI network: `testnet-10` vs `mainnet`
- Kascov live data feed: `/data/testnet-10-live.json` vs `/data/mainnet-live.json`
- display symbol: `TKAS` vs `KAS`

## Kascov Mapping

Kascov itself supports both TN10 and mainnet. The SDK keeps that mapping
explicit so game projects do not mix networks:

| SDK `networkId` | Kaspa network id | Kascov CLI network | Kascov Explorer base |
| --- | --- | --- | --- |
| `tn10` | `testnet-10` | `testnet-10` | `https://kascov.io/share/testnet-10` |
| `mainnet` | `mainnet` | `mainnet` | `https://kascov.io/share/mainnet` |

```js
const { kascovTraceCommand } = require("kaspa-covenant-game-kit");

console.log(kascovTraceCommand(covenantId, kit.network));
// tn10:    kascov --network testnet-10 trace <id>
// mainnet: kascov --network mainnet trace <id>
```

`Kascov Explorer` and `kascov` CLI are network-aware for both TN10 and mainnet.
`kascov-lab` remains a replaceable settlement runner in this SDK, because apps
may use different production settlement infrastructure while keeping the same
proof and network mapping.

## Endpoint Overrides

```bash
KASPA_TN10_REST_API=https://api-tn10.kaspa.org
KASPA_TN10_KASCOV_NETWORK=testnet-10
KASPA_MAINNET_REST_API=https://api.kaspa.org
KASPA_MAINNET_KASCOV_NETWORK=mainnet
KASPA_MAINNET_KASCOV_EXPLORER=https://kascov.io/share/mainnet
```

## Production Checklist

Before enabling mainnet in a user-facing app:

- verify wallet support for the covenant signing draft on mainnet;
- pin and record the SilverScript / kascov-lab version used;
- test with tiny KAS amounts first;
- keep timeout and refund paths visible to users;
- run independent review for contract bytecode and settlement behavior.

`allowMainnet` only unlocks the network configuration. Draft construction has a
second guard, `mainnetProgramProfileApproved`, requires the exact current
`mainnetProgramProfileFingerprint`, and the SDK enforces a hard closed-test cap
of 1 KAS per player. Mainnet also requires a hash-pinned official `silverc`
binary. Every instance is compiled from `contracts/escrow.sil` and compared
byte-for-byte with the deterministic generator before a wallet draft is built.

Set `SILVERC_BIN` and `KASPA_COVENANT_MAINNET_SILVERC_SHA256`, then run
`node examples/program-profile.js` to print the source-linked manifest. Review
and record the compiler, source, generator hashes and parameters before copying
its fingerprint into a mainnet environment. Any compiler, source or generator
change invalidates the previous approval.
