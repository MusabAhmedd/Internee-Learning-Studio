import { randomInt, randomUUID } from "node:crypto";
import { z } from "zod";
import { getLesson, seedQuestions } from "./catalog";
import { db } from "./firebase-admin";
import { HttpError } from "./http";
import { INITIAL_MASTERY, nextMastery } from "./mastery";
import { aiMode, structured, terms } from "./openai";
import { masteryId, topicMastery } from "./practice-store";
import { systemPrompt, untrustedData } from "./prompts";
import {
  activitySchema,
  attemptSchema,
  gradeOutputSchema,
  hintCountSchema,
  idSchema,
  masterySchema,
  profileSchema,
  questionSchema,
  quizPublicSchema,
  quizSpecSchema,
  type LessonView,
  type QuizSpec,
} from "./schemas";
import { isInjection } from "./tutor";

const generatedWire = z.strictObject({
  questions: z
    .array(
      z.strictObject({
        type: z.enum(["mcq", "short"]),
        prompt: z.string().min(8).max(350),
        options: z.array(z.string().min(1).max(170)).max(5),
        answer: z.string().min(1).max(420),
        rubric: z.string().max(480),
        topic: z.string().max(45),
      }),
    )
    .min(1)
    .max(3),
});
const gradeWire = z.strictObject({
  correct: z.boolean(),
  feedback: z.string().min(1).max(420),
});

function shuffle<T>(values: T[]) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
export async function generateQuiz(
  uid: string,
  view: LessonView,
  n: number,
  topic?: string,
  signal?: AbortSignal,
) {
  const { lesson, module: moduleInfo } = view;
  if (topic && !lesson.topics.includes(topic))
    throw new HttpError(
      422,
      "TOPIC_NOT_FOUND",
      "This lesson does not cover that topic.",
    );
  const [mastery, profileDoc] = await Promise.all([
    topicMastery(uid),
    db().doc(`users/${uid}`).get(),
  ]);
  const level = profileDoc.exists
    ? profileSchema.parse(profileDoc.data()).level
    : "Beginner";
  const score = new Map(mastery.map((row) => [row.topic, row.score]));
  const focus =
    topic ??
    [...lesson.topics].sort(
      (a, b) => (score.get(a) ?? 0.5) - (score.get(b) ?? 0.5),
    )[0];
  const provider = aiMode();
  let questions: QuizSpec[];
  if (provider === "demo") {
    // NOT_IMPLEMENTED (demo provider only): LLM question synthesis. The labelled demo uses vetted sample items.
    const stored = await seedQuestions(moduleInfo.id, lesson.id);
    questions = stored
      .filter((item) => !topic || item.topic === topic)
      .sort((a, b) => Number(b.topic === focus) - Number(a.topic === focus))
      .slice(0, n);
    if (questions.length !== n)
      throw new HttpError(
        409,
        "NOT_ENOUGH_QUESTIONS",
        "This sample lesson has fewer curated questions. Select a smaller set.",
      );
  } else {
    const data = untrustedData({
      count: n,
      allowedTopics: lesson.topics,
      level,
      focusTopic: focus,
      lesson: lesson.content,
    });
    const response = await structured(
      "quiz_generate",
      await systemPrompt("quiz-generate"),
      data,
      generatedWire,
      1650,
      signal,
    );
    const parsed = response.questions.map(({ options, rubric, ...entry }) =>
      entry.type === "mcq"
        ? quizSpecSchema.safeParse({ ...entry, options })
        : quizSpecSchema.safeParse({ ...entry, rubric }),
    );
    if (
      parsed.length !== n ||
      parsed.some(
        (result) =>
          !result.success || !lesson.topics.includes(result.data.topic),
      ) ||
      new Set(response.questions.map((q) => q.prompt.trim().toLowerCase()))
        .size !== n ||
      (n > 1 && new Set(response.questions.map((q) => q.type)).size !== 2) ||
      (topic && response.questions.every((q) => q.topic !== topic))
    )
      throw new HttpError(
        502,
        "AI_FORMAT",
        "The AI quiz did not match this lesson. Please try again.",
      );
    questions = parsed.flatMap((result) =>
      result.success ? [result.data] : [],
    );
  }
  const database = db();
  const batch = database.batch();
  const createdAt = new Date().toISOString();
  const published = questions.map((spec) => {
    const id = idSchema.parse(randomUUID());
    const data = questionSchema.parse({
      uid,
      lessonId: lesson.id,
      spec:
        spec.type === "mcq"
          ? { ...spec, options: shuffle(spec.options) }
          : spec,
      createdAt,
    });
    batch.create(database.doc(`quizQuestions/${id}`), data);
    const { prompt, type, topic } = data.spec;
    return {
      id,
      prompt,
      type,
      topic,
      ...(data.spec.type === "mcq" ? { options: data.spec.options } : {}),
    };
  });
  await batch.commit();
  return quizPublicSchema.parse({ questions: published, provider });
}

export async function questionFor(uid: string, id: string) {
  const ref = db().doc(`quizQuestions/${idSchema.parse(id)}`);
  const snapshot = await ref.get();
  const stored = snapshot.exists ? questionSchema.parse(snapshot.data()) : null;
  if (!stored || stored.uid !== uid)
    throw new HttpError(
      404,
      "QUESTION_NOT_FOUND",
      "That question is no longer available. Start a new quiz.",
    );
  return stored;
}

export async function recordHint(uid: string, questionId: string) {
  const database = db();
  const hintRef = database.doc(`quizHints/${questionId}`);
  await database.runTransaction(async (tx) => {
    const [snap, attempt] = await tx.getAll(
      hintRef,
      database.doc(`attempts/${questionId}`),
    );
    if (attempt.exists) {
      attemptSchema.parse(attempt.data());
      throw new HttpError(
        409,
        "ALREADY_GRADED",
        "This question has already been graded.",
      );
    }
    const current = snap.exists ? hintCountSchema.parse(snap.data()) : null;
    if (current && current.uid !== uid)
      throw new HttpError(403, "FORBIDDEN", "This question is not yours.");
    tx.set(
      hintRef,
      hintCountSchema.parse({
        uid,
        count: Math.min(3, (current?.count ?? 0) + 1),
      }),
    );
  });
}

export async function gradeQuiz(
  uid: string,
  questionId: string,
  answer: string,
  signal?: AbortSignal,
) {
  const database = db();
  const ref = database.doc(`attempts/${questionId}`);
  const prior = await ref.get();
  function existing(raw: unknown) {
    const attempt = attemptSchema.parse(raw);
    if (attempt.uid !== uid)
      throw new HttpError(404, "QUESTION_NOT_FOUND", "Question not found.");
    if (attempt.answer !== answer)
      throw new HttpError(
        409,
        "ALREADY_GRADED",
        "This question was already graded. Generate a new quiz to try again.",
      );
    return gradeOutputSchema.parse({
      correct: attempt.correct,
      feedback: attempt.feedback,
    });
  }
  if (prior.exists) return existing(prior.data());
  const question = await questionFor(uid, questionId);
  const view = await getLesson(question.lessonId);
  const spec = question.spec;
  if (!view.lesson.topics.includes(spec.topic))
    throw new HttpError(
      409,
      "CURRICULUM_CHANGED",
      "The lesson changed. Generate a new quiz.",
    );
  let graded: z.infer<typeof gradeOutputSchema>;
  if (spec.type === "mcq") {
    if (!spec.options.includes(answer))
      throw new HttpError(
        422,
        "INVALID_OPTION",
        "Select one of the options shown.",
      );
    const correct = answer === spec.answer;
    graded = gradeOutputSchema.parse({
      correct,
      feedback: correct
        ? "Correct. Your choice matches the lesson."
        : `Not quite. Review “${spec.topic}”; the correct choice is “${spec.answer}”.`,
    });
  } else if (isInjection(answer)) {
    graded = {
      correct: false,
      feedback:
        "Answer the question in your own words using the lesson. Instructions to the grader do not count as an answer.",
    };
  } else if (aiMode() === "demo") {
    // NOT_IMPLEMENTED (demo provider only): semantic LLM grading. Score this sample answer with deterministic term matching.
    const reference = terms(spec.answer);
    const actual = terms(answer);
    const matching = reference.filter((term) => actual.includes(term)).length;
    const correct =
      (answer.toLowerCase() === spec.answer.toLowerCase() ||
        (reference.length >= 2 && matching / reference.length >= 0.75)) &&
      !/\b(not|never|cannot)\b/i.test(answer);
    graded = {
      correct,
      feedback: correct
        ? "Matches the sample answer’s key concepts."
        : `Revisit the source. Sample reference: ${spec.answer.slice(0, 355)}`,
    };
  } else {
    const data = untrustedData({
      question: spec.prompt,
      reference: spec.answer,
      rubric: spec.rubric,
      learnerAnswer: answer,
      lesson: view.lesson.content,
    });
    const result = await structured(
      "quiz_grade",
      await systemPrompt("quiz-grade"),
      data,
      gradeWire,
      440,
      signal,
    );
    const clean = gradeOutputSchema.safeParse(result);
    if (!clean.success)
      throw new HttpError(
        502,
        "AI_FORMAT",
        "The suggested feedback was invalid. Please retry.",
      );
    graded = clean.data;
  }
  const masteryRef = database.doc(`mastery/${masteryId(uid, spec.topic)}`);
  const hintRef = database.doc(`quizHints/${questionId}`);
  const activity = database.doc(`activity/${uid}`);
  return database.runTransaction(async (tx) => {
    const [saved, skill, hint, last] = await tx.getAll(
      ref,
      masteryRef,
      hintRef,
      activity,
    );
    if (saved.exists) return existing(saved.data());
    const previous = skill.exists ? masterySchema.parse(skill.data()) : null;
    const hints = hint.exists ? hintCountSchema.parse(hint.data()) : null;
    if ((previous && previous.uid !== uid) || (hints && hints.uid !== uid))
      throw new HttpError(
        403,
        "FORBIDDEN",
        "This progress record is not yours.",
      );
    const at = new Date().toISOString();
    const hintsUsed = hints?.count ?? 0;
    const lastAt = last.exists ? activitySchema.parse(last.data()).lastAt : at;
    tx.set(
      activity,
      activitySchema.parse({ uid, lastAt: lastAt > at ? lastAt : at }),
    );
    tx.create(
      ref,
      attemptSchema.parse({
        uid,
        lessonId: view.lesson.id,
        questionId,
        topic: spec.topic,
        correct: graded.correct,
        feedback: graded.feedback,
        answer,
        hintsUsed,
        at,
      }),
    );
    tx.set(
      masteryRef,
      masterySchema.parse({
        uid,
        topic: spec.topic,
        score: nextMastery(
          previous?.score ?? INITIAL_MASTERY,
          graded.correct,
          hintsUsed,
        ),
        updatedAt: at,
        attemptCount: (previous?.attemptCount ?? 0) + 1,
      }),
    );
    return gradeOutputSchema.parse(graded);
  });
}
