# Kaspa Covenant Game Kit

SDK-style modules for building Kaspa TN10 / mainnet SilverScript covenant-backed games.

中文：这是一个面向开发者的 Kaspa covenant 游戏 SDK 雏形。它把“游戏规则”和“链上托管结算”拆开，让不同游戏只需要实现一个很薄的 adapter，就能复用押注锁定、签名、广播、结算和凭证展示这套流程。

> Experimental: TN10 is the default. Mainnet uses the same SDK path, but requires an explicit switch because it spends real KAS.

> Mainnet safety: `allowMainnet` only enables the network preset. Building a
> mainnet funding draft additionally requires `mainnetProgramProfileApproved`
> plus the exact reviewed, source-linked profile fingerprint. The SDK recompiles
> every mainnet Escrow instance with a hash-pinned official `silverc` binary and
> rejects any byte difference. Closed-test builds enforce a hard
> maximum of 1 KAS per player. This is for closed testing, not
> a claim that the covenant program has completed an independent audit.

## What This SDK Does

- Creates a two-player, player-funded covenant escrow intent on TN10 or mainnet.
- Builds Toccata v1 covenant transaction drafts for wallet signing.
- Merges player signatures and broadcasts signed covenant transactions.
- Maps a game winner to the covenant release path, currently `buyer` or `seller`.
- Settles through a pluggable settlement runner, with `kascov-lab settle-escrow` supported for the current lab flow.
- Generates readable proof data: covenant id, lock tx, settlement tx, winner, amount, release path, and Kascov Explorer URL.
- Emits versioned Covenant descriptors that pin network, ABI, compiler provenance, program identity, and entrypoints.
- Separates `Reader`, `Writer`, and `Indexer` boundaries, including Kascov settlement-evidence refresh.
- Provides a Gomoku adapter and a custom adapter example.

## 中文说明

这个 SDK 目前专注 **1v1 游戏**：

- 游戏项目负责：房间、玩家、规则、胜负、前端体验。
- SDK 负责：TN10 covenant 托管、钱包签名草案、结算路径、链上结算、凭据。
- SDK 同时提供版本化 Descriptor，以及独立的 Reader / Writer / Indexer 接口；Kascov 只作为可验证索引证据，不参与胜负或资金共识。
- 新游戏只要实现 `toMatch(room, state)`，就可以接入最小流程。
- 如果还实现 `createState / applyMove / getWinnerAddress`，就能获得更完整的 adapter 体验。

## Install

Use from GitHub for now:

```bash
npm install github:w00c00/kaspa-covenant-game-kit
```

Local development:

```bash
npm install
npm test
```

## Quick Start

```js
const { KaspaCovenantGameKit } = require("kaspa-covenant-game-kit");
const myGame = require("./my-game-adapter");

const kit = new KaspaCovenantGameKit({
  networkId: process.env.KASPA_COVENANT_NETWORK || "tn10",
  allowMainnet: process.env.KASPA_COVENANT_ALLOW_MAINNET === "true",
  adapter: myGame,
  arbiter: {
    address: process.env.ARBITER_ADDRESS,
    publicKey: process.env.ARBITER_PUBLIC_KEY,
    arbiterHash: process.env.ARBITER_HASH
  },
  contractFile: "./contracts/escrow.sil"
});

const state = kit.createState("my-game");
const match = kit.toMatch({ game: "my-game", room, state });
const intent = kit.createEscrowIntent({ match });
```

## Network Switch

Default TN10:

```bash
KASPA_COVENANT_NETWORK=tn10
PUBLIC_ORIGINS=https://game.example.com
```

Mainnet, same API, explicit confirmation:

```bash
KASPA_COVENANT_NETWORK=mainnet
KASPA_COVENANT_ALLOW_MAINNET=true
KASPA_COVENANT_MAINNET_PROGRAM_APPROVED=true
KASPA_COVENANT_MAINNET_PROGRAM_FINGERPRINT=<64-char-reviewed-profile-fingerprint>
SILVERC_BIN=/absolute/path/to/silverc
KASPA_COVENANT_MAINNET_SILVERC_SHA256=<64-char-reviewed-compiler-sha256>
KASPA_COVENANT_MAINNET_SETTLEMENT_RUNNER_APPROVED=true
KASPA_COVENANT_MAINNET_SETTLEMENT_RUNNER_SHA256=<64-char-reviewed-runner-sha256>
KASCOV_LAB_JOURNAL_DIR=/absolute/private/data/settlement-journal
PUBLIC_ORIGINS=https://game.example.com
KASPA_COVENANT_MAINNET_MAX_STAKE_KAS=1
```

Direct constructor usage:

```js
const tn10Kit = new KaspaCovenantGameKit({ networkId: "tn10", adapter: myGame, arbiter });

const mainnetKit = new KaspaCovenantGameKit({
  networkId: "mainnet",
  allowMainnet: true,
  mainnetProgramProfileApproved: true,
  mainnetProgramProfileFingerprint: process.env.KASPA_COVENANT_MAINNET_PROGRAM_FINGERPRINT,
  silvercBin: process.env.SILVERC_BIN,
  silvercExpectedSha256: process.env.KASPA_COVENANT_MAINNET_SILVERC_SHA256,
  mainnetMaxStakeKas: "1",
  adapter: myGame,
  arbiter
});
```

The adapter, `match` shape, escrow intent, signature collection, settlement,
and proof APIs stay the same. The preset changes address prefixes, network id,
REST / wRPC targets, explorer links, and display symbol.

More detail: [docs/network-switch.md](docs/network-switch.md)

Mainnet security gates: [docs/mainnet-readiness.md](docs/mainnet-readiness.md)

After configuring the reviewed program and runner, execute the read-only gate:

```bash
npm run mainnet:preflight
```

With the pinned official compiler configured, print the exact source-linked
manifest and fingerprint that must be reviewed before a mainnet draft can be
built:

```bash
node examples/program-profile.js
```

The profile pins SilverScript commit
`956868ea63a2af4176889f1331449b5f4f9e1df8`, the official Escrow source hash,
the local `silverc` executable hash, and the reproduced program generator.
Without `SILVERC_BIN` and its matching SHA-256, the command exits non-zero and
the SDK will not approve a mainnet funding draft.

Mainnet settlement runners are independently guarded: the executable SHA-256
must be pinned, `mainnet` must be in its approved-network list, and a read-only
startup probe must confirm that the runner advertises mainnet `settle-escrow`
support. The bundled snooker `kascov-lab` currently advertises testnet-10 only.
The reproducible, settlement-only mainnet patch and Linux artifact workflow are
documented in [`tools/kascov-mainnet-runner`](tools/kascov-mainnet-runner/README.md);
its binary still requires independent review and explicit hash approval.

## Adapter Contract

Minimum adapter:

```js
module.exports = {
  name: "my-game",

  toMatch(room, state) {
    return {
      id: room.id,
      roundId: state.roundId,
      game: "my-game",
      stakeKas: room.stakeKas,
      players: [
        { seat: 0, role: "black", address: "...", publicKey: "..." },
        { seat: 1, role: "white", address: "...", publicKey: "..." }
      ]
    };
  }
};
```

Recommended adapter:

```js
module.exports = {
  name: "my-game",
  createState(options) {},
  toMatch(room, state) {},
  applyMove(match, state, move) {},
  getWinnerAddress(match, state) {
    return state.winnerAddress;
  }
};
```

More detail: [docs/adapter.md](docs/adapter.md)

## Common Flow

```js
const draft = await kit.buildDeployDraft({ match });

await kit.submitPlayerSignature({
  match,
  draft,
  address: player.address,
  signerInputIndex: 0,
  signResult
});

const result = await kit.settleWinner({
  match,
  state,
  winnerAddress: state.winnerAddress,
  reason: "game-win"
});
```

Broadcast and index evidence are separate. Applications can refresh Kascov evidence without treating the explorer as consensus:

```js
const refreshed = await kit.refreshSettlement(result.settlement.id);
console.log(refreshed.confirmationStatus); // pending-indexer | confirmed-by-indexer
```

`draft.descriptor.abi` pins the ABI and the compiler provenance actually used by the writer. The incompatible KCC1 BLAKE3 draft remains read-only and is rejected by the current transaction writer.

More detail: [docs/integration-flow.md](docs/integration-flow.md)

## Core Exports

- `KaspaCovenantGameKit`: high-level SDK facade.
- `CovenantEscrowEngine`: low-level escrow intent, draft, signature, broadcast engine.
- `SettlementEngine`: winner settlement engine.
- `CovenantReader / CovenantWriter / CovenantIndexer`: stable chain integration boundaries.
- `KascovIndexerAdapter`: network-scoped Kascov reads, polling, and settlement evidence.
- `createCovenantDescriptor / ABI_PROFILES`: versioned ABI and program identity metadata.
- `ProofBuilder`: proof and visible settlement builder.
- `KascovLabAdapter`: wrapper around `kascov-lab`.
- `JsonStore`: simple local storage adapter.
- `adapters.gomoku`: reference game adapter.

## Examples

```bash
node examples/memory-gomoku-flow.js
node examples/custom-game-adapter.js
```

## Status

- SDK package: `0.2.0` developer preview.
- TN10: default active experimental path.
- Mainnet: same SDK path, production-guarded behind `allowMainnet`.
- Game mode: two-player escrow first.
- Wallet surface: compatible wallets need public key access and signing support for the covenant draft.
- Kascov network support: presets include both `testnet-10` and `mainnet` for Explorer / CLI proof links.
- Settlement adapter: pluggable. `kascov-lab` is wired as the current lab runner; production apps can provide a mainnet-capable runner with the same adapter interface.

## Credits

Thanks to:

- Kaspa: https://kaspa.org
- Kaspa Docs / Toccata: https://docs.kaspa.org/toccata
- SilverScript: https://github.com/kaspanet/silverscript
- Kascov and Kascov Lab: https://github.com/Knitser/kascov
- Kascov Explorer: https://kascov.io
- Kasware wallet: https://www.kasware.xyz

## License

MIT. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
