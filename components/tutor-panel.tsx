"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { User } from "firebase/auth";
import { ArrowUp, BookOpenText, Sparkles, Square } from "lucide-react";
import {
  chatViewSchema,
  tutorInputSchema,
  type TutorMode,
  type TutorTurn,
} from "@/lib/schemas";
import { friendlyError, requestApi } from "@/lib/client-api";
import { useResource } from "@/lib/use-resource";
import { readTutor, TutorStreamError } from "@/lib/tutor-stream";
import type { Section } from "@/lib/sections";
import { Button } from "./ui/button";
import { Loading, Notice } from "./ui/state";

const modes: { id: TutorMode; label: string }[] = [
  { id: "explain", label: "Explain simply" },
  { id: "hint", label: "Give a hint" },
  { id: "quiz", label: "Quiz me" },
  { id: "summarize", label: "Summarize" },
];
export function TutorPanel({
  user,
  lessonId,
  sections,
}: {
  user: User;
  lessonId: string;
  sections: Section[];
}) {
  const history = useResource(
    user,
    `/api/tutor?lessonId=${lessonId}`,
    chatViewSchema,
  );
  const [mode, setMode] = useState<TutorMode>("explain");
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<TutorTurn[]>([]);
  const [draft, setDraft] = useState<{ message: string; text: string } | null>(
    null,
  );
  const [error, setError] = useState("");
  const working = useRef<AbortController | null>(null);
  const list = useRef<HTMLDivElement | null>(null);
  useEffect(() => () => working.current?.abort(), []);
  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [turns, draft, history.data]);
  async function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (working.current) return;
    const message =
      input.trim() || (mode === "summarize" ? "Summarize this lesson" : "");
    const fields = tutorInputSchema.safeParse({ lessonId, mode, message });
    if (!fields.success) {
      setError("Enter a question with 2 to 900 characters.");
      return;
    }
    const controller = new AbortController();
    working.current = controller;
    setDraft({ message, text: "" });
    setError("");
    setInput("");
    try {
      const response = await requestApi(user, "/api/tutor", {
        method: "POST",
        body: JSON.stringify(fields.data),
        signal: controller.signal,
      });
      const result = await readTutor(response, (text) =>
        setDraft((old) => (old ? { ...old, text: old.text + text } : old)),
      );
      setTurns((old) => [
        ...old,
        {
          message,
          mode,
          answer: result.text,
          citations: result.citations,
          at: new Date().toISOString(),
        },
      ]);
    } catch (err) {
      setInput(message);
      setError(
        controller.signal.aborted
          ? "Answer stopped. You can resend the question."
          : err instanceof TutorStreamError
            ? err.message
            : friendlyError(err),
      );
    } finally {
      working.current = null;
      setDraft(null);
    }
  }
  const messages = [...(history.data?.messages ?? []), ...turns].slice(-12);
  return (
    <aside
      id="tutor"
      className="panel tutor-panel"
      aria-label="Lesson AI tutor"
    >
      <div className="tutor-head">
        <span className="tool-icon">
          <Sparkles size={20} />
        </span>
        <div>
          <h2>AI tutor</h2>
          <p>
            {history.data?.provider === "demo"
              ? "SAMPLE · extractive answers"
              : "Grounded in this lesson"}
          </p>
        </div>
      </div>
      <div className="mode-picker" role="group" aria-label="Tutor mode">
        {modes.map((item) => (
          <button
            type="button"
            key={item.id}
            aria-pressed={mode === item.id}
            disabled={Boolean(draft)}
            onClick={() => setMode(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div
        className="tutor-feed"
        ref={list}
        tabIndex={0}
        aria-label="Tutor conversation"
      >
        {history.error ? (
          <Notice retry={history.reload}>{history.error}</Notice>
        ) : !history.data ? (
          <Loading label="Loading chat…" />
        ) : (
          messages.length === 0 &&
          !draft && (
            <div className="tutor-empty">
              <BookOpenText size={24} aria-hidden="true" />
              <strong>What are you working through?</strong>
              <p>Ask about a concept or choose a mode to start.</p>
              {sections[0] && (
                <button
                  type="button"
                  onClick={() => {
                    setMode("explain");
                    setInput(`Explain ${sections[0].title.toLowerCase()}.`);
                  }}
                >{`Explain ${sections[0].title.toLowerCase()}`}</button>
              )}
            </div>
          )
        )}
        {messages.map((turn, index) => (
          <div className="turn" key={`${turn.at}-${index}`}>
            <p className="message mine">{turn.message}</p>
            <div className="message reply">
              {turn.answer}
              {turn.citations.length > 0 && (
                <div className="citations" aria-label="Sources">
                  {turn.citations.map((citation) => (
                    <a key={citation.chunkId} href={`#${citation.chunkId}`}>
                      <BookOpenText size={12} aria-hidden="true" />
                      {sections.find((row) => row.id === citation.chunkId)
                        ?.title ?? "Source section"}
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {draft && (
          <div className="turn">
            <p className="message mine">{draft.message}</p>
            <div className="message reply">
              {draft.text || <Loading label="Finding lesson sources…" />}
            </div>
          </div>
        )}
      </div>
      <p className="sr-only" aria-live="polite">
        {draft
          ? "Tutor is answering."
          : turns.length
            ? "Tutor answer received."
            : ""}
      </p>
      {error && <Notice>{error}</Notice>}
      <form className="tutor-form" onSubmit={ask}>
        <label className="sr-only" htmlFor="tutor-message">
          Message the tutor
        </label>
        <input
          id="tutor-message"
          value={input}
          maxLength={900}
          disabled={Boolean(draft)}
          placeholder={
            mode === "summarize"
              ? "Leave empty to summarize lesson"
              : "Ask about this lesson…"
          }
          onChange={(event) => setInput(event.target.value)}
        />
        {draft ? (
          <Button
            type="button"
            size="icon"
            variant="outline"
            aria-label="Stop answer"
            onClick={() => working.current?.abort()}
          >
            <Square />
          </Button>
        ) : (
          <Button
            type="submit"
            size="icon"
            aria-label="Send message"
            disabled={!history.data || (!input.trim() && mode !== "summarize")}
          >
            <ArrowUp />
          </Button>
        )}
      </form>
    </aside>
  );
}
