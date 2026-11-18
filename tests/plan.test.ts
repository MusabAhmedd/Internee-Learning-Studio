import assert from "node:assert/strict";
import { test } from "node:test";
import { HttpError } from "../lib/http";
import {
  type PlanCandidate,
  samplePlan,
  validatePlan,
  weekDates,
} from "../lib/plan-validation";
const dates = weekDates(new Date("2026-10-29T08:00:00Z"));
const candidates: PlanCandidate[] = [
  {
    id: "first",
    title: "First lesson",
    estMinutes: 25,
    prerequisites: [],
    completed: false,
    score: null,
  },
  {
    id: "second",
    title: "Second lesson",
    estMinutes: 45,
    prerequisites: ["first"],
    completed: false,
    score: 0.25,
  },
];
const failsWith = (code: string) => (err: unknown) =>
  err instanceof HttpError && err.code === code;
test("rejects a fabricated lessonId even when the JSON has the correct shape", () => {
  const made = samplePlan(candidates, dates, 70);
  made.days[0].lessonIds = ["fabricated-lesson"];
  assert.throws(
    () => validatePlan(made, candidates, dates, 70),
    failsWith("PLAN_UNKNOWN_LESSON"),
  );
});
test("enforces prerequisites, seven consecutive dates, exact lesson minutes, and weekly budget", () => {
  const valid = samplePlan(candidates, dates, 70);
  assert.equal(valid.days.length, 7);
  assert.deepEqual(validatePlan(valid, candidates, dates, 70), valid);
  assert.throws(
    () => validatePlan(valid, candidates, dates, 69),
    failsWith("PLAN_BUDGET"),
  );
  const reversed = structuredClone(valid);
  reversed.days[0] = {
    ...reversed.days[0],
    lessonIds: ["second"],
    minutes: 45,
  };
  assert.throws(
    () => validatePlan(reversed, candidates, dates, 70),
    failsWith("PLAN_ORDER"),
  );
  const invalid = structuredClone(valid);
  invalid.days[0].minutes = 35;
  assert.throws(
    () => validatePlan(invalid, candidates, dates, 70),
    failsWith("PLAN_MINUTES"),
  );
  const shifted = structuredClone(valid);
  shifted.days[0].date = dates[1];
  assert.throws(
    () => validatePlan(shifted, candidates, dates, 70),
    failsWith("PLAN_DATE"),
  );
});
