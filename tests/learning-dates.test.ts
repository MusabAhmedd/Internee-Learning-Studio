import assert from "node:assert/strict";
import { test } from "node:test";
import {
  duringWeek,
  learningWeek,
  localDate,
  studyStreak,
  timeZoneSchema,
} from "../lib/learning-dates";
import { weekDates } from "../lib/plan-validation";

test("an Asia/Karachi midnight changes the learner date and not the UTC timestamp", () => {
  const before = "2026-11-19T18:59:59.999Z";
  const after = "2026-11-19T19:00:00.000Z";
  assert.equal(localDate(before, "Asia/Karachi"), "2026-11-19");
  assert.equal(localDate(after, "Asia/Karachi"), "2026-11-20");
  assert.equal(localDate(after, "UTC"), "2026-11-19");
  assert.equal(weekDates(new Date(after), "Asia/Karachi")[0], "2026-11-20");
  assert.equal(
    studyStreak([before, after], new Date(after), "Asia/Karachi"),
    2,
  );
  assert.equal(studyStreak([before, after], new Date(after), "UTC"), 1);
  assert.equal(
    learningWeek(new Date(after), "Asia/Karachi").start,
    "2026-11-14",
  );
  assert.equal(
    duringWeek(
      "2026-11-13T18:59:59.999Z",
      learningWeek(new Date(after), "Asia/Karachi"),
    ),
    false,
  );
  assert.equal(
    duringWeek(
      "2026-11-13T19:00:00.000Z",
      learningWeek(new Date(after), "Asia/Karachi"),
    ),
    true,
  );
});

test("calendar-day labels stay consecutive across DST changes and year edges", () => {
  assert.deepEqual(
    weekDates(new Date("2026-03-07T10:00:00Z"), "America/New_York"),
    [
      "2026-03-07",
      "2026-03-08",
      "2026-03-09",
      "2026-03-10",
      "2026-03-11",
      "2026-03-12",
      "2026-03-13",
    ],
  );
  assert.equal(
    studyStreak(
      ["2026-11-01T05:30:00Z", "2026-11-01T06:30:00Z"],
      new Date("2026-11-01T07:00:00Z"),
      "America/New_York",
    ),
    1,
  );
  assert.deepEqual(
    weekDates(new Date("2026-12-31T19:01:00Z"), "Asia/Karachi").slice(0, 2),
    ["2027-01-01", "2027-01-02"],
  );
  assert.equal(timeZoneSchema.safeParse("+05:00").success, false);
  assert.equal(timeZoneSchema.safeParse("Asia/DoesNotExist").success, false);
});
