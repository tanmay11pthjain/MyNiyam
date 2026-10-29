import "server-only";
import { asAccount, pgHint } from "./db";
import { announcementsFor, challengeTitles, loadProfile, toBadge } from "./today";
import { badgeInfo } from "@/lib/badges";
import type { BadgesResponse, BoardRow, FeedPost, GoalCard, SanghTabResponse } from "@/lib/today-types";

// P3 for members: personal vows, the Sangh tab (goals, class leaderboard, milestone feed with
// Anumodana) and badges. Runs as the signed-in account; other members are read only through
// the database's sangh_feed, class_board and goal_progress functions, which stay in the sangh.

// ---------------------------------------------------------------------------
// Personal vows
// ---------------------------------------------------------------------------
export type VowResult = { ok: true } | { ok: false; reason: "not_found" | "vow_limit" | "bad_request" | "log_window_closed" };

export async function addVow(accountId: string, profileId: string, name: string, endDate: string): Promise<VowResult> {
  try {
    return await asAccount(accountId, async (tx) => {
      if (!(await loadProfile(tx, profileId))) return { ok: false as const, reason: "not_found" as const };
      const [ok] = await tx<{ ok: boolean }[]>`select ${endDate}::date between private.local_today() and private.local_today() + 366 as ok`;
      if (!ok.ok) return { ok: false as const, reason: "bad_request" as const };
      await tx`insert into public.vows (profile_id, name, end_date) values (${profileId}, ${name}, ${endDate}::date)`;
      return { ok: true as const };
    });
  } catch (e) {
    if (pgHint(e) === "vow_limit") return { ok: false, reason: "vow_limit" };
    throw e;
  }
}

/** Ticks (or unticks) a vow for today or yesterday, or ends it early. */
export async function changeVow(accountId: string, vowId: string, change: { date: string; done: boolean } | { end: true }): Promise<VowResult> {
  try {
    return await asAccount(accountId, async (tx) => {
      const [v] = await tx`select id from public.vows where id = ${vowId} and ended_at is null`;
      if (!v) return { ok: false as const, reason: "not_found" as const };
      if ("end" in change) await tx`update public.vows set ended_at = now() where id = ${vowId}`;
      else if (change.done) await tx`insert into public.vow_logs (vow_id, log_date) values (${vowId}, ${change.date}::date) on conflict do nothing`;
      else await tx`delete from public.vow_logs where vow_id = ${vowId} and log_date = ${change.date}::date and log_date >= private.local_today() - 1`;
      return { ok: true as const };
    });
  } catch (e) {
    if (pgHint(e) === "log_window_closed") return { ok: false, reason: "log_window_closed" };
    throw e;
  }
}

// ---------------------------------------------------------------------------
// The Sangh tab
// ---------------------------------------------------------------------------
const unitFor = (type: string) => (type === "count" ? "counted" : type === "duration" ? "minutes" : "times kept");

export async function getSanghTab(accountId: string, profileId: string): Promise<SanghTabResponse | null> {
  return asAccount(accountId, async (tx) => {
    const prof = await loadProfile(tx, profileId);
    if (!prof) return null;

    // Goals: running ones, those starting soon, and those that ended in the last 7 days.
    const goals = await tx<{
      id: string; kind: "total" | "challenge"; title: string; title_hi: string | null; niyam: string; type: string;
      target: number | null; days: number | null; start_date: string; end_date: string; state: GoalCard["state"];
      total: string; finishers: number; mine: number;
    }[]>`
      select g.id, g.kind, g.title, g.title_hi, n.name as niyam, n.type, g.target, g.days, g.start_date::text, g.end_date::text,
        case when private.local_today() < g.start_date then 'upcoming' when private.local_today() > g.end_date then 'ended' else 'live' end as state,
        gp.total, gp.finishers,
        (select count(*)::int from public.niyam_logs l where l.profile_id = ${profileId} and l.niyam_id = g.niyam_id and l.done
           and l.log_date between g.start_date and g.end_date) as mine
      from public.sangh_goals g join public.niyams n on n.id = g.niyam_id
      cross join lateral public.goal_progress(g.id) gp
      where g.sangh_id = private.current_sangh_id()
        and (g.all_classes or ${prof.classId}::uuid = any(g.class_ids))
        and g.end_date >= private.local_today() - 7 and g.start_date <= private.local_today() + 30
      order by (private.local_today() > g.end_date), g.end_date
      limit 10`;

    const board = await tx<{ rank: number; name: string; points: number; days: number; me: boolean }[]>`select * from public.class_board(${profileId})`;
    const [cls] = prof.classId ? await tx<{ name: string; leaderboard: boolean }[]>`select name, leaderboard from public.classes where id = ${prof.classId}` : [];

    const feedRows = await tx<{ id: string; badge: string; earned_at: Date; name: string; mine: boolean; count: number; my_msg: number | null }[]>`
      select * from public.sangh_feed(${profileId})`;
    const titles = await challengeTitles(tx, feedRows.map((r) => r.badge));

    const rows: BoardRow[] = board.map((r) => ({ rank: r.rank, name: r.name, points: r.points, days: r.days, me: r.me }));
    const feed: FeedPost[] = feedRows.map((r) => {
      const b = badgeInfo(r.badge, titles.get(r.badge));
      return { id: Number(r.id), badge: r.badge, en: b.en, hi: b.hi, mark: b.mark, name: r.name, mine: r.mine, at: new Date(r.earned_at).toISOString(), count: r.count, myMsg: r.my_msg };
    });
    return {
      goals: goals.map((g) => ({
        id: g.id, kind: g.kind, title: g.title, titleHi: g.title_hi, niyam: g.niyam, target: g.target, days: g.days,
        startDate: g.start_date, endDate: g.end_date, state: g.state, total: Number(g.total), finishers: g.finishers,
        mine: g.kind === "challenge" ? g.mine : null, unit: unitFor(g.type),
      })),
      board: cls?.leaderboard ? {
        className: cls.name,
        // The top 10 who earned Tej this week, and where this person stands.
        rows: rows.filter((r) => r.points > 0).slice(0, 10),
        me: rows.find((r) => r.me) ?? null,
      } : null,
      feed,
      announcements: await announcementsFor(tx, profileId, prof),
    };
  });
}

/** Sends (msg 0-3), changes or takes back (msg null) this person's Anumodana on a milestone in their sangh. */
export async function sendAnumodana(accountId: string, profileId: string, badgeId: number, msg: number | null): Promise<boolean> {
  return asAccount(accountId, async (tx) => {
    if (!(await loadProfile(tx, profileId))) return false;
    if (msg === null) {
      await tx`delete from public.anumodana where badge_id = ${badgeId} and from_profile = ${profileId}`;
      return true;
    }
    // The policy refuses a milestone from another sangh; check first so that is a 404, not an error.
    const [b] = await tx`select 1 from public.sangh_feed(${profileId}) f where f.id = ${badgeId} and not f.mine`;
    if (!b) return false;
    await tx`
      insert into public.anumodana (badge_id, from_profile, msg) values (${badgeId}, ${profileId}, ${msg})
      on conflict (badge_id, from_profile) do update set msg = excluded.msg, at = now()`;
    return true;
  });
}

// ---------------------------------------------------------------------------
// Badges and sharing choices
// ---------------------------------------------------------------------------
export async function getBadges(accountId: string, profileId: string): Promise<BadgesResponse | null> {
  return asAccount(accountId, async (tx) => {
    const [p] = await tx<{ share_milestones: boolean; board_initials: boolean }[]>`
      select share_milestones, board_initials from public.profiles where id = ${profileId} and removed_at is null`;
    if (!p) return null;
    const rows = await tx<{ badge: string; earned_at: Date }[]>`
      select badge, earned_at from public.badges_earned where profile_id = ${profileId} order by earned_at desc`;
    const titles = await challengeTitles(tx, rows.map((r) => r.badge));
    return {
      badges: rows.map((r) => toBadge(r.badge, r.earned_at, titles)),
      prefs: { shareMilestones: p.share_milestones, boardInitials: p.board_initials },
    };
  });
}

export async function setSharePrefs(accountId: string, profileId: string, prefs: { shareMilestones?: boolean; boardInitials?: boolean }): Promise<boolean> {
  const row: Record<string, boolean> = {};
  if (prefs.shareMilestones !== undefined) row.share_milestones = prefs.shareMilestones;
  if (prefs.boardInitials !== undefined) row.board_initials = prefs.boardInitials;
  if (!Object.keys(row).length) return true;
  const r = await asAccount(accountId, (tx) => tx`update public.profiles set ${tx(row)} where id = ${profileId} and removed_at is null returning id`);
  return r.length > 0;
}
