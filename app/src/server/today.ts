import "server-only";
import { asAccount, pgHint, type Tx } from "./db";
import type { DayNiyam, DayView, HistoryDay, HistoryDayResponse, HistoryResponse, LogInput, TodayResponse } from "@/lib/today-types";
import type { NiyamOption } from "@/lib/admin-types";

// The student side: what is on a person's list for a day, logging it, the streak and history.
// Everything runs as the signed-in account, so row-level security keeps it to their own sangh and family.
// Days are Indian days (Asia/Kolkata), decided here and in the database, never by the phone's clock.

/** The niyams a class sees on a date: active (or already logged), in the person's class, scheduled that day. */
const onList = (tx: Tx, date: string, classId: string | null) => tx`
  (n.status = 'active' or l.niyam_id is not null)
  and (n.all_classes or exists (select 1 from public.niyam_classes nc where nc.niyam_id = n.id and nc.class_id = ${classId}))
  and (n.schedule = 'daily'
    or (n.schedule = 'weekdays' and extract(dow from ${date}::date)::int = any(n.weekdays))
    or (n.schedule = 'range' and ${date}::date between n.start_date and n.end_date))`;

type Prof = { classId: string | null; back: number };

async function loadProfile(tx: Tx, profileId: string): Promise<Prof | null> {
  const [p] = await tx<{ class_id: string | null; back: number }[]>`
    select p.class_id, s.log_back_hours as back
    from public.profiles p join public.accounts a on a.id = p.account_id join public.sanghs s on s.id = a.sangh_id
    where p.id = ${profileId} and p.removed_at is null`;
  return p ? { classId: p.class_id, back: p.back } : null;
}

async function dayView(tx: Tx, profileId: string, prof: Prof, date: string): Promise<DayView> {
  const rows = await tx<{
    id: string; name: string; name_hi: string | null; type: DayNiyam["type"]; target: number | null; options: NiyamOption[];
    icon: string | null; note: string | null; is_core: boolean; value: number | null; choice: string | null; done: boolean | null;
  }[]>`
    select n.id, n.name, n.name_hi, n.type, n.target, n.options, n.icon, n.note, n.is_core, l.value, l.choice, l.done
    from public.niyams n
    left join public.niyam_logs l on l.niyam_id = n.id and l.profile_id = ${profileId} and l.log_date = ${date}::date
    where ${onList(tx, date, prof.classId)}
    order by n.is_core desc, n.sort_order, n.created_at`;
  const [{ editable }] = await tx<{ editable: boolean }[]>`
    select ${date}::date <= private.local_today()
      and (now() at time zone 'Asia/Kolkata') < (${date}::date + 1)::timestamp + make_interval(hours => ${prof.back}) as editable`;
  return {
    date, editable,
    niyams: rows.map((r) => ({
      id: r.id, name: r.name, nameHi: r.name_hi, type: r.type, target: r.target, options: r.options, icon: r.icon, note: r.note,
      isCore: r.is_core, value: r.value ?? 0, choice: r.choice, done: r.done ?? false,
    })),
  };
}

/**
 * Days in a row with at least one niyam done, ending today (or yesterday while today is still open).
 * Worked out from the logs every time, so every phone shows the same number.
 */
async function streak(tx: Tx, profileId: string): Promise<{ streak: number; alive: boolean }> {
  const [r] = await tx<{ streak: number; alive: boolean }[]>`
    with d as (select distinct log_date from public.niyam_logs where profile_id = ${profileId} and done and log_date <= private.local_today()),
    g as (select log_date, log_date - (row_number() over (order by log_date))::int as grp from d),
    last as (select grp, log_date from g order by log_date desc limit 1)
    select coalesce((select count(*) from g where grp = (select grp from last)), 0)::int as streak,
           coalesce((select log_date >= private.local_today() - 1 from last), false) as alive`;
  return { streak: r.alive ? r.streak : 0, alive: r.alive };
}

export async function getToday(accountId: string, profileId: string): Promise<TodayResponse | null> {
  return asAccount(accountId, async (tx) => {
    const prof = await loadProfile(tx, profileId);
    if (!prof) return null;
    const [{ today, yesterday }] = await tx<{ today: string; yesterday: string }[]>`
      select private.local_today()::text as today, (private.local_today() - 1)::text as yesterday`;
    const t = await dayView(tx, profileId, prof, today);
    const y = await dayView(tx, profileId, prof, yesterday);
    const s = await streak(tx, profileId);
    return { today: t, yesterday: y.editable ? y : null, streak: s.streak, streakAlive: s.alive };
  });
}

export type LogResult = { ok: true; niyam: DayNiyam } | { ok: false; reason: "not_found" | "bad_request" | "invalid_choice" | "log_window_closed" };

export async function setLog(accountId: string, profileId: string, input: LogInput): Promise<LogResult> {
  try {
    return await asAccount(accountId, async (tx) => {
      const prof = await loadProfile(tx, profileId);
      if (!prof) return { ok: false as const, reason: "not_found" as const };
      const [n] = await tx<{ id: string; type: DayNiyam["type"]; target: number | null; options: NiyamOption[] }[]>`
        select n.id, n.type, n.target, n.options from public.niyams n
        left join public.niyam_logs l on l.niyam_id = n.id and l.profile_id = ${profileId} and l.log_date = ${input.date}::date
        where n.id = ${input.niyamId} and ${onList(tx, input.date, prof.classId)}`;
      if (!n) return { ok: false as const, reason: "not_found" as const };

      // What to store: nothing (clear the entry), or done / value / choice.
      let keep: { done: boolean; value: number | null; choice: string | null } | null = null;
      if (n.type === "yesno") {
        if (input.done !== false) keep = { done: true, value: null, choice: null };
      } else if (n.type === "choice") {
        if (input.choice) {
          if (!n.options.some((o) => o.value === input.choice)) return { ok: false as const, reason: "invalid_choice" as const };
          keep = { done: true, value: null, choice: input.choice };
        }
      } else {
        if (typeof input.value !== "number") return { ok: false as const, reason: "bad_request" as const };
        if (input.value > 0) keep = { done: input.value >= (n.target ?? 1), value: input.value, choice: null };
      }

      if (keep) {
        await tx`
          insert into public.niyam_logs (profile_id, niyam_id, log_date, done, value, choice)
          values (${profileId}, ${n.id}, ${input.date}::date, ${keep.done}, ${keep.value}, ${keep.choice})
          on conflict (profile_id, niyam_id, log_date) do update set done = excluded.done, value = excluded.value, choice = excluded.choice`;
      } else {
        // The database refuses this too once the day is past its window (trigger niyam_logs_window_delete).
        await tx`delete from public.niyam_logs where profile_id = ${profileId} and niyam_id = ${n.id} and log_date = ${input.date}::date`;
      }
      const day = await dayView(tx, profileId, prof, input.date);
      return { ok: true as const, niyam: day.niyams.find((x) => x.id === n.id)! };
    });
  } catch (e) {
    if (pgHint(e) === "log_window_closed") return { ok: false, reason: "log_window_closed" };
    throw e;
  }
}

export async function getHistory(accountId: string, profileId: string, month: string): Promise<HistoryResponse | null> {
  return asAccount(accountId, async (tx) => {
    const prof = await loadProfile(tx, profileId);
    if (!prof) return null;
    const days = await tx<{ date: string; core_total: number; core_done: number; any_done: number }[]>`
      select d.d::date::text as date,
        (select count(*) from public.niyams n left join public.niyam_logs l on l.niyam_id = n.id and l.profile_id = ${profileId} and l.log_date = d.d::date
          where n.is_core and ${onHistoryList(tx, prof.classId)})::int as core_total,
        (select count(*) from public.niyam_logs l join public.niyams n on n.id = l.niyam_id
          where l.profile_id = ${profileId} and l.log_date = d.d::date and l.done and n.is_core)::int as core_done,
        (select count(*) from public.niyam_logs l where l.profile_id = ${profileId} and l.log_date = d.d::date and l.done)::int as any_done
      from generate_series(${month + "-01"}::date, least((${month + "-01"}::date + interval '1 month - 1 day')::date, private.local_today()), interval '1 day') as d(d)
      order by d.d desc`;
    const [m] = await tx<{ today: string; first: string }[]>`
      select private.local_today()::text as today,
        to_char(least((select created_at at time zone 'Asia/Kolkata' from public.profiles where id = ${profileId}),
                      coalesce((select min(log_date) from public.niyam_logs where profile_id = ${profileId}), private.local_today())), 'YYYY-MM') as first`;
    const out: HistoryDay[] = days.map((r) => ({ date: r.date, coreDone: r.core_done, coreTotal: r.core_total, anyDone: r.any_done }));
    return { month, today: m.today, days: out, firstMonth: m.first };
  });
}

/** History's per-day list ignores the date's weekday rules only for the count; the day view applies them fully. */
const onHistoryList = (tx: Tx, classId: string | null) => tx`
  (n.status = 'active' or l.niyam_id is not null)
  and (n.all_classes or exists (select 1 from public.niyam_classes nc where nc.niyam_id = n.id and nc.class_id = ${classId}))
  and (n.schedule = 'daily'
    or (n.schedule = 'weekdays' and extract(dow from d.d::date)::int = any(n.weekdays))
    or (n.schedule = 'range' and d.d::date between n.start_date and n.end_date))`;

export async function getHistoryDay(accountId: string, profileId: string, date: string): Promise<HistoryDayResponse | null> {
  return asAccount(accountId, async (tx) => {
    const prof = await loadProfile(tx, profileId);
    if (!prof) return null;
    const day = await dayView(tx, profileId, prof, date);
    const [{ y }] = await tx<{ y: boolean }[]>`select ${date}::date = private.local_today() - 1 as y`;
    return { day, isYesterday: y };
  });
}
