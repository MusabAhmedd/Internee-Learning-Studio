import { HttpError } from "./http";
import { planSchema, type Plan } from "./schemas";

export type PlanCandidate = {
  id: string;
  title: string;
  estMinutes: number;
  prerequisites: string[];
  completed: boolean;
  score: number | null;
};
export function weekDates(start: Date) {
  const base = Date.UTC(
    start.getUTCFullYear(),
    start.getUTCMonth(),
    start.getUTCDate(),
  );
  return Array.from({ length: 7 }, (_, index) =>
    new Date(base + 86_400_000 * index).toISOString().slice(0, 10),
  );
}
export function validatePlan(
  value: unknown,
  candidates: PlanCandidate[],
  dates: string[],
  budget: number,
) {
  const parsed = planSchema.safeParse(value);
  if (!parsed.success)
    throw new HttpError(
      422,
      "PLAN_SHAPE",
      "A plan must contain seven valid day entries.",
    );
  const map = new Map(candidates.map((item) => [item.id, item]));
  const completed = new Set(
    candidates.filter((item) => item.completed).map((item) => item.id),
  );
  const scheduled = new Set<string>();
  let spent = 0;
  for (const [i, day] of parsed.data.days.entries()) {
    if (day.date !== dates[i])
      throw new HttpError(
        422,
        "PLAN_DATE",
        "Plan dates must be consecutive starting today.",
      );
    let minutes = 0;
    for (const id of day.lessonIds) {
      const known = map.get(id);
      if (!known)
        throw new HttpError(
          422,
          "PLAN_UNKNOWN_LESSON",
          "The plan referenced a lesson that is not in the current catalog.",
        );
      if (scheduled.has(id))
        throw new HttpError(
          422,
          "PLAN_DUPLICATE",
          "Each lesson can appear once per plan.",
        );
      if (
        known.prerequisites.some(
          (required) => !completed.has(required) && !scheduled.has(required),
        )
      )
        throw new HttpError(
          422,
          "PLAN_ORDER",
          "Earlier lessons in a module must be scheduled first.",
        );
      scheduled.add(id);
      minutes += known.estMinutes;
    }
    if (minutes !== day.minutes)
      throw new HttpError(
        422,
        "PLAN_MINUTES",
        "Minutes must match the catalog lesson estimates.",
      );
    spent += minutes;
  }
  if (spent > budget)
    throw new HttpError(
      422,
      "PLAN_BUDGET",
      "The plan exceeds the learner’s available study hours.",
    );
  if (
    !scheduled.size &&
    candidates.some(
      (item) =>
        !item.completed &&
        item.estMinutes <= budget &&
        item.prerequisites.every((id) => completed.has(id)),
    )
  )
    throw new HttpError(
      422,
      "PLAN_EMPTY",
      "Include an available lesson that fits the study budget.",
    );
  return parsed.data;
}
export function samplePlan(
  candidates: PlanCandidate[],
  dates: string[],
  budget: number,
): Plan {
  const completed = new Set(
    candidates.filter((item) => item.completed).map((item) => item.id),
  );
  const queue = [...candidates].filter(
    (item) => !item.completed || (item.score !== null && item.score < 0.6),
  );
  const chosen: PlanCandidate[] = [];
  let remaining = budget;
  while (queue.length) {
    const index = queue.findIndex(
      (item) =>
        item.estMinutes <= remaining &&
        item.prerequisites.every(
          (id) =>
            completed.has(id) || chosen.some((selected) => selected.id === id),
        ),
    );
    if (index < 0) break;
    const [item] = queue.splice(index, 1);
    chosen.push(item);
    remaining -= item.estMinutes;
  }
  const days = dates.map((date) => ({
    date,
    lessonIds: [] as string[],
    goal: "Reflect or take a rest day",
    minutes: 0,
    reason: "No new lesson is scheduled. If useful, revisit your saved notes.",
  }));
  for (const [index, item] of chosen.entries()) {
    const day = days[Math.floor((index * 7) / chosen.length)];
    day.lessonIds.push(item.id);
    day.minutes += item.estMinutes;
    day.goal =
      day.lessonIds.length === 1
        ? `${item.completed ? "Review" : "Study"} ${item.title}`.slice(0, 140)
        : `Study ${day.lessonIds.length} related lessons`;
    day.reason =
      item.score !== null && item.score < 0.6
        ? "Recent practice shows this lesson is worth revisiting."
        : "This lesson fits your time budget and current course sequence.";
  }
  return validatePlan({ days }, candidates, dates, budget);
}
