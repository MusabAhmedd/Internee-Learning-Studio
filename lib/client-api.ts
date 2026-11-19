import type { User } from "firebase/auth";
import type { z } from "zod";
import { browserAppToken } from "./firebase-client";
import { errorSchema } from "./schemas";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
  }
}

export async function prepareApiHeaders(user: User) {
  const [id, appToken] = await Promise.all([
    user.getIdToken(),
    browserAppToken().catch(() => null),
  ]);
  const headers = new Headers({ Authorization: `Bearer ${id}` });
  if (appToken) headers.set("X-Firebase-AppCheck", appToken);
  return headers;
}

export async function requestApi(
  user: User,
  path: string,
  init: RequestInit = {},
  prepared?: Headers,
) {
  const headers = new Headers(init.headers);
  for (const [name, value] of prepared ?? (await prepareApiHeaders(user)))
    headers.set(name, value);
  if (init.body && !headers.has("Content-Type"))
    headers.set("Content-Type", "application/json");
  const signal = init.signal
    ? AbortSignal.any([init.signal, AbortSignal.timeout(55_000)])
    : AbortSignal.timeout(55_000);
  const res = await fetch(path, {
    ...init,
    headers,
    signal,
    cache: "no-store",
  });
  if (!res.ok) {
    const parsed = errorSchema.safeParse(await res.json().catch(() => null));
    throw new ApiError(
      parsed.success
        ? parsed.data.error.message
        : "The request could not be completed.",
      res.status,
      parsed.success ? parsed.data.error.code : "REQUEST_FAILED",
    );
  }
  return res;
}

export async function api<T>(
  user: User,
  path: string,
  schema: z.ZodType<T>,
  init: RequestInit = {},
  prepared?: Headers,
): Promise<T> {
  const response = await requestApi(user, path, init, prepared);
  return schema.parse(await response.json());
}

export function friendlyError(error: unknown) {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.name === "TimeoutError")
    return "This request took too long. Please try again.";
  if (typeof navigator !== "undefined" && !navigator.onLine)
    return "You’re offline. Reconnect and try again.";
  return "Something went wrong. Check your connection and try again.";
}
