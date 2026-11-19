import assert from "node:assert/strict";
import { test } from "node:test";
import { checkAppAttestation } from "../lib/app-attestation";
import { previewLimiter } from "../lib/preview-limits";

const appId = "1:555:web:staging";
const verified = async () => ({ appId });
test("App Check required mode denies missing, malformed, unverifiable, and other-app tokens", async () => {
  await assert.rejects(checkAppAttestation(null, appId, "required", verified), {
    code: "APP_CHECK_REQUIRED",
  });
  await assert.rejects(
    checkAppAttestation("malformed", appId, "required", async () =>
      assert.fail("Malformed input must not reach the verifier"),
    ),
    { code: "APP_CHECK_REQUIRED" },
  );
  await assert.rejects(
    checkAppAttestation("aa.bb.cc", appId, "required", async () => {
      throw new Error("illustrative invalid signature");
    }),
    { code: "APP_CHECK_REQUIRED" },
  );
  await assert.rejects(
    checkAppAttestation("aa.bb.cc", appId, "required", async () => ({
      appId: "other-web-app",
    })),
    { code: "APP_CHECK_REQUIRED" },
  );
  assert.equal(
    await checkAppAttestation("aa.bb.cc", appId, "required", verified),
    "verified",
  );
  assert.equal(
    await checkAppAttestation(null, appId, "observe", verified),
    "missing",
  );
});

test("the public preview uses bounded account-entry and total auth windows", () => {
  const allow = previewLimiter(2, 1);
  assert.equal(allow(true, 61_000), true);
  assert.equal(allow(true, 61_001), false);
  assert.equal(allow(false, 61_002), true);
  assert.equal(allow(false, 61_003), false);
  assert.equal(allow(true, 120_000), true);
});
