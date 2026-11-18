import { requireAdmin } from "@/lib/admin";
import {
  bundleSchema,
  CATALOG_MAX_BYTES,
  publishCatalog,
  revisionOf,
} from "@/lib/catalog";
import { bucket } from "@/lib/firebase-admin";
import { authenticated, HttpError, json, readJson } from "@/lib/http";
import { takeAiQuota } from "@/lib/limits";
import { importResponseSchema } from "@/lib/schemas";
export const maxDuration = 45;
export const POST = authenticated(async (request, claims) => {
  await requireAdmin(claims);
  const name = request.headers.get("x-filename") ?? "";
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,88}\.json$/i.test(name))
    throw new HttpError(
      422,
      "INVALID_FILENAME",
      "Use a .json filename with letters, digits, dots, underscores, or hyphens.",
    );
  const bundle = await readJson(request, bundleSchema, CATALOG_MAX_BYTES);
  if (bundle.source === "SAMPLE" && !name.startsWith("SAMPLE_"))
    throw new HttpError(
      422,
      "SAMPLE_LABEL",
      "A sample bundle filename must start with SAMPLE_.",
    );
  await takeAiQuota(claims.uid);
  // The object is private; publish only validated plain JSON. Content-addressed archives are idempotent.
  await bucket()
    .file(`curricula/${revisionOf(bundle)}.json`)
    .save(JSON.stringify(bundle), {
      contentType: "application/json",
      resumable: false,
    });
  const result = await publishCatalog(bundle);
  return json(
    importResponseSchema.parse({
      ...result,
      modules: bundle.modules.length,
      lessons: bundle.modules.reduce(
        (count, item) => count + item.lessons.length,
        0,
      ),
    }),
  );
});
