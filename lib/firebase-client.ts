import { getApp, getApps, initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";

export const demoEnabled = process.env.NEXT_PUBLIC_DEMO_MODE === "1";

export function browserAuth() {
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;
  const appId = process.env.NEXT_PUBLIC_FIREBASE_APP_ID;
  if (
    !projectId ||
    !apiKey ||
    !authDomain ||
    !appId ||
    demoEnabled !== projectId.startsWith("demo-")
  ) {
    throw new Error("Firebase browser configuration is missing or invalid.");
  }
  const auth = getAuth(
    getApps().length
      ? getApp()
      : initializeApp({ projectId, apiKey, authDomain, appId }),
  );
  if (demoEnabled && !auth.emulatorConfig)
    connectAuthEmulator(auth, window.location.origin, {
      disableWarnings: true,
    });
  return auth;
}
