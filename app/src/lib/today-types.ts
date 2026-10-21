// The student app's API contract: Today, logging and History.
import type { NiyamOption, NiyamType } from "./admin-types";

/** One niyam on one day for one person, with what they logged (if anything). */
export type DayNiyam = {
  id: string; name: string; nameHi: string | null; type: NiyamType; target: number | null; options: NiyamOption[];
  icon: string | null; note: string | null; isCore: boolean;
  /** Count, or minutes. 0 when nothing logged. */
  value: number;
  choice: string | null;
  done: boolean;
};

export type DayView = {
  date: string;          // YYYY-MM-DD, an Indian day
  /** The pathshala still accepts logs for this day. */
  editable: boolean;
  niyams: DayNiyam[];
};

/** GET /api/today */
export type TodayResponse = {
  today: DayView;
  /** Only while the catch-up window is open. */
  yesterday: DayView | null;
  streak: number;
  /** Days in a row, ending today or yesterday, with at least one niyam done. */
  streakAlive: boolean;
};

/** POST /api/log. yesno: done (default true). count/duration: value (0 clears). choice: choice (null clears). */
export type LogInput = { niyamId: string; date: string; done?: boolean; value?: number; choice?: string | null };

export type HistoryDay = { date: string; coreDone: number; coreTotal: number; anyDone: number };

/** GET /api/history?month=YYYY-MM */
export type HistoryResponse = { month: string; today: string; days: HistoryDay[]; firstMonth: string };

/** GET /api/history/day?date=YYYY-MM-DD */
export type HistoryDayResponse = { day: DayView; isYesterday: boolean };
