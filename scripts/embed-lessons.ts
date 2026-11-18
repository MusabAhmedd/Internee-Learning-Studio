import assert from "node:assert/strict";
import { getLesson } from "../lib/catalog";
import { isDemo } from "../lib/firebase-admin";
import { indexCatalog, retrieve } from "../lib/rag";

async function main() {
  if (!isDemo() && process.env.ALLOW_CATALOG_WRITE !== "yes")
    throw new Error("Set ALLOW_CATALOG_WRITE=yes to index a hosted project.");
  const index = await indexCatalog();
  console.log(
    `Index: ${index.count} sections; ${index.cached} embeddings reused; model=${index.model}.`,
  );
  if (process.argv.includes("--verify")) {
    const lesson = await getLesson("rag");
    const top = (
      await retrieve(
        lesson,
        "What does retrieval before generation accomplish?",
      )
    )[0];
    assert.equal(top?.id, "rag--01");
    assert.equal(top?.sectionTitle, "Retrieval before generation");
    console.log(`Query top match: ${top.id} — ${top.sectionTitle} (expected).`);
  }
}
main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
