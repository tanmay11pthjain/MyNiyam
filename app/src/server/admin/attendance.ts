import "server-only";
import { z } from "zod";
import { asAdmin, pgHint, type Tx } from "../db";
import type { AttendanceMonth, AttendanceSheet } from "@/lib/admin-types";
import type { AttendanceStatus } from "@/lib/today-types";

// Attendance for one class on one day, and the month's report. Admins, and volunteers with
// "attendance" for their classes. Row-level security checks the same (can_on_profile).

export const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export const marksInput = z.object({
  classId: z.uuid(),
  day: z.string().regex(DAY),
  marks: z.array(z.object({ profileId: z.uuid(), status: z.enum(["present", "late", "absent"]), gathas: z.number().int().min(0).max(999).default(0) })).max(500),
});

export const holidayInput = z.object({
  classId: z.uuid().nullable().default(null),
  day: z.string().regex(DAY),
  holiday: z.boolean(),
  note: z.string().trim().max(80).nullable().default(null).transform((s) => s || null),
});

/** Classes this person may take attendance for. */
const myClasses = (tx: Tx, sanghId: string) => tx<{ id: string; name: string; meets_on: number[] }[]>`
  select id, name, meets_on from public.classes
  where sangh_id = ${sanghId} and private.has_perm(sangh_id, 'attendance') and private.class_in_scope(sangh_id, id)
  order by sort_order, name`;

export async function getSheet(phone: string, sanghId: string, classId: string | null, day: string | null): Promise<AttendanceSheet | null> {
  return asAdmin(phone, async (tx) => {
    const classes = await myClasses(tx, sanghId);
    const [{ today, min }] = await tx<{ today: string; min: string }[]>`
      select private.local_today()::text as today, (private.local_today() - 30)::text as min`;
    const d = day ?? today;
    if (d > today || d < min) return null;
    const cls = classId ? classes.find((c) => c.id === classId) : classes[0];
    if (classId && !cls) return null;
    const [hol] = await tx<{ note: string | null }[]>`select note from public.sangh_holidays where sangh_id = ${sanghId} and day = ${d}`;
    // People in the class now, and anyone marked in it that day who has since moved.
    const people = cls ? await tx<{ id: string; name: string; status: AttendanceStatus | null; gathas: number | null }[]>`
      select p.id, p.name, at.status, at.gathas from public.profiles p
      left join public.attendance at on at.profile_id = p.id and at.day = ${d}
      where (p.class_id = ${cls.id} or at.class_id = ${cls.id}) and private.can_on_profile(p.id, 'attendance')
      order by lower(p.name)` : [];
    return {
      classes: classes.map((c) => ({ id: c.id, name: c.name, meetsOn: c.meets_on })),
      classId: cls?.id ?? null, day: d, today, minDay: min,
      holiday: hol ? { note: hol.note } : null,
      taken: people.some((p) => p.status !== null),
      people: people.map((p) => ({ id: p.id, name: p.name, status: p.status, gathas: p.gathas ?? 0 })),
    };
  });
}

/** Saves the marks. "not_found" if any person isn't in this person's reach, "day_out_of_range" for a bad day. */
export async function saveMarks(phone: string, sanghId: string, input: z.input<typeof marksInput>): Promise<"ok" | "not_found" | "day_out_of_range"> {
  try {
    return await asAdmin(phone, async (tx) => {
      const [c] = await myClasses(tx, sanghId).then((cs) => cs.filter((x) => x.id === input.classId));
      if (!c) return "not_found" as const;
      if (!input.marks.length) return "ok" as const;
      const ids = input.marks.map((m) => m.profileId);
      const [{ n }] = await tx<{ n: number }[]>`
        select count(*)::int as n from unnest(${tx.array([...new Set(ids)])}::uuid[]) as x(id) where private.can_on_profile(x.id, 'attendance')`;
      if (n !== new Set(ids).size) return "not_found" as const;
      await tx`
        insert into public.attendance (profile_id, day, sangh_id, status, gathas, taken_by)
        select m.profile_id, ${input.day}::date, ${sanghId}, m.status, m.gathas, ${phone}
        from unnest(${tx.array(ids)}::uuid[], ${tx.array(input.marks.map((m) => m.status))}::text[],
          ${tx.array(input.marks.map((m) => (m.status === "absent" ? 0 : m.gathas ?? 0)))}::int[]) as m(profile_id, status, gathas)
        on conflict (profile_id, day) do update set status = excluded.status, gathas = excluded.gathas, taken_by = excluded.taken_by, taken_at = now()`;
      return "ok" as const;
    });
  } catch (e) {
    if (pgHint(e) === "day_out_of_range") return "day_out_of_range";
    throw e;
  }
}

/** Removes the class's marks for that day (taken by mistake). */
export async function clearMarks(phone: string, sanghId: string, classId: string, day: string): Promise<void> {
  await asAdmin(phone, (tx) => tx`
    delete from public.attendance where day = ${day} and sangh_id = ${sanghId} and class_id = ${classId}`);
}

/** A holiday is for the whole pathshala: no class that day, and it never counts against anyone. */
export async function setHoliday(phone: string, sanghId: string, day: string, on: boolean, note: string | null): Promise<boolean> {
  const r = await asAdmin(phone, (tx) => (on
    ? tx`insert into public.sangh_holidays (sangh_id, day, note) values (${sanghId}, ${day}, ${note})
         on conflict (sangh_id, day) do update set note = excluded.note returning day`
    : tx`delete from public.sangh_holidays where sangh_id = ${sanghId} and day = ${day} returning day`));
  return r.length > 0 || !on;
}

/** The month's report for a class: each day it was taken, and each person's count and %. */
export async function getMonth(phone: string, sanghId: string, classId: string, month: string): Promise<AttendanceMonth | null> {
  return asAdmin(phone, async (tx) => {
    const [c] = (await myClasses(tx, sanghId)).filter((x) => x.id === classId);
    if (!c) return null;
    const start = `${month}-01`;
    const rows = await tx<{ profile_id: string; day: string; status: AttendanceStatus; gathas: number }[]>`
      select at.profile_id, at.day::text as day, at.status, at.gathas from public.attendance at
      where at.class_id = ${classId} and at.day >= ${start}::date and at.day < (${start}::date + interval '1 month')
        and not exists (select 1 from public.sangh_holidays h where h.sangh_id = at.sangh_id and h.day = at.day)`;
    const names = await tx<{ id: string; name: string }[]>`
      select p.id, p.name from public.profiles p
      where private.can_on_profile(p.id, 'attendance')
        and (p.class_id = ${classId} or p.id = any(${tx.array([...new Set(rows.map((r) => r.profile_id))])}::uuid[]))`;
    const holidays = await tx<{ day: string; note: string | null }[]>`
      select day::text as day, note from public.sangh_holidays
      where sangh_id = ${sanghId} and day >= ${start}::date and day < (${start}::date + interval '1 month') order by day`;

    const days = new Map<string, { came: number; total: number }>();
    const per = new Map<string, { present: number; late: number; absent: number; gathas: number }>();
    for (const r of rows) {
      const d = days.get(r.day) ?? { came: 0, total: 0 };
      d.total++; if (r.status !== "absent") d.came++;
      days.set(r.day, d);
      const p = per.get(r.profile_id) ?? { present: 0, late: 0, absent: 0, gathas: 0 };
      p[r.status]++;
      p.gathas += r.gathas;
      per.set(r.profile_id, p);
    }
    const people = names.map((n) => {
      const p = per.get(n.id) ?? { present: 0, late: 0, absent: 0, gathas: 0 };
      const total = p.present + p.late + p.absent;
      return { id: n.id, name: n.name, ...p, pct: total ? Math.round(((p.present + p.late) / total) * 100) : null };
    }).sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1) || a.name.localeCompare(b.name));
    return {
      classId, className: c.name, month,
      days: [...days].map(([day, v]) => ({ day, ...v })).sort((a, b) => a.day.localeCompare(b.day)),
      people, holidays,
    };
  });
}
