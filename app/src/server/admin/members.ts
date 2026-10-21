import "server-only";
import { asAdmin, pgCode } from "../db";
import { ageFrom, parseFormFields } from "@/lib/forms";
import { formatPhone, maskPhone } from "@/lib/phone";
import type { Family, MemberDetail, MemberRow, MembersPage } from "@/lib/admin-types";

// Members of one sangh, grouped by family (one phone number). Removed families and people are
// invisible here (row-level security hides them) until private.sweep() deletes them for good.

const LIST_CAP = 2000; // people per sangh shown in one list; filters narrow it further

export type MemberFilters = { q: string; classId: string | null; gender: string | null; age: AgeGroup | null; inactive: boolean };
export const AGE_GROUPS = ["under8", "8to12", "13to17", "18plus", "unknown"] as const;
export type AgeGroup = (typeof AGE_GROUPS)[number];

function ageGroup(age: number | null): AgeGroup {
  if (age === null) return "unknown";
  return age < 8 ? "under8" : age <= 12 ? "8to12" : age <= 17 ? "13to17" : "18plus";
}

/** The Indian date `days` before today, as yyyy-mm-dd. */
function istDate(daysBack = 0): string {
  const d = new Date(Date.now() + 5.5 * 3600_000 - daysBack * 86400_000);
  return d.toISOString().slice(0, 10);
}

export async function listMembers(phone: string, sanghId: string, f: MemberFilters): Promise<MembersPage> {
  return asAdmin(phone, async (tx) => {
    const classes = await tx<{ id: string; name: string }[]>`select id, name from public.classes where sangh_id = ${sanghId} order by sort_order, name`;
    const rows = await tx`
      select p.id, p.name, p.relation, p.class_id, p.photo_url, a.id as account_id, a.phone, a.created_at as joined_at,
        coalesce(pa.answers, '{}') as answers,
        (select to_char(max(l.log_date), 'YYYY-MM-DD') from public.niyam_logs l where l.profile_id = p.id) as last_logged
      from public.profiles p
      join public.accounts a on a.id = p.account_id
      left join public.profile_answers pa on pa.profile_id = p.id
      where a.sangh_id = ${sanghId}
      order by a.created_at desc, p.created_at
      limit ${LIST_CAP + 1}`;
    const truncated = rows.length > LIST_CAP;
    const className = new Map(classes.map((c) => [c.id, c.name]));
    const q = f.q.trim().toLowerCase();
    const qDigits = q.replace(/\D/g, "");
    const staleBefore = istDate(2); // nothing logged in the last 3 days (today and the two before)

    const families = new Map<string, Family>();
    let total = 0;
    for (const r of rows.slice(0, LIST_CAP)) {
      const answers = r.answers as Record<string, unknown>;
      const age = ageFrom(answers.dob);
      const gender = typeof answers.gender === "string" ? answers.gender : null;
      const rollNo = answers.roll_no != null ? String(answers.roll_no) : null;
      if (q) {
        const hit = r.name.toLowerCase().includes(q)
          || (qDigits.length >= 3 && String(r.phone).replace(/\D/g, "").includes(qDigits))
          || (rollNo !== null && rollNo.toLowerCase().includes(q));
        if (!hit) continue;
      }
      if (f.classId && r.class_id !== f.classId) continue;
      if (f.gender && gender !== f.gender) continue;
      if (f.age && ageGroup(age) !== f.age) continue;
      if (f.inactive && r.last_logged && r.last_logged >= staleBefore) continue;
      const row: MemberRow = {
        id: r.id, name: r.name, relation: r.relation, classId: r.class_id, className: r.class_id ? className.get(r.class_id) ?? null : null,
        photoUrl: r.photo_url, lastLogged: r.last_logged, age, gender, rollNo,
      };
      let fam = families.get(r.account_id);
      if (!fam) {
        fam = { accountId: r.account_id, phone: maskPhone(r.phone), joinedAt: new Date(r.joined_at).toISOString(), profiles: [] };
        families.set(r.account_id, fam);
      }
      fam.profiles.push(row);
      total++;
    }
    return { families: [...families.values()], classes: [...classes], total, truncated };
  });
}

export async function memberDetail(phone: string, sanghId: string, profileId: string): Promise<MemberDetail | null> {
  return asAdmin(phone, async (tx) => {
    const [r] = await tx`
      select p.id, p.name, p.relation, p.class_id, p.photo_url, p.created_at, p.consent_at, a.id as account_id, a.phone,
        coalesce(pa.answers, '{}') as answers, s.form_fields
      from public.profiles p
      join public.accounts a on a.id = p.account_id
      join public.sanghs s on s.id = a.sangh_id
      left join public.profile_answers pa on pa.profile_id = p.id
      where p.id = ${profileId} and a.sangh_id = ${sanghId}`;
    if (!r) return null;
    const days = await tx<{ d: string }[]>`
      select distinct to_char(log_date, 'YYYY-MM-DD') as d from public.niyam_logs
      where profile_id = ${profileId} and log_date > private.local_today() - 400 order by d desc`;
    const family = await tx<{ id: string; name: string }[]>`
      select id, name from public.profiles where account_id = ${r.account_id} order by created_at`;
    const classes = await tx<{ id: string; name: string }[]>`select id, name from public.classes where sangh_id = ${sanghId} order by sort_order, name`;

    const logged = new Set(days.map((x) => x.d));
    // Streak: days in a row with at least one log, ending today (or yesterday, if today isn't logged yet).
    let streak = 0;
    for (let i = logged.has(istDate(0)) ? 0 : 1; logged.has(istDate(i)); i++) streak++;
    const last30 = Array.from({ length: 30 }, (_, i) => { const d = istDate(29 - i); return { date: d, logged: logged.has(d) }; });

    const answers = r.answers as Record<string, unknown>;
    const age = ageFrom(answers.dob);
    const fields = parseFormFields(r.form_fields);
    const shown: MemberDetail["answers"] = [];
    for (const f of fields) {
      if (f.type === "class" || f.type === "photo") continue;
      const v = answers[f.key];
      if (v === undefined || v === null || v === "") continue;
      let value = String(v);
      if (f.type === "select") value = f.options.find((o) => o.value === value)?.en ?? value;
      if (f.type === "yesno") value = value === "yes" ? "Yes" : "No";
      if (f.type === "date" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        value = new Date(`${value}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
      }
      if (f.type === "gps") value = `Location saved (${value})`;
      shown.push({ key: f.key, label: f.label.en, value });
    }
    return {
      id: r.id, accountId: r.account_id, name: r.name, relation: r.relation, classId: r.class_id, photoUrl: r.photo_url,
      phone: formatPhone(r.phone), joinedAt: new Date(r.created_at).toISOString(), age,
      answers: shown,
      consent: { applies: r.relation === "child" || (age !== null && age < 18), given: r.consent_at !== null, at: r.consent_at ? new Date(r.consent_at).toISOString() : null },
      streak, last30, family: [...family], classes: [...classes],
    };
  });
}

export async function changeClass(phone: string, sanghId: string, profileId: string, classId: string): Promise<"ok" | "not_found" | "invalid_class"> {
  try {
    const r = await asAdmin(phone, (tx) => tx`
      update public.profiles p set class_id = ${classId}
      from public.accounts a where a.id = p.account_id and a.sangh_id = ${sanghId} and p.id = ${profileId}
      returning p.id`);
    return r.length ? "ok" : "not_found";
  } catch (e) {
    if (pgCode(e) === "23514") return "invalid_class"; // the class belongs to another sangh
    throw e;
  }
}

/** Removes one person. False if they aren't in a sangh this phone runs. */
export async function removeProfile(phone: string, profileId: string): Promise<boolean> {
  try {
    const [r] = await asAdmin(phone, (tx) => tx`select public.admin_remove_profile(${profileId}) as ok`);
    return r.ok;
  } catch (e) {
    if (pgCode(e) === "42501") return false;
    throw e;
  }
}

/** Removes a whole family and frees its number. False if it isn't in a sangh this phone runs. */
export async function removeFamily(phone: string, accountId: string): Promise<boolean> {
  try {
    const [r] = await asAdmin(phone, (tx) => tx`select public.admin_remove_family(${accountId}) as ok`);
    return r.ok;
  } catch (e) {
    if (pgCode(e) === "42501") return false;
    throw e;
  }
}
