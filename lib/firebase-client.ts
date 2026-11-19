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

let check: import("firebase/app-check").AppCheck | undefined;
let attestation: Promise<string | null> | undefined;
export async function browserAppToken() {
  const key = process.env.NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY;
  if (demoEnabled || !key) return null;
  // Firebase caches App Check tokens; this also coalesces concurrent requests in a tab.
  attestation ??= (async () => {
    const { getToken, initializeAppCheck, ReCaptchaEnterpriseProvider } =
      await import("firebase/app-check");
    const app = browserAuth().app;
    check ??= initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(key),
      isTokenAutoRefreshEnabled: true,
    });
    return (await getToken(check)).token;
  })().finally(() => {
    attestation = undefined;
  });
  return attestation;
}
