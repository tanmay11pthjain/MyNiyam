import "server-only";
import { asAdmin, type Tx } from "../db";
import { formatPhone } from "@/lib/phone";
import type { DashboardAlerts, Report, ReportCards } from "@/lib/admin-types";
import type { SheetData } from "../xlsx";

// Reports for admins and volunteers with "view_members". Row-level security limits a volunteer
// to their own classes, so every query here simply reads what the caller may see.

/** People who joined before the last 3 days and logged nothing in them; classes due attendance today. */
export async function getAlerts(tx: Tx, sanghId: string): Promise<DashboardAlerts> {
  const quiet = await tx<{ name: string }[]>`
    select p.name from public.profiles p join public.accounts a on a.id = p.account_id
    where a.sangh_id = ${sanghId} and a.removed_at is null and p.removed_at is null
      and (p.created_at at time zone 'Asia/Kolkata')::date <= private.local_today() - 3
      and not exists (select 1 from public.niyam_logs l where l.profile_id = p.id and l.log_date > private.local_today() - 3)
    order by p.name`;
  const due = await tx<{ name: string }[]>`
    select c.name from public.classes c
    where c.sangh_id = ${sanghId} and private.has_perm(c.sangh_id, 'attendance') and private.class_in_scope(c.sangh_id, c.id)
      and extract(dow from private.local_today())::smallint = any(c.meets_on)
      and not exists (select 1 from public.sangh_holidays h where h.sangh_id = c.sangh_id and h.day = private.local_today())
      and not exists (select 1 from public.attendance at where at.class_id = c.id and at.day = private.local_today())
    order by c.sort_order, c.name`;
  return { quiet: quiet.length, quietNames: quiet.slice(0, 5).map((r) => r.name), attendanceDue: due.map((r) => r.name) };
}

type Range = { days: 7 | 30; classId: string | null };

/** People in range: the class filter, and not removed. Used by every report query. */
const people = (tx: Tx, sanghId: string, r: Range) => tx`
  select p.id, p.name, p.class_id, (p.created_at at time zone 'Asia/Kolkata')::date as joined
  from public.profiles p join public.accounts a on a.id = p.account_id
  where a.sangh_id = ${sanghId} and a.removed_at is null and p.removed_at is null
    ${r.classId ? tx`and p.class_id = ${r.classId}` : tx``}`;

export async function getReport(phone: string, sanghId: string, r: Range): Promise<Report> {
  return asAdmin(phone, async (tx) => {
    const [{ from, to }] = await tx<{ from: string; to: string }[]>`
      select (private.local_today() - ${r.days - 1}::int)::text as from, private.local_today()::text as to`;
    const trend = await tx<{ day: string; people: number; logged: number }[]>`
      with ppl as (${people(tx, sanghId, r)})
      select d.d::date::text as day,
        (select count(*)::int from ppl where ppl.joined <= d.d::date) as people,
        (select count(distinct l.profile_id)::int from public.niyam_logs l join ppl on ppl.id = l.profile_id
          where l.log_date = d.d::date and l.done) as logged
      from generate_series(${from}::date, ${to}::date, interval '1 day') as d(d) order by d.d`;
    const byClass = await tx<{ id: string | null; name: string | null; people: number; logged_days: number; possible: number }[]>`
      with ppl as (${people(tx, sanghId, r)}),
           days as (select ppl.id, count(distinct l.log_date)::int as n from ppl
                    join public.niyam_logs l on l.profile_id = ppl.id and l.done and l.log_date between ${from}::date and ${to}::date
                    group by ppl.id)
      select c.id, c.name, count(ppl.id)::int as people, coalesce(sum(days.n), 0)::int as logged_days,
        coalesce(sum(${to}::date - greatest(ppl.joined, ${from}::date) + 1), 0)::int as possible
      from ppl left join public.classes c on c.id = ppl.class_id left join days on days.id = ppl.id
      group by c.id, c.name, c.sort_order order by c.sort_order nulls last, c.name`;
    const niyams = await tx<{ id: string; name: string; done: number; people: number }[]>`
      with ppl as (${people(tx, sanghId, r)})
      select n.id, n.name, count(*)::int as done, count(distinct l.profile_id)::int as people
      from public.niyam_logs l join ppl on ppl.id = l.profile_id join public.niyams n on n.id = l.niyam_id
      where l.done and l.log_date between ${from}::date and ${to}::date
      group by n.id, n.name order by done desc, n.name limit 30`;
    const top = await tx<{ id: string; name: string; class: string | null; days: number; kept: number }[]>`
      with ppl as (${people(tx, sanghId, r)})
      select ppl.id, ppl.name, c.name as class, count(distinct l.log_date)::int as days, count(*)::int as kept
      from ppl join public.niyam_logs l on l.profile_id = ppl.id and l.done and l.log_date between ${from}::date and ${to}::date
      left join public.classes c on c.id = ppl.class_id
      group by ppl.id, ppl.name, c.name order by days desc, kept desc, ppl.name limit 10`;
    const [{ joins }] = await tx<{ joins: number }[]>`
      with ppl as (${people(tx, sanghId, r)}) select count(*)::int as joins from ppl where joined >= ${from}::date`;
    const classes = await tx<{ id: string; name: string }[]>`
      select id, name from public.classes where sangh_id = ${sanghId} and private.class_in_scope(sangh_id, id) order by sort_order, name`;
    return {
      from, to, days: r.days, classId: r.classId, classes: [...classes],
      trend: trend.map((t) => ({ day: t.day, people: t.people, logged: t.logged, pct: t.people ? Math.round((t.logged / t.people) * 100) : 0 })),
      byClass: byClass.map((c) => ({ classId: c.id, name: c.name ?? "No class", people: c.people, pct: c.possible ? Math.round((c.logged_days / c.possible) * 100) : 0 })),
      niyams: [...niyams],
      top: [...top],
      newJoins: joins,
    };
  });
}

const short = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

/** Admins only (the route checks): the Excel workbook. Members (with numbers), attendance and niyams, last 30 days. */
export async function reportWorkbook(phone: string, sanghId: string): Promise<SheetData[]> {
  return asAdmin(phone, async (tx) => {
    const rows = await tx`
      select p.id, p.name, c.name as class, a.phone, p.relation, (p.created_at at time zone 'Asia/Kolkata')::date::text as joined,
        (select max(l.log_date)::text from public.niyam_logs l where l.profile_id = p.id) as last_logged,
        (select count(distinct l.log_date)::int from public.niyam_logs l where l.profile_id = p.id and l.done and l.log_date > private.local_today() - 30) as days30,
        (select count(*)::int from public.niyam_logs l where l.profile_id = p.id and l.done and l.log_date > private.local_today() - 30) as kept30
      from public.profiles p join public.accounts a on a.id = p.account_id left join public.classes c on c.id = p.class_id
      where a.sangh_id = ${sanghId} and a.removed_at is null and p.removed_at is null
      order by c.sort_order nulls last, lower(p.name)`;
    const marks = await tx<{ profile_id: string; day: string; status: "present" | "late" | "absent"; gathas: number }[]>`
      select at.profile_id, at.day::text as day, at.status, at.gathas from public.attendance at
      where at.sangh_id = ${sanghId} and at.day > private.local_today() - 30
        and not exists (select 1 from public.sangh_holidays h where h.sangh_id = at.sangh_id and h.day = at.day)`;
    const niyams = await tx<{ name: string; done: number; people: number }[]>`
      select n.name, count(*)::int as done, count(distinct l.profile_id)::int as people
      from public.niyam_logs l join public.niyams n on n.id = l.niyam_id
      join public.profiles p on p.id = l.profile_id and p.removed_at is null
      join public.accounts a on a.id = p.account_id and a.sangh_id = ${sanghId} and a.removed_at is null
      where l.done and l.log_date > private.local_today() - 30
      group by n.id, n.name order by done desc, n.name`;

    const days = [...new Set(marks.map((m) => m.day))].sort();
    const per = new Map<string, Map<string, { status: string; gathas: number }>>();
    for (const m of marks) {
      if (!per.has(m.profile_id)) per.set(m.profile_id, new Map());
      per.get(m.profile_id)!.set(m.day, m);
    }
    const LETTER = { present: "P", late: "L", absent: "A" } as Record<string, string>;
    const totals = (id: string) => {
      const t = { present: 0, late: 0, absent: 0, gathas: 0 };
      for (const m of per.get(id)?.values() ?? []) { t[m.status as "present"]++; t.gathas += m.gathas; }
      const n = t.present + t.late + t.absent;
      return { ...t, pct: n ? Math.round(((t.present + t.late) / n) * 100) : null };
    };

    return [
      {
        name: "Members", widths: [24, 16, 16, 8, 12, 12, 12, 12, 12, 10],
        rows: [
          ["Name", "Class", "Mobile", "Who", "Joined", "Last logged", "Days logged (30 days)", "Niyams kept (30 days)", "Attendance % (30 days)", "Gathas (30 days)"],
          ...rows.map((r) => { const t = totals(r.id); return [r.name, r.class ?? "", formatPhone(r.phone), r.relation === "self" ? "Self" : "Child", r.joined, r.last_logged ?? "", r.days30, r.kept30, t.pct, t.gathas]; }),
        ],
      },
      {
        name: "Attendance", widths: [24, 16, ...days.map(() => 7), 9, 7, 9, 9, 9],
        rows: [
          ["Name", "Class", ...days.map(short), "Present", "Late", "Absent", "%", "Gathas"],
          ...rows.filter((r) => per.has(r.id)).map((r) => {
            const t = totals(r.id), mine = per.get(r.id)!;
            return [r.name, r.class ?? "", ...days.map((d) => { const m = mine.get(d); return m ? LETTER[m.status] + (m.gathas ? ` ${m.gathas}` : "") : ""; }), t.present, t.late, t.absent, t.pct, t.gathas];
          }),
        ],
      },
      { name: "Niyams", widths: [30, 14, 10], rows: [["Niyam", "Times kept (30 days)", "People"], ...niyams.map((n) => [n.name, n.done, n.people])] },
    ];
  });
}

/** One report card per person in a class for a month: days logged, niyams kept, best streak, attendance. */
export async function getReportCards(phone: string, sanghId: string, classId: string, month: string): Promise<ReportCards | null> {
  return asAdmin(phone, async (tx) => {
    const [s] = await tx`select name from public.sanghs where id = ${sanghId}`;
    const [c] = await tx`select name from public.classes where id = ${classId} and sangh_id = ${sanghId} and private.class_in_scope(sangh_id, id)`;
    if (!s || !c) return null;
    const start = `${month}-01`;
    const rows = await tx<{ id: string; name: string; days: number[]; kept: number; present: number; total: number }[]>`
      select p.id, p.name,
        coalesce((select array_agg(distinct extract(day from l.log_date)::int order by extract(day from l.log_date)::int) from public.niyam_logs l
          where l.profile_id = p.id and l.done and l.log_date >= ${start}::date and l.log_date < (${start}::date + interval '1 month')), '{}') as days,
        (select count(*)::int from public.niyam_logs l where l.profile_id = p.id and l.done
          and l.log_date >= ${start}::date and l.log_date < (${start}::date + interval '1 month')) as kept,
        (select count(*) filter (where at.status <> 'absent')::int from public.attendance at where at.profile_id = p.id
          and at.day >= ${start}::date and at.day < (${start}::date + interval '1 month')
          and not exists (select 1 from public.sangh_holidays h where h.sangh_id = at.sangh_id and h.day = at.day)) as present,
        (select count(*)::int from public.attendance at where at.profile_id = p.id
          and at.day >= ${start}::date and at.day < (${start}::date + interval '1 month')
          and not exists (select 1 from public.sangh_holidays h where h.sangh_id = at.sangh_id and h.day = at.day)) as total
      from public.profiles p join public.accounts a on a.id = p.account_id
      where p.class_id = ${classId} and a.removed_at is null and p.removed_at is null order by lower(p.name)`;
    const [{ dim }] = await tx<{ dim: number }[]>`
      select extract(day from least((${start}::date + interval '1 month - 1 day')::date, private.local_today()))::int as dim`;
    return {
      sangh: s.name, className: c.name, month, daysInMonth: Math.max(dim, 0),
      cards: rows.map((r) => ({
        name: r.name, daysLogged: r.days.length, kept: r.kept, bestStreak: bestRun(r.days),
        attendance: r.total ? { came: r.present, total: r.total } : null,
      })),
    };
  });
}

/** Longest run of consecutive days in a sorted list of day numbers. */
export function bestRun(days: number[]): number {
  let best = 0, run = 0, prev = -1;
  for (const d of days) { run = d === prev + 1 ? run + 1 : 1; best = Math.max(best, run); prev = d; }
  return best;
}
