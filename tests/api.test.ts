import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import {
  bundleSchema,
  getLesson,
  listCatalog,
  revisionOf,
} from "../lib/catalog";
import { createPlan, planContext } from "../lib/plan";
import { summaryFor, writeSummary } from "../lib/summary";
import { providerAdmission, quotaCounterSchema } from "../lib/limits";
import { embed, streamTutor, structured } from "../lib/openai";
import { z } from "zod";
import { bucket, db, isDemo } from "../lib/firebase-admin";
import {
  attemptSchema,
  completionSchema,
  dashboardSchema,
  progressSchema,
  profileResponseSchema,
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

function fullCounter() {
  const now = new Date();
  return quotaCounterSchema.parse({
    day: now.toISOString().slice(0, 10),
    minute: Math.floor(now.getTime() / 60_000),
    dayCount: 300,
    minuteCount: 300,
  });
}

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

test("Gemini admission at its cap blocks embedding and chat before any upstream fetch", async (t) => {
  const session = await evalSession();
  assert.ok(session.uid);
  const counter = db().doc(`providerLimits/${session.uid}`);
  const saturated = fullCounter();
  const previous = {
    AI_PROVIDER: process.env.AI_PROVIDER,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  };
  const network = globalThis.fetch;
  let remoteCalls = 0;
  try {
    await counter.set(saturated);
    // This sentinel is NOT a real API key. The test prevents all Gemini network I/O.
    process.env.AI_PROVIDER = "gemini";
    process.env.GEMINI_API_KEY = "quota-test-only-no-remote-calls";
    t.mock.method(
      globalThis,
      "fetch",
      (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(
          input instanceof Request ? input.url : input.toString(),
        );
        if (url.hostname === "generativelanguage.googleapis.com") {
          remoteCalls++;
          throw new Error("Unexpected provider fetch");
        }
        return network(input, init);
      },
    );
    const options = { admit: providerAdmission(session.uid) };
    await assert.rejects(embed("Retrieval-augmented generation", options), {
      code: "AI_DAILY_LIMIT",
    });
    await assert.rejects(
      structured(
        "probe",
        "Return a JSON object.",
        "{}",
        z.strictObject({ ok: z.boolean() }),
        100,
        options,
      ),
      { code: "AI_DAILY_LIMIT" },
    );
    await assert.rejects(
      streamTutor(
        "Answer from the lesson.",
        "Explain retrieval.",
        options,
      ).next(),
      { code: "AI_DAILY_LIMIT" },
    );
    assert.equal(remoteCalls, 0);
    assert.deepEqual((await counter.get()).data(), saturated);
  } finally {
    t.mock.restoreAll();
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await session.dispose();
  }
});

test("a shared Gemini cap blocks account rotation and does not partially spend quota", async () => {
  const first = await evalSession();
  const second = await evalSession();
  assert.ok(first.uid && second.uid);
  const service = db().doc("serviceLimits/gemini");
  const previous = await service.get();
  const previousSetting = process.env.AI_PROJECT_DAILY_LIMIT;
  try {
    await service.delete();
    process.env.AI_PROJECT_DAILY_LIMIT = "1";
    const outcomes = await Promise.allSettled([
      providerAdmission(first.uid)(),
      providerAdmission(second.uid)(),
    ]);
    assert.equal(
      outcomes.filter((row) => row.status === "fulfilled").length,
      1,
    );
    const rejected = outcomes.find((row) => row.status === "rejected");
    assert.equal(rejected?.reason.code, "AI_PROJECT_DAILY_LIMIT");
    const counters = await db().getAll(
      db().doc(`providerLimits/${first.uid}`),
      db().doc(`providerLimits/${second.uid}`),
    );
    assert.equal(counters.filter((row) => row.exists).length, 1);
    assert.equal(
      quotaCounterSchema.parse((await service.get()).data()).dayCount,
      1,
    );
    console.log(
      "Abuse checks: two different learner accounts competed for one project reservation; only the winner's counter changed.",
    );
  } finally {
    if (previousSetting === undefined)
      delete process.env.AI_PROJECT_DAILY_LIMIT;
    else process.env.AI_PROJECT_DAILY_LIMIT = previousSetting;
    if (previous.exists)
      await service.set(quotaCounterSchema.parse(previous.data()));
    else await service.delete();
    await Promise.all([first.dispose(), second.dispose()]);
  }
});

test("demo plans and recaps, including cache hits, do not spend provider quota", async () => {
  const session = await evalSession();
  assert.ok(session.uid);
  try {
    const counter = db().doc(`providerLimits/${session.uid}`);
    const saturated = fullCounter();
    await counter.set(saturated);
    const profile = await call("/api/profile", session.token, "PUT", {
      displayName: "Quota Test Learner",
      track: "Generative AI",
      level: "Beginner",
      weeklyHours: 4,
      goal: "Build confidence with retrieval.",
    });
    assert.equal(profile.status, 200);
    for (const [path, request] of [
      ["/api/plan", { uid: session.uid }],
      ["/api/summary", {}],
    ] as const) {
      const first = await call(path, session.token, "POST", request);
      const cached = await call(path, session.token, "POST", request);
      assert.equal(first.status, 200, await first.clone().text());
      assert.equal(cached.status, 200, await cached.clone().text());
      assert.deepEqual(await first.json(), await cached.json());
    }
    assert.deepEqual((await counter.get()).data(), saturated);
  } finally {
    await session.dispose();
  }
});

test("quiz keys stay private; hint is Socratic and idempotent grading records a single attempt", async () => {
  assert.ok(isDemo());
  const session = await evalSession();
  const outsider = await evalSession();
  try {
    assert.ok(session.uid);
    const counter = db().doc(`providerLimits/${session.uid}`);
    const saturated = fullCounter();
    await counter.set(saturated);

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
    assert.deepEqual((await counter.get()).data(), saturated);
    await db().doc(`apiLimits/${session.uid}__quiz-grade`).set(fullCounter());
    const ordinaryLimit = await grade();
    assert.equal(ordinaryLimit.status, 429);
    assert.equal((await ordinaryLimit.json()).error.code, "API_RATE_LIMIT");
    console.log(
      "At the Gemini cap, a fixed hint and repeated MCQ grade succeeded. At the ordinary API cap, grading returned API_RATE_LIMIT.",
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
    assert.ok(admin.uid);
    const counter = db().doc(`providerLimits/${admin.uid}`);
    const saturated = fullCounter();
    await counter.set(saturated);

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
    assert.deepEqual((await counter.get()).data(), saturated);
    await db().doc(`apiLimits/${admin.uid}__admin-import`).set(fullCounter());
    const limited = await call(
      "/api/admin/import",
      admin.token,
      "POST",
      original,
      headers,
    );
    assert.equal(limited.status, 429);
    assert.equal((await limited.json()).error.code, "ADMIN_IMPORT_RATE_LIMIT");
    await db().doc(`apiLimits/${admin.uid}__admin-import`).delete();
    const service = db().doc("serviceLimits/admin-import");
    const prior = await service.get();
    try {
      await service.set(fullCounter());
      const global = await call(
        "/api/admin/import",
        admin.token,
        "POST",
        original,
        headers,
      );
      assert.equal(global.status, 429);
      assert.equal(
        (await global.json()).error.code,
        "ADMIN_IMPORT_PROJECT_LIMIT",
      );
    } finally {
      if (prior.exists)
        await service.set(quotaCounterSchema.parse(prior.data()));
      else await service.delete();
    }

    console.log(
      "With Gemini quota exhausted, admin import succeeded. Its own administrative cap returned ADMIN_IMPORT_RATE_LIMIT.",
    );
    console.log(
      "Admin checks: non-admin denied; validated JSON archived in Storage; catalog changed and restored.",
    );
  } finally {
    await Promise.all([regular.dispose(), admin.dispose()]);
  }
});

test("learner timezone changes plan and recap periods at PKT midnight, not UTC midnight", async () => {
  const session = await evalSession();
  assert.ok(session.uid);
  const uid = session.uid;
  try {
    const fields = {
      displayName: "Calendar Learner",
      track: "Generative AI",
      level: "Beginner",
      weeklyHours: 4,
      goal: "Align my study dates with Karachi.",
    };
    const invalid = await call("/api/profile", session.token, "PUT", {
      ...fields,
      timeZone: "+05:00",
    });
    assert.equal(invalid.status, 422);
    const put = await call("/api/profile", session.token, "PUT", {
      ...fields,
      timeZone: "Asia/Karachi",
    });
    assert.equal(put.status, 200);
    const prior = profileResponseSchema.parse(await put.json()).profile;
    const changed = profileResponseSchema.parse(
      await (await call("/api/profile", session.token, "PUT", fields)).json(),
    ).profile;
    assert.equal(changed?.timeZone, "Asia/Karachi");
    assert.equal(changed?.createdAt, prior?.createdAt);
    assert.match(changed?.createdAt ?? "", /Z$/);
    const before = new Date("2026-11-19T18:59:59.999Z");
    const after = new Date("2026-11-19T19:00:00.000Z");
    const plan = await createPlan(uid, await planContext(uid, before));
    assert.equal(plan.days[0].date, "2026-11-19");
    assert.equal((await planContext(uid, before)).status.reason, null);
    const next = await planContext(uid, after);
    assert.equal(next.status.reason, "behind");
    assert.equal((await createPlan(uid, next)).days[0].date, "2026-11-20");
    await Promise.all(
      ["2026-11-13T18:59:59.999Z", "2026-11-13T19:00:00.000Z"].map((at, i) => {
        const questionId = `boundary-${uid}-${i}`;
        return db()
          .doc(`attempts/${questionId}`)
          .create(
            attemptSchema.parse({
              uid,
              lessonId: "rag",
              questionId,
              topic: "RAG",
              correct: true,
              hintsUsed: 0,
              at,
              feedback: "Sample boundary response.",
              answer: "Sample answer",
            }),
          );
      }),
    );
    const recent = await writeSummary(uid, undefined, before);
    assert.match(recent.summary?.text ?? "", /2 of 2/);
    assert.equal(
      (await summaryFor(uid, before))?.period?.through,
      "2026-11-19",
    );
    assert.equal(await summaryFor(uid, after), null);
    const refreshed = await writeSummary(uid, undefined, after);
    assert.match(refreshed.summary?.text ?? "", /1 of 1/);
    assert.deepEqual(refreshed.summary?.period, {
      timeZone: "Asia/Karachi",
      start: "2026-11-14",
      through: "2026-11-20",
    });
    assert.equal(refreshed.summary?.createdAt, after.toISOString());
    console.log(
      "Calendar checks: passing midnight PKT marked the plan behind, shifted the weekly window, and invalidated the old recap while timestamps stayed UTC.",
    );
  } finally {
    await session.dispose();
  }
});

test("study reports are visible before completion, deduplicated across lessons, and capped", async () => {
  const session = await evalSession();
  assert.ok(session.uid);
  try {
    assert.equal(
      (
        await call("/api/profile", session.token, "PUT", {
          displayName: "Study Test Learner",
          track: "Generative AI",
          level: "Beginner",
          weeklyHours: 4,
          goal: "Keep an accurate study log.",
        })
      ).status,
      200,
    );
    const put = (body: unknown) =>
      call("/api/progress", session.token, "POST", body);
    const end = Date.now() - 100;
    const heartbeat = {
      lessonId: "rag",
      interval: { fromMs: end - 8000, throughMs: end - 3000 },
    };
    const first = await put(heartbeat);
    const replay = await put(heartbeat);
    for (const response of [first, replay]) {
      assert.equal(response.status, 200);
      assert.deepEqual(
        completionSchema.parse(await response.json()).studySeconds,
        5,
      );
    }
    const other = await put({
      lessonId: "llm-apis",
      interval: { fromMs: end - 5000, throughMs: end },
    });
    assert.equal(completionSchema.parse(await other.json()).studySeconds, 3);
    const board = dashboardSchema.parse(
      await (await call("/api/dashboard", session.token)).json(),
    );
    assert.equal(board.studySeconds, 8);
    assert.equal(board.completed, 0);
    const completed = completionSchema.parse(
      await (await put({ ...heartbeat, complete: true })).json(),
    );
    assert.equal(completed.completed, true);
    assert.equal(completed.studySeconds, 5);
    const clock = Date.now();
    const invalid = await put({
      lessonId: "rag",
      interval: { fromMs: clock, throughMs: clock + 10000 },
    });
    assert.equal(invalid.status, 422);
    assert.equal((await invalid.json()).error.code, "STUDY_INTERVAL_WINDOW");
    assert.equal(
      (
        await put({
          lessonId: "rag",
          interval: { fromMs: end - 31_000, throughMs: end },
        })
      ).status,
      422,
    );
    assert.equal(
      (await put({ lessonId: "rag", studySeconds: 7200 })).status,
      422,
    );
    const cap = (await getLesson("rag")).lesson.estMinutes * 60;
    const ref = db().doc(`users/${session.uid}/progress/rag`);
    const row = progressSchema.parse((await ref.get()).data());
    await ref.set({ ...row, studySeconds: cap - 1 });
    const capThrough = Date.now() - 10;
    // Overlapping old timestamps below the shared cursor cannot add anything.
    const capped = await put({
      lessonId: "rag",
      interval: { fromMs: capThrough - 1000, throughMs: capThrough },
    });
    assert.equal(capped.status, 200);
    // Seed exactly one second of uncounted real time inside the accepted window.
    await db()
      .doc(`studyCursors/${session.uid}`)
      .set({ throughMs: Date.now() - 2000 });
    const finish = Date.now() - 10;
    const result = completionSchema.parse(
      await (
        await put({
          lessonId: "rag",
          interval: { fromMs: finish - 1600, throughMs: finish },
        })
      ).json(),
    );
    assert.equal(result.studySeconds, cap);
    assert.equal(result.completed, true);
    assert.equal(
      progressSchema.parse((await ref.get()).data()).completedAt,
      row.completedAt,
    );
    console.log(
      "Study checks: incomplete time shown, overlapping reports not double-counted, invalid elapsed claims rejected, and lesson cap enforced.",
    );
  } finally {
    await session.dispose();
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
            complete: true,
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

test("lesson pages chain to the next lesson across module boundaries", async () => {
  const session = await evalSession();
  try {
    const catalog = await listCatalog();
    const ordered = catalog.modules
      .filter((item) => item.track === "Generative AI")
      .sort((a, b) => a.order - b.order)
      .flatMap((item) =>
        item.lessons
          .sort((a, b) => a.order - b.order)
          .map((lesson) => lesson.id),
      );
    for (const [index, lessonId] of ordered.entries()) {
      const result = await call(`/api/lesson/${lessonId}`, session.token);
      assert.equal(result.status, 200, lessonId);
      const body = await result.json();
      const expected = ordered[index + 1] ?? null;
      assert.equal(
        body.nextLessonId,
        expected,
        `${lessonId} should chain to the next lesson`,
      );
    }
  } finally {
    await session.dispose();
  }
});
