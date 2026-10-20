// The admin API contract, shared by /api/admin/** route handlers and the admin screens.
import type { FormField } from "./forms";

export type SanghStatus = "pending" | "active";
export type AdminSanghRef = { id: string; name: string; city: string; status: SanghStatus };

/** GET /api/admin/session */
export type AdminMe = { phone: string; isSuper: boolean; sanghs: AdminSanghRef[]; activeSanghId: string | null };

export type SanghProfile = {
  id: string; name: string; nameHi: string | null; city: string; area: string | null; sampraday: string | null;
  contactPhone: string | null; about: string | null; logoUrl: string | null; joinCode: string; status: SanghStatus;
  joinOpen: boolean; searchable: boolean; logBackHours: number;
};

export type Checklist = { classes: boolean; form: boolean; niyams: boolean; share: boolean };

/** GET /api/admin/dashboard */
export type Dashboard = {
  sangh: { name: string; joinCode: string; status: SanghStatus };
  families: number; profiles: number; loggedToday: number; loggingPct: number; niyamsDoneToday: number; activeNiyams: number;
  checklist: Checklist;
};

export type AdminClass = {
  id: string; name: string; nameHi: string | null; hidden: boolean; ageMin: number | null; ageMax: number | null; members: number;
};

export type NiyamType = "yesno" | "count" | "duration" | "choice";
export type NiyamStatus = "active" | "paused" | "archived";
export type NiyamOption = { value: string; en: string; hi?: string };
export type Niyam = {
  id: string; name: string; nameHi: string | null; type: NiyamType; target: number | null; options: NiyamOption[];
  icon: string | null; note: string | null; allClasses: boolean; classIds: string[];
  schedule: "daily" | "weekdays" | "range"; weekdays: number[]; startDate: string | null; endDate: string | null;
  isCore: boolean; status: NiyamStatus;
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
