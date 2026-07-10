# Kaspa Covenant Game Kit

Reusable Kaspa TN10 / SilverScript covenant escrow and game settlement modules extracted from the Kaspa Arena experiment.

中文：这是从 Kaspa Arena 五子棋实验项目里单独抽出来的 covenant 对局托管与结算工具包。它不会影响原来的 `kaspa-arena` 项目，目标是让后续类似游戏可以轻度修改后直接复用。

## What It Provides

- Player-funded two-party covenant escrow intent generation.
- Kasware-compatible signing draft shape for Toccata v1 covenant transactions.
- Signed transaction merge and broadcast helpers.
- Winner-to-release-path settlement logic, mapping a game winner to `buyer` or `seller`.
- Kascov Lab adapter for `settle-escrow`.
- Human-readable proof builder with covenant id, deploy tx, settlement tx, release path, amount, and Kascov Explorer link.
- A Gomoku adapter example: game state, move validation, five-in-row winner detection, and transcript generation.

## 中文说明

这个包把“游戏逻辑”和“链上 covenant 托管结算逻辑”分开：

- 游戏只负责判断谁赢。
- adapter 把游戏房间转换成统一 `match` 对象。
- escrow engine 负责生成托管意图、构建玩家共同出资的 covenant 草案、合并签名和广播。
- settlement engine 根据赢家地址选择 `buyer` 或 `seller` 释放路径。
- proof builder 生成前端可以直接展示的结算凭据。

## Install

```bash
npm install
```

This package is currently marked `private: true` while the API stabilizes.

## Basic Usage

```js
const {
  CovenantEscrowEngine,
  DEFAULT_NETWORKS,
  JsonStore,
  ProofBuilder,
  SettlementEngine,
  adapters
} = require("kaspa-covenant-game-kit");

const store = new JsonStore("./data/ledger.json");

const escrowEngine = new CovenantEscrowEngine({
  store,
  network: DEFAULT_NETWORKS.tn10,
  arbiter: {
    address: process.env.ARBITER_ADDRESS,
    publicKey: process.env.ARBITER_PUBLIC_KEY,
    arbiterHash: process.env.ARBITER_HASH
  }
});

const proofBuilder = new ProofBuilder({
  network: DEFAULT_NETWORKS.tn10,
  contractFile: "./contracts/gomoku_escrow.sil"
});

const settlementEngine = new SettlementEngine({
  escrowEngine,
  proofBuilder,
  store
});

const state = adapters.gomoku.createState();
const match = adapters.gomoku.toMatch(room, state);
const intent = escrowEngine.createIntent(match);
```

## Match Shape

Any game can use this kit if it can produce this object:

```js
{
  id: "MATCH-123",
  roundId: "ROUND-1",
  game: "gomoku",
  stakeKas: 25,
  players: [
    { seat: 0, role: "black", address: "kaspatest:...", publicKey: "..." },
    { seat: 1, role: "white", address: "kaspatest:...", publicKey: "..." }
  ],
  claimPaths: ["claimBlack(transcriptHash)", "claimWhite(transcriptHash)", "refund(after expiresAtDaa)"]
}
```

For a new game, implement a small adapter that provides:

- `createState()`
- `toMatch(room, state)`
- `applyMove(match, state, move)`
- winner detection
- transcript fields such as `moves`, `winner`, `winnerAddress`, and `result`

## Current Status

This is an experimental extraction for TN10. The original Kaspa Arena site remains unchanged.

- TN10: active experimental path.
- Mainnet: reserved until covenant tooling, wallet signing, and contract behavior are audited.
- Kascov Lab: used as the current settlement adapter.
- Kasware: expected wallet signing surface is `getPublicKey` and `signPskt`.

## Run Checks

```bash
npm run check
npm test
```

## Credits

Thanks to:

- Kaspa: https://kaspa.org
- Kaspa Docs / Toccata: https://docs.kaspa.org/toccata
- SilverScript: https://github.com/kaspanet/silverscript
- Kascov and Kascov Lab: https://github.com/Knitser/kascov
- Kascov Explorer: https://kascov-explorer.web.app
- Kasware wallet: https://www.kasware.xyz

## Warning

This is an experimental project for verifying Kaspa covenant-based game settlement. Do not use it with mainnet funds without independent review, audits, and wallet compatibility testing.
