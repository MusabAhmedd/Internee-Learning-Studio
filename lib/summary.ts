import { createHash } from "node:crypto";
import { z } from "zod";
import { dashboardFor } from "./dashboard";
import { db } from "./firebase-admin";
import { duringWeek, learningWeek } from "./learning-dates";
import { HttpError } from "./http";
import { providerAdmission, takeApiQuota } from "./limits";
import { aiMode, structured } from "./openai";
import { systemPrompt, untrustedData } from "./prompts";
import { profileSchema, summaryResponseSchema, summarySchema } from "./schemas";
const wire = z.strictObject({ text: z.string().min(4).max(800) });
async function savedSummary(uid: string) {
  const snap = await db().doc(`summaries/${uid}`).get();
  const summary = snap.exists ? summarySchema.parse(snap.data()) : null;
  if (summary && summary.uid !== uid)
    throw new HttpError(403, "FORBIDDEN", "This summary is not yours.");
  return summary;
}
export async function summaryFor(uid: string, now = new Date()) {
  const summary = await savedSummary(uid);
  if (!summary?.period) return null;
  const snapshot = await db().doc(`users/${uid}`).get();
  if (!snapshot.exists) return null;
  const week = learningWeek(now, profileSchema.parse(snapshot.data()).timeZone);
  return summary.period.timeZone === week.timeZone &&
    summary.period.start === week.start &&
    summary.period.through === week.through
    ? summary
    : null;
}
export async function writeSummary(
  uid: string,
  signal?: AbortSignal,
  now = new Date(),
) {
  await takeApiQuota(uid, "summary");
  const [context, prior] = await Promise.all([
    dashboardFor(uid, now),
    savedSummary(uid),
  ]);
  const { board, profile, done, attempts } = context;
  const week = learningWeek(now, profile.timeZone);
  const recent = attempts.filter((row) => duringWeek(row.at, week));
  const input = {
    ...week,
    track: profile.track,
    completions: done.filter(
      (row) => row.completedAt && duringWeek(row.completedAt, week),
    ).length,
    attempts: recent.length,
    correct: recent.filter((row) => row.correct).length,
    weakTopics: board.topics.filter((row) => row.weak).map((row) => row.topic),
    nextLesson: board.next?.title ?? null,
  };
  const provider = aiMode();
  const signature = createHash("sha256")
    .update(JSON.stringify({ provider, input }))
    .digest("hex");
  if (prior?.signature === signature)
    return summaryResponseSchema.parse({ summary: prior });
  // NOT_IMPLEMENTED (demo provider only): model-written recap. Local recap summarizes real sample metrics by template.
  const output =
    provider === "demo"
      ? {
          text: `In the last seven days, you completed ${input.completions} ${input.completions === 1 ? "lesson" : "lessons"} and answered ${input.correct} of ${input.attempts} quiz questions correctly. ${input.weakTopics.length ? `Try another practice question on ${input.weakTopics[0]}.` : input.nextLesson ? `Your next step is ${input.nextLesson}.` : "Use your module library to review a concept."}`,
        }
      : await structured(
          "weekly_summary",
          await systemPrompt("summary"),
          untrustedData(input),
          wire,
          540,
          { signal, admit: providerAdmission(uid) },
        );
  const checked = summarySchema.safeParse({
    uid,
    signature,
    period: week,
    text: output.text,
    createdAt: now.toISOString(),
    provider,
  });
  if (!checked.success)
    throw new HttpError(
      502,
      "AI_FORMAT",
      "The recap did not match the expected format. Please retry.",
    );
  await db().doc(`summaries/${uid}`).set(checked.data);
  return summaryResponseSchema.parse({ summary: checked.data });
}
