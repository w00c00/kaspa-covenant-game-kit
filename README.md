# Kaspa Covenant Game Kit

SDK-style modules for building Kaspa TN10 / mainnet SilverScript covenant-backed games.

中文：这是一个面向开发者的 Kaspa covenant 游戏 SDK 雏形。它把“游戏规则”和“链上托管结算”拆开，让不同游戏只需要实现一个很薄的 adapter，就能复用押注锁定、签名、广播、结算和凭证展示这套流程。

> Experimental: TN10 is the default. Mainnet uses the same SDK path, but requires an explicit switch because it spends real KAS.

## What This SDK Does

- Creates a two-player, player-funded covenant escrow intent on TN10 or mainnet.
- Builds Toccata v1 covenant transaction drafts for wallet signing.
- Merges player signatures and broadcasts signed covenant transactions.
- Maps a game winner to the covenant release path, currently `buyer` or `seller`.
- Settles through `kascov-lab settle-escrow` when configured.
- Generates readable proof data: covenant id, lock tx, settlement tx, winner, amount, release path, and Kascov Explorer URL.
- Provides a Gomoku adapter and a custom adapter example.

## 中文说明

这个 SDK 目前专注 **1v1 游戏**：

- 游戏项目负责：房间、玩家、规则、胜负、前端体验。
- SDK 负责：TN10 covenant 托管、钱包签名草案、结算路径、链上结算、凭据。
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
  contractFile: "./contracts/gomoku_escrow.sil"
});

const state = kit.createState("my-game");
const match = kit.toMatch({ game: "my-game", room, state });
const intent = kit.createEscrowIntent({ match });
```

## Network Switch

Default TN10:

```bash
KASPA_COVENANT_NETWORK=tn10
```

Mainnet, same API, explicit confirmation:

```bash
KASPA_COVENANT_NETWORK=mainnet
KASPA_COVENANT_ALLOW_MAINNET=true
```

Direct constructor usage:

```js
const tn10Kit = new KaspaCovenantGameKit({ networkId: "tn10", adapter: myGame, arbiter });

const mainnetKit = new KaspaCovenantGameKit({
  networkId: "mainnet",
  allowMainnet: true,
  adapter: myGame,
  arbiter
});
```

The adapter, `match` shape, escrow intent, signature collection, settlement,
and proof APIs stay the same. The preset changes address prefixes, network id,
REST / wRPC targets, explorer links, and display symbol.

More detail: [docs/network-switch.md](docs/network-switch.md)

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

More detail: [docs/integration-flow.md](docs/integration-flow.md)

## Core Exports

- `KaspaCovenantGameKit`: high-level SDK facade.
- `CovenantEscrowEngine`: low-level escrow intent, draft, signature, broadcast engine.
- `SettlementEngine`: winner settlement engine.
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

- TN10: default active experimental path.
- Mainnet: same SDK path, production-guarded behind `allowMainnet`.
- Game mode: two-player escrow first.
- Wallet surface: compatible wallets need public key access and signing support for the covenant draft.
- Settlement adapter: `kascov-lab` for current TN10 flow.

## Credits

Thanks to:

- Kaspa: https://kaspa.org
- Kaspa Docs / Toccata: https://docs.kaspa.org/toccata
- SilverScript: https://github.com/kaspanet/silverscript
- Kascov and Kascov Lab: https://github.com/Knitser/kascov
- Kascov Explorer: https://kascov-explorer.web.app
- Kasware wallet: https://www.kasware.xyz

## License

MIT. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
