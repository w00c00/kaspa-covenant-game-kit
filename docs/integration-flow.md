# Integration Flow

## 1. Register A Game

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
  }
});
```

Use `KASPA_COVENANT_NETWORK=tn10` for testnet. Use
`KASPA_COVENANT_NETWORK=mainnet` plus
`KASPA_COVENANT_ALLOW_MAINNET=true` for mainnet.

## 2. Build A Match

```js
const state = kit.createState("my-game");
const match = kit.toMatch({ game: "my-game", room, state });
```

## 3. Create Escrow Intent

```js
const intent = kit.createEscrowIntent({ match });
```

If `intent.status` is `ready-for-pskt-builder`, both player public keys and the
arbiter hash are present.

## 4. Build Wallet Signing Draft

```js
const draft = await kit.buildDeployDraft({ match });
```

Send `draft.kasware.param` to the wallet signing layer.

## 5. Collect Signatures

```js
await kit.submitPlayerSignature({
  match,
  draft,
  address: player.address,
  signerInputIndex: playerInputIndex,
  signResult,
  autoBroadcast: false
});
```

When both signatures are present, the escrow record becomes
`fully-signed-ready-to-broadcast`.

## 6. Broadcast Lock Transaction

```js
await kit.broadcastSignedCovenant({
  match,
  signedTransactionSafeJson
});
```

## 7. Settle Winner

```js
const result = await kit.settleWinner({
  match,
  state,
  winnerAddress: state.winnerAddress,
  reason: "game-win"
});
```

The result includes the escrow record, settlement record, and visible proof data.
