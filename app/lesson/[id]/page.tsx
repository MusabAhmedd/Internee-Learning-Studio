"use client";
import Link from "next/link";
import { Suspense, useEffect } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, BookOpen, Clock3 } from "lucide-react";
import { WorkspaceGate, type Workspace } from "@/components/workspace-gate";
import { WorkspaceShell } from "@/components/workspace-shell";
import { CompleteLesson } from "@/components/complete-lesson";
import { QuizPanel } from "@/components/quiz-panel";
import { TutorPanel } from "@/components/tutor-panel";
import { Button } from "@/components/ui/button";
import { Loading, Notice } from "@/components/ui/state";
import { idSchema, lessonResponseSchema } from "@/lib/schemas";
import { sections } from "@/lib/sections";
import { useResource } from "@/lib/use-resource";

export default function LessonPage() {
  return (
    <Suspense
      fallback={
        <main id="main-content" className="p-8">
          <Loading />
        </main>
      }
    >
      <LessonRoute />
    </Suspense>
  );
}
function LessonRoute() {
  const result = idSchema.safeParse(useParams<{ id: string }>().id);
  return (
    <WorkspaceGate>
      {(context) =>
        result.success ? (
          <Lesson context={context} id={result.data} />
        ) : (
          <WorkspaceShell context={context} section="Lesson" active="Modules">
            <Notice>This lesson does not exist.</Notice>
          </WorkspaceShell>
        )
      }
    </WorkspaceGate>
  );
}
function Lesson({ context, id }: { context: Workspace; id: string }) {
  const { data, error, reload } = useResource(
    context.user,
    `/api/lesson/${id}`,
    lessonResponseSchema,
  );
  const chunks = data ? sections(id, data.lesson.content) : [];
  const search = useSearchParams();
  const topic = search.get("practice") ?? "";
  const focus = data?.lesson.topics.includes(topic) ? topic : undefined;
  useEffect(() => {
    if (!data) return;
    const anchor = window.location.hash.slice(1);
    if (anchor === "practice" || anchor === "tutor")
      document.getElementById(anchor)?.scrollIntoView({ block: "start" });
  }, [data]);
  return (
    <WorkspaceShell
      context={context}
      section="Lesson"
      active="Modules"
      sample={data?.module.source === "SAMPLE"}
    >
      <Link href="/modules" className="backlink">
        <ArrowLeft size={16} aria-hidden="true" /> All modules
      </Link>
      {error ? (
        <Notice retry={reload}>{error}</Notice>
      ) : !data ? (
        <Loading label="Loading lesson…" />
      ) : (
        <>
          <div className="page-intro">
            <span className="eyebrow">
              <BookOpen size={15} /> {data.module.title.toUpperCase()}
            </span>
            <h1>{data.lesson.title}</h1>
            <p className="inline-flex items-center gap-2">
              <Clock3 size={16} aria-hidden="true" /> {data.lesson.estMinutes}{" "}
              min <span aria-hidden="true">·</span>{" "}
              {data.lesson.topics.join(", ")}
            </p>
          </div>
          <div className="lesson-grid">
            <div className="panel lesson-body">
              {chunks.map((chunk, index) => (
                <section key={chunk.id} id={chunk.id}>
                  <span className="section-number">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <h2>{chunk.title}</h2>
                    <p>{chunk.text}</p>
                  </div>
                </section>
              ))}
            </div>
            <TutorPanel
              key={id}
              user={context.user}
              lessonId={id}
              sections={chunks}
            />
          </div>
          <QuizPanel
            key={`${id}-${focus ?? "all"}`}
            user={context.user}
            lessonId={id}
            focus={focus}
          />
          <CompleteLesson
            key={`complete-${id}`}
            user={context.user}
            lessonId={id}
          />
          {data.nextLessonId && (
            <Button asChild>
              <Link href={`/lesson/${data.nextLessonId}`}>
                Next lesson <ArrowRight />
              </Link>
            </Button>
          )}
        </>
      )}
    </WorkspaceShell>
  );
}
