import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../lib/firebase-admin";
import { planContext, createPlan } from "../lib/plan";
import { profileSchema } from "../lib/schemas";
async function run() {
  const uid = `plan-gate-${randomUUID()}`;
  const user = db().doc(`users/${uid}`);
  await user.create(
    profileSchema.parse({
      displayName: "Plan Gate",
      track: "Generative AI",
      level: "Beginner",
      weeklyHours: 1,
      goal: "Keep my first study week under one hour.",
      createdAt: new Date().toISOString(),
    }),
  );
  try {
    const context = await planContext(uid);
    const made = await createPlan(uid, context);
    const after = await planContext(uid);
    assert.deepEqual(after.status.plan?.days, made.days);
    assert.equal(made.days.length, 7);
    assert.ok(made.days.reduce((n, day) => n + day.minutes, 0) <= 60);
    console.log(
      "Firestore integration: seven days saved and reloaded within a 60-minute budget.",
    );
  } finally {
    await Promise.all([user.delete(), db().doc(`plans/${uid}`).delete()]);
  }
}
run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
