"use client";
import Link from "next/link";
import { ArrowUpRight, CalendarDays, Clock3, RefreshCw } from "lucide-react";
import { WorkspaceGate, type Workspace } from "@/components/workspace-gate";
import { WorkspaceShell } from "@/components/workspace-shell";
import { Button } from "@/components/ui/button";
import { Loading, Notice } from "@/components/ui/state";
import { usePlan } from "@/lib/use-plan";

const labelFor = {
  behind: "You missed a scheduled lesson.",
  "low-score": "Recent practice identified a lesson to review.",
  "new-week": "A new week is ready.",
  curriculum: "The catalog changed.",
  profile: "Your study profile changed.",
};
const dayLabel = new Intl.DateTimeFormat("en", {
  weekday: "long",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
export default function PlanPage() {
  return (
    <WorkspaceGate>
      {(context) => <StudyPlan context={context} />}
    </WorkspaceGate>
  );
}
function StudyPlan({ context }: { context: Workspace }) {
  const state = usePlan(context.user);
  const data = state.data;
  const titles = new Map(data?.lessons.map((item) => [item.id, item.title]));
  return (
    <WorkspaceShell context={context} section="Study plan">
      <div className="page-intro">
        <span className="eyebrow">
          <CalendarDays size={15} /> YOUR LEARNING ROADMAP
        </span>
        <h1>Your study plan</h1>
        <p>
          Seven days shaped around your goals, practice results, and{" "}
          {context.profile.weeklyHours} weekly study hours.
        </p>
      </div>
      {state.error ? (
        <Notice retry={state.reload}>{state.error}</Notice>
      ) : !data ? (
        <Loading label="Loading study plan…" />
      ) : (
        <>
          <div className="panel plan-banner">
            <div>
              <h2>
                {data.plan ? "Your learning week" : "Build your first plan"}
              </h2>
              <p>
                {data.provider === "demo"
                  ? "SAMPLE · local planner"
                  : "Personalized with Gemini"}{" "}
                · Dates in UTC{data.reason ? ` · ${labelFor[data.reason]}` : ""}
              </p>
            </div>
            <Button
              onClick={state.generate}
              disabled={state.working || !data.lessons.length}
            >
              <RefreshCw />
              {state.working
                ? "Updating plan…"
                : data.plan
                  ? "Refresh plan"
                  : "Generate study plan"}
            </Button>
          </div>
          {state.actionError && (
            <Notice retry={state.generate}>{state.actionError}</Notice>
          )}
          {!data.lessons.length ? (
            <div className="panel empty">
              <CalendarDays />
              <h2>No lessons for this track</h2>
              <p>
                Choose a track with published modules to build your study plan.
              </p>
              <Button asChild variant="outline">
                <Link href="/modules">Browse modules</Link>
              </Button>
            </div>
          ) : !data.plan ? (
            <div className="panel empty">
              <CalendarDays />
              <h2>No plan yet</h2>
              <p>
                Generate a schedule above to see your daily goals and lessons
                here.
              </p>
            </div>
          ) : (
            <ol className="plan-grid">
              {data.plan.days.map((day, index) => (
                <li key={day.date} className="panel plan-day">
                  <div className="plan-day-top">
                    <span className="tool-icon">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div>
                      <span className="module-index">
                        {dayLabel.format(new Date(`${day.date}T12:00:00Z`))}
                      </span>
                      <h2>{day.goal}</h2>
                    </div>
                    <span className="plan-minutes">
                      <Clock3 size={14} />
                      {day.minutes} min
                    </span>
                  </div>
                  <p>{day.reason}</p>
                  {day.lessonIds.length > 0 && (
                    <div className="module-links">
                      {day.lessonIds.map((id) =>
                        titles.has(id) ? (
                          <Link key={id} href={`/lesson/${id}`}>
                            {titles.get(id)}
                            <ArrowUpRight size={15} />
                          </Link>
                        ) : (
                          <span key={id} className="smallprint">
                            Lesson no longer available
                          </span>
                        ),
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </WorkspaceShell>
  );
}
