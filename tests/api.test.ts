import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import { bundleSchema, listCatalog, revisionOf } from "../lib/catalog";
import { bucket, db, isDemo } from "../lib/firebase-admin";
import {
  attemptSchema,
  gradeOutputSchema,
  importResponseSchema,
  quizPublicSchema,
} from "../lib/schemas";
import { readTutor } from "../lib/tutor-stream";
import { evalSession, origin } from "../scripts/eval-session";

const call = (
  path: string,
  token?: string,
  method = "GET",
  body?: unknown,
  extra: Record<string, string> = {},
) =>
  fetch(new URL(path, origin), {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...extra,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });

test("feature routes require a Firebase ID token", async () => {
  for (const path of [
    "/api/plan",
    "/api/tutor",
    "/api/quiz/generate",
    "/api/quiz/grade",
    "/api/summary",
    "/api/admin/import",
  ]) {
    const result = await call(path, undefined, "POST", {});
    assert.equal(result.status, 401, path);
    assert.equal((await result.json()).error.code, "UNAUTHENTICATED");
  }
});

test("quiz keys stay private; hint is Socratic and idempotent grading records a single attempt", async () => {
  assert.ok(isDemo());
  const session = await evalSession();
  const outsider = await evalSession();
  try {
    const response = await call("/api/quiz/generate", session.token, "POST", {
      lessonId: "rag",
      n: 1,
    });
    assert.equal(response.status, 200);
    const questions = quizPublicSchema.parse(await response.json());
    const [question] = questions.questions;
    assert.equal(Object.hasOwn(question, "answer"), false);
    assert.equal(
      (
        await call("/api/quiz/grade", outsider.token, "POST", {
          questionId: question.id,
          answer: "Retrieval",
        })
      ).status,
      404,
    );
    const hint = await call("/api/tutor", session.token, "POST", {
      lessonId: "rag",
      mode: "hint",
      message: question.prompt,
      questionId: question.id,
    });
    assert.equal(hint.status, 200);
    const socratic = await readTutor(hint, () => {});
    assert.ok(socratic.text.includes("?"));
    assert.doesNotMatch(socratic.text, /\bRetrieval\b/i);
    assert.ok(socratic.citations.length > 0);
    const grade = () =>
      call("/api/quiz/grade", session.token, "POST", {
        questionId: question.id,
        answer: "Retrieval",
      });
    const first = gradeOutputSchema.parse(await (await grade()).json());
    assert.equal(first.correct, true);
    const repeat = gradeOutputSchema.parse(await (await grade()).json());
    assert.deepEqual(first, repeat);
    const snapshot = await db().doc(`attempts/${question.id}`).get();
    const saved = attemptSchema.parse(snapshot.data());
    assert.equal(saved.hintsUsed, 1);
    assert.equal(saved.uid, session.uid);
    assert.equal(
      (await call("/api/plan", outsider.token, "POST", { uid: session.uid }))
        .status,
      403,
    );
    console.log(
      "Assessment checks: authorized hint recorded once; answer not leaked; cross-user grade rejected.",
    );
  } finally {
    await Promise.all([session.dispose(), outsider.dispose()]);
  }
});

test("admin requires the realtime claim; validates and archives JSON before catalog replacement", async () => {
  const regular = await evalSession();
  const admin = await evalSession("admin");
  const original = bundleSchema.parse(
    JSON.parse(await readFile("data/sample/SAMPLE_generative_ai.json", "utf8")),
  );
  const changed = structuredClone(original);
  changed.modules[0].description =
    "SAMPLE administrative round-trip. Learn to design prompts with appropriate boundaries.";
  const headers = { "X-Filename": "SAMPLE_admin_test.json" };
  try {
    assert.equal((await call("/api/admin", regular.token)).status, 403);
    assert.equal(
      (await call("/api/admin/import", regular.token, "POST", changed, headers))
        .status,
      403,
    );
    assert.equal((await call("/api/admin", admin.token)).status, 200);
    assert.equal(
      (
        await call(
          "/api/admin/import",
          admin.token,
          "POST",
          { invalid: true },
          headers,
        )
      ).status,
      422,
    );
    const uploaded = await call(
      "/api/admin/import",
      admin.token,
      "POST",
      changed,
      headers,
    );
    assert.equal(uploaded.status, 200, await uploaded.clone().text());
    const result = importResponseSchema.parse(await uploaded.json());
    assert.equal(result.revision, revisionOf(changed));
    assert.equal(
      (await listCatalog()).modules[0]?.description,
      changed.modules[0].description,
    );
    const [exists] = await bucket()
      .file(`curricula/${result.revision}.json`)
      .exists();
    assert.ok(exists);
    const restored = await call(
      "/api/admin/import",
      admin.token,
      "POST",
      original,
      headers,
    );
    assert.equal(restored.status, 200);
    console.log(
      "Admin checks: non-admin denied; validated JSON archived in Storage; catalog changed and restored.",
    );
  } finally {
    await Promise.all([regular.dispose(), admin.dispose()]);
  }
});

test("completing a track unlocks a valid PDF via the authenticated certificate route", async () => {
  const session = await evalSession();
  try {
    const profile = await call("/api/profile", session.token, "PUT", {
      displayName: "Certificate Learner",
      track: "Generative AI",
      level: "Beginner",
      weeklyHours: 4,
      goal: "Complete the sample training track.",
    });
    assert.equal(profile.status, 200);
    assert.equal((await call("/api/certificate", session.token)).status, 409);
    for (const lesson of (await listCatalog()).modules.flatMap(
      (item) => item.lessons,
    ))
      assert.equal(
        (
          await call("/api/progress", session.token, "POST", {
            lessonId: lesson.id,
            studySeconds: 60,
          })
        ).status,
        200,
      );
    const file = await call("/api/certificate", session.token);
    assert.equal(file.status, 200);
    assert.equal(file.headers.get("content-type"), "application/pdf");
    const pdf = await PDFDocument.load(await file.arrayBuffer());
    assert.equal(pdf.getPageCount(), 1);
    assert.match(pdf.getTitle() ?? "", /Completion Certificate/);
    console.log(
      "Certificate checks: gated before completion; generated PDF parses as one page.",
    );
  } finally {
    await session.dispose();
  }
});
