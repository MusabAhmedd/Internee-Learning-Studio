import assert from "node:assert/strict";
import { z } from "zod";
import { db } from "../lib/firebase-admin";
import { aiMode } from "../lib/openai";
import { sections } from "../lib/sections";
import {
  attemptSchema,
  gradeOutputSchema,
  lessonResponseSchema,
  planSchema,
  profileResponseSchema,
  questionSchema,
  quizPublicSchema,
  summaryResponseSchema,
} from "../lib/schemas";
import { readTutor, TutorStreamError } from "../lib/tutor-stream";
import { evalSession, origin } from "./eval-session";

function reportError(error: unknown) {
  if (error instanceof TutorStreamError) return error.code;
  if (error instanceof z.ZodError) return "SCHEMA_MISMATCH";
  if (error instanceof assert.AssertionError) return "EXPECTATION_FAILED";
  return error instanceof Error ? error.name : "UNKNOWN";
}

async function main() {
  if (
    aiMode() !== "gemini" ||
    origin !== "http://127.0.0.1:3000" ||
    process.env.FIREBASE_PROJECT_ID !== "demo-learning-studio" ||
    !/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? "")
  )
    throw new Error("Requires a local Gemini probe environment.");
  const session = await evalSession();
  let failures = 0;
  async function check(
    name: string,
    run: (started: number) => Promise<unknown>,
  ) {
    const started = performance.now();
    try {
      const metrics = await run(started);
      console.log(
        JSON.stringify({
          workflow: name,
          result: "PASS",
          ms: Math.round(performance.now() - started),
          metrics,
        }),
      );
    } catch (error) {
      failures++;
      console.error(
        JSON.stringify({
          workflow: name,
          result: "FAIL",
          ms: Math.round(performance.now() - started),
          code: reportError(error),
        }),
      );
    }
  }
  async function request(
    path: string,
    input?: unknown,
    method = input === undefined ? "GET" : "POST",
  ) {
    const response = await fetch(new URL(path, origin), {
      method,
      headers: {
        Authorization: `Bearer ${session.token}`,
        ...(input === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: input === undefined ? undefined : JSON.stringify(input),
      signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) {
      const body = z
        .object({
          error: z.object({ code: z.string().regex(/^[A-Z_]{2,40}$/) }),
        })
        .safeParse(await response.json().catch(() => null));
      throw new TutorStreamError(
        "Probe HTTP failure",
        body.success ? body.data.error.code : `HTTP_${response.status}`,
      );
    }
    return response;
  }
  const lessonId = "rag";
  let shortId: string | undefined;
  try {
    const profile = profileResponseSchema.parse(
      await (
        await request(
          "/api/profile",
          {
            displayName: "SAMPLE Gemini Probe",
            track: "Generative AI",
            level: "Beginner",
            weeklyHours: 4,
            goal: "Explain how retrieval grounds an answer.",
          },
          "PUT",
        )
      ).json(),
    );
    assert.ok(profile.profile);
    assert.ok(session.uid);
    const view = lessonResponseSchema.parse(
      await (await request(`/api/lesson/${lessonId}`)).json(),
    );
    const allowed = new Set(
      sections(lessonId, view.lesson.content).map((row) => row.id),
    );
    await check("tutor_stream", async (started) => {
      let first: number | undefined;
      const reply = await request("/api/tutor", {
        lessonId,
        mode: "explain",
        message:
          "How does retrieval before generation ground an answer in the lesson?",
      });
      const output = await readTutor(reply, (delta) => {
        if (delta.trim()) first ??= Math.round(performance.now() - started);
      });
      assert.ok(first !== undefined);
      assert.ok(
        output.citations.some((citation) => citation.chunkId === "rag--01"),
      );
      assert.ok(
        output.citations.every(
          (citation) =>
            citation.lessonId === lessonId && allowed.has(citation.chunkId),
        ),
      );
      return { firstTextMs: first, citationCount: output.citations.length };
    });
    await check("quiz_generation", async () => {
      const quiz = quizPublicSchema.parse(
        await (await request("/api/quiz/generate", { lessonId, n: 2 })).json(),
      );
      assert.equal(quiz.provider, "gemini");
      assert.equal(quiz.questions.length, 2);
      assert.ok(quiz.questions.some((row) => row.type === "mcq"));
      shortId = quiz.questions.find((row) => row.type === "short")?.id;
      assert.ok(shortId);
      return { questions: quiz.questions.length };
    });
    if (shortId) {
      const id = shortId;
      await check("short_answer_grading", async () => {
        // Read the rubric reference in this emulator-only test, never from the public API.
        const question = questionSchema.parse(
          (await db().doc(`quizQuestions/${id}`).get()).data(),
        );
        assert.equal(question.uid, session.uid);
        const grade = gradeOutputSchema.parse(
          await (
            await request("/api/quiz/grade", {
              questionId: id,
              answer: question.spec.answer,
            })
          ).json(),
        );
        assert.equal(grade.correct, true);
        assert.ok(grade.feedback.trim());
        const saved = attemptSchema.parse(
          (await db().doc(`attempts/${id}`).get()).data(),
        );
        assert.equal(saved.uid, session.uid);
        assert.equal(saved.correct, true);
        return { attemptPersisted: true };
      });
    } else {
      failures++;
      console.error(
        JSON.stringify({
          workflow: "short_answer_grading",
          result: "NOT RUN",
          code: "QUIZ_GENERATION_REQUIRED",
        }),
      );
    }
    await check("study_plan", async () => {
      const plan = planSchema.parse(
        await (await request("/api/plan", { uid: session.uid })).json(),
      );
      assert.equal(plan.days.length, 7);
      const minutes = plan.days.reduce((total, day) => total + day.minutes, 0);
      assert.ok(minutes > 0 && minutes <= 240);
      return { days: plan.days.length, minutes };
    });
    await check("weekly_recap", async () => {
      const { summary } = summaryResponseSchema.parse(
        await (await request("/api/summary", {})).json(),
      );
      assert.ok(summary?.text && summary.provider === "gemini");
      const cached = summaryResponseSchema.parse(
        await (await request("/api/summary", {})).json(),
      );
      assert.deepEqual(cached.summary, summary);
      return { cacheHit: true };
    });
  } finally {
    await session.dispose();
  }
  if (failures) process.exitCode = 1;
}
main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      workflow: "gemini_probe_setup",
      result: "FAIL",
      code: reportError(error),
    }),
  );
  process.exitCode = 1;
});
