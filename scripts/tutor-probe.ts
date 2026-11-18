import assert from "node:assert/strict";
import { evalSession, origin } from "./eval-session";
import { readTutor } from "../lib/tutor-stream";
import { db } from "../lib/firebase-admin";
import { indexedChunkSchema } from "../lib/rag";
import { aiMode } from "../lib/openai";

async function main() {
  const url = `${origin}/api/tutor`;
  const session = await evalSession();
  const headers = {
    Authorization: `Bearer ${session.token}`,
    "Content-Type": "application/json",
  };
  try {
    assert.equal((await fetch(`${url}?lessonId=rag`)).status, 401);
    assert.equal((await fetch(`${url}?lessonId=rag`, { headers })).status, 200); // warm route + Firestore; no model warmup
    const start = performance.now();
    let first: number | undefined;
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        lessonId: "rag",
        mode: "explain",
        message: "What does retrieval before generation accomplish?",
      }),
      signal: AbortSignal.timeout(40_000),
    });
    assert.equal(response.status, 200);
    assert.ok(
      response.headers.get("content-type")?.startsWith("application/x-ndjson"),
    );
    const { citations } = await readTutor(response, (text) => {
      if (text.trim()) first ??= performance.now() - start;
    });
    assert.ok(
      first !== undefined && first < 2000,
      `First text exceeded target: ${first}ms`,
    );
    assert.deepEqual(citations, [{ lessonId: "rag", chunkId: "rag--01" }]);
    for (const citation of citations) {
      const snapshot = await db()
        .doc(`lessons_chunks/${citation.chunkId}`)
        .get();
      const row = indexedChunkSchema.parse({
        ...snapshot.data(),
        id: snapshot.id,
      });
      assert.equal(row.lessonId, citation.lessonId);
    }
    console.log(
      `Provider: ${aiMode()}; warmed local HTTP first text: ${first.toFixed(1)} ms (< 2000 ms).`,
    );
    console.log(
      `Citations resolved: ${citations.map((item) => item.chunkId).join(", ")}. Unauthenticated request returned 401.`,
    );
  } finally {
    await session.dispose();
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
