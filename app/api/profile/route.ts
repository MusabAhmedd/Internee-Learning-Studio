import { abuseEvent } from "@/lib/abuse-telemetry";
import { publicDemo } from "@/lib/admin";
import { db } from "@/lib/firebase-admin";
import { authenticated, json, readJson } from "@/lib/http";
import {
  profileInputSchema,
  profileResponseSchema,
  profileSchema,
} from "@/lib/schemas";

export const runtime = "nodejs";
export const GET = authenticated(async (_request, claims) => {
  const snap = await db().doc(`users/${claims.uid}`).get();
  return json(
    profileResponseSchema.parse({
      profile: snap.exists ? profileSchema.parse(snap.data()) : null,
      admin: claims.admin === true && !publicDemo(),
    }),
  );
});
export const PUT = authenticated(async (request, claims) => {
  const fields = await readJson(request, profileInputSchema);
  const ref = db().doc(`users/${claims.uid}`);
  const { profile, created } = await db().runTransaction(async (tx) => {
    const stored = await tx.get(ref);
    const prior = stored.exists ? profileSchema.parse(stored.data()) : null;
    const profile = profileSchema.parse({
      ...fields,
      timeZone: fields.timeZone ?? prior?.timeZone,
      createdAt: prior?.createdAt ?? new Date().toISOString(),
    });
    tx.set(ref, profile);
    return { profile, created: !prior };
  });
  if (created) abuseEvent("account_signal", "profile_created");
  return json(
    profileResponseSchema.parse({
      profile,
      admin: claims.admin === true && !publicDemo(),
    }),
  );
});
