"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { AuthLayout } from "@/components/auth-layout";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { Loading, Notice } from "@/components/ui/state";
import { timeZoneSchema } from "@/lib/learning-dates";
import { api, friendlyError } from "@/lib/client-api";
import {
  levelSchema,
  profileInputSchema,
  profileResponseSchema,
  trackSchema,
  type Profile,
} from "@/lib/schemas";

export default function Onboarding() {
  const { user, loading, error: sessionError } = useAuth();
  const router = useRouter();
  const [existing, setExisting] = useState<Profile | null | undefined>(
    undefined,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (loading || sessionError) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    const controller = new AbortController();
    api(user, "/api/profile", profileResponseSchema, {
      signal: controller.signal,
    })
      .then((result) => setExisting(result.profile))
      .catch((err) => {
        if (!controller.signal.aborted) setError(friendlyError(err));
      });
    return () => controller.abort();
  }, [loading, router, sessionError, user, retry]);

  const browserZone = timeZoneSchema.safeParse(
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const zone =
    existing?.timeZone ?? (browserZone.success ? browserZone.data : "UTC");
  const zones = [
    ...new Set([
      "UTC",
      "Asia/Karachi",
      zone,
      ...(Intl.supportedValuesOf?.("timeZone") ?? []),
    ]),
  ];

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return;
    const data = new FormData(event.currentTarget);
    const fields = profileInputSchema.safeParse({
      ...Object.fromEntries(data),
      weeklyHours: Number(data.get("weeklyHours")),
    });
    if (!fields.success) {
      setError(
        "Check your name, study hours, time zone, and goal before continuing.",
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api(user, "/api/profile", profileResponseSchema, {
        method: "PUT",
        body: JSON.stringify(fields.data),
      });
      router.replace("/dashboard");
    } catch (err) {
      setError(friendlyError(err));
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <span className="eyebrow">LEARNING PROFILE</span>
      <h1>{existing ? "Update your profile" : "Make it yours"}</h1>
      <p className="description">
        Tell us what you’re working toward so your study plan fits your time and
        goals.
      </p>
      {(error || sessionError) && (
        <Notice
          retry={
            !sessionError && existing === undefined
              ? () => {
                  setError(null);
                  setRetry((value) => value + 1);
                }
              : undefined
          }
        >
          {error ?? sessionError}
        </Notice>
      )}
      {existing === undefined ? (
        !error && !sessionError && <Loading label="Loading profile…" />
      ) : (
        <form className="field-stack" onSubmit={save}>
          <label>
            Display name
            <input
              name="displayName"
              autoComplete="given-name"
              required
              minLength={2}
              maxLength={48}
              defaultValue={existing?.displayName ?? user?.displayName ?? ""}
            />
          </label>
          <label>
            Learning track
            <select
              name="track"
              defaultValue={existing?.track ?? trackSchema.options[0]}
            >
              {trackSchema.options.map((track) => (
                <option key={track}>{track}</option>
              ))}
            </select>
          </label>
          <div className="field-row">
            <label>
              Current level
              <select
                name="level"
                defaultValue={existing?.level ?? levelSchema.options[0]}
              >
                {levelSchema.options.map((level) => (
                  <option key={level}>{level}</option>
                ))}
              </select>
            </label>
            <label>
              Weekly study hours
              <input
                type="number"
                name="weeklyHours"
                required
                min={1}
                max={40}
                defaultValue={existing?.weeklyHours ?? 5}
              />
            </label>
          </div>
          <label>
            Learning time zone
            <select
              name="timeZone"
              defaultValue={zone}
              aria-describedby="zone-note"
            >
              {zones.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <small id="zone-note" className="smallprint">
              Sets the day boundary for your plan, streak, and recap.
            </small>
          </label>
          <label>
            Learning goal
            <textarea
              name="goal"
              required
              minLength={5}
              maxLength={280}
              rows={3}
              placeholder="e.g. Build a tutor that cites its sources"
              defaultValue={existing?.goal ?? ""}
            />
          </label>
          <Button type="submit" size="lg" disabled={busy}>
            {busy ? "Saving…" : "Save learning profile"}
            <ArrowRight aria-hidden="true" />
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
