import { createHash } from "node:crypto";
import { z } from "zod";
import { listCatalog } from "./catalog";
import { db } from "./firebase-admin";
import { HttpError } from "./http";
import { aiMode, structured } from "./openai";
import {
  type PlanCandidate,
  samplePlan,
  validatePlan,
  weekDates,
} from "./plan-validation";
import { recentAttempts } from "./practice-store";
import { completions } from "./progress-store";
import { systemPrompt, untrustedData } from "./prompts";
import {
  planRecordSchema,
  planSchema,
  planStatusSchema,
  profileSchema,
  revisionSchema,
} from "./schemas";

const wire = z.strictObject({
  days: z
    .array(
      z.strictObject({
        date: z.string(),
        lessonIds: z.array(z.string()).max(4),
        goal: z.string().min(2).max(140),
        minutes: z.number().int().min(0).max(480),
        reason: z.string().min(2).max(230),
      }),
    )
    .length(7),
});
export async function planContext(uid: string) {
  const database = db();
  const [user, content, done, attempts, marker, previous] = await Promise.all([
    database.doc(`users/${uid}`).get(),
    listCatalog(),
    completions(uid),
    recentAttempts(uid, 100),
    database.doc("catalog/meta").get(),
    database.doc(`plans/${uid}`).get(),
  ]);
  if (!user.exists)
    throw new HttpError(
      409,
      "PROFILE_REQUIRED",
      "Finish your learning profile before planning.",
    );
  const profile = profileSchema.parse(user.data());
  const profileHash = createHash("sha256")
    .update(JSON.stringify(profile))
    .digest("hex");
  const prior = previous.exists
    ? planRecordSchema.parse(previous.data())
    : null;
  if (prior && prior.uid !== uid)
    throw new HttpError(
      403,
      "FORBIDDEN",
      "This plan belongs to a different learner.",
    );
  const revision = marker.exists
    ? revisionSchema.parse(marker.data()).revision
    : null;
  const completed = new Set(done.map((item) => item.lessonId));
  const modules = content.modules.filter(
    (item) => item.track === profile.track,
  );
  const lessons = modules.flatMap((item) => item.lessons);
  const lessonIds = new Set(lessons.map((lesson) => lesson.id));
  const relevant = attempts.filter((row) => lessonIds.has(row.lessonId));
  const candidates = modules
    .flatMap((item) =>
      item.lessons.map((lesson, index): PlanCandidate => {
        const rows = relevant
          .filter((attempt) => attempt.lessonId === lesson.id)
          .slice(0, 5);
        return {
          id: lesson.id,
          title: lesson.title,
          estMinutes: lesson.estMinutes,
          prerequisites: item.lessons.slice(0, index).map((row) => row.id),
          completed: completed.has(lesson.id),
          score: rows.length
            ? rows.filter((row) => row.correct).length / rows.length
            : null,
        };
      }),
    )
    .sort(
      (a, b) =>
        Number(b.score !== null && b.score < 0.6) -
        Number(a.score !== null && a.score < 0.6),
    );
  const today = weekDates(new Date())[0];
  let reason: z.infer<typeof planStatusSchema>["reason"] = null;
  if (prior) {
    if (prior.revision !== revision) reason = "curriculum";
    else if (prior.profileHash !== profileHash) reason = "profile";
    else if ((prior.days.at(-1)?.date ?? "") < today) reason = "new-week";
    else if (
      prior.days.some(
        (day) =>
          day.date < today && day.lessonIds.some((id) => !completed.has(id)),
      )
    )
      reason = "behind";
    else if (
      relevant.some(
        (row) =>
          row.at > prior.createdAt &&
          !row.correct &&
          candidates.some(
            (item) =>
              item.id === row.lessonId &&
              item.score !== null &&
              item.score < 0.6,
          ),
      )
    )
      reason = "low-score";
  }
  const status = planStatusSchema.parse({
    plan: prior,
    reason,
    lessons,
    budgetMinutes: profile.weeklyHours * 60,
    provider: aiMode(),
  });
  return {
    status,
    candidates,
    revision,
    profile,
    profileHash,
    recent: relevant.slice(0, 12).map(({ lessonId, correct, hintsUsed }) => ({
      lessonId,
      correct,
      hintsUsed,
    })),
  };
}

export async function createPlan(
  uid: string,
  context: Awaited<ReturnType<typeof planContext>>,
  signal?: AbortSignal,
) {
  const { status, candidates, revision, profile, profileHash, recent } =
    context;
  if (!revision || !candidates.length)
    throw new HttpError(
      409,
      "NO_TRACK_LESSONS",
      "No modules are published for your track yet. Choose a track with lessons or wait for a curriculum import.",
    );
  const dates = weekDates(new Date());
  const createdAt = new Date().toISOString();
  const budget = status.budgetMinutes;
  // NOT_IMPLEMENTED (demo provider only): model inference. The local scheduling algorithm observes the same validation and study constraints.
  const proposal =
    status.provider === "demo"
      ? samplePlan(candidates, dates, budget)
      : await structured(
          "study_plan",
          await systemPrompt("plan"),
          untrustedData({
            dates,
            budgetMinutes: budget,
            level: profile.level,
            goal: profile.goal,
            track: profile.track,
            lessons: candidates,
            recentAttempts: recent,
          }),
          wire,
          2200,
          signal,
        );
  const checked = validatePlan(proposal, candidates, dates, budget);
  const database = db();
  const ref = database.doc(`plans/${uid}`);
  return database.runTransaction(async (tx) => {
    const [stored, marker] = await tx.getAll(ref, database.doc("catalog/meta"));
    if (
      !marker.exists ||
      revisionSchema.parse(marker.data()).revision !== revision
    )
      throw new HttpError(
        409,
        "CATALOG_CHANGED",
        "Curriculum changed while building your plan. Please retry.",
      );
    const old = stored.exists ? planRecordSchema.parse(stored.data()) : null;
    if (old && old.uid !== uid)
      throw new HttpError(
        403,
        "FORBIDDEN",
        "This plan belongs to a different learner.",
      );
    if (
      old &&
      old.createdAt > (status.plan?.createdAt ?? "") &&
      old.revision === revision &&
      old.profileHash === profileHash
    )
      return planSchema.parse({ days: old.days });
    tx.set(
      ref,
      planRecordSchema.parse({
        ...checked,
        uid,
        revision,
        createdAt,
        profileHash,
      }),
    );
    return checked;
  });
}
