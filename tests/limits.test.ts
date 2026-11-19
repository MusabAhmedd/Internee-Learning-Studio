import assert from "node:assert/strict";
import { test } from "node:test";
import { oncePerRequest } from "../lib/limits";
import { tutorAnswer } from "../lib/tutor";
import { lessonResponseSchema } from "../lib/schemas";

test("admission is lazy and the embedding and chat share one reservation", async () => {
  let calls = 0;
  const admit = oncePerRequest(async () => {
    calls++;
  });
  assert.equal(calls, 0);
  await Promise.all([admit(), admit(), admit()]);
  assert.equal(calls, 1);
});

test("a fixed hint uses canonical lesson text and never requests provider admission", async () => {
  const view = lessonResponseSchema.parse({
    lesson: {
      id: "rag",
      title: "Grounding answers",
      order: 1,
      topics: ["RAG"],
      estMinutes: 30,
      content:
        "## Retrieval before generation\nRetrieval finds relevant excerpts that help the learner verify a grounded answer.",
    },
    module: {
      id: "m-rag",
      title: "Retrieval",
      description: "Ground answers in a lesson.",
      order: 1,
      track: "Generative AI",
      source: "SAMPLE",
    },
    nextLessonId: null,
  });
  const result = await tutorAnswer(
    view,
    "hint",
    "Where does retrieval help?",
    [],
    {
      admit: () => {
        throw new Error("Fixed hint tried to use Gemini quota");
      },
    },
    () => {},
  );
  assert.match(result.answer, /\?/);
  assert.deepEqual(result.citations, [{ lessonId: "rag", chunkId: "rag--01" }]);
});
