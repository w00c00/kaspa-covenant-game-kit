import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { FaucetService } from "../server/faucet-service.mjs";

test("TN10 faucet enforces 200 per claim and 2000 per wallet per UTC day", (context) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "kaspa-faucet-test-"));
  context.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const faucet = new FaucetService({ dataDir });
  const address = faucet.wallet.address;
  assert.equal(faucet.validateClaim(address, 200), 200);
  assert.throws(() => faucet.validateClaim(address, 200.01), /1–200/);

  fs.writeFileSync(faucet.claimsFile, JSON.stringify({
    claims: [
      { address, day: new Date().toISOString().slice(0, 10), amountKas: 1900, status: "sent" },
      { address, day: new Date().toISOString().slice(0, 10), amountKas: 200, status: "failed" }
    ]
  }));
  assert.equal(faucet.dailyClaimed(address), 1900);
  assert.equal(faucet.validateClaim(address, 100), 100);
  assert.throws(() => faucet.validateClaim(address, 101), /每日上限为 2000/);
});
