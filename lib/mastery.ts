export const INITIAL_MASTERY = 0.5;
export function nextMastery(old: number, correct: boolean, hintsUsed: number) {
  return Math.min(
    1,
    Math.max(
      0,
      0.7 * old + 0.3 * (correct ? 1 : 0) - 0.05 * Math.min(hintsUsed, 3),
    ),
  );
}
export function isWeak(score: number, attempts: number) {
  return score < 0.5 && attempts >= 3;
}
