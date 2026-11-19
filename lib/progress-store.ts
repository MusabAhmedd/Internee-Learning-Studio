import type { DocumentSnapshot } from "firebase-admin/firestore";
import type { z } from "zod";
import { db } from "./firebase-admin";
import { HttpError } from "./http";
import {
  activitySchema,
  completionSchema,
  progressInputSchema,
  progressSchema,
  uidSchema,
} from "./schemas";
import {
  getStudyCredit,
  studyCursorSchema,
  STUDY_LESSON_MAX_SECONDS,
} from "./study-time";

type Mark = z.infer<typeof progressSchema>;
function readMark(uid: string, snap: DocumentSnapshot) {
  if (!snap.exists) return null;
  const row = progressSchema.parse(snap.data());
  if (row.uid !== uid || row.lessonId !== snap.id)
    throw new HttpError(403, "FORBIDDEN", "This progress record is not yours.");
  return row;
}
const present = (row: Mark | null) =>
  completionSchema.parse({
    completed: Boolean(row?.completedAt),
    studySeconds: row?.studySeconds ?? 0,
    serverTimeMs: Date.now(),
  });
export async function progressFor(uid: string) {
  const result = await db()
    .collection(`users/${uidSchema.parse(uid)}/progress`)
    .limit(400)
    .get();
  return result.docs.flatMap((snap) => {
    const row = readMark(uid, snap);
    return row ? [row] : [];
  });
}
export async function completions(uid: string) {
  return (await progressFor(uid)).filter((row) => row.completedAt !== null);
}
export async function getProgress(uid: string, lessonId: string) {
  const snap = await db().doc(`users/${uid}/progress/${lessonId}`).get();
  return present(readMark(uid, snap));
}
export async function saveProgress(
  uid: string,
  estimatedMinutes: number,
  input: z.infer<typeof progressInputSchema>,
) {
  const database = db();
  const ref = database.doc(`users/${uid}/progress/${input.lessonId}`);
  const cursor = database.doc(`studyCursors/${uid}`);
  const activity = database.doc(`activity/${uid}`);
  return database.runTransaction(async (tx) => {
    const [snap, watermark, last] = await tx.getAll(ref, cursor, activity);
    const prior = readMark(uid, snap);
    const nowMs = Date.now();
    const at = new Date(nowMs).toISOString();
    const prevThrough = watermark.exists
      ? studyCursorSchema.parse(watermark.data()).throughMs
      : 0;
    const interval = input.interval;
    const credit = interval
      ? getStudyCredit(interval, prevThrough, nowMs)
      : undefined;
    if (credit === null)
      throw new HttpError(
        422,
        "STUDY_INTERVAL_WINDOW",
        "The study interval expired or is ahead of the server clock. Refresh the lesson and try again.",
      );
    const capMs =
      Math.min(estimatedMinutes * 60, STUDY_LESSON_MAX_SECONDS) * 1000;
    const priorMs =
      (prior?.studySeconds ?? 0) * 1000 + (prior?.studyRemainderMs ?? 0);
    const added = Math.min(
      credit?.acceptedMs ?? 0,
      Math.max(0, capMs - priorMs),
    );
    const markComplete = input.complete && !prior?.completedAt;
    if (credit && credit.throughMs > prevThrough)
      tx.set(cursor, studyCursorSchema.parse({ throughMs: credit.throughMs }));
    if (!added && !markComplete) return present(prior);
    const current = priorMs + added;
    const next = progressSchema.parse({
      uid,
      lessonId: input.lessonId,
      studySeconds: Math.floor(current / 1000),
      studyRemainderMs: current % 1000,
      completedAt: prior?.completedAt ?? (markComplete ? at : null),
    });
    const lastAt = last.exists ? activitySchema.parse(last.data()).lastAt : at;
    tx.set(
      activity,
      activitySchema.parse({ uid, lastAt: lastAt > at ? lastAt : at }),
    );
    tx.set(ref, next);
    return present(next);
  });
}
