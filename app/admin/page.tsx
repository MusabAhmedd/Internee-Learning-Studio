"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { CloudUpload, ShieldCheck } from "lucide-react";
import { WorkspaceGate, type Workspace } from "@/components/workspace-gate";
import { WorkspaceShell } from "@/components/workspace-shell";
import { Button } from "@/components/ui/button";
import { Loading, Notice } from "@/components/ui/state";
import { api, friendlyError } from "@/lib/client-api";
import { adminViewSchema, importResponseSchema } from "@/lib/schemas";
import { useResource } from "@/lib/use-resource";

export default function AdminPage() {
  return (
    <WorkspaceGate>
      {(context) =>
        context.admin ? (
          <Admin context={context} />
        ) : (
          <WorkspaceShell context={context} section="Cohort admin">
            <div className="panel empty">
              <ShieldCheck />
              <h1>Administrator access required</h1>
              <p>
                This view is only available to an account with an administrator
                claim.
              </p>
              <Button asChild variant="outline">
                <Link href="/dashboard">Back to overview</Link>
              </Button>
            </div>
          </WorkspaceShell>
        )
      }
    </WorkspaceGate>
  );
}
function Admin({ context }: { context: Workspace }) {
  const state = useResource(context.user, "/api/admin", adminViewSchema);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setStatus("");
    const form = event.currentTarget;
    const file = new FormData(form).get("bundle");
    if (
      !(file instanceof File) ||
      !file.name.toLowerCase().endsWith(".json") ||
      (file.type && file.type !== "application/json") ||
      file.size === 0 ||
      file.size > 98_304
    ) {
      setError("Select a nonempty JSON catalogue no larger than 96 KiB.");
      return;
    }
    setBusy(true);
    try {
      const result = await api(
        context.user,
        "/api/admin/import",
        importResponseSchema,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Filename": file.name,
          },
          body: file,
        },
      );
      setStatus(
        result.unchanged
          ? `Archived the existing revision ${result.revision.slice(0, 12)}. No lessons changed.`
          : `Published ${result.modules} modules and ${result.lessons} lessons. Run npm run embed before using the tutor on changed lessons.`,
      );
      form.reset();
      state.reload();
    } catch (error) {
      setError(friendlyError(error));
    } finally {
      setBusy(false);
    }
  }
  const data = state.data;
  return (
    <WorkspaceShell context={context} section="Cohort admin">
      <div className="page-intro">
        <span className="eyebrow">
          <ShieldCheck size={15} /> ADMINISTRATION
        </span>
        <h1>Cohort overview</h1>
        <p>Track cohort learning signals and publish a validated curriculum.</p>
      </div>
      {state.error ? (
        <Notice retry={state.reload}>{state.error}</Notice>
      ) : !data ? (
        <Loading label="Loading cohort…" />
      ) : (
        <>
          <div className="admin-stats">
            <div className="panel overview-panel">
              <h2>Learners</h2>
              <strong>{data.learners}</strong>
            </div>
            <div className="panel overview-panel">
              <h2>Average mastery</h2>
              <strong>
                {data.meanMastery === null
                  ? "—"
                  : `${Math.round(data.meanMastery * 100)}%`}
              </strong>
            </div>
            <div className="panel overview-panel">
              <h2>Inactive learners</h2>
              <strong>{data.inactive}</strong>
            </div>
          </div>
          <div className="overview-grid">
            <section className="panel overview-panel">
              <div className="panel-heading">
                <div>
                  <h2>Most-missed topics</h2>
                  <p>From {data.sampledAttempts} recent graded answers.</p>
                </div>
              </div>
              {data.missed.length ? (
                <ul className="admin-list">
                  {data.missed.map((row) => (
                    <li key={row.topic}>
                      <strong>{row.topic}</strong>
                      <span>
                        {row.misses} of {row.total} missed
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="smallprint">
                  No missed questions in this sample.
                </p>
              )}
            </section>
            <section className="panel overview-panel">
              <div className="panel-heading">
                <div>
                  <h2>Inactive learners</h2>
                  <p>No quiz or completion activity for at least seven days.</p>
                </div>
              </div>
              {data.inactiveLearners.length ? (
                <ul className="admin-list">
                  {data.inactiveLearners.map((row, index) => (
                    <li key={`${row.displayName}-${index}`}>
                      <strong>{row.displayName}</strong>
                      <span>
                        {row.track} · {row.lastAt.slice(0, 10)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="smallprint">
                  No inactive learners in this cohort.
                </p>
              )}
            </section>
          </div>
        </>
      )}
      <section className="panel overview-panel">
        <div className="panel-heading">
          <div>
            <h2>Curriculum import</h2>
            <p>
              Upload structured JSON. A valid bundle replaces the catalog;
              completed work and practice history are retained.
            </p>
          </div>
        </div>
        <form className="field-stack" onSubmit={upload}>
          <label>
            Curriculum JSON
            <input
              name="bundle"
              type="file"
              required
              accept="application/json,.json"
              disabled={busy}
            />
          </label>
          <p className="smallprint">
            Use the format in <code>data/sample/SAMPLE_generative_ai.json</code>
            . The original validated JSON is kept in private Firebase Storage.
            Re-index changed content after publishing.
          </p>
          <Button className="w-fit" type="submit" disabled={busy}>
            <CloudUpload />
            {busy ? "Validating and publishing…" : "Upload and publish"}
          </Button>
        </form>
        {error && <Notice>{error}</Notice>}
        {status && (
          <p className="completion-pill" role="status">
            {status}
          </p>
        )}
      </section>
    </WorkspaceShell>
  );
}
