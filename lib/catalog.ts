import { createHash } from "node:crypto";
import { z } from "zod";
import { db } from "./firebase-admin";
import {
  catalogIndexSchema,
  catalogSchema,
  idSchema,
  lessonPreviewSchema,
  lessonResponseSchema,
  lessonSchema,
  moduleSchema,
  quizSeedSchema,
  revisionSchema,
  sourceSchema,
} from "./schemas";
import { sections } from "./sections";
import { HttpError } from "./http";

const bundleLesson = lessonSchema.extend({
  id: idSchema,
  quizzes: z.array(quizSeedSchema).min(1).max(5),
});
const bundleModule = moduleSchema
  .omit({ source: true })
  .extend({ id: idSchema, lessons: z.array(bundleLesson).min(1).max(8) });
export const bundleSchema = z
  .strictObject({
    source: sourceSchema,
    modules: z.array(bundleModule).min(1).max(12),
  })
  .superRefine((bundle, ctx) => {
    const ids = bundle.modules.flatMap((module) => [
      module.id,
      ...module.lessons.map((lesson) => lesson.id),
    ]);
    if (
      new Set(ids).size !== ids.length ||
      ids.length - bundle.modules.length > 24
    )
      ctx.addIssue({
        code: "custom",
        path: ["modules"],
        message: "Use globally unique IDs and at most 24 lessons.",
      });
    bundle.modules.forEach((module, mi) =>
      module.lessons.forEach((lesson, li) => {
        try {
          sections(lesson.id, lesson.content);
        } catch {
          ctx.addIssue({
            code: "custom",
            path: ["modules", mi, "lessons", li, "content"],
            message: "Use valid ## lesson sections.",
          });
        }
        if (
          new Set(lesson.topics).size !== lesson.topics.length ||
          new Set(lesson.quizzes.map((entry) => entry.id)).size !==
            lesson.quizzes.length ||
          lesson.quizzes.some(
            (entry) => !lesson.topics.includes(entry.question.topic),
          )
        )
          ctx.addIssue({
            code: "custom",
            path: ["modules", mi, "lessons", li, "quizzes"],
            message: "Use distinct IDs and topics from the lesson.",
          });
      }),
    );
  });
export type Bundle = z.infer<typeof bundleSchema>;
export const CATALOG_MAX_BYTES = 98_304;
export const revisionOf = (bundle: Bundle) =>
  createHash("sha256").update(JSON.stringify(bundle)).digest("hex");

export async function listCatalog() {
  const database = db();
  const snapshot = await database
    .collection("modules")
    .orderBy("order")
    .limit(12)
    .get();
  const modules = await Promise.all(
    snapshot.docs.map(async (moduleDoc) => {
      const metadata = moduleSchema.parse(moduleDoc.data());
      const lessons = await moduleDoc.ref
        .collection("lessons")
        .orderBy("order")
        .limit(8)
        .get();
      return {
        ...metadata,
        id: moduleDoc.id,
        lessons: lessons.docs.map((doc) => {
          const { title, order, topics, estMinutes } = lessonSchema.parse(
            doc.data(),
          );
          return lessonPreviewSchema.parse({
            id: doc.id,
            title,
            order,
            topics,
            estMinutes,
          });
        }),
      };
    }),
  );
  return catalogSchema.parse({ modules });
}

export async function getLesson(id: string) {
  const database = db();
  const index = await database.doc(`lesson_index/${idSchema.parse(id)}`).get();
  if (!index.exists)
    throw new HttpError(
      404,
      "LESSON_NOT_FOUND",
      "This lesson is no longer available.",
    );
  const { moduleId } = catalogIndexSchema.parse(index.data());
  const moduleRef = database.doc(`modules/${moduleId}`);
  const [moduleSnap, lessonSnap, siblings] = await Promise.all([
    moduleRef.get(),
    moduleRef.collection("lessons").doc(id).get(),
    moduleRef.collection("lessons").orderBy("order").limit(8).get(),
  ]);
  if (!moduleSnap.exists || !lessonSnap.exists)
    throw new HttpError(
      404,
      "LESSON_NOT_FOUND",
      "This lesson is no longer available.",
    );
  const next = siblings.docs.findIndex((candidate) => candidate.id === id) + 1;
  return lessonResponseSchema.parse({
    lesson: { ...lessonSchema.parse(lessonSnap.data()), id },
    module: { ...moduleSchema.parse(moduleSnap.data()), id: moduleId },
    nextLessonId: siblings.docs[next]?.id ?? null,
  });
}

export async function seedQuestions(moduleId: string, lessonId: string) {
  const result = await db()
    .collection(
      `modules/${idSchema.parse(moduleId)}/lessons/${idSchema.parse(lessonId)}/quizzes`,
    )
    .limit(5)
    .get();
  return result.docs.map(
    (doc) =>
      quizSeedSchema.parse({ id: doc.id, question: doc.data() }).question,
  );
}

export async function publishCatalog(raw: Bundle) {
  const bundle = bundleSchema.parse(raw);
  const database = db();
  const revision = revisionOf(bundle);
  const marker = database.doc("catalog/meta");
  const current = await marker.get();
  if (
    current.exists &&
    revisionSchema.parse(current.data()).revision === revision
  )
    return { revision, unchanged: true };
  const previous = await database.collection("modules").limit(13).get();
  const priorPaths = new Set<string>();
  for (const moduleDoc of previous.docs) {
    priorPaths.add(moduleDoc.ref.path);
    const lessons = await moduleDoc.ref.collection("lessons").limit(9).get();
    for (const lesson of lessons.docs) {
      priorPaths.add(lesson.ref.path);
      priorPaths.add(`lesson_index/${lesson.id}`);
      const quizzes = await lesson.ref.collection("quizzes").limit(6).get();
      quizzes.docs.forEach((quiz) => priorPaths.add(quiz.ref.path));
    }
  }
  const writes = new Map<string, Record<string, unknown>>();
  for (const { id, lessons, ...metadata } of bundle.modules) {
    writes.set(
      `modules/${id}`,
      moduleSchema.parse({ ...metadata, source: bundle.source }),
    );
    for (const { id: lessonId, quizzes, ...lesson } of lessons) {
      const path = `modules/${id}/lessons/${lessonId}`;
      writes.set(
        `lesson_index/${lessonId}`,
        catalogIndexSchema.parse({ moduleId: id }),
      );
      writes.set(path, lessonSchema.parse(lesson));
      for (const quiz of quizzes)
        writes.set(
          `${path}/quizzes/${quiz.id}`,
          quizSeedSchema.parse(quiz).question,
        );
    }
  }
  const removed = [...priorPaths].filter((path) => !writes.has(path));
  if (writes.size + removed.length + 1 > 450)
    throw new HttpError(
      422,
      "CATALOG_SIZE",
      "The catalog change is too large for one safe publish.",
    );
  await database.runTransaction(async (tx) => {
    const fresh = await tx.get(marker);
    if (
      (fresh.exists ? revisionSchema.parse(fresh.data()).revision : null) !==
      (current.exists ? revisionSchema.parse(current.data()).revision : null)
    )
      throw new HttpError(
        409,
        "CATALOG_CHANGED",
        "The catalog changed during import. Retry with the current version.",
      );
    for (const [path, value] of writes) tx.set(database.doc(path), value);
    for (const path of removed) tx.delete(database.doc(path));
    tx.set(marker, revisionSchema.parse({ revision, source: bundle.source }));
  });
  return { revision, unchanged: false };
}
