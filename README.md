# Kaspa Covenant Game Kit

Build two-player games with player-funded Kaspa Covenant escrow, wallet signing, automatic settlement orchestration, and verifiable on-chain receipts.

使用玩家共同出资的 Kaspa Covenant（链上约束合约）托管、钱包签名、自动结算编排和可验证链上凭据，构建双人对战游戏。

[English](#english) · [简体中文](#简体中文)

> **Developer Preview / 开发者预览**
>
> TN10 is the default and recommended network. Mainnet support uses the same API but is protected only by an explicit opt-in switch; that switch is not a security audit. The current design depends on a settlement signer (`arbiter`) and has not completed an independent security review. Do not use it for production-value mainnet funds.
>
> SDK 默认并推荐使用 TN10 测试网。主网沿用同一套 API，但目前仅通过显式开关防止误用；该开关不等同于安全审计。当前方案依赖结算签名者（`arbiter`），且尚未完成独立安全审计，请勿直接用于承载有实际价值的主网资金。

---

## English

### Overview

Kaspa Covenant Game Kit separates fast game logic from the money path:

- Your application manages rooms, networking, input, game rules, turn validation, rematches, and the authoritative result.
- The SDK normalizes a two-player match, builds a player-funded Covenant transaction draft, collects wallet signatures, broadcasts the lock transaction, maps the winner to an allowed release path, runs settlement, and builds explorer-ready proof data.
- A small game adapter keeps the same integration usable across different games and across TN10/mainnet.

The bundled Gomoku adapter is a reference implementation. Snooker, chess, card games, and other deterministic 1v1 games can integrate through the same adapter boundary.

### What is included

- Two-player, player-funded Covenant escrow intents.
- Toccata v1 Covenant transaction drafts for compatible wallet signing.
- Per-player signature collection, merge, and lock-transaction broadcast.
- Pluggable settlement execution, including the current `kascov-lab` adapter.
- Winner-to-`buyer`/`seller` release-path mapping.
- Visible settlement records containing the Covenant id, lock/settlement transaction, winner, amount, status, and Kascov Explorer link.
- TN10 and mainnet network presets with explicit endpoint and explorer mapping.
- A minimal adapter contract, a Gomoku adapter, and custom-game examples.
- CommonJS exports plus TypeScript declarations.

### Trust and security model

The current flow is **non-custodial, but not fully trustless**.

1. Each player funds an assigned transaction input and signs with their own wallet.
2. The combined transaction locks both stakes in a Covenant output; the application server does not receive custody of the pot.
3. The off-chain game engine determines the winner.
4. The settlement signer (`arbiter`) attests the selected winner path so the Covenant can release funds to one of the two players.

The `arbiter` is not an in-game referee and does not judge shots or moves. It is a settlement authorization role. The Covenant constrains payout to an allowed player path, so the signer should not be able to redirect the pot to an arbitrary third-party address. However, a compromised, dishonest, or unavailable signer can still authorize an incorrect result, refuse to sign, or delay settlement. The blockchain cannot independently observe the complete off-chain game.

For stronger decentralization, a production system would need an independently verifiable game transcript, a dispute/challenge mechanism, multiple signers or threshold authorization, and a thoroughly tested recovery path. These are outside the current SDK release.

### Requirements

- Node.js 20 or newer.
- A Kaspa wallet surface that exposes a public key and can sign the generated transaction draft.
- Two player addresses and public keys.
- A 32-byte hexadecimal `arbiterHash` for escrow program generation.
- A settlement runner such as `kascov-lab` when automatic on-chain release is required.

### Installation

The package is currently installed directly from GitHub:

```bash
npm install github:w00c00/kaspa-covenant-game-kit
```

For local development:

```bash
git clone https://github.com/w00c00/kaspa-covenant-game-kit.git
cd kaspa-covenant-game-kit
npm install
npm test
```

### Quick start

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
  kascovLabBin: process.env.KASCOV_LAB_BIN,
  kascovLabKeyFile: process.env.KASCOV_LAB_KEY_FILE
});

const state = kit.createState("my-game", { roundId: "round-1" });
const match = kit.toMatch({ game: "my-game", room, state });
const intent = kit.createEscrowIntent({ match });

console.log(intent.status);
```

An intent becomes `ready-for-pskt-builder` only when two players, both public keys, and the `arbiterHash` are present.

### Integration lifecycle

#### 1. Build the player-funded draft

```js
const draft = await kit.buildDeployDraft({ match });
```

Use `draft.signers` to associate each player with the correct input. A compatible wallet integration can consume the signing payload under `draft.kasware.param`.

#### 2. Collect both wallet signatures

```js
const submission = await kit.submitPlayerSignature({
  match,
  draft,
  address: player.address,
  signerInputIndex: playerInputIndex,
  signResult,
  autoBroadcast: false
});
```

After every required input is signed, the escrow status becomes `fully-signed-ready-to-broadcast`.

#### 3. Broadcast the lock transaction

```js
const escrow = await kit.broadcastSignedCovenant({
  match,
  signedTransactionSafeJson: submission.merge.mergedSignedTransactionSafeJson
});
```

Do not start a wagered match until the application has verified the lock transaction and the expected Covenant output on the selected network.

#### 4. Settle the winner

```js
const result = await kit.settleWinner({
  match,
  state,
  winnerAddress: state.winnerAddress,
  reason: "game-win"
});

console.log(result.visible.covenantStoryUrl);
console.log(result.visible.txExplorerUrl);
```

`settleWinner()` automatically executes the chain release only when a deployed escrow and a settlement runner are available. Otherwise it returns a pending/waiting record that the application can persist, display, and retry. Applications should poll or subscribe to their backend and refresh the visible settlement status until it reaches a terminal state.

See [Integration Flow](docs/integration-flow.md) for the lower-level sequence.

### Game adapter contract

Only `toMatch(room, state)` is required:

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
        { seat: 0, role: "player-a", address: "...", publicKey: "..." },
        { seat: 1, role: "player-b", address: "...", publicKey: "..." }
      ]
    };
  }
};
```

For a complete integration, also implement:

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

Keep physics, rules, anti-cheat checks, and result determination in the game layer. Keep network selection, escrow, signing, settlement, and proof generation in the SDK layer. A rematch should use a new stable `roundId` so it cannot reuse a previous round's escrow record.

See [Adapter Contract](docs/adapter.md).

### TN10 and mainnet

TN10 is the default:

```bash
KASPA_COVENANT_NETWORK=tn10
```

Mainnet requires both network selection and explicit confirmation:

```bash
KASPA_COVENANT_NETWORK=mainnet
KASPA_COVENANT_ALLOW_MAINNET=true
```

Or configure it directly:

```js
const kit = new KaspaCovenantGameKit({
  networkId: "mainnet",
  allowMainnet: true,
  adapter: myGame,
  arbiter
});
```

| SDK network | Kaspa network | Address prefix | Kascov CLI network | Currency |
| --- | --- | --- | --- | --- |
| `tn10` | `testnet-10` | `kaspatest:` | `testnet-10` | `TKAS` |
| `mainnet` | `mainnet` | `kaspa:` | `mainnet` | `KAS` |

The adapter and lifecycle APIs do not change when switching networks. The preset changes address/network metadata, REST endpoints, explorer links, Kascov CLI mapping, and display currency.

The mainnet opt-in prevents accidental use; it does not validate contract safety, wallet behavior, signer security, fee policy, or operational recovery. Before any controlled mainnet test, pin all compiler/runner versions, use tiny capped stakes, verify generated bytecode and payout paths independently, exercise failure/refund scenarios, and obtain an independent security review.

See [Network Switch](docs/network-switch.md) and [.env.example](.env.example).

### Core exports

| Export | Purpose |
| --- | --- |
| `KaspaCovenantGameKit` | High-level SDK facade and adapter registry. |
| `CovenantEscrowEngine` | Escrow intent, draft construction, signature merge, and broadcast. |
| `SettlementEngine` | Winner-path settlement orchestration. |
| `ProofBuilder` | Covenant plans and user-visible settlement records. |
| `KascovLabAdapter` | Process adapter for `kascov-lab settle-escrow`. |
| `KascovTools` | Program emission, hashing, and bundled Kascov utilities. |
| `JsonStore` | Simple local JSON persistence for development and examples. |
| `adapters.gomoku` | Reference game adapter. |

### Examples and checks

```bash
node examples/memory-gomoku-flow.js
node examples/custom-game-adapter.js
node examples/network-switch.js

npm run check
npm test
```

The examples use placeholder keys and/or mocked chain calls. They are integration references, not production deployment scripts.

### Current limitations

- Two-player escrow only.
- The game state and winner are determined off-chain.
- Settlement currently relies on one `arbiter`/settlement signer.
- Automatic chain settlement requires a configured external runner.
- `JsonStore` is a development convenience, not a concurrent production database.
- Wallet compatibility must be verified against the exact wallet version and target network.
- The sample contract describes a timeout refund path, but a production application must implement and test recovery end to end; do not assume refunds are automatic.
- No independent security audit has been completed for this release.

### Project status

- Package version: `0.1.0` developer preview.
- Recommended network: Kaspa TN10.
- Mainnet API path: present, explicitly gated, not production-certified.
- License: MIT.

### Credits

- [Kaspa](https://kaspa.org)
- [Kaspa Toccata documentation](https://docs.kaspa.org/toccata)
- [SilverScript](https://github.com/kaspanet/silverscript)
- [Kascov and Covenant Lab](https://github.com/Knitser/kascov)
- [Kascov Explorer](https://kascov-explorer.web.app)
- [KasWare Wallet](https://www.kasware.xyz)

---

## 简体中文

### 项目概述

Kaspa Covenant Game Kit 将高频、低延迟的游戏逻辑与资金路径分离：

- 游戏应用负责房间、联机通信、输入、规则、回合校验、重开以及权威胜负结果。
- SDK 负责标准化双人对局、构建玩家共同出资的 Covenant 交易草案、收集钱包签名、广播锁仓交易、把胜者映射到允许的放款路径、执行结算并生成可供区块浏览器验证的凭据。
- 不同游戏只需实现一个轻量 adapter（适配器），TN10 与主网也可共用相同接入方式。

仓库内置的五子棋适配器是参考实现。斯诺克、国际象棋、卡牌等确定性 1v1 游戏均可通过同一适配层接入。

### 已包含的能力

- 双人、玩家共同出资的 Covenant 托管意图。
- 供兼容钱包签名的 Toccata v1 Covenant 交易草案。
- 玩家逐一签名、签名合并和锁仓交易广播。
- 可替换的结算执行器，包括当前的 `kascov-lab` 适配器。
- 将胜者映射为 `buyer` 或 `seller` 放款路径。
- 面向用户的结算记录：Covenant ID、锁仓/结算交易、胜者、金额、状态与 Kascov Explorer 链接。
- TN10 和主网预设，以及明确的节点与浏览器映射。
- 最小适配器协议、五子棋适配器和自定义游戏示例。
- CommonJS 导出与 TypeScript 类型声明。

### 信任与安全模型

当前流程是**非托管的，但并非完全无需信任**。

1. 两位玩家分别用自己的钱包为指定交易输入提供资金并签名。
2. 合并后的交易把双方资金锁入 Covenant 输出，应用服务器不会托管奖池。
3. 链下游戏引擎判断胜负。
4. 结算签名者（`arbiter`）对选定的胜者路径进行授权，Covenant 再把资金释放给两位玩家之一。

`arbiter` 不是游戏内裁判，不负责判断击球或落子是否合法；它承担的是结算授权角色。Covenant 会把收款路径限制为参赛玩家，因此该签名者原则上不能把奖池任意转到第三方地址。但如果签名者被攻破、不诚实或不可用，仍可能授权错误结果、拒绝签名或拖延结算。区块链本身无法直接观察完整的链下游戏过程。

如需进一步去中心化，生产系统还需要可独立验证的对局记录、争议与挑战机制、多签或门限授权，以及经过充分验证的恢复路径。这些能力不属于当前 SDK 版本。

### 环境要求

- Node.js 20 或更高版本。
- 能读取公钥并签署所生成交易草案的 Kaspa 钱包接口。
- 两位玩家的地址与公钥。
- 用于生成托管程序的 32 字节十六进制 `arbiterHash`。
- 如需自动完成链上放款，还要配置 `kascov-lab` 等结算执行器。

### 安装

目前请直接从 GitHub 安装：

```bash
npm install github:w00c00/kaspa-covenant-game-kit
```

本地开发：

```bash
git clone https://github.com/w00c00/kaspa-covenant-game-kit.git
cd kaspa-covenant-game-kit
npm install
npm test
```

### 快速开始

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
  kascovLabBin: process.env.KASCOV_LAB_BIN,
  kascovLabKeyFile: process.env.KASCOV_LAB_KEY_FILE
});

const state = kit.createState("my-game", { roundId: "round-1" });
const match = kit.toMatch({ game: "my-game", room, state });
const intent = kit.createEscrowIntent({ match });

console.log(intent.status);
```

只有当两位玩家、双方公钥和 `arbiterHash` 都已提供时，托管意图才会进入 `ready-for-pskt-builder` 状态。

### 接入生命周期

#### 1. 构建玩家出资草案

```js
const draft = await kit.buildDeployDraft({ match });
```

根据 `draft.signers` 将每位玩家与正确的交易输入对应起来。兼容的钱包接入层可以使用 `draft.kasware.param` 中的签名参数。

#### 2. 收集双方钱包签名

```js
const submission = await kit.submitPlayerSignature({
  match,
  draft,
  address: player.address,
  signerInputIndex: playerInputIndex,
  signResult,
  autoBroadcast: false
});
```

所有必需输入均已签名后，托管状态会变为 `fully-signed-ready-to-broadcast`。

#### 3. 广播锁仓交易

```js
const escrow = await kit.broadcastSignedCovenant({
  match,
  signedTransactionSafeJson: submission.merge.mergedSignedTransactionSafeJson
});
```

在所选网络上确认锁仓交易及预期 Covenant 输出之前，不应开始带押注的对局。

#### 4. 结算胜者

```js
const result = await kit.settleWinner({
  match,
  state,
  winnerAddress: state.winnerAddress,
  reason: "game-win"
});

console.log(result.visible.covenantStoryUrl);
console.log(result.visible.txExplorerUrl);
```

只有已存在链上托管且已配置结算执行器时，`settleWinner()` 才会自动执行链上放款；否则会返回待处理或等待状态，应用可将其持久化、展示并重试。应用应通过轮询或订阅后端的方式自动刷新可见结算状态，直到进入最终状态。

更完整的底层步骤请参阅[接入流程](docs/integration-flow.md)。

### 游戏适配器协议

仅 `toMatch(room, state)` 为必需方法：

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
        { seat: 0, role: "player-a", address: "...", publicKey: "..." },
        { seat: 1, role: "player-b", address: "...", publicKey: "..." }
      ]
    };
  }
};
```

完整接入建议同时实现：

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

物理模拟、游戏规则、反作弊检查和胜负判定应留在游戏层；网络选择、托管、签名、结算和凭据生成应放在 SDK 层。重开一局时必须使用新的稳定 `roundId`，避免复用上一局的托管记录。

详见[适配器协议](docs/adapter.md)。

### TN10 与主网切换

默认使用 TN10：

```bash
KASPA_COVENANT_NETWORK=tn10
```

主网必须同时选择网络并显式确认：

```bash
KASPA_COVENANT_NETWORK=mainnet
KASPA_COVENANT_ALLOW_MAINNET=true
```

也可以直接通过构造参数配置：

```js
const kit = new KaspaCovenantGameKit({
  networkId: "mainnet",
  allowMainnet: true,
  adapter: myGame,
  arbiter
});
```

| SDK 网络 | Kaspa 网络 | 地址前缀 | Kascov CLI 网络 | 币种 |
| --- | --- | --- | --- | --- |
| `tn10` | `testnet-10` | `kaspatest:` | `testnet-10` | `TKAS` |
| `mainnet` | `mainnet` | `kaspa:` | `mainnet` | `KAS` |

切换网络时，适配器和生命周期 API 无需改变。网络预设会切换地址/网络元数据、REST 节点、浏览器链接、Kascov CLI 映射和显示币种。

主网显式开关只能防止误操作，无法验证合约安全性、钱包行为、签名者安全、手续费策略或故障恢复能力。在任何受控主网测试前，都应锁定编译器与执行器版本、使用极小且设有上限的押注、独立核验生成字节码与放款路径、演练失败/退款场景，并完成独立安全审查。

详见[网络切换](docs/network-switch.md)和[环境变量示例](.env.example)。

### 核心导出

| 导出项 | 用途 |
| --- | --- |
| `KaspaCovenantGameKit` | 高层 SDK 门面与适配器注册中心。 |
| `CovenantEscrowEngine` | 托管意图、草案构建、签名合并与广播。 |
| `SettlementEngine` | 胜者路径的结算编排。 |
| `ProofBuilder` | Covenant 计划及用户可见的结算记录。 |
| `KascovLabAdapter` | 调用 `kascov-lab settle-escrow` 的进程适配器。 |
| `KascovTools` | 程序生成、哈希及内置 Kascov 工具。 |
| `JsonStore` | 用于开发和示例的简易本地 JSON 存储。 |
| `adapters.gomoku` | 参考游戏适配器。 |

### 示例与检查

```bash
node examples/memory-gomoku-flow.js
node examples/custom-game-adapter.js
node examples/network-switch.js

npm run check
npm test
```

示例使用占位密钥和/或模拟链上调用，仅用于说明接入方式，不是生产部署脚本。

### 当前限制

- 目前仅支持双人托管。
- 游戏状态和胜者由链下逻辑判定。
- 结算目前依赖单个 `arbiter`/结算签名者。
- 自动链上结算需要配置外部执行器。
- `JsonStore` 仅适合开发，不是支持并发的生产数据库。
- 必须针对确切的钱包版本与目标网络验证兼容性。
- 示例合约描述了超时退款路径，但生产应用必须完整实现并测试恢复流程，不能假定退款会自动执行。
- 当前版本尚未完成独立安全审计。

### 项目状态

- 软件包版本：`0.1.0` 开发者预览。
- 推荐网络：Kaspa TN10。
- 主网 API 路径：已提供并要求显式开启，但未通过生产认证。
- 开源协议：MIT。

### 致谢

- [Kaspa](https://kaspa.org)
- [Kaspa Toccata 文档](https://docs.kaspa.org/toccata)
- [SilverScript](https://github.com/kaspanet/silverscript)
- [Kascov 与 Covenant Lab](https://github.com/Knitser/kascov)
- [Kascov Explorer](https://kascov-explorer.web.app)
- [KasWare 钱包](https://www.kasware.xyz)

## License / 许可证

MIT. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

采用 MIT 许可证。详见 [LICENSE](LICENSE) 与 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
