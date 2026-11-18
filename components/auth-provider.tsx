"use client";

import { onAuthStateChanged, type User } from "firebase/auth";
import { createContext, useContext, useEffect, useState } from "react";
import { browserAuth } from "@/lib/firebase-client";

type Session = { user: User | null; loading: boolean; error: string | null };
const AuthContext = createContext<Session>({
  user: null,
  loading: true,
  error: null,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session>({
    user: null,
    loading: true,
    error: null,
  });
  useEffect(() => {
    try {
      return onAuthStateChanged(
        browserAuth(),
        (user) => setSession({ user, loading: false, error: null }),
        () =>
          setSession({
            user: null,
            loading: false,
            error: "Could not restore your session. Reload to retry.",
          }),
      );
    } catch {
      queueMicrotask(() =>
        setSession({
          user: null,
          loading: false,
          error: "Firebase is not configured for this workspace.",
        }),
      );
    }
  }, []);
  return (
    <AuthContext.Provider value={session}>{children}</AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
