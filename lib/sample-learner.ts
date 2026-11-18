import { createHash } from "node:crypto";
import { z } from "zod";
import sample from "../data/sample/SAMPLE_learner.json";
import { listCatalog } from "./catalog";
import { db } from "./firebase-admin";
import { HttpError } from "./http";
import { INITIAL_MASTERY, nextMastery } from "./mastery";
import { masteryId } from "./practice-store";
import {
  activitySchema,
  attemptSchema,
  idSchema,
  masterySchema,
  profileInputSchema,
  profileSchema,
  progressSchema,
  topicSchema,
  type Mastery,
} from "./schemas";
const seeded = z
  .strictObject({
    label: z.literal("SAMPLE"),
    profile: profileInputSchema,
    completions: z.array(
      z.strictObject({
        lessonId: idSchema,
        daysAgo: z.number().int().nonnegative().max(28),
        studySeconds: progressSchema.shape.studySeconds,
      }),
    ),
    attempts: z
      .array(
        z.strictObject({
          lessonId: idSchema,
          topic: topicSchema,
          daysAgo: z.number().int().nonnegative().max(28),
          correct: z.boolean(),
          hintsUsed: attemptSchema.shape.hintsUsed,
        }),
      )
      .max(50),
  })
  .parse(sample);
export async function setupSample(uid: string) {
  const database = db();
  const ref = database.doc(`users/${uid}`);
  const existing = await ref.get();
  if (existing.exists) return profileSchema.parse(existing.data());
  const catalog = await listCatalog();
  const lessons = new Map(
    catalog.modules
      .filter((item) => item.source === "SAMPLE")
      .flatMap((item) => item.lessons)
      .map((lesson) => [lesson.id, lesson]),
  );
  if (!lessons.size)
    throw new HttpError(
      409,
      "SAMPLE_NOT_SEEDED",
      "The sample curriculum is missing. Run the seed and embedding scripts first.",
    );
  const now = Date.now();
  const before = (days: number) =>
    new Date(now - days * 86_400_000).toISOString();
  const profile = profileSchema.parse({
    ...seeded.profile,
    createdAt: before(6),
  });
  const prefix = createHash("sha256").update(uid).digest("hex").slice(0, 24);
  return database.runTransaction(async (tx) => {
    const saved = await tx.get(ref);
    if (saved.exists) return profileSchema.parse(saved.data());
    tx.create(ref, profile);
    for (const { daysAgo, lessonId, studySeconds } of seeded.completions) {
      if (lessons.has(lessonId))
        tx.create(
          ref.collection("progress").doc(lessonId),
          progressSchema.parse({
            uid,
            lessonId,
            studySeconds,
            completedAt: before(daysAgo),
          }),
        );
    }
    const mastery = new Map<string, Mastery>();
    for (const [index, { daysAgo, ...attempt }] of seeded.attempts.entries()) {
      if (!lessons.get(attempt.lessonId)?.topics.includes(attempt.topic))
        continue;
      const questionId = `sample-${prefix}-${index}`;
      const at = before(daysAgo);
      tx.create(
        database.doc(`attempts/${questionId}`),
        attemptSchema.parse({
          ...attempt,
          uid,
          questionId,
          at,
          answer: "SAMPLE seeded attempt",
          feedback: "SAMPLE practice history for the jury demo.",
        }),
      );
      const old = mastery.get(attempt.topic);
      mastery.set(
        attempt.topic,
        masterySchema.parse({
          uid,
          topic: attempt.topic,
          score: nextMastery(
            old?.score ?? INITIAL_MASTERY,
            attempt.correct,
            attempt.hintsUsed,
          ),
          attemptCount: (old?.attemptCount ?? 0) + 1,
          updatedAt: at,
        }),
      );
    }
    for (const row of mastery.values())
      tx.set(database.doc(`mastery/${masteryId(uid, row.topic)}`), row);
    tx.set(
      database.doc(`activity/${uid}`),
      activitySchema.parse({ uid, lastAt: before(0) }),
    );
    return profile;
  });
}
