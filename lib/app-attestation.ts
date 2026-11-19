import { z } from "zod";
import { adminAppCheck, isDemo } from "./firebase-admin";
import { HttpError } from "./http-error";

const modeSchema = z.enum(["observe", "required"]);
type Mode = z.infer<typeof modeSchema>;
type Verify = (token: string) => Promise<{ appId: string }>;
export async function checkAppAttestation(
  token: string | null,
  appId: string,
  mode: Mode,
  verify: Verify,
) {
  let outcome: "missing" | "invalid" | "wrong_app" | "verified" = "missing";
  if (token) {
    outcome = "invalid";
    if (
      token.length <= 8192 &&
      /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)
    ) {
      try {
        outcome =
          (await verify(token)).appId === appId ? "verified" : "wrong_app";
      } catch {
        /* Invalid/expired/unverifiable is denied in enforcing mode. */
      }
    }
  }
  if (mode === "observe" || outcome !== "verified")
    console.info(JSON.stringify({ event: "app_check", mode, outcome }));
  if (mode === "required" && outcome !== "verified")
    throw new HttpError(
      403,
      "APP_CHECK_REQUIRED",
      "This browser could not verify the app. Refresh the page and try again.",
    );
  return outcome;
}

export async function attestRequest(request: Request) {
  if (isDemo()) return;
  const parsed = modeSchema.safeParse(process.env.APP_CHECK_MODE ?? "required");
  const appId = process.env.NEXT_PUBLIC_FIREBASE_APP_ID;
  if (
    !parsed.success ||
    !appId ||
    (parsed.data === "required" &&
      !process.env.NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY)
  )
    throw new HttpError(
      503,
      "APP_CHECK_CONFIG",
      "App verification is not configured. Please contact the site administrator.",
    );
  await checkAppAttestation(
    request.headers.get("X-Firebase-AppCheck"),
    appId,
    parsed.data,
    (token) => adminAppCheck().verifyToken(token),
  );
}
