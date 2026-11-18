"use client";
import Link from "next/link";
import {
  ArrowUpRight,
  BookOpen,
  Clock3,
  Code2,
  Compass,
  FlaskConical,
  Layers3,
  Network,
  Rocket,
  Shapes,
} from "lucide-react";
import { WorkspaceGate, type Workspace } from "@/components/workspace-gate";
import { WorkspaceShell } from "@/components/workspace-shell";
import { Loading, Notice } from "@/components/ui/state";
import { catalogSchema } from "@/lib/schemas";
import { useResource } from "@/lib/use-resource";

const icons = [Shapes, Code2, Network, Layers3, FlaskConical, Rocket];
export default function ModulesPage() {
  return (
    <WorkspaceGate>{(context) => <Modules context={context} />}</WorkspaceGate>
  );
}
function Modules({ context }: { context: Workspace }) {
  const { data, error, reload } = useResource(
    context.user,
    "/api/catalog",
    catalogSchema,
  );
  return (
    <WorkspaceShell
      context={context}
      section="Modules"
      sample={Boolean(
        data?.modules.some((module) => module.source === "SAMPLE"),
      )}
    >
      <div className="page-intro">
        <span className="eyebrow">
          <BookOpen size={15} /> THE CURRICULUM
        </span>
        <h1>Learning modules</h1>
        <p>
          Explore the curriculum at your pace. Each lesson has a tutor and a
          practice quiz.
        </p>
      </div>
      {error ? (
        <Notice retry={reload}>{error}</Notice>
      ) : !data ? (
        <Loading label="Loading modules…" />
      ) : !data.modules.length ? (
        <div className="panel empty">
          <Compass />
          <h2>No modules published yet</h2>
          <p>
            Your learning team can add a curriculum from the admin workspace.
          </p>
        </div>
      ) : (
        <div className="module-grid">
          {data.modules.map((module, index) => {
            const Icon = icons[index % icons.length] ?? BookOpen;
            return (
              <article key={module.id} className="panel module-card">
                <div className="module-top">
                  <span className={`tool-icon tone-${index % 4}`}>
                    <Icon size={22} aria-hidden="true" />
                  </span>
                  <span className="module-index">
                    MODULE {String(module.order).padStart(2, "0")}
                  </span>
                </div>
                <h2>{module.title}</h2>
                <p>{module.description}</p>
                <div className="module-links">
                  {module.lessons.map((lesson) => (
                    <Link key={lesson.id} href={`/lesson/${lesson.id}`}>
                      <span>
                        {lesson.title}
                        <small>
                          <Clock3 size={13} />
                          {lesson.estMinutes} min
                        </small>
                      </span>
                      <ArrowUpRight size={17} aria-hidden="true" />
                    </Link>
                  ))}
                </div>
                <small className="module-track">
                  {module.track}
                  {module.source === "SAMPLE" ? " · SAMPLE" : ""}
                </small>
              </article>
            );
          })}
        </div>
      )}
    </WorkspaceShell>
  );
}
