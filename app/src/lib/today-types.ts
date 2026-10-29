// The student app's API contract: Today, logging and History.
import type { NiyamOption, NiyamType } from "./admin-types";

/** One niyam on one day for one person, with what they logged (if anything). */
export type DayNiyam = {
  id: string; name: string; nameHi: string | null; type: NiyamType; target: number | null; options: NiyamOption[];
  icon: string | null; note: string | null; isCore: boolean;
  /** Count (no upper limit), or minutes. 0 when nothing logged. Any value above 0 is done. */
  value: number;
  choice: string | null;
  done: boolean;
  /** A time to keep it by, from the sangh's sunrise or sunset: "By 7:14 am", "Before 6:02 pm". */
  time: string | null;
};

export type DayView = {
  date: string;          // YYYY-MM-DD, an Indian day
  /** The pathshala still accepts logs for this day. */
  editable: boolean;
  niyams: DayNiyam[];
};

/** A slide on the Today screen. `seen`: this person saw it on an earlier day, so it shows as one line. */
export type AnnouncementCard = {
  id: string; title: string; body: string | null; imageUrl: string | null; buttonLabel: string | null; buttonUrl: string | null;
  pinned: boolean; seen: boolean;
};

/** GET /api/today. Yesterday is changed from History. */
export type TodayResponse = {
  today: DayView;
  streak: number;
  /** Days in a row, ending today or yesterday, with at least one niyam done. */
  streakAlive: boolean;
  progress: Progress;
  vows: Vow[];
  /** Badges earned just now, to celebrate once. */
  newBadges: EarnedBadge[];
};

/** GET /api/progress (also inside /api/today). kshamaUsedOn: days in the last 30 a kshama day saved the streak. */
export type Progress = {
  streak: number; best: number; kshama: number; kshamaUsedOn: string[];
  tej: number; tejToday: number; diya: number; nextDiya: number | null;
  /** A missed day that can still be made up for (streak repair), and the streak it would bring back. */
  repair: { missed: string; streak: number } | null;
};

/** POST /api/log. yesno: done (default true). count/duration: value (0 clears). choice: choice (null clears). */
export type LogInput = { niyamId: string; date: string; done?: boolean; value?: number; choice?: string | null };

export type AttendanceStatus = "present" | "late" | "absent";
export type HistoryDay = { date: string; coreDone: number; coreTotal: number; anyDone: number; attendance: AttendanceStatus | null };

/** GET /api/history?month=YYYY-MM */
/** attendance: this month's pathshala attendance, null when none was taken. */
export type HistoryResponse = { month: string; today: string; days: HistoryDay[]; firstMonth: string; attendance: { present: number; late: number; absent: number } | null };

/** GET /api/history/day?date=YYYY-MM-DD */
export type HistoryDayResponse = { day: DayView; isYesterday: boolean };

/** GET /api/history/niyams: per niyam, days in a row now (ending today or yesterday), best ever and the lifetime total. */
export type NiyamStat = { id: string; name: string; streak: number; best: number; total: number; unit: string };

/** A personal vow (pachchakkhan) on Today. doneToday: ticked for today. */
export type Vow = { id: string; name: string; startDate: string; endDate: string; doneToday: boolean; daysKept: number };

/** A badge this person has earned. */
export type EarnedBadge = { id: string; en: string; hi: string; mark: string; kind: string; earnedAt: string };

/** GET /api/badges: badges earned, and this person's sharing choices. */
export type BadgesResponse = { badges: EarnedBadge[]; prefs: { shareMilestones: boolean; boardInitials: boolean } };

/** A pathshala goal on the Sangh tab. mine: this person's days for a challenge (null for a total). */
export type GoalCard = {
  id: string; kind: "total" | "challenge"; title: string; titleHi: string | null; niyam: string;
  target: number | null; days: number | null; startDate: string; endDate: string; state: "live" | "upcoming" | "ended";
  total: number; finishers: number; mine: number | null; unit: string;
};

/** A milestone post in the feed. myMsg: the Anumodana this person sent (index into the presets), if any. */
export type FeedPost = { id: number; badge: string; en: string; hi: string; mark: string; name: string; mine: boolean; at: string; count: number; myMsg: number | null };

export type BoardRow = { rank: number; name: string; days: number; me: boolean };

/** GET /api/sangh: the Sangh tab. board: null when the class has no leaderboard. */
export type SanghTabResponse = {
  goals: GoalCard[];
  board: { className: string; rows: BoardRow[]; me: BoardRow | null } | null;
  feed: FeedPost[];
  announcements: AnnouncementCard[];
};
