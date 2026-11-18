import { getLesson } from "@/lib/catalog";
import { authenticated, json, readJson } from "@/lib/http";
import { takeAiQuota } from "@/lib/limits";
import { generateQuiz } from "@/lib/quiz";
import { quizGenerateInputSchema } from "@/lib/schemas";
export const maxDuration = 45;
export const POST = authenticated(async (request, claims) => {
  const { lessonId, n, topic } = await readJson(
    request,
    quizGenerateInputSchema,
  );
  const lesson = await getLesson(lessonId);
  await takeAiQuota(claims.uid);
  return json(await generateQuiz(claims.uid, lesson, n, topic, request.signal));
});
