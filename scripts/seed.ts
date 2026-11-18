import { readFile, stat } from "node:fs/promises";
import {
  bundleSchema,
  CATALOG_MAX_BYTES,
  listCatalog,
  publishCatalog,
  seedQuestions,
} from "../lib/catalog";
import { isDemo } from "../lib/firebase-admin";

async function main() {
  const file = process.argv[2] ?? "data/sample/SAMPLE_generative_ai.json";
  if (!isDemo() && process.env.ALLOW_CATALOG_WRITE !== "yes")
    throw new Error(
      "Set ALLOW_CATALOG_WRITE=yes to publish to a hosted project.",
    );
  if (!file.endsWith(".json") || (await stat(file)).size > CATALOG_MAX_BYTES)
    throw new Error("Supply a small JSON bundle.");
  const buffer = await readFile(file);
  const bundle = bundleSchema.parse(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer)),
  );
  const published = await publishCatalog(bundle);
  const catalog = await listCatalog();
  const counts = await Promise.all(
    catalog.modules.flatMap((module) =>
      module.lessons.map((lesson) =>
        seedQuestions(module.id, lesson.id).then((list) => list.length),
      ),
    ),
  );
  console.log(
    `${bundle.source}: ${published.unchanged ? "verified unchanged" : "published"} revision ${published.revision.slice(0, 12)}; ${catalog.modules.length} modules, ${counts.length} lessons, ${counts.reduce((total, n) => total + n, 0)} quiz items.`,
  );
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
