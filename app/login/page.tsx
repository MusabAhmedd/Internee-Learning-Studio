"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import { AuthLayout } from "@/components/auth-layout";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { Loading, Notice } from "@/components/ui/state";
import { browserAuth, demoEnabled } from "@/lib/firebase-client";

function authMessage(error: unknown) {
  const code =
    error && typeof error === "object" && "code" in error ? error.code : "";
  if (code === "auth/email-already-in-use")
    return "This email is registered. Try signing in.";
  if (
    code === "auth/invalid-credential" ||
    code === "auth/wrong-password" ||
    code === "auth/user-not-found"
  )
    return "That email and password combination did not match.";
  if (code === "auth/too-many-requests")
    return "Too many attempts. Wait a few minutes and retry.";
  if (code === "auth/popup-closed-by-user" || code === "auth/popup-blocked")
    return "The Google sign-in window closed or was blocked. Allow popups and retry, or use email.";
  if (code === "auth/weak-password") return "Choose a longer password.";
  return "Sign-in is currently unavailable. Check your connection and try again.";
}

export default function Login() {
  const [register, setRegister] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const { user, loading, error: sessionError } = useAuth();
  const router = useRouter();

  async function checkProfileAndRedirect() {
    const current = browserAuth().currentUser;
    if (!current) {
      setError("Could not restore your session. Sign in again.");
      return;
    }
    const idToken = await current.getIdToken();
    const res = await fetch("/api/profile", {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (!res.ok) {
      await signOut(browserAuth());
      setError("Sign-in failed. Please try again.");
      return;
    }
    const data = await res.json();
    if (!data.profile) {
      await signOut(browserAuth());
      setError("No account profile found. Please create an account first.");
      return;
    }
    router.replace("/dashboard");
  }

  async function emailSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const email = String(fields.get("email")).trim();
    const secret = String(fields.get("password"));
    setBusy("email");
    setError(null);
    try {
      if (register) {
        await createUserWithEmailAndPassword(browserAuth(), email, secret);
        // Do not auto-open the dashboard: ask the user to sign in instead.
        await signOut(browserAuth());
        setSuccess("Account created. Please sign in below.");
        return;
      }
      await signInWithEmailAndPassword(browserAuth(), email, secret);
      await checkProfileAndRedirect();
    } catch (err) {
      setError(authMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function google() {
    setBusy("google");
    setError(null);
    try {
      await signInWithPopup(browserAuth(), new GoogleAuthProvider());
      await checkProfileAndRedirect();
    } catch (err) {
      setError(authMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <AuthLayout>
      {demoEnabled && <span className="sample-pill">SAMPLE ENVIRONMENT</span>}
      <h1>{register ? "Create your account" : "Sign in"}</h1>
      <p className="description">
        {register
          ? "Set up your Learning Studio profile."
          : "Continue to your personalized learning workspace."}
      </p>
      {success && (
        <Notice>{success}</Notice>
      )}
      {(error || sessionError) && <Notice>{error ?? sessionError}</Notice>}
      {loading || user ? (
        <Loading label="Checking session…" />
      ) : (
        <>
          <form className="field-stack" onSubmit={emailSubmit}>
            <label>
              Email address
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                maxLength={254}
                placeholder={
                  demoEnabled ? "learner@example.test" : "you@example.com"
                }
              />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                autoComplete={register ? "new-password" : "current-password"}
                required
                minLength={register ? 8 : 1}
                maxLength={128}
              />
            </label>
            <Button
              type="submit"
              size="lg"
              disabled={Boolean(busy) || Boolean(sessionError)}
            >
              {busy === "email"
                ? "Please wait…"
                : register
                  ? "Create account"
                  : "Sign in"}
              <ArrowRight aria-hidden="true" />
            </Button>
          </form>
          <div className="entry-divider">
            <span />
            or
            <span />
          </div>
          <Button
            variant="outline"
            size="lg"
            className="w-full"
            disabled={Boolean(busy) || Boolean(sessionError)}
            onClick={google}
          >
            <span aria-hidden="true" className="google-mark">
              G
            </span>
            {busy === "google" ? "Opening Google…" : "Continue with Google"}
          </Button>
          <p className="entry-switch">
            {register ? "Already have an account?" : "New to Learning Studio?"}{" "}
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => {
                setRegister(!register);
                setError(null);
                setSuccess(null);
              }}
            >
              {register ? "Sign in" : "Create account"}
            </button>
          </p>
          {demoEnabled && (
            <>
              <Button variant="outline" asChild className="w-full">
                <Link href="/dashboard?sample=1">
                  Open sample workspace <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
              <p className="smallprint">
                Use a made-up email and password. Google sign-in is simulated by
                Firebase in this environment.
              </p>
            </>
          )}
        </>
      )}
    </AuthLayout>
  );
}
