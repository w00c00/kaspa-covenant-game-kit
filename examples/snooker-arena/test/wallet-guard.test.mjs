import assert from "node:assert/strict";
import test from "node:test";
import { roomWalletIdentityFrozen, walletAccountDecision } from "../src/wallet-guard.js";

test("wallet account changes fail closed on the wrong network or after a chain commitment", () => {
  assert.equal(walletAccountDecision({ addressPrefix: "kaspa", nextAddress: "" }).action, "disconnect");
  assert.equal(walletAccountDecision({ addressPrefix: "kaspa", nextAddress: "kaspatest:other" }).action, "wrong-network");
  assert.equal(walletAccountDecision({
    addressPrefix: "kaspa",
    nextAddress: "kaspa:new",
    boundAddress: "kaspa:original",
    identityFrozen: true
  }).action, "restore-bound-account");
  assert.deepEqual(walletAccountDecision({
    addressPrefix: "kaspa",
    nextAddress: "kaspa:new",
    boundAddress: "kaspa:original",
    identityFrozen: false
  }), { action: "bind", address: "kaspa:new" });
});

test("a wallet identity freezes as soon as a shared draft or signature exists", () => {
  const room = { players: [{ seat: 0, lockStatus: "unsigned", locked: false }], escrow: { status: "waiting-for-wallets" } };
  assert.equal(roomWalletIdentityFrozen(room, 0), false);
  room.escrow.status = "awaiting-player-signatures";
  assert.equal(roomWalletIdentityFrozen(room, 0), true);
  room.escrow.status = "waiting-for-wallets";
  room.players[0].lockStatus = "signed";
  assert.equal(roomWalletIdentityFrozen(room, 0), true);
});
