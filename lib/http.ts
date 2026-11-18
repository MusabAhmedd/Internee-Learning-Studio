import type { DecodedIdToken } from "firebase-admin/auth";
import { z } from "zod";
import { adminAuth } from "./firebase-admin";
import { uidSchema } from "./schemas";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

export function errorBody(error: unknown) {
  if (error instanceof HttpError)
    return {
      status: error.status,
      error: { code: error.code, message: error.message },
    };
  // No exception message, request body, tokens, user IDs or prompts in logs.
  console.error(
    JSON.stringify({
      event: "request_failed",
      kind: error instanceof Error ? error.name : "unknown",
    }),
  );
  return {
    status: 503,
    error: {
      code: "UNAVAILABLE",
      message: "The service is temporarily unavailable. Please retry.",
    },
  };
}

export async function identity(request: Request): Promise<DecodedIdToken> {
  const token = request.headers
    .get("authorization")
    ?.match(/^Bearer ([A-Za-z0-9_.-]{20,8192})$/i)?.[1];
  if (!token)
    throw new HttpError(401, "UNAUTHENTICATED", "Please sign in to continue.");
  const auth = adminAuth();
  try {
    const claims = await auth.verifyIdToken(token);
    uidSchema.parse(claims.uid);
    return claims;
  } catch {
    throw new HttpError(
      401,
      "UNAUTHENTICATED",
      "Your session is invalid or expired. Sign in again.",
    );
  }
}

export function authenticated(
  handler: (request: Request, claims: DecodedIdToken) => Promise<Response>,
) {
  return async (request: Request) => {
    try {
      return await handler(request, await identity(request));
    } catch (err) {
      const value = errorBody(err);
      return json({ error: value.error }, value.status);
    }
  };
}

export async function readJson<T>(
  request: Request,
  schema: z.ZodType<T>,
  maxBytes = 16_384,
): Promise<T> {
  if (
    !/^application\/json(?:\s*;|$)/i.test(
      request.headers.get("content-type") ?? "",
    )
  )
    throw new HttpError(415, "CONTENT_TYPE", "Use application/json.");
  const reader = request.body?.getReader();
  if (!reader)
    throw new HttpError(400, "INVALID_JSON", "A JSON body is required.");
  if (Number(request.headers.get("content-length")) > maxBytes) {
    void reader.cancel().catch(() => {});
    throw new HttpError(
      413,
      "TOO_LARGE",
      "The upload or request is too large.",
    );
  }
  let size = 0;
  let value = "";
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let parsed: unknown;
  try {
    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      size += chunk.byteLength;
      if (size > maxBytes)
        throw new HttpError(
          413,
          "TOO_LARGE",
          "The upload or request is too large.",
        );
      value += decoder.decode(chunk, { stream: true });
    }
    parsed = JSON.parse(value + decoder.decode());
  } catch (err) {
    void reader.cancel().catch(() => {});
    if (err instanceof HttpError) throw err;
    throw new HttpError(
      400,
      "INVALID_JSON",
      "The body must be valid UTF-8 JSON.",
    );
  } finally {
    reader.releaseLock();
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    const path = result.error.issues[0]?.path.join(".");
    throw new HttpError(
      422,
      "INVALID_INPUT",
      path
        ? `Check the value at ${path}.`
        : "The request did not match the expected schema.",
    );
  }
  return result.data;
}
