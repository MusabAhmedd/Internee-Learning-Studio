"use client";
import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Award,
  BookOpen,
  CalendarDays,
  Clock3,
  Flame,
  Focus,
  GraduationCap,
  Layers3,
  Play,
  Sparkles,
  Target,
  Trophy,
} from "lucide-react";
import type { User } from "firebase/auth";
import type { z } from "zod";
import { WorkspaceGate, type Workspace } from "@/components/workspace-gate";
import { WorkspaceShell } from "@/components/workspace-shell";
import { Button } from "@/components/ui/button";
import { Loading, Notice } from "@/components/ui/state";
import { api, friendlyError, requestApi } from "@/lib/client-api";
import {
  badgeSchema,
  dashboardSchema,
  summaryResponseSchema,
} from "@/lib/schemas";
import { useResource } from "@/lib/use-resource";
import { usePlan } from "@/lib/use-plan";

type View = z.infer<typeof dashboardSchema>;
const labels: Record<
  z.infer<typeof badgeSchema>,
  { label: string; detail: string }
> = {
  "first-lesson": {
    label: "First steps",
    detail: "Complete your first lesson",
  },
  "three-day-streak": {
    label: "On a roll",
    detail: "Study three days in a row",
  },
  "practice-pro": { label: "Practice pro", detail: "Record ten quiz attempts" },
  "track-complete": {
    label: "Track finisher",
    detail: "Complete every lesson in your track",
  },
};
const percent = (ratio: number) => Math.round(ratio * 100);
function duration(seconds: number) {
  const mins = Math.floor(seconds / 60),
    hours = Math.floor(mins / 60);
  return hours ? `${hours}h ${mins % 60}m` : `${mins}m`;
}
export default function DashboardPage() {
  return (
    <Suspense
      fallback={
        <main
          id="main-content"
          className="grid min-h-screen place-items-center"
        >
          <Loading />
        </main>
      }
    >
      <DashboardRoute />
    </Suspense>
  );
}
function DashboardRoute() {
  const open = useSearchParams().get("sample") === "1";
  return (
    <WorkspaceGate sampleOnEntry={open}>
      {(context) => <Dashboard context={context} />}
    </WorkspaceGate>
  );
}

function Dashboard({ context }: { context: Workspace }) {
  const state = useResource(context.user, "/api/dashboard", dashboardSchema);
  const plan = usePlan(context.user);
  const view = state.data;
  const first = context.profile.displayName.split(/\s+/)[0];
  const zone = context.profile.timeZone;
  const today = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: zone,
  }).format(new Date());
  const progress = view?.total ? percent(view.completed / view.total) : 0;
  const accuracy = view?.attempts
    ? percent(view.correct / view.attempts)
    : null;
  const next = view?.next;
  const target = next ? `/lesson/${next.id}` : "/modules";
  return (
    <WorkspaceShell
      context={context}
      section="Overview"
      sample={view?.sample}
      tutorLessonId={next?.id}
    >
      <div className="overview-intro">
        <div className="page-intro">
          <span className="eyebrow">
            <span className="live-dot" /> PERSONAL LEARNING SPACE
          </span>
          <h1>Welcome back, {first}.</h1>
          <p>Here’s where you stand and what to learn next.</p>
        </div>
        <span className="date-chip">
          <CalendarDays size={16} aria-hidden="true" />
          {today}
          <small>{zone}</small>
        </span>
      </div>
      <section className="journey-hero" aria-label="Active learning track">
        <div className="hero-inner">
          <span className="hero-tag">
            <Layers3 size={14} aria-hidden="true" /> YOUR ACTIVE TRACK
          </span>
          <h2>{context.profile.track}</h2>
          <p>Build practical skills, one lesson at a time.</p>
          <div className="hero-actions">
            <Button asChild>
              <Link href={target}>
                <Play fill="currentColor" aria-hidden="true" />
                {next ? "Continue learning" : "Explore modules"}
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/plan">
                <CalendarDays aria-hidden="true" /> View study plan
              </Link>
            </Button>
          </div>
        </div>
      </section>
      {state.error ? (
        <Notice retry={state.reload}>{state.error}</Notice>
      ) : !view ? (
        <Loading label="Loading your progress…" />
      ) : (
        <>
          <section className="stat-grid" aria-label="Learning statistics">
            <Stat
              label="Course progress"
              value={`${progress}%`}
              detail={`${view.completed} of ${view.total} lessons complete`}
            >
              <ProgressRing value={progress} />
            </Stat>
            <Stat
              label="Study streak"
              value={`${view.streak} ${view.streak === 1 ? "day" : "days"}`}
              detail={
                view.streak
                  ? "Consecutive active days"
                  : "Study to begin a streak"
              }
            >
              <span className="tool-icon tone-3">
                <Flame size={21} aria-hidden="true" />
              </span>
            </Stat>
            <Stat
              label="Time studied"
              value={duration(view.studySeconds)}
              detail="Recorded lesson time"
            >
              <span className="tool-icon tone-1">
                <Clock3 size={21} aria-hidden="true" />
              </span>
            </Stat>
            <Stat
              label="Quiz accuracy"
              value={accuracy === null ? "—" : `${accuracy}%`}
              detail={
                view.attempts
                  ? `${view.correct} of ${view.attempts} recent answers correct`
                  : "No scored practice yet"
              }
            >
              <span className="tool-icon tone-2">
                <Target size={21} aria-hidden="true" />
              </span>
            </Stat>
          </section>
          <div className="overview-grid">
            <section className="panel overview-panel">
              <div className="panel-heading">
                <div>
                  <h2>Continue learning</h2>
                  <p>Pick up where you left off.</p>
                </div>
                <Link href="/modules" className="text-link">
                  All modules <ArrowUpRight size={14} aria-hidden="true" />
                </Link>
              </div>
              {next ? (
                <div className="next-lesson">
                  <span className="tool-icon">
                    <BookOpen size={22} aria-hidden="true" />
                  </span>
                  <div>
                    <span className="module-index">
                      MODULE {String(next.moduleOrder).padStart(2, "0")} · NEXT
                      LESSON
                    </span>
                    <h3>{next.title}</h3>
                    <p>
                      <Clock3 size={13} aria-hidden="true" />
                      {next.estMinutes} min <span>·</span> {next.moduleTitle}
                    </p>
                  </div>
                  <Button asChild size="icon" variant="outline">
                    <Link
                      href={`/lesson/${next.id}`}
                      aria-label={`Open ${next.title}`}
                    >
                      <ArrowUpRight />
                    </Link>
                  </Button>
                </div>
              ) : (
                <p className="smallprint">
                  {view.total
                    ? "You’ve completed every lesson in this track. Revisit a module to keep practicing."
                    : "No lessons have been published for this track yet."}
                </p>
              )}
              <div className="panel-divider" />
              <div className="panel-heading">
                <div>
                  <h2>
                    <Focus size={17} aria-hidden="true" /> Focus areas
                  </h2>
                  <p>Topics to revisit based on your practice.</p>
                </div>
              </div>
              {view.topics.some((row) => row.weak) ? (
                <div className="focus-list">
                  {view.topics
                    .filter((row) => row.weak)
                    .map((row) => (
                      <div className="focus-item" key={row.topic}>
                        <span className="focus-dot" />
                        <div>
                          <strong>{row.topic}</strong>
                          <small>
                            {row.attemptCount} attempts · Needs practice
                          </small>
                        </div>
                        <Button asChild size="sm" variant="outline">
                          <Link
                            href={`/lesson/${row.lessonId}?practice=${encodeURIComponent(row.topic)}#practice`}
                          >
                            Practice this <ArrowRight />
                          </Link>
                        </Button>
                      </div>
                    ))}
                </div>
              ) : (
                <p className="smallprint">
                  No weak areas yet. Practice a topic three times to identify
                  where to focus.
                </p>
              )}
            </section>
            <section className="panel overview-panel">
              <div className="panel-heading">
                <div>
                  <h2>Topic mastery</h2>
                  <p>Updated from quiz results and hint usage.</p>
                </div>
                <span className="tool-icon mastery-icon">
                  <Target size={17} aria-hidden="true" />
                </span>
              </div>
              {view.topics.length ? (
                <div className="heatmap" aria-label="Topic mastery heatmap">
                  {view.topics.map((row) => {
                    const level =
                      row.score === null
                        ? "empty"
                        : row.weak
                          ? "weak"
                          : row.score >= 0.75
                            ? "strong"
                            : "growing";
                    return (
                      <div
                        className={`heat-cell ${level}`}
                        key={row.topic}
                        data-testid={`mastery-${row.topic}`}
                      >
                        <span>{row.topic}</span>
                        <strong>
                          {row.score === null ? "—" : `${percent(row.score)}%`}
                        </strong>
                        <div className="heat-track" aria-hidden="true">
                          <i style={{ width: `${percent(row.score ?? 0)}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="smallprint">
                  No topics to show until a curriculum is published.
                </p>
              )}
              <div className="heat-legend">
                <span>
                  <i className="legend-strong" />
                  Strong
                </span>
                <span>
                  <i className="legend-growing" />
                  Developing
                </span>
                <span>
                  <i className="legend-weak" />
                  Needs practice
                </span>
                <span>
                  <i className="legend-empty" />
                  No data
                </span>
              </div>
            </section>
            <WeeklyRecap user={context.user} />
            <Achievements user={context.user} view={view} />
          </div>
          {(plan.working || plan.actionError) && (
            <div role="status">
              {plan.actionError ? (
                <Notice retry={plan.generate}>{plan.actionError}</Notice>
              ) : (
                <Loading label="Adapting your study plan…" />
              )}
            </div>
          )}
        </>
      )}
    </WorkspaceShell>
  );
}
function Stat({
  label,
  value,
  detail,
  children,
}: {
  label: string;
  value: string;
  detail: string;
  children: React.ReactNode;
}) {
  return (
    <article className="panel stat">
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
      </div>
      {children}
      <small>{detail}</small>
    </article>
  );
}
function ProgressRing({ value }: { value: number }) {
  return (
    <svg
      className="progress-ring"
      role="img"
      aria-label={`${value}% course completion`}
      viewBox="0 0 44 44"
    >
      <circle
        cx="22"
        cy="22"
        r="18"
        fill="none"
        stroke="#302b49"
        strokeWidth="4"
      />
      <circle
        cx="22"
        cy="22"
        r="18"
        fill="none"
        stroke="#b8a6ff"
        strokeWidth="4"
        pathLength="100"
        strokeDasharray={`${value} 100`}
        strokeLinecap="round"
        transform="rotate(-90 22 22)"
      />
      <path
        d="M17 22l3 3 7-7"
        fill="none"
        stroke="#b8a6ff"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function WeeklyRecap({ user }: { user: User }) {
  const state = useResource(user, "/api/summary", summaryResponseSchema);
  const [updated, setUpdated] =
    useState<z.infer<typeof summaryResponseSchema>>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const summary = updated?.summary ?? state.data?.summary;
  async function generate() {
    setBusy(true);
    setError("");
    try {
      setUpdated(
        await api(user, "/api/summary", summaryResponseSchema, {
          method: "POST",
          body: "{}",
        }),
      );
    } catch (error) {
      setError(friendlyError(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel overview-panel">
      <div className="panel-heading">
        <div>
          <h2>
            <Sparkles size={17} aria-hidden="true" /> Weekly recap
          </h2>
          <p>
            {summary?.provider === "demo"
              ? "SAMPLE · local recap"
              : "A snapshot of the last seven days."}
            {summary?.period
              ? ` · Through ${summary.period.through} (${summary.period.timeZone})`
              : ""}
          </p>
        </div>
      </div>
      {state.error ? (
        <Notice retry={state.reload}>{state.error}</Notice>
      ) : !state.data ? (
        <Loading label="Loading recap…" />
      ) : (
        <>
          <p className="recap-text" aria-live="polite">
            {summary?.text ??
              "Generate a recap to see recent progress and a useful next step."}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="w-fit"
            disabled={busy}
            onClick={generate}
          >
            <Sparkles />
            {busy
              ? "Writing recap…"
              : summary
                ? "Refresh recap"
                : "Generate weekly recap"}
          </Button>
        </>
      )}
      {error && <Notice>{error}</Notice>}
    </section>
  );
}
function Achievements({ user, view }: { user: User; view: View }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function download() {
    setBusy(true);
    setError("");
    try {
      const response = await requestApi(user, "/api/certificate");
      const url = URL.createObjectURL(await response.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = "learning-studio-certificate.pdf";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
    } catch (error) {
      setError(friendlyError(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel overview-panel">
      <div className="panel-heading">
        <div>
          <h2>
            <Trophy size={17} aria-hidden="true" /> Achievements
          </h2>
          <p>Milestones earned as you learn.</p>
        </div>
      </div>
      <ul className="badge-row">
        {badgeSchema.options.map((id) => (
          <li
            key={id}
            data-earned={view.badges.includes(id)}
            title={labels[id].detail}
          >
            <Award size={15} aria-hidden="true" />
            <span>{labels[id].label}</span>
            <span className="sr-only">
              .{" "}
              {view.badges.includes(id)
                ? "Earned"
                : `Not earned. ${labels[id].detail}`}
            </span>
          </li>
        ))}
      </ul>
      {view.certificateAvailable ? (
        <Button className="w-fit" size="sm" onClick={download} disabled={busy}>
          <ArrowDownToLine />
          {busy ? "Preparing PDF…" : "Download certificate"}
        </Button>
      ) : (
        <p className="smallprint inline-flex items-center gap-2">
          <GraduationCap size={16} aria-hidden="true" /> Finish this track to
          unlock your certificate.
        </p>
      )}
      {error && <Notice>{error}</Notice>}
    </section>
  );
}
