import type { DecodedIdToken } from "firebase-admin/auth";
import { adminAuth, db, isDemo } from "./firebase-admin";
import { HttpError } from "./http";
import {
  activitySchema,
  adminViewSchema,
  attemptSchema,
  masterySchema,
  profileSchema,
  uidSchema,
} from "./schemas";
export function publicDemo() {
  return isDemo() && process.env.DEMO_PUBLIC_PREVIEW === "1";
}
export async function requireAdmin(claims: DecodedIdToken) {
  if (publicDemo() || claims.admin !== true)
    throw new HttpError(
      403,
      "ADMIN_REQUIRED",
      "This action requires an administrator account.",
    );
  const current = await adminAuth().getUser(claims.uid);
  if (
    current.disabled ||
    current.customClaims?.admin !== true ||
    claims.auth_time * 1000 < Date.parse(current.tokensValidAfterTime ?? "")
  )
    throw new HttpError(
      403,
      "ADMIN_REQUIRED",
      "The admin session is no longer active. Sign in again.",
    );
}
const COHORT_CAP = 400;
export async function readCohort() {
  const database = db();
  const [users, last, attempts, skills] = await Promise.all([
    database
      .collection("users")
      .limit(COHORT_CAP + 1)
      .get(),
    database
      .collection("activity")
      .limit(COHORT_CAP + 1)
      .get(),
    database.collection("attempts").orderBy("at", "desc").limit(500).get(),
    database.collection("mastery").limit(2000).get(),
  ]);
  if (users.size > COHORT_CAP || last.size > COHORT_CAP || skills.size >= 2000)
    throw new HttpError(
      409,
      "COHORT_SIZE",
      "This cohort exceeds the live dashboard cap. Export metrics for larger groups.",
    );
  const known = new Map(
    users.docs.map((row) => [
      uidSchema.parse(row.id),
      profileSchema.parse(row.data()),
    ]),
  );
  const activity = new Map(
    last.docs
      .map((row) => activitySchema.parse(row.data()))
      .map((row) => [row.uid, row.lastAt]),
  );
  const scores = skills.docs
    .map((row) => masterySchema.parse(row.data()))
    .filter((row) => known.has(row.uid));
  const perLearner = new Map<string, { score: number; topics: number }>();
  for (const row of scores) {
    const old = perLearner.get(row.uid) ?? { score: 0, topics: 0 };
    perLearner.set(row.uid, {
      score: old.score + row.score,
      topics: old.topics + 1,
    });
  }
  const mean = perLearner.size
    ? [...perLearner.values()].reduce(
        (total, row) => total + row.score / row.topics,
        0,
      ) / perLearner.size
    : null;
  const recent = attempts.docs
    .map((row) => attemptSchema.parse(row.data()))
    .filter((row) => known.has(row.uid));
  const missed = new Map<
    string,
    { topic: string; total: number; misses: number }
  >();
  for (const item of recent) {
    const row = missed.get(item.topic) ?? {
      topic: item.topic,
      total: 0,
      misses: 0,
    };
    row.total++;
    if (!item.correct) row.misses++;
    missed.set(item.topic, row);
  }
  const threshold = Date.now() - 7 * 86_400_000;
  const inactive = [...known]
    .map(([uid, profile]) => ({
      displayName: profile.displayName,
      track: profile.track,
      lastAt: activity.get(uid) ?? profile.createdAt,
    }))
    .filter((row) => Date.parse(row.lastAt) < threshold)
    .sort((a, b) => a.lastAt.localeCompare(b.lastAt));
  return adminViewSchema.parse({
    learners: known.size,
    meanMastery: mean,
    inactive: inactive.length,
    sampledAttempts: recent.length,
    missed: [...missed.values()]
      .filter((row) => row.misses > 0)
      .sort(
        (a, b) =>
          b.misses - a.misses || b.misses / b.total - a.misses / a.total,
      )
      .slice(0, 10),
    inactiveLearners: inactive.slice(0, 12),
  });
}
