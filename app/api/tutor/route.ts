import { getLesson } from "@/lib/catalog";
import {
  authenticated,
  errorBody,
  HttpError,
  json,
  readJson,
} from "@/lib/http";
import { questionFor, recordHint } from "@/lib/quiz";
import { takeAiQuota } from "@/lib/limits";
import {
  finalFrameSchema,
  idSchema,
  textFrameSchema,
  tutorInputSchema,
  tutorTurnSchema,
} from "@/lib/schemas";
import { appendChat, getChat, tutorAnswer } from "@/lib/tutor";

export const runtime = "nodejs";
export const maxDuration = 45;
export const GET = authenticated(async (request, claims) => {
  const lessonId = idSchema.safeParse(
    new URL(request.url).searchParams.get("lessonId"),
  );
  if (!lessonId.success)
    throw new HttpError(422, "INVALID_INPUT", "A lessonId is required.");
  await getLesson(lessonId.data);
  return json(await getChat(claims.uid, lessonId.data));
});
export const POST = authenticated(async (request, claims) => {
  const start = performance.now();
  const input = await readJson(request, tutorInputSchema);
  const [lesson, chat] = await Promise.all([
    getLesson(input.lessonId),
    getChat(claims.uid, input.lessonId),
  ]);
  const assessed = input.questionId
    ? await questionFor(claims.uid, input.questionId)
    : null;
  if (assessed && assessed.lessonId !== input.lessonId)
    throw new HttpError(
      422,
      "LESSON_MISMATCH",
      "The question does not belong to this lesson.",
    );
  const message = assessed?.spec.prompt ?? input.message;
  await takeAiQuota(claims.uid);

  const cancellation = new AbortController();
  const signal = AbortSignal.any([request.signal, cancellation.signal]);
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (frame: unknown) => {
        if (!cancellation.signal.aborted)
          controller.enqueue(encoder.encode(`${JSON.stringify(frame)}\n`));
      };
      let first: number | undefined;
      let outcome = "ok";
      try {
        const result = await tutorAnswer(
          lesson,
          input.mode,
          message,
          chat.messages,
          signal,
          (delta) => {
            if (delta.trim() && first === undefined)
              first = Math.round(performance.now() - start);
            send(textFrameSchema.parse({ type: "delta", text: delta }));
          },
          input.questionId
            ? () => recordHint(claims.uid, input.questionId!)
            : undefined,
        );
        if (!signal.aborted) {
          await appendChat(
            claims.uid,
            input.lessonId,
            tutorTurnSchema.parse({
              mode: input.mode,
              message: message,
              answer: result.answer,
              citations: result.citations,
              at: new Date().toISOString(),
            }),
          );
          send(
            finalFrameSchema.parse({
              type: "done",
              citations: result.citations,
            }),
          );
        }
      } catch (err) {
        const failure = errorBody(err);
        outcome = failure.error.code;
        send({ type: "error", error: failure.error });
      } finally {
        console.info(
          JSON.stringify({
            event: "tutor_stream",
            provider: chat.provider,
            status: signal.aborted ? "cancelled" : outcome,
            firstTextMs: first ?? null,
            ms: Math.round(performance.now() - start),
          }),
        );
        if (!cancellation.signal.aborted) controller.close();
      }
    },
    cancel() {
      cancellation.abort();
    },
  });
  return new Response(body, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
});
