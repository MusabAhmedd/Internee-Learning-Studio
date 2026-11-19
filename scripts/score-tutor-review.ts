import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { citationSchema, idSchema } from "../lib/schemas";

const observation = z.object({
  provider: z.enum(["demo", "gemini"]),
  results: z
    .array(
      z.object({
        id: idSchema,
        answer: z.string().optional(),
        citations: z.array(citationSchema).optional(),
      }),
    )
    .min(1),
});
const reviewSchema = z.strictObject({
  reviewer: z.string().trim().min(2).max(120),
  reviewedOn: z.iso.date(),
  observationSha256: z.string().regex(/^[a-f0-9]{64}$/),
  cases: z.array(
    z.strictObject({
      id: idSchema,
      decision: z.enum(["pass", "fail"]),
      notes: z.string().trim().min(3),
      claims: z.array(
        z.strictObject({
          quote: z.string().trim().min(3),
          correctness: z.enum(["correct", "incorrect", "unverifiable"]),
          support: z.enum([
            "entailed",
            "contradicted",
            "not-supported",
            "not-applicable",
          ]),
          evidenceId: citationSchema.shape.chunkId.nullable(),
          rationale: z.string().trim().min(3),
        }),
      ),
    }),
  ),
});
async function main() {
  const [observationPath, reviewPath] = process.argv.slice(2);
  if (!observationPath)
    throw new Error(
      "Usage: npm run eval:review -- <observations.json> [completed-review.json]",
    );
  const bytes = await readFile(observationPath);
  const observed = observation.parse(JSON.parse(bytes.toString("utf8")));
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (!reviewPath) {
    console.log(
      JSON.stringify(
        {
          reviewer: "",
          reviewedOn: "",
          observationSha256: digest,
          cases: observed.results.map((row) => ({
            id: row.id,
            decision: "",
            notes: "",
            claims: [],
          })),
        },
        null,
        2,
      ),
    );
    return;
  }
  const reviewed = reviewSchema.parse(
    JSON.parse(await readFile(reviewPath, "utf8")),
  );
  if (reviewed.observationSha256 !== digest)
    throw new Error("Review does not match this exact observation file.");
  const byId = new Map(observed.results.map((row) => [row.id, row]));
  if (
    reviewed.cases.length !== byId.size ||
    new Set(reviewed.cases.map((row) => row.id)).size !== byId.size
  )
    throw new Error("Review every observed case exactly once.");
  let incorrect = 0,
    correct = 0,
    unverifiable = 0,
    entailed = 0,
    contradicted = 0,
    unsupported = 0;
  for (const item of reviewed.cases) {
    const row = byId.get(item.id);
    if (!row) throw new Error("Review refers to an unknown case.");
    if (
      item.decision === "pass" &&
      (!row.answer ||
        item.claims.some(
          (claim) =>
            claim.correctness !== "correct" ||
            ["contradicted", "not-supported"].includes(claim.support),
        ))
    )
      throw new Error(`Pass verdict contradicts evidence on ${item.id}.`);
    for (const claim of item.claims) {
      if (!row.answer?.includes(claim.quote))
        throw new Error(
          `A claim quote is not in the observed answer for ${item.id}.`,
        );
      if (
        (claim.support === "entailed" || claim.support === "contradicted") &&
        !row.citations?.some(
          (citation) => citation.chunkId === claim.evidenceId,
        )
      )
        throw new Error(
          `Point evidenceId to an actually cited excerpt in ${item.id}.`,
        );
      if (claim.correctness === "correct") correct++;
      else if (claim.correctness === "incorrect") incorrect++;
      else unverifiable++;
      if (claim.support === "entailed") entailed++;
      else if (claim.support === "contradicted") contradicted++;
      else if (claim.support === "not-supported") unsupported++;
    }
  }
  console.log(
    JSON.stringify(
      {
        provider: observed.provider,
        reviewedOn: reviewed.reviewedOn,
        cases: {
          pass: reviewed.cases.filter((row) => row.decision === "pass").length,
          total: reviewed.cases.length,
        },
        factual: {
          correct,
          incorrect,
          scorable: correct + incorrect,
          unverifiable,
        },
        citationSupport: {
          entailed,
          contradicted,
          unsupported,
          assessed: entailed + contradicted + unsupported,
        },
      },
      null,
      2,
    ),
  );
}
main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "Review scoring failed",
  );
  process.exitCode = 1;
});
