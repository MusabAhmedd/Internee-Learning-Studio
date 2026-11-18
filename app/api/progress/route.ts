import { getLesson } from "@/lib/catalog";
import { db } from "@/lib/firebase-admin";
import { authenticated, HttpError, json, readJson } from "@/lib/http";
import {
  activitySchema,
  completionSchema,
  idSchema,
  progressInputSchema,
  progressSchema,
} from "@/lib/schemas";
export const GET = authenticated(async (request, claims) => {
  const lesson = idSchema.safeParse(
    new URL(request.url).searchParams.get("lessonId"),
  );
  if (!lesson.success)
    throw new HttpError(422, "INVALID_INPUT", "A lessonId is required.");
  const snap = await db()
    .doc(`users/${claims.uid}/progress/${lesson.data}`)
    .get();
  return json(
    completionSchema.parse({
      completed:
        snap.exists && progressSchema.parse(snap.data()).uid === claims.uid,
    }),
  );
});
export const POST = authenticated(async (request, claims) => {
  const input = await readJson(request, progressInputSchema);
  const { lesson } = await getLesson(input.lessonId);
  const ref = db().doc(`users/${claims.uid}/progress/${input.lessonId}`);
  const activity = db().doc(`activity/${claims.uid}`);
  await db().runTransaction(async (tx) => {
    const [snap, last] = await tx.getAll(ref, activity);
    if (snap.exists) {
      progressSchema.parse(snap.data());
      return;
    }
    const at = new Date().toISOString();
    const lastAt = last.exists ? activitySchema.parse(last.data()).lastAt : at;
    tx.set(
      activity,
      activitySchema.parse({
        uid: claims.uid,
        lastAt: lastAt > at ? lastAt : at,
      }),
    );
    tx.create(
      ref,
      progressSchema.parse({
        ...input,
        studySeconds: Math.min(lesson.estMinutes * 60, input.studySeconds),
        uid: claims.uid,
        completedAt: at,
      }),
    );
  });
  return json(completionSchema.parse({ completed: true }));
});
