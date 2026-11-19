import { getLesson } from "@/lib/catalog";
import { authenticated, HttpError, json, readJson } from "@/lib/http";
import { takeApiQuota } from "@/lib/limits";
import { getProgress, saveProgress } from "@/lib/progress-store";
import { idSchema, progressInputSchema } from "@/lib/schemas";

export const GET = authenticated(async (request, claims) => {
  const lesson = idSchema.safeParse(
    new URL(request.url).searchParams.get("lessonId"),
  );
  if (!lesson.success)
    throw new HttpError(422, "INVALID_INPUT", "A lessonId is required.");
  return json(await getProgress(claims.uid, lesson.data));
});
export const POST = authenticated(async (request, claims) => {
  const input = await readJson(request, progressInputSchema);
  await takeApiQuota(claims.uid, "progress");
  const { lesson } = await getLesson(input.lessonId);
  return json(await saveProgress(claims.uid, lesson.estMinutes, input));
});
