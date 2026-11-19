import { getLesson } from "@/lib/catalog";
import { authenticated, json, readJson } from "@/lib/http";
import { takeApiQuota } from "@/lib/limits";
import { generateQuiz } from "@/lib/quiz";
import { quizGenerateInputSchema } from "@/lib/schemas";
export const maxDuration = 45;
export const POST = authenticated(async (request, claims) => {
  const { lessonId, n, topic } = await readJson(
    request,
    quizGenerateInputSchema,
  );
  await takeApiQuota(claims.uid, "quiz-generate");
  const lesson = await getLesson(lessonId);
  return json(await generateQuiz(claims.uid, lesson, n, topic, request.signal));
});
