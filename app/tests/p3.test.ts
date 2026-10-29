// P3: vows, badges and the Sangh feed, Anumodana, goals and challenges, the class leaderboard,
// streak repair and reminders. Checked where the rules live: the server and the database.
import { getBoard } from "@/server/admin/leaderboard";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const pushed = vi.hoisted(() => [] as { endpoint: string; body: string }[]);
vi.mock("web-push", () => ({
  default: {
    setVapidDetails: () => {},
    sendNotification: async (sub: { endpoint: string }, body: string) => {
      if (sub.endpoint.includes("gone")) throw Object.assign(new Error("gone"), { statusCode: 410 });
      pushed.push({ endpoint: sub.endpoint, body });
    },
  },
}));

import { sql } from "@/server/db";
import { createProfile, findSanghByCode, joinSangh, setupProfile } from "@/server/onboarding";
import { getProgress, getToday, repairStreak } from "@/server/today";
import { addVow, changeVow, getBadges, getSanghTab, sendAnumodana, setSharePrefs } from "@/server/engage";
import { deleteGoal, getGoals, goalInput, saveGoal } from "@/server/admin/goals";
import { updateClass } from "@/server/admin/classes";
import { saveSubscription, sendReminders } from "@/server/push";
import { repairOffer, walkStreak } from "@/lib/progress";
import { earnedBadges } from "@/lib/badges";

let n = 0;
const phone = () => `+9193${String(Date.now() % 1e6).padStart(6, "0")}${String(n++ % 100).padStart(2, "0")}`;
let heer: string, shan: string, cls: string[], niyam: string, countNiyam: string, today: string;
const admin = phone();
const day = async (back: number) => (await sql()<{ d: string }[]>`select (private.local_today() - ${back}::int)::text as d`)[0].d;

beforeAll(async () => {
  heer = (await findSanghByCode("HEER01"))!.id;
  shan = (await findSanghByCode("SHAN01"))!.id;
  await sql()`insert into public.sangh_admins (sangh_id, phone) values (${heer}, ${admin})`;
  cls = (await sql()<{ id: string }[]>`select id from public.classes where sangh_id = ${heer} order by sort_order limit 2`).map((r) => r.id);
  niyam = (await sql()<{ id: string }[]>`select id from public.niyams where sangh_id = ${heer} and type = 'yesno' and status = 'active' and all_classes and schedule = 'daily' limit 1`)[0].id;
  countNiyam = (await sql()<{ id: string }[]>`select id from public.niyams where sangh_id = ${heer} and type = 'count' and status = 'active' and all_classes and schedule = 'daily' limit 1`)[0].id;
  today = await day(0);
});
afterAll(async () => { await sql().end(); });

async function member(name = "Riya Shah", classId: string | null = null, sanghId = heer) {
  const p = phone();
  const r = await joinSangh(p, sanghId);
  if (r.kind === "closed") throw new Error("closed");
  const prof = await createProfile(r.accountId, p, { name, relation: "self", consent: false });
  if (!prof.ok) throw new Error("profile");
  const c = classId ?? (sanghId === heer ? cls[0] : null);
  if (c) {
    const s = await setupProfile(r.accountId, prof.profile.id, c, {});
    if (!s.ok) await sql()`update public.profiles set class_id = ${c} where id = ${prof.profile.id}`;
  }
  return { accountId: r.accountId, profileId: prof.profile.id };
}

/** Writes logs for days in the past directly, with the window check set aside (as the seed does). */
async function logDays(profileId: string, backs: number[], niyamId = niyam, value: number | null = null) {
  await sql().begin(async (tx) => {
    await tx`alter table public.niyam_logs disable trigger niyam_logs_window`;
    for (const b of backs) {
      await tx`insert into public.niyam_logs (profile_id, niyam_id, log_date, done, value)
        values (${profileId}, ${niyamId}, private.local_today() - ${b}::int, true, ${value}) on conflict do nothing`;
    }
    await tx`alter table public.niyam_logs enable trigger niyam_logs_window`;
  });
}

describe("streak repair (rules)", () => {
  const d = (n: number) => new Date(Date.parse("2026-10-20T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
  it("offers to make up for yesterday when it brings back a streak of 3 or more", () => {
    const kept = [d(-5), d(-4), d(-3), d(-2)]; // missed d(-1), today open
    expect(walkStreak(kept, d(0)).streak).toBe(0);
    expect(repairOffer(kept, d(0))).toEqual({ missed: d(-1), streak: 4 });
    expect(walkStreak(kept, d(0), [d(-1)]).streak).toBe(4);
  });
  it("offers nothing for a short streak, a day 3 back, or two missed days in a row", () => {
    expect(repairOffer([d(-3), d(-2)], d(0))).toBeNull();
    expect(repairOffer([d(-6), d(-5), d(-4)], d(0))).toBeNull();
    expect(repairOffer([d(-7), d(-6), d(-5), d(-4), d(-3)], d(0))).toBeNull();
  });
});

describe("badges (rules)", () => {
  it("rewards streaks, days, Tej, tapasya firsts by name, attendance and challenges", () => {
    const got = earnedBadges({ best: 21, daysKept: 30, tej: 999, tapasyaNames: ["Ayambil आयंबिल", "Porsi"], fullAttendanceMonth: true, challengesDone: ["g1"] });
    expect(got).toEqual(["streak_7", "streak_21", "days_30", "first_ayambil", "attendance_month", "challenge:g1"]);
  });
});

describe("personal vows", () => {
  it("adds, ticks today and yesterday only, keeps 5 at most, and ends early", async () => {
    const m = await member();
    expect((await addVow(m.accountId, m.profileId, "No sweets until Diwali", await day(-10))).ok).toBe(true);
    expect(await addVow(m.accountId, m.profileId, "Bad date", await day(1))).toEqual({ ok: false, reason: "bad_request" });
    const t = await getToday(m.accountId, m.profileId);
    const v = t!.vows[0];
    expect(v).toMatchObject({ name: "No sweets until Diwali", doneToday: false });
    expect((await changeVow(m.accountId, v.id, { date: today, done: true })).ok).toBe(true);
    expect(await changeVow(m.accountId, v.id, { date: await day(3), done: true })).toEqual({ ok: false, reason: "log_window_closed" });
    expect((await getToday(m.accountId, m.profileId))!.vows[0]).toMatchObject({ doneToday: true, daysKept: 1 });
    for (let i = 0; i < 4; i++) await addVow(m.accountId, m.profileId, `Vow ${i}`, await day(-5));
    expect(await addVow(m.accountId, m.profileId, "Sixth", await day(-5))).toEqual({ ok: false, reason: "vow_limit" });
    expect((await changeVow(m.accountId, v.id, { end: true })).ok).toBe(true);
    expect((await getToday(m.accountId, m.profileId))!.vows).toHaveLength(4);
  });

  it("can't touch another family's vow", async () => {
    const a = await member(), b = await member();
    await addVow(a.accountId, a.profileId, "Mine", await day(-3));
    const [v] = await sql()`select id from public.vows where profile_id = ${a.profileId}`;
    expect(await changeVow(b.accountId, v.id, { date: today, done: true })).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("badges, the Sangh feed and Anumodana", () => {
  it("awards a 7-day streak once, shows it in the sangh's feed and nowhere else", async () => {
    const riya = await member("Riya Shah");
    await logDays(riya.profileId, [1, 2, 3, 4, 5, 6, 7]);
    const t1 = await getToday(riya.accountId, riya.profileId);
    expect(t1!.newBadges.map((b) => b.id)).toContain("streak_7");
    expect((await getToday(riya.accountId, riya.profileId))!.newBadges).toHaveLength(0);

    const friend = await member("Aarav Jain");
    const feed = (await getSanghTab(friend.accountId, friend.profileId))!.feed;
    const post = feed.find((p) => p.name === "Riya S." && p.badge === "streak_7");
    expect(post).toBeTruthy();
    expect(JSON.stringify(feed)).not.toContain("+91");

    const outsider = await member("Other", null, shan);
    expect((await getSanghTab(outsider.accountId, outsider.profileId))!.feed.find((p) => p.id === post!.id)).toBeUndefined();
    expect(await sendAnumodana(outsider.accountId, outsider.profileId, post!.id, 0)).toBe(false);

    // Anumodana: one per person, can change the message, can't send to yourself.
    expect(await sendAnumodana(friend.accountId, friend.profileId, post!.id, 1)).toBe(true);
    expect(await sendAnumodana(friend.accountId, friend.profileId, post!.id, 2)).toBe(true);
    expect(await sendAnumodana(riya.accountId, riya.profileId, post!.id, 0)).toBe(false);
    const again = (await getSanghTab(friend.accountId, friend.profileId))!.feed.find((p) => p.id === post!.id)!;
    expect(again).toMatchObject({ count: 1, myMsg: 2 });
    expect(await sendAnumodana(friend.accountId, friend.profileId, post!.id, null)).toBe(true);

    // Hidden from the feed when Riya turns sharing off (she still sees her own).
    await setSharePrefs(riya.accountId, riya.profileId, { shareMilestones: false });
    expect((await getSanghTab(friend.accountId, friend.profileId))!.feed.find((p) => p.id === post!.id)).toBeUndefined();
    expect((await getSanghTab(riya.accountId, riya.profileId))!.feed.find((p) => p.id === post!.id)).toBeTruthy();
    const mine = await getBadges(riya.accountId, riya.profileId);
    expect(mine!.prefs.shareMilestones).toBe(false);
    expect(mine!.badges.map((b) => b.id)).toContain("streak_7");
  });

  it("a member can't award themselves a badge for another family", async () => {
    const a = await member(), b = await member();
    const { asAccount } = await import("@/server/db");
    await expect(asAccount(a.accountId, (tx) => tx`insert into public.badges_earned (profile_id, badge) values (${b.profileId}, 'streak_108')`)).rejects.toThrow();
  });
});

describe("goals and challenges", () => {
  it("adds up everyone's counts for a total, and gives a challenge's badge to those who finish", async () => {
    const start = await day(5);
    const total = goalInput.parse({ kind: "total", title: "1 lakh Navkar", niyamId: countNiyam, target: 100000, startDate: start, endDate: await day(-20) });
    const challenge = goalInput.parse({ kind: "challenge", title: "3 days of Navkarsi", niyamId: niyam, days: 3, startDate: start, endDate: await day(-20) });
    expect(goalInput.safeParse({ ...challenge, days: 400 }).success).toBe(false);
    expect(await saveGoal(admin, heer, null, total)).toBeTruthy();
    const goals = await saveGoal(admin, heer, null, challenge);
    expect(Array.isArray(goals)).toBe(true);

    const a = await member("Meena Shah"), b = await member("Siya Shah");
    await logDays(a.profileId, [1, 2], countNiyam, 108);
    await logDays(b.profileId, [1], countNiyam, 27);
    await logDays(a.profileId, [1, 2, 3]);
    const tab = await getSanghTab(a.accountId, a.profileId);
    const g = tab!.goals.find((x) => x.title === "1 lakh Navkar")!;
    expect(g.total).toBeGreaterThanOrEqual(108 * 2 + 27);
    expect(tab!.goals.find((x) => x.title === "3 days of Navkarsi")).toMatchObject({ mine: 3, state: "live" });
    const t = await getToday(a.accountId, a.profileId);
    expect(t!.newBadges.some((x) => x.id.startsWith("challenge:") && x.en.includes("3 days of Navkarsi"))).toBe(true);

    // A niyam from another sangh is refused.
    const shanNiyam = (await sql()`select id from public.niyams where sangh_id = ${shan} limit 1`)[0]?.id;
    if (shanNiyam) expect(await saveGoal(admin, heer, null, { ...total, niyamId: shanNiyam })).toBeNull();

    const page = await getGoals(admin, heer);
    for (const x of page.goals) await deleteGoal(admin, heer, x.id);
    expect((await getGoals(admin, heer)).goals).toHaveLength(0);
  });

  it("a goal for one class is not shown to another class", async () => {
    const g = goalInput.parse({ kind: "total", title: "Class only", niyamId: niyam, target: 10, startDate: today, endDate: today, allClasses: false, classIds: [cls[1]] });
    await saveGoal(admin, heer, null, g);
    const a = await member("In Class0", cls[0]);
    const b = await member("In Class1", cls[1]);
    expect((await getSanghTab(a.accountId, a.profileId))!.goals.find((x) => x.title === "Class only")).toBeUndefined();
    expect((await getSanghTab(b.accountId, b.profileId))!.goals.find((x) => x.title === "Class only")).toBeTruthy();
  });
});

describe("class leaderboard", () => {
  it("is on by default and can be turned off; ranks days kept this week, with initials if chosen", async () => {
    const c = cls[1];
    const a = await member("Top Kid", c), b = await member("Second Kid", c);
    await logLocalWeek(a.profileId, 2);
    await logLocalWeek(b.profileId, 1);
    expect((await getSanghTab(a.accountId, a.profileId))!.board).not.toBeNull();
    await updateClass(admin, heer, c, { leaderboard: false });
    expect((await getSanghTab(a.accountId, a.profileId))!.board).toBeNull();
    await updateClass(admin, heer, c, { leaderboard: true });
    await setSharePrefs(b.accountId, b.profileId, { boardInitials: true });
    const board = (await getSanghTab(b.accountId, b.profileId))!.board!;
    expect(board.rows[0].days).toBeGreaterThanOrEqual(board.rows[board.rows.length - 1].days);
    expect(board.rows.some((r) => r.name === "Top K.")).toBe(true);
    expect(board.me).toMatchObject({ name: "S. K.", me: true });
    // The admin's view (for the top-3 poster): same names, no photo for someone showing initials.
    const ab = (await getBoard(admin, heer, c, "this"))!;
    expect(ab.rows[0]).toMatchObject({ rank: 1 });
    expect(ab.rows.find((r) => r.name === "S. K.")).toMatchObject({ photoUrl: null });
    expect((await getBoard(admin, heer, c, "last"))!.weekEnd < ab.weekStart).toBe(true);
  });
});

/** Logs `n` days of this week (Monday onwards, up to today). */
async function logLocalWeek(profileId: string, n: number) {
  const [{ dow }] = await sql()<{ dow: number }[]>`select extract(isodow from private.local_today())::int as dow`;
  const backs = Array.from({ length: Math.min(n, dow) }, (_, i) => i);
  await logDays(profileId, backs);
}

describe("streak repair (server)", () => {
  it("makes up for yesterday once, then not again for 30 days", async () => {
    const m = await member();
    await logDays(m.profileId, [2, 3, 4, 5]);
    const p = await getProgress(m.accountId, m.profileId);
    expect(p!.repair).toEqual({ missed: await day(1), streak: 4 });
    expect(await repairStreak(m.accountId, m.profileId, await day(3))).toBe("not_allowed");
    expect(await repairStreak(m.accountId, m.profileId, await day(1))).toBe("ok");
    const after = await getProgress(m.accountId, m.profileId);
    expect(after!.streak).toBe(4);
    expect(after!.repair).toBeNull();
  });
});

describe("reminders", () => {
  it("sends the evening nudge once a day, only if nothing is logged, and drops dead subscriptions", async () => {
    const a = await member("Evening Kid"), b = await member("Logged Kid"), c = await member("Gone Kid");
    const key = { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" };
    await saveSubscription(a.accountId, a.profileId, { endpoint: `https://push.example/${a.profileId}`, keys: key }, { remindAt: "19:00", chauvihar: false });
    await saveSubscription(b.accountId, b.profileId, { endpoint: `https://push.example/${b.profileId}`, keys: key }, { remindAt: "19:00", chauvihar: false });
    await saveSubscription(c.accountId, c.profileId, { endpoint: `https://push.example/gone/${c.profileId}`, keys: key }, { remindAt: "19:00", chauvihar: false });
    // b logged today, so no nudge for b.
    await logDays(b.profileId, [0]);
    process.env.VAPID_PUBLIC_KEY = "x"; process.env.VAPID_PRIVATE_KEY = "y";
    const { config } = await import("@/server/config");
    Object.assign(config(), { pushEnabled: true, VAPID_PUBLIC_KEY: "x", VAPID_PRIVATE_KEY: "y" });

    const at = new Date(`${today}T19:20:00+05:30`);
    pushed.length = 0;
    await sendReminders(at);
    const mine = pushed.filter((p) => [a.profileId, b.profileId, c.profileId].some((id) => p.endpoint.endsWith(id)));
    expect(mine.map((p) => p.endpoint)).toEqual([`https://push.example/${a.profileId}`]);
    expect(JSON.parse(mine[0].body).title).toBe("Your niyams are waiting");
    expect(await sql()`select 1 from private.push_subs where endpoint like ${"%gone/" + c.profileId}`).toHaveLength(0);

    pushed.length = 0;
    await sendReminders(new Date(`${today}T19:40:00+05:30`));
    expect(pushed.filter((p) => p.endpoint.endsWith(a.profileId))).toHaveLength(0);
    // Before the chosen time nothing goes out on another day either.
    await sql()`update private.push_subs set last_evening = null where profile_id = ${a.profileId}`;
    await sendReminders(new Date(`${today}T18:00:00+05:30`));
    expect(pushed.filter((p) => p.endpoint.endsWith(a.profileId))).toHaveLength(0);
  });
});
