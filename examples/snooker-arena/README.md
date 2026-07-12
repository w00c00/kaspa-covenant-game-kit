# Kaspa Snooker Arena

基于 `kaspa-covenant-game-kit` 的 TN10 链上斯诺克 1v1 网页游戏。大厅、房间、球局、锁仓和结算是一个完整状态机：双方资金没有真实上链前，服务器不会允许开球。

## 当前流程

1. 玩家在大厅创建或加入房间并连接 KasWare TN10 钱包。
2. 服务端按房间、局次、双方地址、公钥和押注金额构建唯一的共同锁仓交易。
3. 两位玩家各自只签署属于自己的 transaction input。
4. 服务端验证并合并两份签名、广播交易，并等待 Covenant UTXO 可查询。
5. 只有锁仓确认后，双方才可准备并开始比赛。
6. 服务端运行与客户端同源的确定性物理和规则引擎，校验回合、摆白球、力度、杆法、犯规、超时和胜负。
7. 比赛结束后，自动结算服务根据最终状态选择已预先写入 Covenant 的 Player 1 或 Player 2 路径，奖池直接释放到胜者钱包。

协议内部沿用上游 SDK 的 `arbiter` 字段名，但产品中不存在人工裁判。它是自动结算密钥，只能在双方预先承诺的钱包地址中选择一个收款方，不能把奖池转给服务端。

## 游戏体验

- 电脑：移动鼠标瞄准，左键按住按时间蓄力，松开发杆，实时显示力度。
- 触屏：球桌滑动只负责瞄准，独立力度杆下拉控制力量，松手发杆。
- 二维母球击点：高杆、低杆、左/右塞及组合塞，并影响跟杆、缩杆、吃库偏转和传递。
- 开球和母球摔袋后都可在 D 区拖动摆放白球，松手确认。
- 包含击球、碰球、落袋、犯规和开局提示音。
- 服务端 30 秒回合计时，客户端不能单方面重置、改分或指定赢家。

## 大厅与水龙头

- 页面顺序：游戏大厅 → 创建/加入房间 → 双方锁仓等待室 → 比赛球台。
- 房间只有创建者时可进入无钱包、无押注的单机练习；一个人可操作双方逻辑回合，并支持重新摆球或退出练习。
- 内置 TN10 水龙头：单次最多 200 TKAS，同一地址每日最多 2000 TKAS。
- 水龙头钱包同时承担自动结算网络手续费，因此只需给一个后台地址充值。
- 私钥只保存在 `data/`，接口只返回公开地址和余额。

## 本地运行

本示例位于 SDK 仓库的 `examples/snooker-arena`，通过 `file:../..` 直接使用仓库根目录的 SDK。

```bash
npm install
npm run build
npm start
```

开发模式：

```bash
npm run dev
```

默认 API 端口为 `8787`。服务会自动生成 TN10 水龙头/结算密钥。真正锁仓要求 `bin/kascov-lab` 可执行文件存在；缺少自动释放器时，服务会拒绝锁入资金，防止奖池被锁死。

构建 `kascov-lab`：

```bash
git clone --depth 1 https://github.com/Knitser/kascov.git
cd kascov
cargo build --release -p kascov-lab
install -m 755 target/release/kascov-lab /path/to/snooker/bin/kascov-lab
```

## 测试

```bash
npm run check
npm test
npm run build
```

测试覆盖力度映射、D 区摆白球、摔袋手中球、远端加塞、清彩犯规/复位、最终红球后的彩球复位、两方签名合并、房间座位恢复及未锁仓禁止开球。

## 网络切换

TN10 默认配置：

```dotenv
KASPA_COVENANT_NETWORK=tn10
KASPA_COVENANT_ALLOW_MAINNET=false
```

SDK 的地址、REST/wRPC、Explorer、match 和签名接口已经按网络配置解耦。主网必须同时设置：

```dotenv
KASPA_COVENANT_NETWORK=mainnet
KASPA_COVENANT_ALLOW_MAINNET=true
KASPA_COVENANT_MAINNET_PROGRAM_APPROVED=true
KASPA_COVENANT_MAINNET_PROGRAM_FINGERPRINT=<reviewed-profile-fingerprint>
SILVERC_BIN=/opt/kaspa-snooker/bin/silverc
KASPA_COVENANT_MAINNET_SILVERC_SHA256=<reviewed-silverc-sha256>
KASPA_COVENANT_MAINNET_SETTLEMENT_RUNNER_APPROVED=true
KASPA_COVENANT_MAINNET_SETTLEMENT_RUNNER_SHA256=<reviewed-runner-sha256>
KASPA_COVENANT_MAINNET_MAX_STAKE_KAS=1
```

注意：当前随示例部署的 `kascov-lab` 释放器只按 TN10 验证。主网模式还需要官方 `silverc` 编译器、经过审查的 settlement runner，并分别通过 source-linked program profile 与 runner 两道许可；每位玩家硬限制最多 1 KAS。仅修改网络名称和 `allowMainnet` 无法构建或结算主网房间。

## 主要目录

```text
src/game-engine.js                 确定性物理与斯诺克规则
src/main.js                        大厅、房间、球台、钱包和实时 UI
src/audio.js                       Web Audio 游戏音效
server/index.mjs                   权威房间、锁仓、计时和自动结算
server/faucet-service.mjs          TN10 水龙头及领取限额
server/settlement-verifier.mjs     自动结算密钥初始化
server/snooker-adapter.cjs         SDK 游戏 adapter
sdk/                               kaspa-covenant-game-kit
bin/kascov-lab                     TN10 自动释放器（按部署平台编译）
bin/silverc                        官方 SilverScript 编译器（主网闭测必需）
```

TN10 仍属于实验环境。上线主网前需要完成双钱包真机联调、异常断线/退款策略、合约和结算 runner 独立安全审计。
