"use client";
import { useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import { Check, CircleCheck } from "lucide-react";
import { api, friendlyError, prepareApiHeaders } from "@/lib/client-api";
import { completionSchema } from "@/lib/schemas";
import { STUDY_HEARTBEAT_MS, STUDY_SPAN_MAX_MS } from "@/lib/study-time";
import { useResource } from "@/lib/use-resource";
import { Button } from "./ui/button";
import { Loading, Notice } from "./ui/state";

type Send = (complete: boolean, leaving?: boolean) => Promise<void>;

export function CompleteLesson({
  user,
  lessonId,
}: {
  user: User;
  lessonId: string;
}) {
  const state = useResource(
    user,
    `/api/progress?lessonId=${lessonId}`,
    completionSchema,
  );
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [timeError, setTimeError] = useState("");
  const report = useRef<Send | null>(null);
  const serverTimeMs = state.data?.serverTimeMs;
  useEffect(() => {
    if (serverTimeMs === undefined) return;
    const baseline = performance.now();
    const serverClock = () =>
      serverTimeMs + Math.max(0, Math.floor(performance.now() - baseline));
    let from = document.visibilityState === "visible" ? serverClock() : null;
    let prepared: Headers | undefined;
    let alive = true;
    const warmHeaders = async () => {
      prepared = await prepareApiHeaders(user);
      return prepared;
    };
    void warmHeaders().catch(() => {});

    const send: Send = async (complete, leaving = false) => {
      const now = serverClock();
      const interval =
        from !== null && now > from
          ? { fromMs: Math.max(from, now - STUDY_SPAN_MAX_MS), throughMs: now }
          : undefined;
      from = leaving || document.visibilityState !== "visible" ? null : now;
      if (!interval && !complete) return;
      // A prepared token allows the keepalive fetch to start synchronously on pagehide.
      const headers = leaving ? prepared : await warmHeaders();
      await api(
        user,
        "/api/progress",
        completionSchema,
        {
          method: "POST",
          body: JSON.stringify({ lessonId, interval, complete }),
          keepalive: leaving,
        },
        headers,
      );
      if (alive) setTimeError("");
    };
    report.current = send;
    const flush = (leaving: boolean) => {
      void send(false, leaving).catch(() => {
        if (alive)
          setTimeError(
            "Some study time could not be saved. Keep the lesson open or reconnect to continue tracking.",
          );
      });
    };
    const sync = () => {
      if (document.visibilityState === "visible") {
        from ??= serverClock();
        void warmHeaders().catch(() => {});
      } else if (from !== null) flush(true);
    };
    const pagehide = () => {
      if (from !== null) flush(true);
    };
    const timer = window.setInterval(() => {
      if (from !== null && document.visibilityState === "visible") flush(false);
    }, STUDY_HEARTBEAT_MS);
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("pagehide", pagehide);
    window.addEventListener("pageshow", sync);
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("pagehide", pagehide);
      window.removeEventListener("pageshow", sync);
      if (from !== null) flush(true);
      report.current = null;
    };
  }, [lessonId, serverTimeMs, user]);
  async function complete() {
    setBusy(true);
    setError("");
    try {
      if (!report.current)
        throw new Error("Progress tracking has not started.");
      await report.current(true);
      setSaved(true);
    } catch (error) {
      setError(friendlyError(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="grid gap-2">
      {state.error ? (
        <Notice retry={state.reload}>{state.error}</Notice>
      ) : !state.data ? (
        <Loading label="Checking completion…" />
      ) : saved || state.data.completed ? (
        <span className="completion-pill" role="status">
          <CircleCheck size={17} /> Lesson completed
        </span>
      ) : (
        <Button className="w-fit" onClick={complete} disabled={busy}>
          <Check />
          {busy ? "Saving…" : "Mark lesson complete"}
        </Button>
      )}
      {error && <Notice>{error}</Notice>}
      {timeError && <Notice>{timeError}</Notice>}
    </div>
  );
}
