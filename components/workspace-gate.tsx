"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createUserWithEmailAndPassword, type User } from "firebase/auth";
import { browserAuth, demoEnabled } from "@/lib/firebase-client";
import { useAuth } from "./auth-provider";
import { Loading, Notice } from "./ui/state";
import { api, friendlyError } from "@/lib/client-api";
import { profileResponseSchema, type Profile } from "@/lib/schemas";

export type Workspace = { user: User; profile: Profile; admin: boolean };

let demoEntry: Promise<unknown> | null = null;
function enterSample() {
  const auth = browserAuth();
  if (auth.currentUser) return Promise.resolve();
  return (demoEntry ??= createUserWithEmailAndPassword(
    auth,
    `${crypto.randomUUID()}@sample.invalid`,
    `Demo!${crypto.randomUUID()}`,
  ).finally(() => {
    demoEntry = null;
  }));
}

export function WorkspaceGate({
  children,
  sampleOnEntry = false,
}: {
  sampleOnEntry?: boolean;
  children: (context: Workspace) => React.ReactNode;
}) {
  const { user, loading, error: sessionError } = useAuth();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const router = useRouter();
  useEffect(() => {
    if (loading || sessionError) return;
    if (!user) {
      if (sampleOnEntry && demoEnabled) {
        let active = true;
        void Promise.resolve()
          .then(enterSample)
          .catch((error) => {
            if (active) setError(friendlyError(error));
          });
        return () => {
          active = false;
        };
      }
      router.replace("/login");
      return;
    }
    const controller = new AbortController();
    api(user, "/api/profile", profileResponseSchema, {
      signal: controller.signal,
    })
      .then(async (state) =>
        !state.profile && demoEnabled && user.email?.endsWith("@sample.invalid")
          ? api(user, "/api/demo", profileResponseSchema, {
              method: "POST",
              signal: controller.signal,
            })
          : state,
      )
      .then(({ profile, admin }) => {
        if (controller.signal.aborted) return;
        if (!profile) router.replace("/onboarding");
        else setWorkspace({ user, profile, admin });
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(friendlyError(err));
      });
    return () => controller.abort();
  }, [user, loading, sessionError, router, revision, sampleOnEntry]);
  if (sessionError || error)
    return (
      <main id="main-content" className="mx-auto max-w-2xl p-8">
        <Notice
          retry={() => {
            if (sessionError) window.location.reload();
            else {
              setError(null);
              setRevision((n) => n + 1);
            }
          }}
        >
          {sessionError ?? error}
        </Notice>
      </main>
    );
  if (!workspace || workspace.user.uid !== user?.uid)
    return (
      <main
        id="main-content"
        className="grid min-h-screen place-items-center p-8"
      >
        <Loading />
      </main>
    );
  return children(workspace);
}
