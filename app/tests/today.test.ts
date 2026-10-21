// The student side, checked where the rules live: logging, the window, the streak and who sees what.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "@/server/db";
import { createProfile, findSanghByCode, joinSangh } from "@/server/onboarding";
import { getHistory, getToday, setLog } from "@/server/today";

let n = 0;
const phone = () => `+9196${String(Date.now() % 1e6).padStart(6, "0")}${String(n++ % 100).padStart(2, "0")}`;
let heer: string, shan: string;
let today: string;
const day = async (back: number) => (await sql()<{ d: string }[]>`select (private.local_today() - ${back}::int)::text as d`)[0].d;

beforeAll(async () => {
  heer = (await findSanghByCode("HEER01"))!.id;
  shan = (await findSanghByCode("SHAN01"))!.id;
  today = await day(0);
});
afterAll(async () => { await sql().end(); });

async function member(sanghId = heer) {
  const p = phone();
  const r = await joinSangh(p, sanghId);
  if (r.kind === "closed") throw new Error("closed");
  const prof = await createProfile(r.accountId, p, { name: "Member", relation: "self", consent: false });
  if (!prof.ok) throw new Error("profile");
  return { accountId: r.accountId, profileId: prof.profile.id };
}
const niyamByType = async (type: string) =>
  (await sql()<{ id: string }[]>`select id from public.niyams where sangh_id = ${heer} and type = ${type} and status = 'active' limit 1`)[0].id;

/** Writes an old log directly, as the seed does, with the window check set aside. */
async function oldLog(profileId: string, niyamId: string, back: number) {
  await sql().begin(async (tx) => {
    await tx`alter table public.niyam_logs disable trigger niyam_logs_window`;
    await tx`insert into public.niyam_logs (profile_id, niyam_id, log_date, done) values (${profileId}, ${niyamId}, private.local_today() - ${back}::int, true)`;
    await tx`alter table public.niyam_logs enable trigger niyam_logs_window`;
  });
}

describe("logging", () => {
  it("yes/no: one tap logs, another undoes, and a repeat never counts twice", async () => {
    const m = await member();
    const id = await niyamByType("yesno");
    for (let i = 0; i < 3; i++) await setLog(m.accountId, m.profileId, { niyamId: id, date: today });
    const rows = await sql()`select 1 from public.niyam_logs where profile_id = ${m.profileId} and niyam_id = ${id}`;
    expect(rows).toHaveLength(1);
    const t = await getToday(m.accountId, m.profileId);
    expect(t!.today.niyams.find((x) => x.id === id)!.done).toBe(true);
    await setLog(m.accountId, m.profileId, { niyamId: id, date: today, done: false });
    expect(await sql()`select 1 from public.niyam_logs where profile_id = ${m.profileId}`).toHaveLength(0);
  });

  it("count and minutes: below the target is saved but not done; reaching it is done", async () => {
    const m = await member();
    const id = await niyamByType("count");
    const part = await setLog(m.accountId, m.profileId, { niyamId: id, date: today, value: 5 });
    expect(part.ok && part.niyam).toMatchObject({ value: 5, done: false });
    const full = await setLog(m.accountId, m.profileId, { niyamId: id, date: today, value: 108 });
    expect(full.ok && full.niyam.done).toBe(true);
    await setLog(m.accountId, m.profileId, { niyamId: id, date: today, value: 0 });
    expect(await sql()`select 1 from public.niyam_logs where profile_id = ${m.profileId}`).toHaveLength(0);
  });

  it("choice: only the admin's options are accepted", async () => {
    const m = await member();
    const id = await niyamByType("choice");
    expect(await setLog(m.accountId, m.profileId, { niyamId: id, date: today, choice: "feast" })).toEqual({ ok: false, reason: "invalid_choice" });
    const ok = await setLog(m.accountId, m.profileId, { niyamId: id, date: today, choice: "upvas" });
    expect(ok.ok && ok.niyam).toMatchObject({ choice: "upvas", done: true });
  });

  it("a niyam of another sangh is not found", async () => {
    const m = await member(shan);
    const id = await niyamByType("yesno"); // belongs to HEER01
    expect(await setLog(m.accountId, m.profileId, { niyamId: id, date: today })).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("the logging window", () => {
  it("yesterday can be filled in and cleared; two days ago can be neither", async () => {
    const m = await member();
    const id = await niyamByType("yesno");
    expect((await setLog(m.accountId, m.profileId, { niyamId: id, date: await day(1) })).ok).toBe(true);
    expect((await setLog(m.accountId, m.profileId, { niyamId: id, date: await day(1), done: false })).ok).toBe(true);
    expect(await setLog(m.accountId, m.profileId, { niyamId: id, date: await day(2) })).toEqual({ ok: false, reason: "log_window_closed" });
    await oldLog(m.profileId, id, 2);
    expect(await setLog(m.accountId, m.profileId, { niyamId: id, date: await day(2), done: false })).toEqual({ ok: false, reason: "log_window_closed" });
    expect(await sql()`select 1 from public.niyam_logs where profile_id = ${m.profileId}`).toHaveLength(1);
  });

  it("tomorrow is never allowed", async () => {
    const m = await member();
    const id = await niyamByType("yesno");
    expect(await setLog(m.accountId, m.profileId, { niyamId: id, date: await day(-1) })).toEqual({ ok: false, reason: "log_window_closed" });
  });

  it("yesterday disappears from Today when the pathshala allows no catch-up", async () => {
    const m = await member();
    expect((await getToday(m.accountId, m.profileId))!.yesterday).not.toBeNull();
    await sql()`update public.sanghs set log_back_hours = 0 where id = ${heer}`;
    try {
      expect((await getToday(m.accountId, m.profileId))!.yesterday).toBeNull();
    } finally {
      await sql()`update public.sanghs set log_back_hours = 24 where id = ${heer}`;
    }
  });
});

describe("streak", () => {
  it("counts days in a row with at least one niyam done", async () => {
    const m = await member();
    const id = await niyamByType("yesno");
    expect((await getToday(m.accountId, m.profileId))!.streak).toBe(0);
    await oldLog(m.profileId, id, 3);
    await oldLog(m.profileId, id, 2);
    expect((await getToday(m.accountId, m.profileId))!.streak).toBe(0); // broken: yesterday and today are empty
    await setLog(m.accountId, m.profileId, { niyamId: id, date: await day(1) });
    expect((await getToday(m.accountId, m.profileId))!.streak).toBe(3);
    await setLog(m.accountId, m.profileId, { niyamId: id, date: today });
    expect((await getToday(m.accountId, m.profileId))!.streak).toBe(4);
  });

  it("a part-filled count does not count as a day", async () => {
    const m = await member();
    await setLog(m.accountId, m.profileId, { niyamId: await niyamByType("count"), date: today, value: 3 });
    expect((await getToday(m.accountId, m.profileId))!.streak).toBe(0);
  });
});

describe("history", () => {
  it("shows the month newest first, up to today, with core counts", async () => {
    const m = await member();
    await setLog(m.accountId, m.profileId, { niyamId: await niyamByType("yesno"), date: today });
    const h = await getHistory(m.accountId, m.profileId, today.slice(0, 7));
    expect(h!.days[0]).toMatchObject({ date: today });
    expect(h!.days[0].anyDone).toBe(1);
    expect(h!.days.every((d, i, a) => i === 0 || d.date < a[i - 1].date)).toBe(true);
  });

  it("removing a person still deletes their logs, whatever the window", async () => {
    const m = await member();
    const id = await niyamByType("yesno");
    await oldLog(m.profileId, id, 5);
    await sql()`delete from public.profiles where id = ${m.profileId}`;
    expect(await sql()`select 1 from public.niyam_logs where profile_id = ${m.profileId}`).toHaveLength(0);
  });
});
