import "server-only";
import webpush from "web-push";
import { config } from "./config";
import { sql } from "./db";
import { log } from "./log";
import { CITIES, clock, sunTimes } from "@/lib/sun";

// Reminders by web push: at most 2 a day per phone. An evening nudge at the time the member picks,
// sent only if nothing is logged yet that day, and an optional "Chauvihar in 30 minutes".
// A job calls sendReminders() every 15 minutes (see /api/cron/remind and docs/SETUP.md Part I).
// Only the server reads private.push_subs; each row is checked against the session's account.

export type PushSettings = { remindAt: string; chauvihar: boolean };
export type Subscription = { endpoint: string; keys: { p256dh: string; auth: string } };

const MAX_PER_ACCOUNT = 10;
/** The evening nudge may go out up to this long after the chosen time (a late or missed run still sends). */
const EVENING_GRACE_MIN = 120;
const CHAUVIHAR_BEFORE_MIN = 30;

export async function saveSubscription(accountId: string, profileId: string, sub: Subscription, s: PushSettings): Promise<boolean> {
  return sql().begin(async (tx) => {
    const [p] = await tx`select 1 from public.profiles where id = ${profileId} and account_id = ${accountId} and removed_at is null`;
    if (!p) return false;
    // A phone that logs in with another number takes its subscription along.
    await tx`delete from private.push_subs where endpoint = ${sub.endpoint} and account_id <> ${accountId}`;
    await tx`
      insert into private.push_subs (account_id, profile_id, endpoint, p256dh, auth, remind_at, chauvihar)
      values (${accountId}, ${profileId}, ${sub.endpoint}, ${sub.keys.p256dh}, ${sub.keys.auth}, ${s.remindAt}::time, ${s.chauvihar})
      on conflict (endpoint) do update set profile_id = excluded.profile_id, p256dh = excluded.p256dh, auth = excluded.auth,
        remind_at = excluded.remind_at, chauvihar = excluded.chauvihar, fails = 0`;
    await tx`
      delete from private.push_subs where account_id = ${accountId} and id not in (
        select id from private.push_subs where account_id = ${accountId} order by created_at desc limit ${MAX_PER_ACCOUNT})`;
    return true;
  });
}

export async function getSubscription(accountId: string, endpoint: string): Promise<PushSettings | null> {
  const [r] = await sql()<{ remind_at: string; chauvihar: boolean }[]>`
    select to_char(remind_at, 'HH24:MI') as remind_at, chauvihar from private.push_subs where account_id = ${accountId} and endpoint = ${endpoint}`;
  return r ? { remindAt: r.remind_at, chauvihar: r.chauvihar } : null;
}

export async function removeSubscription(accountId: string, endpoint: string): Promise<void> {
  await sql()`delete from private.push_subs where account_id = ${accountId} and endpoint = ${endpoint}`;
}

type Due = {
  id: string; endpoint: string; p256dh: string; auth: string; kind: "evening" | "chauvihar";
  name: string; lat: number | null; lon: number | null; city: string;
};

type Message = { title: string; body: string; url: string; tag: string };

function place(r: Due): { lat: number; lon: number } | null {
  if (r.lat !== null && r.lon !== null) return { lat: r.lat, lon: r.lon };
  const c = CITIES.find((x) => x.name.toLowerCase() === r.city.trim().toLowerCase());
  return c ? { lat: c.lat, lon: c.lon } : null;
}

/**
 * Sends the reminders that are due now. Safe to call often and from two places at once: each row is
 * claimed (its date set) in the same statement that picks it, so a reminder goes out at most once a day.
 */
export async function sendReminders(now = new Date()): Promise<{ sent: number; skipped: number; failed: number }> {
  const c = config();
  if (!c.pushEnabled) return { sent: 0, skipped: 0, failed: 0 };
  webpush.setVapidDetails(c.VAPID_SUBJECT, c.VAPID_PUBLIC_KEY!, c.VAPID_PRIVATE_KEY!);
  const at = now.toISOString();

  // Evening: the chosen time has passed (within the grace window), not sent today, and nothing logged today.
  const evening = await sql()<Due[]>`
    with t as (select (${at}::timestamptz at time zone 'Asia/Kolkata') as local),
    picked as (
      select s.id from private.push_subs s, t
      where s.fails < 5
        and (s.last_evening is null or s.last_evening < t.local::date)
        and t.local::time >= s.remind_at
        and t.local::time < s.remind_at + make_interval(mins => ${EVENING_GRACE_MIN})
        and not exists (select 1 from public.niyam_logs l where l.profile_id = s.profile_id and l.done and l.log_date = t.local::date)
      order by s.remind_at
      limit ${c.REMIND_BATCH}
      for update of s skip locked)
    update private.push_subs s set last_evening = (select local::date from t)
    from picked, public.profiles p, public.accounts a, public.sanghs g
    where s.id = picked.id and p.id = s.profile_id and p.removed_at is null and a.id = s.account_id and a.removed_at is null and g.id = a.sangh_id
    returning s.id, s.endpoint, s.p256dh, s.auth, 'evening' as kind, p.name, g.lat, g.lon, g.city`;

  // Chauvihar: candidates who asked for it and haven't had it today; the sunset check is done here.
  const candidates = await sql()<(Due & { local_date: string; local_min: number })[]>`
    select s.id, s.endpoint, s.p256dh, s.auth, 'chauvihar' as kind, p.name, g.lat, g.lon, g.city,
      (${at}::timestamptz at time zone 'Asia/Kolkata')::date::text as local_date,
      (extract(hour from ${at}::timestamptz at time zone 'Asia/Kolkata') * 60 + extract(minute from ${at}::timestamptz at time zone 'Asia/Kolkata'))::int as local_min
    from private.push_subs s
    join public.profiles p on p.id = s.profile_id and p.removed_at is null
    join public.accounts a on a.id = s.account_id and a.removed_at is null
    join public.sanghs g on g.id = a.sangh_id
    where s.chauvihar and s.fails < 5
      and (s.last_chauvihar is null or s.last_chauvihar < (${at}::timestamptz at time zone 'Asia/Kolkata')::date)
    limit ${c.REMIND_BATCH * 4}`;
  const chauvihar: (Due & { sunset: number })[] = [];
  for (const r of candidates) {
    const pl = place(r);
    const sun = pl && sunTimes(r.local_date, pl.lat, pl.lon);
    if (!sun) continue;
    if (r.local_min >= sun.sunset - CHAUVIHAR_BEFORE_MIN && r.local_min < sun.sunset) chauvihar.push({ ...r, sunset: sun.sunset });
    if (chauvihar.length >= c.REMIND_BATCH) break;
  }
  if (chauvihar.length) {
    // Claim them; another run that got here first wins and this one skips those rows.
    const claimed = await sql()<{ id: string }[]>`
      update private.push_subs set last_chauvihar = (${at}::timestamptz at time zone 'Asia/Kolkata')::date
      where id = any(${sql().array(chauvihar.map((r) => r.id))}::uuid[])
        and (last_chauvihar is null or last_chauvihar < (${at}::timestamptz at time zone 'Asia/Kolkata')::date)
      returning id`;
    const ok = new Set(claimed.map((r) => r.id));
    for (let i = chauvihar.length - 1; i >= 0; i--) if (!ok.has(chauvihar[i].id)) chauvihar.splice(i, 1);
  }

  const jobs: [Due, Message][] = [
    ...evening.map((r): [Due, Message] => [r, {
      title: "Your niyams are waiting", body: `${r.name.split(/\s+/)[0]}, take a moment to log today's niyams. Jai Jinendra.`,
      url: "/home", tag: "evening",
    }]),
    ...chauvihar.map((r): [Due, Message] => [r, {
      title: "Chauvihar soon", body: `Sunset is at ${clock(r.sunset)}. Chauvihar in ${CHAUVIHAR_BEFORE_MIN} minutes.`,
      url: "/home", tag: "chauvihar",
    }]),
  ];

  let sent = 0, failed = 0;
  const gone: string[] = [], flaky: string[] = [];
  // A few at a time, so one slow push service doesn't hold up the rest.
  for (let i = 0; i < jobs.length; i += 20) {
    await Promise.all(jobs.slice(i, i + 20).map(async ([r, m]) => {
      try {
        await webpush.sendNotification({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }, JSON.stringify(m), { TTL: 3600, timeout: 8000 });
        sent++;
      } catch (e) {
        failed++;
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) gone.push(r.id); else flaky.push(r.id);
      }
    }));
  }
  if (gone.length) await sql()`delete from private.push_subs where id = any(${sql().array(gone)}::uuid[])`;
  if (flaky.length) await sql()`update private.push_subs set fails = fails + 1 where id = any(${sql().array(flaky)}::uuid[])`;
  const skipped = candidates.length - chauvihar.length;
  if (sent || failed) log.info("reminders", { sent, failed, removed: gone.length });
  return { sent, skipped, failed };
}
