import assert from "node:assert/strict";
import test from "node:test";
import { MINIMUM_SETTLEMENT_UTXO_SOMPI, SettlementFundingMonitor } from "../server/settlement-funding.mjs";

function response(payload, ok = true, status = 200) {
  return { ok, status, async json() { return payload; } };
}

test("settlement funding requires one sufficiently large plain UTXO", async () => {
  const monitor = new SettlementFundingMonitor({
    address: "kaspa:test",
    restApi: "https://api.example",
    fetch: async () => response([
      { utxoEntry: { amount: "900000", covenantId: null } },
      { utxoEntry: { amount: "900000", covenantId: null } },
      { utxoEntry: { amount: "999999999", covenantId: "covenant" } }
    ])
  });
  const status = await monitor.status({ force: true });
  assert.equal(status.ready, false);
  assert.equal(status.code, "VERIFIER_FUNDING_REQUIRED");
  assert.equal(status.balanceKas, 0.018);
  assert.equal(status.largestUtxoKas, 0.009);
});

test("settlement funding becomes ready at the reviewed runner threshold", async () => {
  const monitor = new SettlementFundingMonitor({
    address: "kaspa:test",
    restApi: "https://api.example",
    fetch: async () => response([{ utxoEntry: { amount: MINIMUM_SETTLEMENT_UTXO_SOMPI.toString() } }])
  });
  const status = await monitor.status({ force: true });
  assert.equal(status.ready, true);
  assert.equal(status.code, "READY");
  assert.equal(status.minimumUtxoKas, 0.01600001);
});

test("settlement funding fails closed when Kaspa REST is unavailable", async () => {
  const monitor = new SettlementFundingMonitor({
    address: "kaspa:test",
    restApi: "https://api.example",
    fetch: async () => response({}, false, 503)
  });
  const status = await monitor.status({ force: true });
  assert.equal(status.ready, false);
  assert.equal(status.code, "VERIFIER_BALANCE_UNAVAILABLE");
});
