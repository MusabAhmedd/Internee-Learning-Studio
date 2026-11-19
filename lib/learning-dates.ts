import { z } from "zod";

const calendarFormatters = new Map<string, Intl.DateTimeFormat>();
function dateFormatter(timeZone: string) {
  let format = calendarFormatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-CA", {
      calendar: "gregory",
      numberingSystem: "latn",
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    // Only cache a bounded number of user-selectable IANA names/aliases per instance.
    if (calendarFormatters.size < 128) calendarFormatters.set(timeZone, format);
  }
  return format;
}
export const timeZoneSchema = z
  .string()
  .trim()
  .max(64)
  .regex(/^(?:UTC|[A-Za-z_]+(?:\/[A-Za-z0-9_.+-]+)+)$/)
  .refine((value) => {
    try {
      dateFormatter(value);
      return true;
    } catch {
      return false;
    }
  }, "Choose a valid IANA time zone, for example Asia/Karachi.");

export function localDate(instant: Date | string, timeZone: string) {
  const parts = dateFormatter(timeZone).formatToParts(new Date(instant));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((row) => row.type === type)?.value;
  return `${part("year")?.padStart(4, "0")}-${part("month")}-${part("day")}`;
}

export function shiftDate(date: string, days: number) {
  // UTC here is a neutral representation of a calendar label, not a learner instant.
  const calendar = new Date(`${date}T00:00:00Z`);
  calendar.setUTCDate(calendar.getUTCDate() + days);
  return calendar.toISOString().slice(0, 10);
}
export function learningWeek(now: Date, timeZone: string) {
  const through = localDate(now, timeZone);
  return { timeZone, start: shiftDate(through, -6), through };
}
export function duringWeek(
  instant: string,
  week: ReturnType<typeof learningWeek>,
) {
  const date = localDate(instant, week.timeZone);
  return date >= week.start && date <= week.through;
}

export function studyStreak(timestamps: string[], now: Date, timeZone: string) {
  const today = localDate(now, timeZone);
  const active = new Set(timestamps.map((value) => localDate(value, timeZone)));
  const offset = active.has(today) ? 0 : 1;
  let streak = 0;
  while (active.has(shiftDate(today, -(offset + streak)))) streak++;
  return streak;
}
