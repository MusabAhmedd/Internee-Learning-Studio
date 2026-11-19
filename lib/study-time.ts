import { z } from "zod";

export const STUDY_HEARTBEAT_MS = 15_000;
export const STUDY_SPAN_MAX_MS = 30_000;
export const STUDY_REPORT_WINDOW_MS = 90_000;
export const STUDY_LESSON_MAX_SECONDS = 7200;
const futureToleranceMs = 2000;
const epochMs = z.number().int().min(0).max(8_640_000_000_000_000);

export const studyIntervalSchema = z
  .strictObject({
    fromMs: epochMs,
    throughMs: epochMs,
  })
  .refine(
    ({ fromMs, throughMs }) =>
      throughMs > fromMs && throughMs - fromMs <= STUDY_SPAN_MAX_MS,
    "Report one positive visible interval of at most 30 seconds.",
  );
export type StudyInterval = z.infer<typeof studyIntervalSchema>;
export const studyCursorSchema = z.strictObject({ throughMs: epochMs });

export function getStudyCredit(
  interval: StudyInterval,
  lastThroughMs: number,
  nowMs: number,
) {
  if (
    interval.fromMs < nowMs - STUDY_REPORT_WINDOW_MS ||
    interval.throughMs > nowMs + futureToleranceMs
  )
    return null;
  const throughMs = Math.min(nowMs, interval.throughMs);
  const acceptedMs = Math.max(
    0,
    throughMs - Math.max(lastThroughMs, interval.fromMs),
  );
  return { throughMs: Math.max(lastThroughMs, throughMs), acceptedMs };
}
