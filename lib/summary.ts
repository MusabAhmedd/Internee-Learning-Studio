import { createHash } from "node:crypto";
import { z } from "zod";
import { attemptsInWeek, dashboardFor } from "./dashboard";
import { db } from "./firebase-admin";
import { HttpError } from "./http";
import { takeAiQuota } from "./limits";
import { aiMode, structured } from "./openai";
import { systemPrompt, untrustedData } from "./prompts";
import { summaryResponseSchema, summarySchema } from "./schemas";
const wire = z.strictObject({ text: z.string().min(4).max(800) });
export async function summaryFor(uid: string) {
  const snap = await db().doc(`summaries/${uid}`).get();
  const summary = snap.exists ? summarySchema.parse(snap.data()) : null;
  if (summary && summary.uid !== uid)
    throw new HttpError(403, "FORBIDDEN", "This summary is not yours.");
  return summary;
}
export async function writeSummary(uid: string, signal?: AbortSignal) {
  const [context, prior] = await Promise.all([
    dashboardFor(uid),
    summaryFor(uid),
  ]);
  const { board, profile, done, attempts } = context;
  const recent = attemptsInWeek(attempts);
  const now = new Date();
  const start = new Date(now.getTime() - 6 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const input = {
    start,
    through: now.toISOString().slice(0, 10),
    track: profile.track,
    completions: done.filter((row) => row.completedAt.slice(0, 10) >= start)
      .length,
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
  await takeAiQuota(uid);
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
          signal,
        );
  const checked = summarySchema.safeParse({
    uid,
    signature,
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
