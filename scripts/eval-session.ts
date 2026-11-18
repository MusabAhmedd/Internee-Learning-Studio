import { randomUUID } from "node:crypto";
import { z } from "zod";
import { adminAuth, isDemo } from "../lib/firebase-admin";

export const origin = process.env.APP_BASE_URL ?? "http://127.0.0.1:3000";
export async function evalSession(role?: "admin") {
  if (!isDemo()) {
    if (!process.env.EVAL_ID_TOKEN)
      throw new Error("Set EVAL_ID_TOKEN for a real Firebase project.");
    return {
      uid: undefined,
      token: process.env.EVAL_ID_TOKEN,
      dispose: async () => {},
    };
  }
  const uid = `eval-${randomUUID()}`;
  if (role === "admin") {
    await adminAuth().createUser({ uid });
    await adminAuth().setCustomUserClaims(uid, { admin: true });
  }
  const custom = await adminAuth().createCustomToken(
    uid,
    role === "admin" ? { admin: true } : undefined,
  );
  const key = process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "";
  const response = await fetch(
    new URL(
      `/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(key)}`,
      origin,
    ),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: custom, returnSecureToken: true }),
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok)
    throw new Error(`Emulator custom sign-in failed: ${response.status}`);
  const { idToken } = z
    .object({ idToken: z.string() })
    .parse(await response.json());
  return { uid, token: idToken, dispose: () => adminAuth().deleteUser(uid) };
}
