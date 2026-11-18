import { z } from "zod";

export function text(min: number, max: number, multiline = false) {
  return z
    .string()
    .max(max + 200)
    .transform((value) => value.normalize("NFC").replace(/\r\n?/g, "\n").trim())
    .pipe(
      z
        .string()
        .min(min)
        .max(max)
        .refine(
          (value) =>
            !Array.from(value).some((char) => {
              const code = char.charCodeAt(0);
              return (
                (code < 32 && !(multiline && (code === 10 || code === 9))) ||
                (code >= 127 && code <= 159) ||
                (code >= 0x202a && code <= 0x202e) ||
                (code >= 0x2066 && code <= 0x2069)
              );
            }),
          "Contains unsupported control characters",
        ),
    );
}

export const uidSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export const idSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/);
export const timestampSchema = z.iso.datetime();
export const trackSchema = z.enum([
  "Generative AI",
  "Web Development",
  "Data Science",
]);
export const levelSchema = z.enum(["Beginner", "Intermediate", "Advanced"]);
export const profileInputSchema = z.strictObject({
  displayName: text(2, 48),
  track: trackSchema,
  level: levelSchema,
  weeklyHours: z.number().int().min(1).max(40),
  goal: text(5, 280, true),
});
export const profileSchema = profileInputSchema.extend({
  createdAt: timestampSchema,
});
export const profileResponseSchema = z.strictObject({
  profile: profileSchema.nullable(),
  admin: z.boolean(),
});
export const errorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
export type Profile = z.infer<typeof profileSchema>;

export const sourceSchema = z.enum(["SAMPLE", "IMPORTED"]);
export const minutesSchema = z.number().int().min(5).max(120);
const orderSchema = z.number().int().min(1).max(100);
export const topicSchema = text(2, 45);
export const moduleSchema = z.strictObject({
  title: text(2, 95),
  description: text(5, 350),
  order: orderSchema,
  track: trackSchema,
  source: sourceSchema,
});
export const lessonSchema = z.strictObject({
  title: text(2, 110),
  order: orderSchema,
  content: text(30, 12_000, true),
  topics: z.array(topicSchema).min(1).max(5),
  estMinutes: minutesSchema,
});
export const lessonPreviewSchema = lessonSchema
  .omit({ content: true })
  .extend({ id: idSchema });
export const modulePreviewSchema = moduleSchema.extend({
  id: idSchema,
  lessons: z.array(lessonPreviewSchema).max(8),
});
export const catalogSchema = z.strictObject({
  modules: z.array(modulePreviewSchema).max(12),
});
export const lessonResponseSchema = z.strictObject({
  lesson: lessonSchema.extend({ id: idSchema }),
  module: moduleSchema.extend({ id: idSchema }),
  nextLessonId: idSchema.nullable(),
});
export const quizSpecSchema = z
  .discriminatedUnion("type", [
    z.strictObject({
      type: z.literal("mcq"),
      prompt: text(8, 350),
      options: z.array(text(1, 170)).min(3).max(5),
      answer: text(1, 170),
      topic: topicSchema,
    }),
    z.strictObject({
      type: z.literal("short"),
      prompt: text(8, 350),
      answer: text(2, 420),
      rubric: text(5, 480),
      topic: topicSchema,
    }),
  ])
  .superRefine((question, ctx) => {
    if (
      question.type === "mcq" &&
      (new Set(question.options.map((option) => option.toLowerCase())).size !==
        question.options.length ||
        !question.options.includes(question.answer))
    )
      ctx.addIssue({
        code: "custom",
        message: "MCQs require distinct options and an exact matching answer.",
      });
  });
export const quizSeedSchema = z.strictObject({
  id: idSchema,
  question: quizSpecSchema,
});
export const catalogIndexSchema = z.strictObject({ moduleId: idSchema });
export const revisionSchema = z.strictObject({
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  source: sourceSchema,
});
export type Lesson = z.infer<typeof lessonSchema>;
export type LessonPreview = z.infer<typeof lessonPreviewSchema>;
export type LessonView = z.infer<typeof lessonResponseSchema>;
export type Catalog = z.infer<typeof catalogSchema>;
export type QuizSpec = z.infer<typeof quizSpecSchema>;

export const tutorModeSchema = z.enum(["explain", "hint", "quiz", "summarize"]);
export const citationSchema = z.strictObject({
  lessonId: idSchema,
  chunkId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,67}$/),
});
export const tutorInputSchema = z
  .strictObject({
    lessonId: idSchema,
    mode: tutorModeSchema,
    message: text(2, 900, true),
    questionId: idSchema.optional(),
  })
  .superRefine((input, ctx) => {
    if (input.questionId && input.mode !== "hint")
      ctx.addIssue({
        code: "custom",
        path: ["questionId"],
        message: "Question IDs are used only for hints.",
      });
  });
export const tutorTurnSchema = z.strictObject({
  message: tutorInputSchema.shape.message,
  mode: tutorModeSchema,
  answer: text(1, 4500, true),
  citations: z.array(citationSchema).max(3),
  at: timestampSchema,
});
export const chatSchema = z.strictObject({
  uid: uidSchema,
  lessonId: idSchema,
  messages: z.array(tutorTurnSchema).max(12),
});
export const chatViewSchema = chatSchema
  .pick({ messages: true })
  .extend({ provider: z.enum(["demo", "gemini"]) });
export const textFrameSchema = z.strictObject({
  type: z.literal("delta"),
  text: z.string().min(1).max(4500),
});
export const finalFrameSchema = z.strictObject({
  type: z.literal("done"),
  citations: z.array(citationSchema).max(3),
});
export const tutorFrameSchema = z.discriminatedUnion("type", [
  textFrameSchema,
  finalFrameSchema,
  z.strictObject({ type: z.literal("error"), error: errorSchema.shape.error }),
]);
export type TutorMode = z.infer<typeof tutorModeSchema>;
export type TutorTurn = z.infer<typeof tutorTurnSchema>;
export type Citation = z.infer<typeof citationSchema>;

export const quizGenerateInputSchema = z.strictObject({
  lessonId: idSchema,
  n: z.number().int().min(1).max(3),
  topic: topicSchema.optional(),
});
export const quizGradeInputSchema = z.strictObject({
  questionId: idSchema,
  answer: text(1, 600, true),
});
export const gradeOutputSchema = z.strictObject({
  correct: z.boolean(),
  feedback: text(1, 420, true),
});
export const questionSchema = z.strictObject({
  uid: uidSchema,
  lessonId: idSchema,
  spec: quizSpecSchema,
  createdAt: timestampSchema,
});
export const quizPublicSchema = z.strictObject({
  questions: z
    .array(
      z.strictObject({
        id: idSchema,
        type: z.enum(["mcq", "short"]),
        prompt: text(8, 350),
        options: z.array(text(1, 170)).min(3).max(5).optional(),
        topic: topicSchema,
      }),
    )
    .min(1)
    .max(3),
  provider: z.enum(["demo", "gemini"]),
});
export const attemptSchema = z.strictObject({
  uid: uidSchema,
  lessonId: idSchema,
  questionId: idSchema,
  topic: topicSchema,
  correct: z.boolean(),
  hintsUsed: z.number().int().min(0).max(3),
  at: timestampSchema,
  feedback: gradeOutputSchema.shape.feedback,
  answer: text(1, 600, true),
});
export const masterySchema = z.strictObject({
  uid: uidSchema,
  topic: topicSchema,
  score: z.number().min(0).max(1),
  updatedAt: timestampSchema,
  attemptCount: z.number().int().nonnegative(),
});
export const hintCountSchema = z.strictObject({
  uid: uidSchema,
  count: z.number().int().min(0).max(3),
});
export type Attempt = z.infer<typeof attemptSchema>;
export type Mastery = z.infer<typeof masterySchema>;

export const progressInputSchema = z.strictObject({
  lessonId: idSchema,
  studySeconds: z.number().int().min(0).max(7200),
});
export const progressSchema = progressInputSchema.extend({
  uid: uidSchema,
  completedAt: timestampSchema,
});
export const completionSchema = z.strictObject({ completed: z.boolean() });
export const planDaySchema = z.strictObject({
  date: z.iso.date(),
  lessonIds: z.array(idSchema).max(4),
  goal: text(2, 140),
  minutes: z.number().int().min(0).max(480),
  reason: text(2, 230),
});
export const planSchema = z.strictObject({
  days: z.array(planDaySchema).length(7),
});
export const planInputSchema = z.strictObject({
  uid: uidSchema,
  refresh: z.boolean().optional(),
});
export const planRecordSchema = planSchema.extend({
  uid: uidSchema,
  createdAt: timestampSchema,
  revision: revisionSchema.shape.revision,
  profileHash: revisionSchema.shape.revision,
});
export const planStatusSchema = z.strictObject({
  plan: planRecordSchema.nullable(),
  reason: z
    .enum(["behind", "low-score", "new-week", "curriculum", "profile"])
    .nullable(),
  lessons: z.array(lessonPreviewSchema).max(24),
  budgetMinutes: z.number().int().nonnegative(),
  provider: z.enum(["demo", "gemini"]),
});
export type PlanRecord = z.infer<typeof planRecordSchema>;
export type Plan = z.infer<typeof planSchema>;
export type PlanDay = z.infer<typeof planDaySchema>;
export type Progress = z.infer<typeof progressSchema>;

export const activitySchema = z.strictObject({
  uid: uidSchema,
  lastAt: timestampSchema,
});
export const badgeSchema = z.enum([
  "first-lesson",
  "three-day-streak",
  "practice-pro",
  "track-complete",
]);
export const dashboardSchema = z.strictObject({
  sample: z.boolean(),
  completed: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  studySeconds: z.number().int().nonnegative(),
  streak: z.number().int().nonnegative(),
  correct: z.number().int().nonnegative(),
  attempts: z.number().int().nonnegative(),
  next: lessonPreviewSchema
    .extend({
      moduleTitle: moduleSchema.shape.title,
      moduleOrder: z.number().int(),
    })
    .nullable(),
  topics: z
    .array(
      z.strictObject({
        topic: topicSchema,
        score: z.number().min(0).max(1).nullable(),
        attemptCount: z.number().int().nonnegative(),
        weak: z.boolean(),
        lessonId: idSchema,
      }),
    )
    .max(120),
  badges: z.array(badgeSchema).max(4),
  certificateAvailable: z.boolean(),
});
export const summarySchema = z.strictObject({
  uid: uidSchema,
  signature: revisionSchema.shape.revision,
  text: text(4, 800, true),
  createdAt: timestampSchema,
  provider: z.enum(["demo", "gemini"]),
});
export const summaryResponseSchema = z.strictObject({
  summary: summarySchema.nullable(),
});
export const adminViewSchema = z.strictObject({
  learners: z.number().int().nonnegative(),
  meanMastery: z.number().min(0).max(1).nullable(),
  inactive: z.number().int().nonnegative(),
  sampledAttempts: z.number().int().nonnegative(),
  missed: z
    .array(
      z.strictObject({
        topic: topicSchema,
        misses: z.number().int().positive(),
        total: z.number().int().positive(),
      }),
    )
    .max(10),
  inactiveLearners: z
    .array(
      z.strictObject({
        displayName: profileSchema.shape.displayName,
        track: trackSchema,
        lastAt: timestampSchema,
      }),
    )
    .max(12),
});
export const importResponseSchema = z.strictObject({
  revision: revisionSchema.shape.revision,
  modules: z.number().int().positive(),
  lessons: z.number().int().positive(),
  unchanged: z.boolean(),
});
