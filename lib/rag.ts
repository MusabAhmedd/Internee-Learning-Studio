import { createHash } from "node:crypto";
import { z } from "zod";
import { db } from "./firebase-admin";
import { getLesson, listCatalog } from "./catalog";
import {
  aiMode,
  embed,
  embeddingModel,
  embeddingSchema,
  terms,
  type ProviderOptions,
} from "./openai";
import { idSchema, revisionSchema, text, type LessonView } from "./schemas";
import { sections, sectionSchema } from "./sections";
import { HttpError } from "./http";

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const chunkSchema = z.strictObject({
  lessonId: idSchema,
  sectionTitle: text(2, 110),
  text: text(16, 1600, true),
  embedding: embeddingSchema,
  model: z.string().min(1).max(100),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export const indexedChunkSchema = chunkSchema.extend({
  id: sectionSchema.shape.id,
});
export type IndexedChunk = z.infer<typeof indexedChunkSchema>;
export const contentHash = (
  title: string,
  section: { title: string; text: string },
) => hash(JSON.stringify([title, section.title, section.text]));

export async function buildLessonIndex(
  lessonId: string,
  title: string,
  content: string,
) {
  const database = db();
  const blocks = sections(lessonId, content);
  const refs = blocks.map((block) =>
    database.doc(`lessons_chunks/${block.id}`),
  );
  const stored = await database.getAll(...refs);
  const model = embeddingModel();
  let cached = 0;
  const chunks: IndexedChunk[] = [];
  for (let index = 0; index < blocks.length; index += 3) {
    const batch = await Promise.all(
      blocks.slice(index, index + 3).map(async (block, offset) => {
        const signature = contentHash(title, block);
        const snapshot = stored[index + offset];
        if (snapshot?.exists) {
          const previous = chunkSchema.parse(snapshot.data());
          if (
            previous.model === model &&
            previous.contentHash === signature &&
            previous.lessonId === lessonId &&
            previous.text === block.text &&
            previous.sectionTitle === block.title
          ) {
            cached++;
            return indexedChunkSchema.parse({ ...previous, id: block.id });
          }
        }
        const embedding = await embed(
          `${title}\n${block.title}\n${block.text}`,
        );
        return indexedChunkSchema.parse({
          id: block.id,
          lessonId,
          sectionTitle: block.title,
          text: block.text,
          embedding,
          model,
          contentHash: signature,
        });
      }),
    );
    chunks.push(...batch);
  }
  return { chunks, cached };
}

export async function indexCatalog() {
  const database = db();
  const marker = database.doc("catalog/meta");
  const current = await marker.get();
  if (!current.exists)
    throw new HttpError(
      409,
      "CATALOG_EMPTY",
      "Seed or import a curriculum before indexing.",
    );
  const { revision } = revisionSchema.parse(current.data());
  const { modules } = await listCatalog();
  const records: IndexedChunk[] = [];
  let cached = 0;
  for (const item of modules.flatMap((item) => item.lessons)) {
    const { lesson } = await getLesson(item.id);
    const result = await buildLessonIndex(
      lesson.id,
      lesson.title,
      lesson.content,
    );
    records.push(...result.chunks);
    cached += result.cached;
  }
  const old = await database
    .collection("lessons_chunks")
    .select()
    .limit(240)
    .get();
  const ids = new Set(records.map((chunk) => chunk.id));
  await database.runTransaction(async (tx) => {
    const fresh = revisionSchema.parse((await tx.get(marker)).data());
    if (fresh.revision !== revision)
      throw new HttpError(
        409,
        "CATALOG_CHANGED",
        "Catalog changed during indexing. Retry.",
      );
    for (const record of records) {
      const { id, ...fields } = indexedChunkSchema.parse(record);
      tx.set(database.doc(`lessons_chunks/${id}`), chunkSchema.parse(fields));
    }
    for (const row of old.docs) if (!ids.has(row.id)) tx.delete(row.ref);
  });
  return { count: records.length, cached, model: embeddingModel() };
}

export function cosine(left: number[], right: number[]) {
  if (left.length !== right.length) return -1;
  let product = 0,
    a = 0,
    b = 0;
  for (let i = 0; i < left.length; i++) {
    product += left[i] * right[i];
    a += left[i] ** 2;
    b += right[i] ** 2;
  }
  return a && b ? product / Math.sqrt(a * b) : -1;
}

const queryCache = new Map<string, { vector: number[]; until: number }>();
async function queryVector(value: string, options?: ProviderOptions) {
  const key = hash(`${embeddingModel()}\0${value.toLowerCase()}`);
  const cached = queryCache.get(key);
  if (cached && cached.until > Date.now()) {
    queryCache.delete(key);
    queryCache.set(key, cached);
    return cached.vector;
  }
  const vector = await embed(value, options);
  queryCache.set(key, { vector, until: Date.now() + 15 * 60 * 1000 });
  if (queryCache.size > 128) {
    const oldest = queryCache.keys().next().value;
    if (oldest) queryCache.delete(oldest);
  }
  return vector;
}

export async function retrieve(
  view: LessonView,
  question: string,
  options?: ProviderOptions,
  wholeLesson = false,
) {
  const model = embeddingModel();
  const { lesson } = view;
  const database = db();
  const current = sections(lesson.id, lesson.content);
  const reference = new Map(current.map((row) => [row.id, row]));
  const hits = await database
    .collection("lessons_chunks")
    .where("lessonId", "==", lesson.id)
    .limit(8)
    .get();
  const chunks = hits.docs
    .map((doc) =>
      indexedChunkSchema.parse({
        id: doc.id,
        ...chunkSchema.parse(doc.data()),
      }),
    )
    .filter((row) => {
      const block = reference.get(row.id);
      return (
        block &&
        row.model === model &&
        row.contentHash === contentHash(lesson.title, block) &&
        row.text === block.text &&
        row.sectionTitle === block.title
      );
    });
  if (chunks.length !== current.length)
    throw new HttpError(
      409,
      "INDEX_PENDING",
      "Lesson sources are being indexed. Retry after the learning team updates the index.",
    );
  if (wholeLesson)
    return chunks.sort((a, b) => a.id.localeCompare(b.id)).slice(0, 3);
  const queryTerms = terms(question);
  if (!queryTerms.length) return [];
  const vector = await queryVector(question, options);
  const demo = aiMode() === "demo";
  const ranked = chunks
    .map((chunk) => {
      const heading = new Set(terms(chunk.sectionTitle));
      const body = new Set(terms(`${chunk.sectionTitle} ${chunk.text}`));
      const overlap = queryTerms.filter((term) => body.has(term)).length;
      const headlineHits = queryTerms.filter((term) =>
        heading.has(term),
      ).length;
      const score = cosine(vector, chunk.embedding);
      return {
        chunk,
        overlap,
        score,
        rank: score + headlineHits * (demo ? 0.14 : 0.025),
      };
    })
    .filter((hit) =>
      demo ? hit.overlap > 0 && hit.score >= 0.06 : hit.score >= 0.32,
    )
    .sort((a, b) => b.rank - a.rank);
  return ranked.slice(0, 3).map((hit) => hit.chunk);
}
