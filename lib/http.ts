import type { FirebaseIdTokenClaims } from "./verify-id-token";
import { z } from "zod";
import { attestRequest } from "./app-attestation";
import { verifyFirebaseIdToken } from "./verify-id-token";
import { uidSchema } from "./schemas";

import { HttpError } from "./http-error";
export { HttpError } from "./http-error";
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
      message: error instanceof Error ? error.message : String(error),
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

export async function identity(
  request: Request,
): Promise<FirebaseIdTokenClaims> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader)
    throw new HttpError(401, "UNAUTHENTICATED", "Please sign in to continue.");
  const match = authHeader.match(/^Bearer ([A-Za-z0-9_.-]{20,8192})$/i);
  if (!match) {
    console.error(
      JSON.stringify({
        event: "token_verify_failed",
        reason: "missing_or_malformed_authorization_header",
        headerPrefix: authHeader.slice(0, 30),
      }),
    );
    throw new HttpError(401, "UNAUTHENTICATED", "Please sign in to continue.");
  }
  const token = match[1];
  console.error(
    JSON.stringify({
      event: "token_received",
      tokenPreview: `${token.slice(0, 16)}...${token.slice(-16)}`,
      tokenLength: token.length,
    }),
  );
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!projectId)
    throw new HttpError(
      503,
      "CONFIG_ERROR",
      "Server is not configured. Contact the administrator.",
    );
  try {
    const claims = await verifyFirebaseIdToken(token, projectId);
    uidSchema.parse(claims.uid);
    return claims;
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "token_verify_failed",
        code: err instanceof HttpError ? err.code : "unknown",
        projectId,
      }),
    );
    throw err;
  }
}

export function authenticated(
  handler: (request: Request, claims: FirebaseIdTokenClaims) => Promise<Response>,
) {
  return async (request: Request) => {
    try {
      const claims = await identity(request);
      console.error(
        JSON.stringify({
          event: "auth_passed",
          uid: claims.uid,
        }),
      );
      await attestRequest(request);
      console.error(
        JSON.stringify({
          event: "handler_start",
          uid: claims.uid,
        }),
      );
      return await handler(request, claims);
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
