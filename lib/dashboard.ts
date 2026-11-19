import { listCatalog } from "./catalog";
import { db, isDemo } from "./firebase-admin";
import { studyStreak } from "./learning-dates";
import { HttpError } from "./http";
import { isWeak } from "./mastery";
import { recentAttempts, topicMastery } from "./practice-store";
import { progressFor } from "./progress-store";
import { dashboardSchema, profileSchema } from "./schemas";

export async function dashboardFor(uid: string, now = new Date()) {
  const [profileDoc, catalog, marks, attempts, skills] = await Promise.all([
    db().doc(`users/${uid}`).get(),
    listCatalog(),
    progressFor(uid),
    recentAttempts(uid),
    topicMastery(uid),
  ]);
  if (!profileDoc.exists)
    throw new HttpError(
      409,
      "PROFILE_REQUIRED",
      "Create a profile to see your learning data.",
    );
  const profile = profileSchema.parse(profileDoc.data());
  const modules = catalog.modules.filter(
    (item) => item.track === profile.track,
  );
  const lessons = modules.flatMap((item) =>
    item.lessons.map((lesson) => ({
      ...lesson,
      moduleTitle: item.title,
      moduleOrder: item.order,
    })),
  );
  const ids = new Set(lessons.map((lesson) => lesson.id));
  const trackMarks = marks.filter((mark) => ids.has(mark.lessonId));
  const done = trackMarks.filter((mark) => mark.completedAt !== null);
  const completed = new Set(done.map((mark) => mark.lessonId));
  const relevant = attempts.filter((attempt) => ids.has(attempt.lessonId));
  const streak = studyStreak(
    [
      ...relevant.map((row) => row.at),
      ...done.flatMap((row) => (row.completedAt ? [row.completedAt] : [])),
    ],
    now,
    profile.timeZone,
  );
  const topics = [...new Set(lessons.flatMap((item) => item.topics))];
  const mastery = new Map(skills.map((row) => [row.topic, row]));
  const certificateAvailable =
    lessons.length > 0 && completed.size === lessons.length;
  const board = dashboardSchema.parse({
    sample: isDemo() || modules.some((item) => item.source === "SAMPLE"),
    completed: completed.size,
    total: lessons.length,
    studySeconds: trackMarks.reduce(
      (total, item) => total + item.studySeconds,
      0,
    ),
    streak,
    correct: relevant.filter((attempt) => attempt.correct).length,
    attempts: relevant.length,
    next: lessons.find((lesson) => !completed.has(lesson.id)) ?? null,
    topics: topics.flatMap((topic) => {
      const stats = mastery.get(topic);
      const lesson = lessons.find((lesson) => lesson.topics.includes(topic));
      return lesson
        ? [
            {
              topic,
              lessonId: lesson.id,
              score: stats?.score ?? null,
              attemptCount: stats?.attemptCount ?? 0,
              weak: isWeak(stats?.score ?? 0, stats?.attemptCount ?? 0),
            },
          ]
        : [];
    }),
    badges: [
      ...(done.length ? ["first-lesson"] : []),
      ...(streak >= 3 ? ["three-day-streak"] : []),
      ...(relevant.length >= 10 ? ["practice-pro"] : []),
      ...(certificateAvailable ? ["track-complete"] : []),
    ],
    certificateAvailable,
  });
  return { board, profile, done, attempts: relevant };
}
