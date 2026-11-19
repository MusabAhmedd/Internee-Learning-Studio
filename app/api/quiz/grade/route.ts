import { authenticated, json, readJson } from "@/lib/http";
import { takeApiQuota } from "@/lib/limits";
import { gradeQuiz } from "@/lib/quiz";
import { quizGradeInputSchema } from "@/lib/schemas";
export const maxDuration = 45;
export const POST = authenticated(async (request, claims) => {
  const { questionId, answer } = await readJson(request, quizGradeInputSchema);
  await takeApiQuota(claims.uid, "quiz-grade");
  return json(await gradeQuiz(claims.uid, questionId, answer, request.signal));
});
