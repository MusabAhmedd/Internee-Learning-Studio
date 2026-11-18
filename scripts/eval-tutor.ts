import { readFile } from "node:fs/promises";
import { z } from "zod";
import {
  chatViewSchema,
  citationSchema,
  idSchema,
  tutorInputSchema,
} from "../lib/schemas";
import { readTutor } from "../lib/tutor-stream";
import { evalSession, origin } from "./eval-session";

const dataset = z
  .array(
    z.strictObject({
      lessonId: idSchema,
      message: tutorInputSchema.shape.message,
      expected: citationSchema.shape.chunkId.nullable(),
    }),
  )
  .length(20);
const pct = (n: number, total: number) =>
  `${((100 * n) / total).toFixed(1)}% (${n}/${total})`;
const quantile = (values: number[], p: number) =>
  values.length
    ? values[Math.max(0, Math.ceil(values.length * p) - 1)].toFixed(1)
    : "NOT RUN";

async function main() {
  const cases = dataset.parse(
    JSON.parse(await readFile("data/sample/SAMPLE_tutor_eval.json", "utf8")),
  );
  const session = await evalSession();
  try {
    const headers = {
      Authorization: `Bearer ${session.token}`,
      "Content-Type": "application/json",
    };
    const url = `${origin}/api/tutor`;
    const warm = await fetch(`${url}?lessonId=${cases[0].lessonId}`, {
      headers,
      signal: AbortSignal.timeout(15_000),
    });
    if (!warm.ok) throw new Error(`Tutor warm-up returned HTTP ${warm.status}`);
    const { provider } = chatViewSchema.parse(await warm.json());
    console.log(
      `SAMPLE tutor evaluation; provider=${provider}; ${cases.length} cases. HTTP route warmed with GET; model not pre-warmed.`,
    );
    let correct = 0,
      abstained = 0,
      answered = 0,
      errors = 0;
    const times: number[] = [];
    for (const [index, row] of cases.entries()) {
      const start = performance.now();
      let first: number | undefined;
      try {
        const response = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({
            lessonId: row.lessonId,
            mode: "explain",
            message: row.message,
          }),
          signal: AbortSignal.timeout(40_000),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const result = await readTutor(response, (text) => {
          if (text.trim()) first ??= performance.now() - start;
        });
        if (first !== undefined) times.push(first);
        const pass =
          row.expected === null
            ? result.citations.length === 0 &&
              result.text.startsWith("I can only answer from this lesson.")
            : result.citations.some(
                (citation) =>
                  citation.lessonId === row.lessonId &&
                  citation.chunkId === row.expected,
              );
        if (row.expected === null) {
          if (pass) abstained++;
        } else {
          if (result.citations.length) answered++;
          if (pass) correct++;
        }
        console.log(
          `${String(index + 1).padStart(2, "0")} ${pass ? "PASS" : "MISS"} lesson=${row.lessonId} expected=${row.expected ?? "abstain"} cited=${result.citations.map((item) => item.chunkId).join(",") || "none"} first_ms=${first?.toFixed(1) ?? "none"}`,
        );
        // Keep a hosted eval below the default per-user burst limit; local emulators allow the full benchmark in one minute.
        if (provider === "gemini" && index === 9)
          await new Promise((resolve) => setTimeout(resolve, 61_000));
      } catch (error) {
        errors++;
        console.log(
          `${index + 1} ERROR ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }
    }
    const inScope = cases.filter((row) => row.expected !== null).length;
    times.sort((a, b) => a - b);
    console.log(`In scope with correct citation: ${pct(correct, inScope)}`);
    console.log(`In scope with a citation: ${pct(answered, inScope)}`);
    console.log(
      `Out-of-scope abstention: ${pct(abstained, cases.length - inScope)}`,
    );
    console.log(
      `First visible text p50=${quantile(times, 0.5)} ms; p95=${quantile(times, 0.95)} ms; errors=${errors}.`,
    );
    if (errors) process.exitCode = 1;
    if (provider === "demo")
      console.log(
        "Gemini live groundedness and latency: NOT RUN. Citation-label agreement does not measure full factual support.",
      );
  } finally {
    await session.dispose();
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
