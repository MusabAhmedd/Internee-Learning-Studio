"use client";
import { useState, type FormEvent } from "react";
import type { User } from "firebase/auth";
import {
  ArrowRight,
  BadgeCheck,
  Brain,
  CircleHelp,
  Lightbulb,
} from "lucide-react";
import { api, friendlyError, requestApi } from "@/lib/client-api";
import { gradeOutputSchema, quizPublicSchema } from "@/lib/schemas";
import { readTutor, TutorStreamError } from "@/lib/tutor-stream";
import { Button } from "./ui/button";
import { Notice } from "./ui/state";
import type { z } from "zod";

type Quiz = z.infer<typeof quizPublicSchema>;
type Grade = z.infer<typeof gradeOutputSchema>;
export function QuizPanel({
  user,
  lessonId,
  focus,
}: {
  user: User;
  lessonId: string;
  focus?: string;
}) {
  const [quiz, setQuiz] = useState<Quiz>();
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState("");
  const [grades, setGrades] = useState<Grade[]>([]);
  const [busy, setBusy] = useState<"generate" | "grade" | "hint" | null>(null);
  const [error, setError] = useState("");
  const [hint, setHint] = useState("");
  const question = quiz?.questions[index];
  const grade = grades[index];
  const finished = Boolean(quiz && index >= quiz.questions.length);
  async function start() {
    setBusy("generate");
    setError("");
    try {
      const result = await api(user, "/api/quiz/generate", quizPublicSchema, {
        method: "POST",
        body: JSON.stringify({
          lessonId,
          n: focus ? 1 : 3,
          ...(focus ? { topic: focus } : {}),
        }),
      });
      setQuiz(result);
      setIndex(0);
      setGrades([]);
      setHint("");
      setAnswer("");
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(null);
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!question || !answer.trim() || grade || busy) return;
    setBusy("grade");
    setError("");
    try {
      const result = await api(user, "/api/quiz/grade", gradeOutputSchema, {
        method: "POST",
        body: JSON.stringify({
          questionId: question.id,
          answer: answer.trim(),
        }),
      });
      setGrades((old) => [...old, result]);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(null);
    }
  }
  async function getHint() {
    if (!question || busy) return;
    setBusy("hint");
    setError("");
    try {
      const response = await requestApi(user, "/api/tutor", {
        method: "POST",
        body: JSON.stringify({
          lessonId,
          questionId: question.id,
          mode: "hint",
          message: question.prompt,
        }),
      });
      const result = await readTutor(response, () => {});
      setHint(result.text);
    } catch (error) {
      setError(
        error instanceof TutorStreamError
          ? error.message
          : friendlyError(error),
      );
    } finally {
      setBusy(null);
    }
  }
  return (
    <section
      className="panel quiz-panel"
      id="practice"
      aria-labelledby="practice-title"
    >
      <div className="tutor-head">
        <span className="tool-icon tone-1">
          <Brain size={21} />
        </span>
        <div>
          <h2 id="practice-title">Practice quiz</h2>
          <p>
            {focus
              ? `Focus topic: ${focus}`
              : "Check your understanding and update your mastery."}
            {quiz?.provider === "demo" ? " · SAMPLE questions" : ""}
          </p>
        </div>
      </div>
      {error && <Notice>{error}</Notice>}
      {!quiz ? (
        <Button className="w-fit" onClick={start} disabled={Boolean(busy)}>
          {busy === "generate" ? "Preparing quiz…" : "Start practice quiz"}{" "}
          <ArrowRight />
        </Button>
      ) : finished ? (
        <div className="quiz-finished">
          <BadgeCheck size={25} aria-hidden="true" />
          <h3>Practice complete</h3>
          <p>
            {grades.filter((x) => x.correct).length} of {grades.length} correct.
            Your attempts are saved.
          </p>
          <Button variant="outline" onClick={start} disabled={Boolean(busy)}>
            {busy === "generate" ? "Preparing quiz…" : "Practice again"}
          </Button>
        </div>
      ) : (
        question && (
          <form className="field-stack" onSubmit={submit}>
            <span className="module-index">
              QUESTION {index + 1} OF {quiz.questions.length} ·{" "}
              {question.topic.toUpperCase()}
            </span>
            {question.type === "mcq" ? (
              <fieldset className="quiz-options">
                <legend>{question.prompt}</legend>
                {question.options?.map((option) => (
                  <label key={option} className="quiz-option">
                    <input
                      type="radio"
                      name="answer"
                      value={option}
                      checked={option === answer}
                      disabled={Boolean(grade) || Boolean(busy)}
                      onChange={(event) => setAnswer(event.target.value)}
                    />
                    {option}
                  </label>
                ))}
              </fieldset>
            ) : (
              <label>
                {question.prompt}
                <textarea
                  rows={3}
                  maxLength={600}
                  required
                  disabled={Boolean(grade) || Boolean(busy)}
                  value={answer}
                  onChange={(event) => setAnswer(event.target.value)}
                  placeholder="Answer in your own words"
                />
              </label>
            )}
            {hint && (
              <p className="quiz-hint" role="status">
                <Lightbulb size={15} />
                {hint}
              </p>
            )}
            {grade ? (
              <>
                <div
                  className={`quiz-feedback ${grade.correct ? "correct" : ""}`}
                  role="status"
                >
                  <strong>{grade.correct ? "Correct" : "Not quite"}</strong>
                  <p>{grade.feedback}</p>
                </div>
                <Button
                  type="button"
                  className="w-fit"
                  onClick={() => {
                    setIndex(index + 1);
                    setAnswer("");
                    setHint("");
                    setError("");
                  }}
                >
                  {index === quiz.questions.length - 1
                    ? "See results"
                    : "Next question"}{" "}
                  <ArrowRight />
                </Button>
              </>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="submit"
                  disabled={!answer.trim() || Boolean(busy)}
                >
                  {busy === "grade" ? "Checking…" : "Check answer"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={Boolean(busy) || Boolean(hint)}
                  onClick={getHint}
                >
                  <CircleHelp />
                  {busy === "hint" ? "Finding hint…" : "Get a hint"}
                </Button>
              </div>
            )}
          </form>
        )
      )}
    </section>
  );
}
