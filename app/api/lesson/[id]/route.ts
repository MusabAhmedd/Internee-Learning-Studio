import { getLesson } from "@/lib/catalog";
import { authenticated, HttpError, json } from "@/lib/http";
import { idSchema } from "@/lib/schemas";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return authenticated(async () => {
    const id = idSchema.safeParse((await context.params).id);
    if (!id.success)
      throw new HttpError(
        404,
        "LESSON_NOT_FOUND",
        "This lesson does not exist.",
      );
    return json(await getLesson(id.data));
  })(request);
}
