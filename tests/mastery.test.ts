import assert from "node:assert/strict";
import { test } from "node:test";
import { INITIAL_MASTERY, isWeak, nextMastery } from "../lib/mastery";
function close(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);
}
test("mastery uses the exact weighted update for correct and incorrect answers", () => {
  close(nextMastery(INITIAL_MASTERY, true, 0), 0.65);
  close(nextMastery(0.6, false, 0), 0.42);
  close(nextMastery(0.6, true, 2), 0.62);
});
test("hint penalty stops at three and the score stays within [0, 1]", () => {
  close(nextMastery(0.7, true, 3), nextMastery(0.7, true, 99));
  assert.equal(nextMastery(0, false, 3), 0);
  assert.equal(nextMastery(1, true, 0), 1);
});
test("weak areas require at least three attempts and strictly less than 0.5", () => {
  assert.equal(isWeak(0.49, 2), false);
  assert.equal(isWeak(0.5, 3), false);
  assert.equal(isWeak(0.49, 3), true);
});
