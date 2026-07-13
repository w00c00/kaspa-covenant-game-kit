import assert from "node:assert/strict";
import test from "node:test";
import { CONTENT_SECURITY_POLICY, createOriginPolicy } from "../server/origin-policy.mjs";

test("production origin policy allows only the configured site and non-browser probes", () => {
  assert.throws(() => createOriginPolicy({ production: true, allowedOrigins: [] }), /public origin/);
  const policy = createOriginPolicy({ production: true, allowedOrigins: ["https://kas.w00c00.cyou:8443"] });
  assert.equal(policy.isAllowed(undefined), true);
  assert.equal(policy.isAllowed("https://kas.w00c00.cyou:8443"), true);
  assert.equal(policy.isAllowed("https://kas.w00c00.cyou"), false);
  assert.equal(policy.isAllowed("https://evil.example"), false);
  assert.equal(policy.isAllowed("http://127.0.0.1:8788"), false);
});

test("development origin policy permits loopback ports but not unrelated hosts", () => {
  const policy = createOriginPolicy({ production: false, allowedOrigins: ["http://localhost:5173"] });
  assert.equal(policy.isAllowed("http://127.0.0.1:19876"), true);
  assert.equal(policy.isAllowed("http://localhost:5173"), true);
  assert.equal(policy.isAllowed("https://evil.example"), false);
  assert.match(CONTENT_SECURITY_POLICY, /frame-ancestors 'none'/);
  assert.match(CONTENT_SECURITY_POLICY, /script-src 'self'/);
});
