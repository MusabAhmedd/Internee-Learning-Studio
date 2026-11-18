import { z } from "zod";
import { db, isDemo } from "./firebase-admin";
import { HttpError } from "./http";
import { uidSchema } from "./schemas";

const counterSchema = z.strictObject({
  day: z.iso.date(),
  minute: z.number().int().nonnegative(),
  dayCount: z.number().int().nonnegative(),
  minuteCount: z.number().int().nonnegative(),
});
function dailyLimit() {
  return z.coerce
    .number()
    .int()
    .min(1)
    .max(300)
    .catch(40)
    .parse(process.env.AI_DAILY_LIMIT ?? 40);
}
export async function takeAiQuota(uid: string) {
  const database = db();
  const ref = database.doc(`aiLimits/${uidSchema.parse(uid)}`);
  const now = new Date();
  const minute = Math.floor(now.getTime() / 60_000);
  const day = now.toISOString().slice(0, 10);
  await database.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const old = snap.exists ? counterSchema.parse(snap.data()) : null;
    const dayCount = old?.day === day ? old.dayCount : 0;
    const minuteCount = old?.minute === minute ? old.minuteCount : 0;
    if (dayCount >= dailyLimit())
      throw new HttpError(
        429,
        "DAILY_LIMIT",
        "Your AI allowance resets at midnight UTC. Lesson content is still available.",
      );
    if (minuteCount >= (isDemo() ? 24 : 12))
      throw new HttpError(
        429,
        "BURST_LIMIT",
        "Too many AI requests. Wait a minute before trying again.",
      );
    tx.set(
      ref,
      counterSchema.parse({
        day,
        minute,
        minuteCount: minuteCount + 1,
        dayCount: dayCount + 1,
      }),
    );
  });
}
