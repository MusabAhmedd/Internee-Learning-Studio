import assert from "node:assert/strict";
import { test } from "node:test";
import { getStudyCredit, studyIntervalSchema } from "../lib/study-time";

const now = 10_000_000;
test("a cursor credits only the new visible portion, even across tabs", () => {
  const span = { fromMs: now - 10_000, throughMs: now - 5_000 };
  const first = getStudyCredit(span, 0, now);
  assert.deepEqual(first, { throughMs: span.throughMs, acceptedMs: 5000 });
  assert.deepEqual(getStudyCredit(span, span.throughMs, now), {
    throughMs: span.throughMs,
    acceptedMs: 0,
  });
  assert.deepEqual(
    getStudyCredit(
      { fromMs: now - 8_000, throughMs: now },
      span.throughMs,
      now,
    ),
    { throughMs: now, acceptedMs: 5000 },
  );
});
test("study reports reject invalid spans, stale timestamps, and future inflation", () => {
  assert.equal(
    studyIntervalSchema.safeParse({ fromMs: now - 31_000, throughMs: now })
      .success,
    false,
  );
  assert.equal(
    studyIntervalSchema.safeParse({ fromMs: now, throughMs: now - 1 }).success,
    false,
  );
  assert.equal(
    getStudyCredit({ fromMs: now - 100_000, throughMs: now - 99_000 }, 0, now),
    null,
  );
  assert.equal(
    getStudyCredit({ fromMs: now, throughMs: now + 2_001 }, 0, now),
    null,
  );
  assert.deepEqual(
    getStudyCredit({ fromMs: now - 500, throughMs: now + 500 }, 0, now),
    { throughMs: now, acceptedMs: 500 },
  );
});
