"use client";
import { useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import { Check, CircleCheck } from "lucide-react";
import { api, friendlyError } from "@/lib/client-api";
import { completionSchema } from "@/lib/schemas";
import { useResource } from "@/lib/use-resource";
import { Button } from "./ui/button";
import { Loading, Notice } from "./ui/state";

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
  const milliseconds = useRef(0);
  const started = useRef<number | null>(null);
  useEffect(() => {
    const sync = () => {
      if (started.current !== null) {
        milliseconds.current += performance.now() - started.current;
        started.current = null;
      }
      if (document.visibilityState === "visible")
        started.current = performance.now();
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      started.current = null;
    };
  }, []);
  async function complete() {
    setBusy(true);
    setError("");
    const studySeconds = Math.min(
      7200,
      Math.floor(
        (milliseconds.current +
          (started.current === null
            ? 0
            : performance.now() - started.current)) /
          1000,
      ),
    );
    try {
      await api(user, "/api/progress", completionSchema, {
        method: "POST",
        body: JSON.stringify({ lessonId, studySeconds }),
      });
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
    </div>
  );
}
