import { z } from "zod";
import { abuseEvent } from "./abuse-telemetry";
import { db } from "./firebase-admin";
import { HttpError } from "./http";
import { uidSchema } from "./schemas";

export const quotaCounterSchema = z.strictObject({
  day: z.iso.date(),
  minute: z.number().int().nonnegative(),
  dayCount: z.number().int().nonnegative(),
  minuteCount: z.number().int().nonnegative(),
});

type Policy = {
  perMinute: number;
  perDay: number;
  minuteCode: string;
  dayCode: string;
  message: string;
};
const apiPolicies = {
  tutor: { perMinute: 30, perDay: 300 },
  "tutor-hint": { perMinute: 15, perDay: 120 },
  "quiz-generate": { perMinute: 12, perDay: 120 },
  "quiz-grade": { perMinute: 30, perDay: 300 },
  progress: { perMinute: 20, perDay: 2000 },
  plan: { perMinute: 8, perDay: 80 },
  summary: { perMinute: 8, perDay: 80 },
  "admin-import": { perMinute: 4, perDay: 20 },
} as const;
export type ApiLane = keyof typeof apiPolicies;

async function consume(entries: Array<{ path: string; policy: Policy }>) {
  const database = db();
  const refs = entries.map((entry) => database.doc(entry.path));
  try {
    await database.runTransaction(async (tx) => {
      const snapshots = await tx.getAll(...refs);
      const now = new Date();
      const minute = Math.floor(now.getTime() / 60_000);
      const day = now.toISOString().slice(0, 10);
      const next = snapshots.map((snap, i) => {
        const { policy } = entries[i];
        const old = snap.exists ? quotaCounterSchema.parse(snap.data()) : null;
        const dayCount = old?.day === day ? old.dayCount : 0;
        const minuteCount = old?.minute === minute ? old.minuteCount : 0;
        if (dayCount >= policy.perDay)
          throw new HttpError(429, policy.dayCode, policy.message);
        if (minuteCount >= policy.perMinute)
          throw new HttpError(
            429,
            policy.minuteCode,
            "Too many requests for this action. Try again in a minute.",
          );
        return quotaCounterSchema.parse({
          day,
          minute,
          dayCount: dayCount + 1,
          minuteCount: minuteCount + 1,
        });
      });
      refs.forEach((ref, i) => tx.set(ref, next[i]));
    });
  } catch (error) {
    if (error instanceof HttpError && error.status === 429)
      abuseEvent("rate_limited", error.code);
    throw error;
  }
}

export function takeApiQuota(uid: string, lane: ApiLane) {
  const code =
    lane === "admin-import" ? "ADMIN_IMPORT_RATE_LIMIT" : "API_RATE_LIMIT";
  const entries: Array<{ path: string; policy: Policy }> = [
    {
      path: `apiLimits/${uidSchema.parse(uid)}__${lane}`,
      policy: {
        ...apiPolicies[lane],
        minuteCode: code,
        dayCode: code,
        message: "This action’s daily limit resets at midnight UTC.",
      },
    },
  ];
  if (lane === "admin-import")
    entries.push({
      path: "serviceLimits/admin-import",
      policy: {
        perMinute: 8,
        perDay: 60,
        minuteCode: "ADMIN_IMPORT_PROJECT_LIMIT",
        dayCode: "ADMIN_IMPORT_PROJECT_LIMIT",
        message:
          "The workspace import limit has been reached. Try again tomorrow (UTC).",
      },
    });
  return consume(entries);
}

function configuredLimit(
  key: "AI_DAILY_LIMIT" | "AI_PROJECT_DAILY_LIMIT" | "AI_PROJECT_PER_MINUTE",
  fallback: number,
  max: number,
) {
  const value = process.env[key] ?? String(fallback);
  if (!/^\d{1,5}$/.test(value) || Number(value) > max)
    throw new HttpError(503, "LIMIT_CONFIG", `Configure ${key} on the server.`);
  return Number(value);
}
export function takeProviderQuota(uid: string) {
  return consume([
    {
      path: `providerLimits/${uidSchema.parse(uid)}`,
      policy: {
        perMinute: 12,
        perDay: configuredLimit("AI_DAILY_LIMIT", 40, 300),
        minuteCode: "AI_BURST_LIMIT",
        dayCode: "AI_DAILY_LIMIT",
        message:
          "Your Gemini allowance resets at midnight UTC. Lessons, fixed hints, and multiple-choice grading remain available.",
      },
    },
    {
      path: "serviceLimits/gemini",
      policy: {
        perMinute: configuredLimit("AI_PROJECT_PER_MINUTE", 20, 300),
        perDay: configuredLimit("AI_PROJECT_DAILY_LIMIT", 200, 10_000),
        minuteCode: "AI_PROJECT_BURST_LIMIT",
        dayCode: "AI_PROJECT_DAILY_LIMIT",
        message:
          "The workspace Gemini budget is exhausted. Lessons, fixed hints, and MCQ grading remain available.",
      },
    },
  ]);
}

/** Reuse the reservation when a single learner request needs embeddings and chat. */
export function oncePerRequest(reserve: () => Promise<void>) {
  let pending: Promise<void> | undefined;
  return () => (pending ??= Promise.resolve().then(reserve));
}

export function providerAdmission(uid: string) {
  return oncePerRequest(() => takeProviderQuota(uid));
}
