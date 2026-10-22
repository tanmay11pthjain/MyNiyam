// Streak with kshama days, and the diya's brightness. Pure, so the server and tests share it.
//
// Kshama (forgiveness) days: every 7 days kept in a row earns one, up to 2 saved. A missed day
// uses one up and the streak carries on (it doesn't grow that day). Today never breaks a streak,
// since it is still open.

export const KSHAMA_EVERY = 7;
export const KSHAMA_MAX = 2;
/** The diya grows brighter at these streaks. */
export const DIYA_LEVELS = [7, 21, 48, 108] as const;

const addDay = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

export type StreakWalk = { streak: number; best: number; kshama: number; usedOn: string[] };

/** `days`: dates (YYYY-MM-DD) with at least one niyam kept, any order. */
export function walkStreak(days: Iterable<string>, today: string): StreakWalk {
  const kept = new Set(days);
  const sorted = [...kept].filter((d) => d <= today).sort();
  const out: StreakWalk = { streak: 0, best: 0, kshama: 0, usedOn: [] };
  if (!sorted.length) return out;
  let run = 0, inRow = 0;
  for (let d = sorted[0]; d <= today; d = addDay(d, 1)) {
    if (kept.has(d)) {
      run++; inRow++;
      if (inRow % KSHAMA_EVERY === 0) out.kshama = Math.min(KSHAMA_MAX, out.kshama + 1);
    } else if (d === today) {
      // still open
    } else if (run > 0 && out.kshama > 0) {
      out.kshama--; out.usedOn.push(d);
    } else {
      run = 0; inRow = 0; out.kshama = 0;
    }
    out.best = Math.max(out.best, run);
  }
  out.streak = run;
  return out;
}

/** 0 (plain) to 4 (brightest). */
export const diyaLevel = (streak: number) => DIYA_LEVELS.filter((n) => streak >= n).length;
/** The next streak at which the diya grows brighter, or null at the top. */
export const nextDiya = (streak: number) => DIYA_LEVELS.find((n) => streak < n) ?? null;

/**
 * One niyam's streak (ending today or yesterday) and best run. Days it isn't scheduled (a weekday
 * niyam on its off days) are skipped, so they neither count nor break the run.
 */
export function niyamRuns(days: Iterable<string>, today: string, scheduled: (d: string) => boolean = () => true): { streak: number; best: number } {
  const kept = new Set(days);
  const sorted = [...kept].filter((d) => d <= today).sort();
  let run = 0, best = 0;
  if (!sorted.length) return { streak: 0, best: 0 };
  for (let d = sorted[0]; d <= today; d = addDay(d, 1)) {
    if (kept.has(d)) { run++; best = Math.max(best, run); }
    else if (d !== today && scheduled(d)) run = 0;
  }
  return { streak: run, best };
}
