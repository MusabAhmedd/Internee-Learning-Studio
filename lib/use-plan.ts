"use client";
import { useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import { api, friendlyError } from "./client-api";
import { planSchema, planStatusSchema } from "./schemas";
import { useResource } from "./use-resource";

export function usePlan(user: User) {
  const { data, error, reload } = useResource(
    user,
    "/api/plan",
    planStatusSchema,
  );
  const [actionError, setError] = useState("");
  const [working, setWorking] = useState(false);
  const tried = useRef("");
  const inFlight = useRef(false);
  const key =
    data?.plan && data.reason && data.lessons.length
      ? `${data.plan.createdAt}:${data.reason}`
      : null;
  useEffect(() => {
    if (!key || tried.current === key || inFlight.current) return;
    const controller = new AbortController();
    void Promise.resolve().then(async () => {
      if (controller.signal.aborted || inFlight.current) return;
      tried.current = key;
      inFlight.current = true;
      setWorking(true);
      setError("");
      try {
        await api(user, "/api/plan", planSchema, {
          method: "POST",
          body: JSON.stringify({ uid: user.uid }),
          signal: controller.signal,
        });
        if (!controller.signal.aborted) reload();
      } catch (error) {
        if (!controller.signal.aborted) setError(friendlyError(error));
      } finally {
        inFlight.current = false;
        setWorking(false);
      }
    });
    return () => controller.abort();
  }, [key, reload, user]);
  async function generate() {
    if (inFlight.current) return;
    inFlight.current = true;
    setWorking(true);
    setError("");
    try {
      await api(user, "/api/plan", planSchema, {
        method: "POST",
        body: JSON.stringify({ uid: user.uid, refresh: true }),
      });
      reload();
    } catch (error) {
      setError(friendlyError(error));
    } finally {
      inFlight.current = false;
      setWorking(false);
    }
  }
  return { data, error, reload, generate, working, actionError };
}
