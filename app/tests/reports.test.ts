// Reports and dashboard alerts: counts are right, and a volunteer sees only their classes.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAdmin, sql } from "@/server/db";
import { createProfile, findSanghByCode, joinSangh } from "@/server/onboarding";
import { bestRun, getAlerts, getReport, getReportCards, membersCsv } from "@/server/admin/reports";
import { saveVolunteer } from "@/server/admin/volunteers";

let n = 0;
const phone = () => `+9191${String(Date.now() % 1e6).padStart(6, "0")}${String(n++ % 100).padStart(2, "0")}`;
let heer: string, classA: string, classB: string, niyam: string, today: string;
const admin = phone();

beforeAll(async () => {
  heer = (await findSanghByCode("HEER01"))!.id;
  await sql()`insert into public.sangh_admins (sangh_id, phone) values (${heer}, ${admin})`;
  [classA, classB] = (await sql()`select id from public.classes where sangh_id = ${heer} order by sort_order limit 2`).map((r) => r.id);
  [{ id: niyam }] = await sql()`select id from public.niyams where sangh_id = ${heer} and status = 'active' and type = 'yesno' and all_classes limit 1`;
  [{ today }] = await sql()`select private.local_today()::text as today`;
});
afterAll(async () => { await sql().end(); });

async function member(classId: string, name: string, joinedDaysAgo = 0) {
  const p = phone();
  const r = await joinSangh(p, heer);
  if (r.kind === "closed") throw new Error("closed");
  const prof = await createProfile(r.accountId, p, { name, relation: "self", consent: false });
  if (!prof.ok) throw new Error("profile");
  await sql()`update public.profiles set class_id = ${classId}, created_at = now() - make_interval(days => ${joinedDaysAgo}) where id = ${prof.profile.id}`;
  return prof.profile.id;
}
const logToday = (id: string) => sql()`insert into public.niyam_logs (profile_id, niyam_id, log_date, done) values (${id}, ${niyam}, ${today}, true)`;

describe("reports", () => {
  it("best streak is the longest run of days", () => {
    expect(bestRun([])).toBe(0);
    expect(bestRun([1, 2, 3, 5, 6])).toBe(3);
    expect(bestRun([4, 9, 10, 11, 12])).toBe(4);
  });

  it("counts today's loggers, the top list and niyam totals", async () => {
    const a = await member(classA, "Report Regular");
    await logToday(a);
    const r = await getReport(admin, heer, { days: 7, classId: classA });
    expect(r.trend).toHaveLength(7);
    expect(r.trend[6].day).toBe(today);
    expect(r.trend[6].logged).toBeGreaterThanOrEqual(1);
    expect(r.top.some((p) => p.id === a)).toBe(true);
    expect(r.niyams.find((x) => x.id === niyam)!.done).toBeGreaterThanOrEqual(1);
    expect(r.newJoins).toBeGreaterThanOrEqual(1);
  });

  it("a volunteer's report covers only their classes", async () => {
    const b = await member(classB, "Report Other Class");
    await logToday(b);
    const t = phone();
    expect(await saveVolunteer(admin, heer, { phone: t, name: "A teacher", classIds: [classA], perms: ["view_members"] })).toBe("ok");
    const r = await getReport(t, heer, { days: 7, classId: null });
    expect(r.top.some((p) => p.id === b)).toBe(false);
    expect(r.classes.map((c) => c.id)).toEqual([classA]);
    expect(await getReportCards(t, heer, classB, today.slice(0, 7))).toBeNull();
  });

  it("alerts list people quiet for 3 days, not people who just joined", async () => {
    const quiet = await member(classA, "Zz Quiet Person", 5);
    const fresh = await member(classA, "Zz Fresh Person", 0);
    const al = await asAdmin(admin, (tx) => getAlerts(tx, heer));
    expect(al.quiet).toBeGreaterThanOrEqual(1);
    const [{ names }] = await sql()`select array_agg(name) as names from public.profiles where id in (${quiet}, ${fresh})`;
    expect(names).toHaveLength(2);
    await logToday(quiet);
    const after = await asAdmin(admin, (tx) => getAlerts(tx, heer));
    expect(after.quiet).toBe(al.quiet - 1);
  });

  it("report cards and the member CSV", async () => {
    const a = await member(classA, "Card Person");
    await logToday(a);
    const cards = (await getReportCards(admin, heer, classA, today.slice(0, 7)))!;
    const c = cards.cards.find((x) => x.name === "Card Person")!;
    expect(c).toMatchObject({ daysLogged: 1, kept: 1, bestStreak: 1, attendance: null });
    const csv = await membersCsv(admin, heer);
    expect(csv.split("\r\n")[0]).toContain('"Name","Class","Mobile"');
    expect(csv).toContain('"Card Person"');
  });

  it("a CSV cell can't run as a spreadsheet formula", async () => {
    await member(classA, "=HYPERLINK(1)");
    expect(await membersCsv(admin, heer)).toContain(`"'=HYPERLINK(1)"`);
  });
});
