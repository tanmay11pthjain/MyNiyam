// Streak with kshama days, and the diya's brightness.
import { describe, expect, it } from "vitest";
import { diyaLevel, nextDiya, walkStreak } from "@/lib/progress";

const run = (from: string, n: number) => Array.from({ length: n }, (_, i) => new Date(Date.parse(`${from}T00:00:00Z`) + i * 864e5).toISOString().slice(0, 10));

describe("streak and kshama days", () => {
  it("counts days in a row; today being empty doesn't break it", () => {
    expect(walkStreak([], "2026-10-22")).toEqual({ streak: 0, best: 0, kshama: 0, usedOn: [], repairedOn: [] });
    expect(walkStreak(run("2026-10-19", 3), "2026-10-22").streak).toBe(3);
    expect(walkStreak(run("2026-10-18", 3), "2026-10-22").streak).toBe(0); // yesterday missed, nothing saved
  });

  it("7 in a row earns a kshama day, and a missed day uses it", () => {
    const days = run("2026-10-01", 7); // 1..7 Oct
    const w = walkStreak([...days, ...run("2026-10-09", 3)], "2026-10-11"); // 8 Oct missed
    expect(w.usedOn).toEqual(["2026-10-08"]);
    expect(w.streak).toBe(10);
    expect(w.kshama).toBe(0);
  });

  it("holds at most 2, and breaks once they run out", () => {
    const w = walkStreak(run("2026-09-01", 28), "2026-09-28");
    expect(w.kshama).toBe(2);
    const broken = walkStreak(run("2026-09-01", 28), "2026-10-02"); // 29, 30 Sep saved; 1 Oct breaks
    expect(broken.usedOn).toEqual(["2026-09-29", "2026-09-30"]);
    expect(broken.streak).toBe(0);
    expect(broken.best).toBe(28);
  });

  it("the diya grows brighter at 7, 21, 48 and 108 days", () => {
    expect([0, 6, 7, 21, 47, 48, 108, 500].map(diyaLevel)).toEqual([0, 0, 1, 2, 2, 3, 4, 4]);
    expect(nextDiya(10)).toBe(21);
    expect(nextDiya(108)).toBeNull();
  });
});

describe("one niyam's runs", () => {
  it("skips days the niyam isn't scheduled", async () => {
    const { niyamRuns } = await import("@/lib/progress");
    // Sundays only: 4, 11, 18 Oct 2026 are Sundays.
    const sunday = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay() === 0;
    expect(niyamRuns(["2026-10-04", "2026-10-11", "2026-10-18"], "2026-10-22", sunday)).toEqual({ streak: 3, best: 3 });
    expect(niyamRuns(["2026-10-04", "2026-10-11", "2026-10-18"], "2026-10-22")).toEqual({ streak: 0, best: 1 });
    expect(niyamRuns(["2026-10-20", "2026-10-21"], "2026-10-22")).toEqual({ streak: 2, best: 2 });
  });
});
