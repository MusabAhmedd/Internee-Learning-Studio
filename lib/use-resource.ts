"use client";
import { useCallback, useEffect, useState } from "react";
import type { User } from "firebase/auth";
import type { z } from "zod";
import { api, friendlyError } from "./client-api";

export function useResource<T>(user: User, path: string, schema: z.ZodType<T>) {
  const [version, reload] = useState(0);
  const [state, setState] = useState<{ key: string; data?: T; error?: string }>(
    { key: "" },
  );
  const key = `${user.uid}:${path}:${version}`;
  useEffect(() => {
    const controller = new AbortController();
    api(user, path, schema, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setState({ key, data });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setState({ key, error: friendlyError(error) });
      });
    return () => controller.abort();
  }, [key, path, schema, user]);
  const refresh = useCallback(() => reload((value) => value + 1), []);
  return {
    data: state.key === key ? state.data : undefined,
    error: state.key === key ? state.error : undefined,
    reload: refresh,
  };
}
