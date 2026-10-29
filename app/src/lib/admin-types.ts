// The admin API contract, shared by /api/admin/** route handlers and the admin screens.
import type { FormField } from "./forms";

export type SanghStatus = "pending" | "active";
export type AdminSanghRef = { id: string; name: string; city: string; status: SanghStatus };

/** What a volunteer can be allowed to do. Admins can do all of it, and more. */
export const PERMS = ["view_members", "attendance", "announcements", "niyams", "setup", "remove_members"] as const;
export type Perm = (typeof PERMS)[number];
/** A sangh this phone can open, and as what. */
export type AdminSangh = AdminSanghRef & { role: "admin" | "volunteer"; perms: Perm[] };

/** GET /api/admin/session */
export type AdminMe = { phone: string; isSuper: boolean; sanghs: AdminSangh[]; activeSanghId: string | null };

export type SanghProfile = {
  id: string; name: string; nameHi: string | null; city: string; area: string | null; sampraday: string | null;
  contactPhone: string | null; about: string | null; logoUrl: string | null; joinCode: string; status: SanghStatus;
  joinOpen: boolean; searchable: boolean; logBackHours: number;
  /** Where sunrise and sunset (Navkarsi, Chauvihar times) are worked out for. */
  location: { lat: number; lon: number } | null;
};

export type Checklist = { classes: boolean; form: boolean; niyams: boolean; share: boolean };

/** GET /api/admin/dashboard */
export type Dashboard = {
  sangh: { name: string; joinCode: string; status: SanghStatus };
  families: number; profiles: number; loggedToday: number; loggingPct: number; niyamsDoneToday: number; activeNiyams: number;
  checklist: Checklist;
  alerts: DashboardAlerts;
};

/** quiet: people who joined before the last 3 days and logged nothing in them (first 5 names shown). */
export type DashboardAlerts = { quiet: number; quietNames: string[]; attendanceDue: string[] };

export type AdminClass = {
  id: string; name: string; nameHi: string | null; hidden: boolean; ageMin: number | null; ageMax: number | null;
  /** Days the class meets, 0 = Sunday ... 6 = Saturday; empty = not set. */
  meetsOn: number[]; members: number;
  /** Members of this class see a weekly leaderboard of days kept (on by default). */
  leaderboard: boolean;
};

export type NiyamType = "yesno" | "count" | "duration" | "choice";
export type NiyamStatus = "active" | "paused" | "archived";
/** points: this level's own Tej (tapasya levels); missing = the niyam's points. */
export type NiyamOption = { value: string; en: string; hi?: string; points?: number };
export type Niyam = {
  id: string; name: string; nameHi: string | null; type: NiyamType; target: number | null; options: NiyamOption[];
  icon: string | null; note: string | null; allClasses: boolean; classIds: string[];
  schedule: "daily" | "weekdays" | "range" | "dates"; weekdays: number[]; startDate: string | null; endDate: string | null;
  /** Chosen dates (tithis), for schedule "dates". */
  dates: string[];
  isCore: boolean; status: NiyamStatus;
  /** Show a time on the member's card: Navkarsi (sunrise + 48 min) or Chauvihar (sunset). */
  timeHint: "navkarsi" | "chauvihar" | null;
  /** Tej each time it is kept; for count and minutes niyams, each count (up to 10 a day). */
  points: number;
};
export type NiyamInput = Omit<Niyam, "id" | "status">;

/** GET /api/admin/niyams */
export type NiyamsPage = { niyams: Niyam[]; classes: { id: string; name: string }[]; logBackHours: number };

/** GET /api/admin/form */
export type FormPage = { fields: FormField[]; classes: { id: string; name: string; nameHi: string | null; hidden: boolean; ageMin: number | null; ageMax: number | null }[]; sanghName: string };

export type MemberRow = {
  id: string; name: string; relation: "self" | "child"; classId: string | null; className: string | null;
  photoUrl: string | null; lastLogged: string | null; age: number | null; gender: string | null; rollNo: string | null;
};
export type Family = { accountId: string; phone: string /* masked */; joinedAt: string; profiles: MemberRow[] };

/** GET /api/admin/members */
export type MembersPage = { families: Family[]; classes: { id: string; name: string }[]; total: number; truncated: boolean };

export type MemberDetail = {
  id: string; accountId: string; name: string; relation: "self" | "child"; classId: string | null; photoUrl: string | null;
  phone: string; joinedAt: string; age: number | null;
  answers: { key: string; label: string; value: string }[];
  /** Under-18s (by date of birth) and every child profile: was consent given on the OTP-verified number? */
  consent: { applies: boolean; given: boolean; at: string | null };
  streak: number;
  last30: { date: string; logged: boolean }[];
  family: { id: string; name: string }[];
  classes: { id: string; name: string }[];
};

/** GET /api/admin/super/sanghs */
export type SuperSangh = AdminSanghRef & { joinCode: string; admins: string[]; families: number; requestedBy: string | null; createdAt: string };

export type Announcement = {
  id: string; title: string; body: string | null; imageUrl: string | null; buttonLabel: string | null; buttonUrl: string | null;
  allClasses: boolean; classIds: string[]; startDate: string | null; endDate: string | null; pinned: boolean;
  /** live: showing to members now; scheduled: starts later; ended: past its end date. */
  state: "live" | "scheduled" | "ended";
  views: number;
};
export type AnnouncementInput = Omit<Announcement, "id" | "state" | "views">;

/** GET /api/admin/announcements */
export type AnnouncementsPage = { announcements: Announcement[]; classes: { id: string; name: string }[]; today: string };

export type Volunteer = { phone: string /* formatted */; name: string; classIds: string[]; perms: Perm[]; addedAt: string };
export type ActivityEntry = { at: string; who: string; action: string; detail: string | null };

/** GET /api/admin/volunteers */
export type VolunteersPage = {
  volunteers: Volunteer[]; classes: { id: string; name: string }[];
  /** Members who could be made volunteers (number owners), for the picker. */
  members: { name: string; phone: string /* formatted */ }[];
  activity: ActivityEntry[];
};

/** GET /api/admin/attendance: one class on one day. status null = not marked yet. */
export type AttendanceSheet = {
  classes: { id: string; name: string; meetsOn: number[] }[];
  classId: string | null; day: string; today: string; minDay: string;
  holiday: { note: string | null } | null;
  taken: boolean;
  people: { id: string; name: string; status: "present" | "late" | "absent" | null; gathas: number }[];
};

/** GET /api/admin/attendance/month: holidays are left out of every count. */
export type AttendanceMonth = {
  classId: string; className: string; month: string;
  days: { day: string; came: number; total: number }[];
  people: { id: string; name: string; present: number; late: number; absent: number; gathas: number; pct: number | null }[];
  holidays: { day: string; note: string | null }[];
};

/** GET /api/admin/reports?days=7|30&class= */
export type Report = {
  from: string; to: string; days: 7 | 30; classId: string | null;
  classes: { id: string; name: string }[];
  trend: { day: string; people: number; logged: number; pct: number }[];
  byClass: { classId: string | null; name: string; people: number; pct: number }[];
  niyams: { id: string; name: string; done: number; people: number }[];
  top: { id: string; name: string; class: string | null; days: number; kept: number }[];
  newJoins: number;
};

/** GET /api/admin/reports/cards?class=&month=: one printable card per person. */
export type ReportCards = {
  sangh: string; className: string; month: string; daysInMonth: number;
  cards: { name: string; daysLogged: number; kept: number; bestStreak: number; attendance: { came: number; total: number } | null }[];
};

/** A pathshala goal: a total for everyone ("10 lakh Navkar") or a challenge each person finishes ("21 days of Navkarsi"). */
export type Goal = {
  id: string; kind: "total" | "challenge"; title: string; titleHi: string | null; niyamId: string; niyamName: string;
  target: number | null; days: number | null; startDate: string; endDate: string; allClasses: boolean; classIds: string[];
  state: "live" | "upcoming" | "ended"; total: number; finishers: number;
};
export type GoalInput = Pick<Goal, "kind" | "title" | "titleHi" | "niyamId" | "target" | "days" | "startDate" | "endDate" | "allClasses" | "classIds">;
/** GET /api/admin/goals */
export type GoalsPage = { goals: Goal[]; niyams: { id: string; name: string; type: NiyamType }[]; classes: { id: string; name: string }[]; today: string };

/** GET /api/admin/leaderboard: one class between two dates, most Tej first (days kept break a tie). */
export type AdminBoard = {
  sangh: string;
  classes: { id: string; name: string; on: boolean }[];
  classId: string | null;
  from: string; to: string; today: string;
  /** Names as members see them on the board; photoUrl is null for those who show only initials. */
  rows: { rank: number; id: string; name: string; photoUrl: string | null; points: number; days: number }[];
};
