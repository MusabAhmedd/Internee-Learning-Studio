import { isDemo } from "@/lib/firebase-admin";
import { authenticated, HttpError, json } from "@/lib/http";
import { setupSample } from "@/lib/sample-learner";
import { profileResponseSchema } from "@/lib/schemas";
export const POST = authenticated(async (_request, claims) => {
  if (!isDemo() || !claims.email?.endsWith("@sample.invalid"))
    throw new HttpError(
      404,
      "DEMO_DISABLED",
      "A sample learner session is required.",
    );
  return json(
    profileResponseSchema.parse({
      profile: await setupSample(claims.uid),
      admin: false,
    }),
  );
});
