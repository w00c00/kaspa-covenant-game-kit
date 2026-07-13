import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const kaspa = require("@kluster/kaspa-wasm");
const { CovenantEscrowEngine, KascovTools } = require("kaspa-covenant-game-kit");

function fundedPlayer(transactionByte) {
  const keypair = kaspa.Keypair.random();
  const address = keypair.toAddress("testnet-10").toString();
  return {
    keypair,
    address,
    utxo: {
      address,
      outpoint: { transactionId: transactionByte.repeat(64), index: 0 },
      amount: 1_000_000_000n,
      script: kaspa.payToAddressScript(address).script,
      blockDaaScore: 1n,
      isCoinbase: false
    }
  };
}

test("two player wallet signatures are merged before an escrow can be broadcast", async () => {
  const first = fundedPlayer("1");
  const second = fundedPlayer("2");
  const utxos = new Map([[first.address, first.utxo], [second.address, second.utxo]]);
  const engine = new CovenantEscrowEngine({
    networkId: "tn10",
    arbiter: { arbiterHash: new KascovTools().blake2b256Hex("33".repeat(32)) },
    fetchUtxos: async (address) => [utxos.get(address)].filter(Boolean)
  });
  const match = {
    id: "KSP-TEST",
    roomId: "KSP-TEST",
    roundId: "ROUND-1",
    game: "snooker",
    stakeKas: 5,
    players: [first, second].map((player, seat) => ({
      seat,
      role: `player-${seat + 1}`,
      address: player.address,
      publicKey: player.keypair.xOnlyPublicKey
    }))
  };

  const draft = await engine.buildPlayerFundedDeployDraft(match);
  assert.doesNotThrow(() => JSON.stringify(draft), "the room store must be able to persist a signing draft across restarts");
  assert.match(draft.covenantId, /^[0-9a-f]{64}$/);
  assert.deepEqual(draft.kasware.param.options.signInputs, [
    { index: 0, sighashType: 1 },
    { index: 1, sighashType: 1 }
  ]);

  const sign = (player) => {
    const unsigned = kaspa.Transaction.deserializeFromSafeJSON(draft.unsignedTransactionSafeJson);
    return kaspa.signTransaction(unsigned, [player.keypair.privateKey], false).serializeToSafeJSON();
  };
  const onlyFirst = engine.mergePlayerSignedTransactions(draft.unsignedTransactionSafeJson, [
    { signerInputIndex: 0, signedTransactionSafeJson: sign(first) }
  ], 2);
  assert.equal(onlyFirst.complete, false);
  assert.deepEqual(onlyFirst.signedIndexes, [0]);

  const both = engine.mergePlayerSignedTransactions(draft.unsignedTransactionSafeJson, [
    { signerInputIndex: 0, signedTransactionSafeJson: sign(first) },
    { signerInputIndex: 1, signedTransactionSafeJson: sign(second) }
  ], 2);
  assert.equal(both.complete, true);
  assert.deepEqual(both.signedIndexes, [0, 1]);
  const merged = kaspa.Transaction.deserializeFromSafeJSON(both.mergedSignedTransactionSafeJson);
  assert.ok(merged.inputs[0].signatureScript);
  assert.ok(merged.inputs[1].signatureScript);
});
