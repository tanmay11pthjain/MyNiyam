import "server-only";
import { asAccount, pgHint, type Tx } from "./db";
import { diyaLevel, nextDiya, niyamRuns, repairOffer, walkStreak } from "@/lib/progress";
import { badgeInfo, earnedBadges } from "@/lib/badges";
import type { AnnouncementCard, AttendanceStatus, DayNiyam, DayView, EarnedBadge, HistoryDay, HistoryDayResponse, HistoryResponse, LogInput, NiyamStat, Progress, TodayResponse, Vow } from "@/lib/today-types";
import type { NiyamOption } from "@/lib/admin-types";
import { CITIES, NAVKARSI_AFTER_SUNRISE_MIN, clock, sunTimes } from "@/lib/sun";

// The student side: what is on a person's list for a day, logging it, the streak and history.
// Everything runs as the signed-in account, so row-level security keeps it to their own sangh and family.
// Days are Indian days (Asia/Kolkata), decided here and in the database, never by the phone's clock.

/** The niyams a class sees on a date: active (or already logged), in the person's class, scheduled that day. */
const onList = (tx: Tx, date: string, classId: string | null) => tx`
  (n.status = 'active' or l.niyam_id is not null)
  and (n.all_classes or exists (select 1 from public.niyam_classes nc where nc.niyam_id = n.id and nc.class_id = ${classId}))
  and (n.schedule = 'daily'
    or (n.schedule = 'weekdays' and extract(dow from ${date}::date)::int = any(n.weekdays))
    or (n.schedule = 'range' and ${date}::date between n.start_date and n.end_date)
    or (n.schedule = 'dates' and ${date}::date = any(n.dates)))`;

export type Prof = { classId: string | null; back: number; place: { lat: number; lon: number } | null };

export async function loadProfile(tx: Tx, profileId: string): Promise<Prof | null> {
  const [p] = await tx<{ class_id: string | null; back: number; lat: number | null; lon: number | null; city: string }[]>`
    select p.class_id, s.log_back_hours as back, s.lat, s.lon, s.city
    from public.profiles p join public.accounts a on a.id = p.account_id join public.sanghs s on s.id = a.sangh_id
    where p.id = ${profileId} and p.removed_at is null`;
  if (!p) return null;
  // The admin's chosen place, else the sangh's city if it is one we know.
  const city = CITIES.find((c) => c.name.toLowerCase() === p.city.trim().toLowerCase());
  const place = p.lat !== null && p.lon !== null ? { lat: p.lat, lon: p.lon } : city ? { lat: city.lat, lon: city.lon } : null;
  return { classId: p.class_id, back: p.back, place };
}

/** "By 7:14 am" (Navkarsi) or "Before 6:02 pm" (Chauvihar) for that day, when the sangh's place is known. */
function timeFor(hint: string | null, date: string, prof: Prof): string | null {
  if (!hint || !prof.place) return null;
  const sun = sunTimes(date, prof.place.lat, prof.place.lon);
  if (!sun) return null;
  return hint === "navkarsi" ? `By ${clock(sun.sunrise + NAVKARSI_AFTER_SUNRISE_MIN)}` : `Before ${clock(sun.sunset)}`;
}

async function dayView(tx: Tx, profileId: string, prof: Prof, date: string): Promise<DayView> {
  const rows = await tx<{
    id: string; name: string; name_hi: string | null; type: DayNiyam["type"]; target: number | null; options: NiyamOption[];
    icon: string | null; note: string | null; is_core: boolean; value: number | null; choice: string | null; done: boolean | null;
    time_hint: string | null;
  }[]>`
    select n.id, n.name, n.name_hi, n.type, n.target, n.options, n.icon, n.note, n.is_core, l.value, l.choice, l.done, n.time_hint
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
      isCore: r.is_core, value: r.value ?? 0, choice: r.choice, done: r.done ?? false, time: timeFor(r.time_hint, date, prof),
    })),
  };
}

/**
 * Streak (with kshama days), best streak and Tej, worked out from the logs every time, so every phone
 * shows the same numbers. Tej: a niyam's points each time it is kept; for count and minutes niyams,
 * points for each count, up to 10 counts a day.
 */
export async function progress(tx: Tx, profileId: string): Promise<Progress & { daysKept: number }> {
  const days = await tx<{ d: string }[]>`
    select distinct log_date::text as d from public.niyam_logs
    where profile_id = ${profileId} and done and log_date <= private.local_today()`;
  const repairs = await tx<{ d: string; recent: boolean }[]>`
    select missed_date::text as d, repaired_at > now() - interval '30 days' as recent
    from public.streak_repairs where profile_id = ${profileId}`;
  const [t] = await tx<{ today: string; tej: number; tej_today: number }[]>`
    with pts as (
      select l.log_date, private.log_tej(n.type, n.points, n.options, l.value, l.choice) as p
      from public.niyam_logs l join public.niyams n on n.id = l.niyam_id
      where l.profile_id = ${profileId} and l.done)
    select private.local_today()::text as today, coalesce(sum(p), 0)::int as tej,
      coalesce(sum(p) filter (where log_date = private.local_today()), 0)::int as tej_today from pts`;
  const kept = days.map((r) => r.d);
  const fixed = repairs.map((r) => r.d);
  const w = walkStreak(kept, t.today, fixed);
  const monthAgo = new Date(Date.parse(`${t.today}T00:00:00Z`) - 30 * 864e5).toISOString().slice(0, 10);
  return {
    streak: w.streak, best: w.best, kshama: w.kshama, kshamaUsedOn: [...w.usedOn, ...w.repairedOn].filter((d) => d >= monthAgo),
    tej: t.tej, tejToday: t.tej_today, diya: diyaLevel(w.streak), nextDiya: nextDiya(w.streak),
    // One repair in any 30 days.
    repair: repairs.some((r) => r.recent) ? null : repairOffer(kept, t.today, fixed),
    daysKept: kept.length,
  };
}

/** Makes up for a missed day, if the rules allow it right now (see repairOffer). */
export async function repairStreak(accountId: string, profileId: string, missed: string): Promise<"ok" | "not_allowed"> {
  return asAccount(accountId, async (tx) => {
    if (!(await loadProfile(tx, profileId))) return "not_allowed";
    await tx`select 1 from public.profiles where id = ${profileId} for update`; // one repair at a time
    const p = await progress(tx, profileId);
    if (!p.repair || p.repair.missed !== missed) return "not_allowed";
    await tx`insert into public.streak_repairs (profile_id, missed_date) values (${profileId}, ${missed}::date) on conflict do nothing`;
    return "ok";
  });
}

/**
 * Awards any badge this person has earned and not yet received. Returns the new ones (to celebrate
 * once on Today; they also appear in the Sangh feed).
 */
async function awardBadges(tx: Tx, profileId: string, classId: string | null, p: Progress & { daysKept: number }): Promise<EarnedBadge[]> {
  const [facts] = await tx<{ names: string[]; att: boolean; goals: string[] }[]>`
    select
      array(select distinct y.x from public.niyam_logs l join public.niyams n on n.id = l.niyam_id,
        lateral (select coalesce((select (o ->> 'en') || ' ' || coalesce(o ->> 'hi', '') from jsonb_array_elements(n.options) o where o ->> 'value' = l.choice),
                                 n.name || ' ' || coalesce(n.name_hi, '')) as x) y
        where l.profile_id = ${profileId} and l.done and n.type in ('choice', 'yesno')
          and y.x ~* '(eka?s|aya?mb|upa?vas|upwas|एकास|आयं|आयम्|उपवास)') as names,
      coalesce((select count(*) >= 4 and bool_and(a.status in ('present', 'late')) from public.attendance a
        where a.profile_id = ${profileId}
          and a.day between date_trunc('month', private.local_today() - interval '1 month')::date and (date_trunc('month', private.local_today())::date - 1)
          and not exists (select 1 from public.sangh_holidays h where h.sangh_id = a.sangh_id and h.day = a.day)), false) as att,
      array(select g.id::text from public.sangh_goals g
        where g.kind = 'challenge' and g.sangh_id = private.current_sangh_id() and g.start_date <= private.local_today()
          and (g.all_classes or ${classId}::uuid = any(g.class_ids))
          and not exists (select 1 from public.badges_earned b where b.profile_id = ${profileId} and b.badge = 'challenge:' || g.id)
          and (select count(*) from public.niyam_logs l where l.profile_id = ${profileId} and l.niyam_id = g.niyam_id and l.done
               and l.log_date between g.start_date and g.end_date) >= g.days) as goals`;
  const ids = earnedBadges({ best: p.best, daysKept: p.daysKept, tej: p.tej, tapasyaNames: facts.names, fullAttendanceMonth: facts.att, challengesDone: facts.goals });
  if (!ids.length) return [];
  const rows = await tx<{ badge: string; earned_at: Date }[]>`
    insert into public.badges_earned (profile_id, badge) select ${profileId}, b from unnest(${tx.array(ids)}::text[]) b
    on conflict (profile_id, badge) do nothing returning badge, earned_at`;
  if (!rows.length) return [];
  const titles = await challengeTitles(tx, rows.map((r) => r.badge));
  return rows.map((r) => toBadge(r.badge, r.earned_at, titles));
}

export async function challengeTitles(tx: Tx, badges: string[]): Promise<Map<string, string>> {
  const ids = badges.filter((b) => b.startsWith("challenge:")).map((b) => b.slice(10));
  if (!ids.length) return new Map();
  const rows = await tx<{ id: string; title: string }[]>`select id, title from public.sangh_goals where id = any(${tx.array(ids)}::uuid[])`;
  return new Map(rows.map((r) => [`challenge:${r.id}`, r.title]));
}

export function toBadge(id: string, at: Date | string, titles: Map<string, string>): EarnedBadge {
  const b = badgeInfo(id, titles.get(id));
  return { id, en: b.en, hi: b.hi, mark: b.mark, kind: b.kind, earnedAt: new Date(at).toISOString() };
}

/** Running personal vows, with today's tick and the days kept so far. */
async function vowsFor(tx: Tx, profileId: string): Promise<Vow[]> {
  const rows = await tx<{ id: string; name: string; start_date: string; end_date: string; done_today: boolean; days: number }[]>`
    select v.id, v.name, v.start_date::text, v.end_date::text,
      exists (select 1 from public.vow_logs l where l.vow_id = v.id and l.log_date = private.local_today()) as done_today,
      (select count(*)::int from public.vow_logs l where l.vow_id = v.id) as days
    from public.vows v
    where v.profile_id = ${profileId} and v.ended_at is null and v.end_date >= private.local_today()
    order by v.end_date, v.created_at`;
  return rows.map((r) => ({ id: r.id, name: r.name, startDate: r.start_date, endDate: r.end_date, doneToday: r.done_today, daysKept: r.days }));
}

export async function getProgress(accountId: string, profileId: string): Promise<Progress | null> {
  return asAccount(accountId, async (tx) => ((await loadProfile(tx, profileId)) ? progress(tx, profileId) : null));
}

/** Each niyam this person has on their list or has kept: streak, best run and lifetime total. */
export async function getNiyamStats(accountId: string, profileId: string): Promise<NiyamStat[] | null> {
  return asAccount(accountId, async (tx) => {
    const prof = await loadProfile(tx, profileId);
    if (!prof) return null;
    const rows = await tx<{ id: string; name: string; type: string; schedule: string; weekdays: number[] | null; dates: string[] | null; days: string[]; total: number; today: string }[]>`
      select n.id, n.name, n.type, n.schedule, n.weekdays, n.dates::text[] as dates, private.local_today()::text as today,
        coalesce(array_agg(l.log_date::text) filter (where l.done), '{}') as days,
        coalesce(case when n.type in ('count', 'duration') then sum(l.value) filter (where l.done) else count(*) filter (where l.done) end, 0)::int as total
      from public.niyams n left join public.niyam_logs l on l.niyam_id = n.id and l.profile_id = ${profileId}
      where n.sangh_id = (select sangh_id from public.accounts where id = ${accountId})
        and ((n.status = 'active' and (n.all_classes or exists (select 1 from public.niyam_classes nc where nc.niyam_id = n.id and nc.class_id = ${prof.classId})))
             or l.niyam_id is not null)
      group by n.id order by n.sort_order, n.created_at`;
    return rows.map((r) => {
      const scheduled = r.schedule === "weekdays" && r.weekdays?.length
        ? (d: string) => r.weekdays!.includes(new Date(`${d}T00:00:00Z`).getUTCDay())
        : r.schedule === "dates" ? (d: string) => (r.dates ?? []).includes(d) : undefined;
      const runs = niyamRuns(r.days, r.today, scheduled);
      const unit = r.type === "count" ? "counted in all" : r.type === "duration" ? "minutes in all" : r.total === 1 ? "time kept" : "times kept";
      return { id: r.id, name: r.name, ...runs, total: r.total, unit };
    });
  });
}

/** Up to 6 slides for this person's class showing today, pinned first, then the admin's order. */
export async function announcementsFor(tx: Tx, profileId: string, prof: Prof): Promise<AnnouncementCard[]> {
  const rows = await tx`
    select an.id, an.title, an.body, an.image_url, an.button_label, an.button_url, an.pinned,
      -- Seen on an earlier day: it shows as one line. Seen today: still in full, however often Today reloads.
      exists (select 1 from public.announcement_views v where v.announcement_id = an.id and v.profile_id = ${profileId}
              and (v.seen_at at time zone 'Asia/Kolkata')::date < private.local_today()) as seen
    from public.announcements an
    where an.sangh_id = (select a.sangh_id from public.profiles p join public.accounts a on a.id = p.account_id where p.id = ${profileId})
      and (an.start_date is null or an.start_date <= private.local_today())
      and (an.end_date is null or an.end_date >= private.local_today())
      and (an.all_classes or exists (select 1 from public.announcement_classes ac where ac.announcement_id = an.id and ac.class_id = ${prof.classId}))
    order by an.pinned desc, an.sort_order, an.created_at desc
    limit 6`;
  return rows.map((r) => ({
    id: r.id, title: r.title, body: r.body, imageUrl: r.image_url, buttonLabel: r.button_label, buttonUrl: r.button_url,
    pinned: r.pinned, seen: r.seen,
  }));
}

/** Records that this person has seen these slides (once each). */
export async function markSeen(accountId: string, profileId: string, ids: string[]): Promise<void> {
  await asAccount(accountId, (tx) => tx`
    insert into public.announcement_views (announcement_id, profile_id)
    select an.id, ${profileId} from public.announcements an
    where an.id = any(${tx.array(ids)}::uuid[]) and an.sangh_id = private.current_sangh_id()
    on conflict do nothing`);
}

export async function getToday(accountId: string, profileId: string): Promise<TodayResponse | null> {
  return asAccount(accountId, async (tx) => {
    const prof = await loadProfile(tx, profileId);
    if (!prof) return null;
    const [{ today }] = await tx<{ today: string }[]>`select private.local_today()::text as today`;
    const t = await dayView(tx, profileId, prof, today);
    const p = await progress(tx, profileId);
    const newBadges = await awardBadges(tx, profileId, prof.classId, p);
    return {
      today: t, streak: p.streak, streakAlive: p.streak > 0, progress: p,
      vows: await vowsFor(tx, profileId), newBadges,
    };
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
        if (input.value > 0) keep = { done: true, value: input.value, choice: null }; // a counter: the first one counts, no upper limit
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
    const days = await tx<{ date: string; core_total: number; core_done: number; any_done: number; attendance: AttendanceStatus | null }[]>`
      select d.d::date::text as date,
        (select count(*) from public.niyams n left join public.niyam_logs l on l.niyam_id = n.id and l.profile_id = ${profileId} and l.log_date = d.d::date
          where n.is_core and ${onHistoryList(tx, prof.classId)})::int as core_total,
        (select count(*) from public.niyam_logs l join public.niyams n on n.id = l.niyam_id
          where l.profile_id = ${profileId} and l.log_date = d.d::date and l.done and n.is_core)::int as core_done,
        (select count(*) from public.niyam_logs l where l.profile_id = ${profileId} and l.log_date = d.d::date and l.done)::int as any_done,
        (select at.status from public.attendance at where at.profile_id = ${profileId} and at.day = d.d::date
          and not exists (select 1 from public.sangh_holidays h where h.sangh_id = at.sangh_id and h.day = at.day)) as attendance
      from generate_series(${month + "-01"}::date, least((${month + "-01"}::date + interval '1 month - 1 day')::date, private.local_today()), interval '1 day') as d(d)
      order by d.d desc`;
    const [m] = await tx<{ today: string; first: string }[]>`
      select private.local_today()::text as today,
        to_char(least((select created_at at time zone 'Asia/Kolkata' from public.profiles where id = ${profileId}),
                      coalesce((select min(log_date) from public.niyam_logs where profile_id = ${profileId}), private.local_today())), 'YYYY-MM') as first`;
    const out: HistoryDay[] = days.map((r) => ({ date: r.date, coreDone: r.core_done, coreTotal: r.core_total, anyDone: r.any_done, attendance: r.attendance }));
    const att = { present: 0, late: 0, absent: 0 };
    for (const d of out) if (d.attendance) att[d.attendance]++;
    return { month, today: m.today, days: out, firstMonth: m.first, attendance: att.present + att.late + att.absent ? att : null };
  });
}

/** History's per-day list ignores the date's weekday rules only for the count; the day view applies them fully. */
const onHistoryList = (tx: Tx, classId: string | null) => tx`
  (n.status = 'active' or l.niyam_id is not null)
  and (n.all_classes or exists (select 1 from public.niyam_classes nc where nc.niyam_id = n.id and nc.class_id = ${classId}))
  and (n.schedule = 'daily'
    or (n.schedule = 'weekdays' and extract(dow from d.d::date)::int = any(n.weekdays))
    or (n.schedule = 'range' and d.d::date between n.start_date and n.end_date)
    or (n.schedule = 'dates' and d.d::date = any(n.dates)))`;

export async function getHistoryDay(accountId: string, profileId: string, date: string): Promise<HistoryDayResponse | null> {
  return asAccount(accountId, async (tx) => {
    const prof = await loadProfile(tx, profileId);
    if (!prof) return null;
    const day = await dayView(tx, profileId, prof, date);
    const [{ y }] = await tx<{ y: boolean }[]>`select ${date}::date = private.local_today() - 1 as y`;
    return { day, isYesterday: y };
  });
}
