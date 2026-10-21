// Admin panel rules, checked where they are enforced: in Postgres (policies, triggers, functions).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAccount, asAdmin, sql } from "@/server/db";
import { createProfile, findSanghByCode, getMe, joinSangh, searchSanghs, setupProfile } from "@/server/onboarding";
import { createClass, deleteClass, listClasses } from "@/server/admin/classes";
import { createNiyam } from "@/server/admin/niyams";
import { listMembers, removeFamily, removeProfile } from "@/server/admin/members";
import { requestSangh, superApprove, superCreateSangh } from "@/server/admin/sangh";
import { getDashboard } from "@/server/admin/dashboard";
import { saveForm } from "@/server/admin/form";

let n = 0;
const phone = () => `+9197${String(Date.now() % 1e6).padStart(6, "0")}${String(n++ % 100).padStart(2, "0")}`;
const noFilters = { q: "", classId: null, gender: null, age: null, inactive: false };

let heer: string, shan: string;
const heerAdmin = phone();
const shanAdmin = phone();
const SUPER = "+918431567935";

beforeAll(async () => {
  heer = (await findSanghByCode("HEER01"))!.id;
  shan = (await findSanghByCode("SHAN01"))!.id;
  await sql()`insert into public.sangh_admins (sangh_id, phone) values (${heer}, ${heerAdmin}), (${shan}, ${shanAdmin})`;
  await sql()`insert into private.super_admins (phone) values (${SUPER}) on conflict do nothing`;
});
afterAll(async () => { await sql().end(); });

async function member(sanghId = heer) {
  const p = phone();
  const r = await joinSangh(p, sanghId);
  if (r.kind === "closed") throw new Error("closed");
  const prof = await createProfile(r.accountId, p, { name: "Member", relation: "self", consent: false });
  if (!prof.ok) throw new Error("profile");
  return { phone: p, accountId: r.accountId, profileId: prof.profile.id };
}

describe("each admin sees only their own sangh", () => {
  it("reads nothing of another sangh", async () => {
    const m = await member(shan);
    await asAdmin(heerAdmin, async (tx) => {
      expect((await tx`select id from public.sanghs`).map((r) => r.id)).toEqual([heer]);
      expect(await tx`select id from public.accounts where sangh_id = ${shan}`).toHaveLength(0);
      expect(await tx`select id from public.profiles where id = ${m.profileId}`).toHaveLength(0);
      expect(await tx`select id from public.classes where sangh_id = ${shan}`).toHaveLength(0);
    });
    const list = await listMembers(heerAdmin, shan, noFilters); // asking for the other sangh by id
    expect(list.total).toBe(0);
    expect(await getDashboard(heerAdmin, shan)).toBeNull();
  });

  it("changes nothing in another sangh", async () => {
    await expect(asAdmin(heerAdmin, (tx) => tx`insert into public.classes (sangh_id, name) values (${shan}, 'Sneaky')`))
      .rejects.toMatchObject({ code: "42501" });
    const r = await asAdmin(heerAdmin, (tx) => tx`update public.sanghs set name = 'Hacked' where id = ${shan} returning id`);
    expect(r).toHaveLength(0);
    const m = await member(shan);
    expect(await removeFamily(heerAdmin, m.accountId)).toBe(false);
    expect(await removeProfile(heerAdmin, m.profileId)).toBe(false);
    await expect(asAdmin(heerAdmin, (tx) => tx`select public.admin_set_join_code(${shan}, 'ZZZZZ9')`)).rejects.toMatchObject({ code: "42501" });
  });

  it("a phone that admins nothing sees nothing; a member can't act as admin", async () => {
    await asAdmin(phone(), async (tx) => {
      expect(await tx`select id from public.sanghs`).toHaveLength(0);
      expect(await tx`select id from public.profiles`).toHaveLength(0);
    });
    const m = await member(heer);
    await asAccount(m.accountId, async (tx) => {
      expect(await tx`select id from public.accounts`).toHaveLength(1); // only itself
    });
    await expect(asAccount(m.accountId, (tx) => tx`select public.admin_remove_family(${m.accountId})`)).rejects.toMatchObject({ code: "42501" });
  });

  it("a niyam can't be given a class of another sangh", async () => {
    const [shanClass] = await sql()`select id from public.classes where sangh_id = ${shan}`;
    const [heerClass] = await sql()`select id from public.classes where sangh_id = ${heer}`;
    const base = { name: "Test", nameHi: null, type: "yesno" as const, target: null, options: [], icon: null, note: null,
      schedule: "daily" as const, weekdays: [], startDate: null, endDate: null, isCore: true };
    await expect(createNiyam(heerAdmin, heer, { ...base, allClasses: false, classIds: [shanClass.id] })).rejects.toBeTruthy();
    const ok = await createNiyam(heerAdmin, heer, { ...base, name: "Only Heer", allClasses: false, classIds: [heerClass.id] });
    expect(ok.find((x) => x.name === "Only Heer")?.classIds).toEqual([heerClass.id]);
  });
});

describe("a class with members can't be deleted", () => {
  it("refuses while someone is in it, allows it once empty", async () => {
    const created = await createClass(heerAdmin, heer, { name: `Guard ${Date.now()}`, nameHi: null, ageMin: null, ageMax: null });
    if (!created.ok) throw new Error("create");
    const cls = created.classes.find((c) => c.name.startsWith("Guard"))!;
    const m = await member(heer);
    await sql()`update public.profiles set class_id = ${cls.id} where id = ${m.profileId}`;
    expect(await deleteClass(heerAdmin, heer, cls.id)).toEqual({ ok: false, reason: "class_has_members" });
    await expect(sql()`delete from public.classes where id = ${cls.id}`).rejects.toMatchObject({ hint: "class_has_members" }); // even for the owner
    expect((await listClasses(heerAdmin, heer)).find((c) => c.id === cls.id)?.members).toBe(1);
    await sql()`update public.profiles set class_id = null where id = ${m.profileId}`;
    expect((await deleteClass(heerAdmin, heer, cls.id)).ok).toBe(true);
  });
});

describe("removing a family", () => {
  it("frees the number at once, hides the family, and deletes it after 30 days", async () => {
    const m = await member(heer);
    const [niyam] = await sql()`insert into public.niyams (sangh_id, name, type) values (${heer}, 'Remove test', 'yesno') returning id`;
    await asAccount(m.accountId, (tx) => tx`insert into public.niyam_logs (profile_id, niyam_id, log_date) values (${m.profileId}, ${niyam.id}, private.local_today())`);

    expect(await removeFamily(heerAdmin, m.accountId)).toBe(true);
    expect((await listMembers(heerAdmin, heer, { ...noFilters, q: m.phone.slice(-6) })).total).toBe(0);
    const [acc] = await sql()`select phone, removed_phone, removed_at from public.accounts where id = ${m.accountId}`;
    expect(acc).toMatchObject({ phone: null, removed_phone: m.phone });

    // The number can join another sangh straight away.
    expect((await joinSangh(m.phone, shan)).kind).toBe("joined");
    // Logs are still there (hidden) until the sweep, 30 days later.
    await sql()`select private.sweep()`;
    expect(await sql()`select 1 from public.niyam_logs where profile_id = ${m.profileId}`).toHaveLength(1);
    await sql()`update public.accounts set removed_at = now() - interval '31 days' where id = ${m.accountId}`;
    await sql()`select private.sweep()`;
    expect(await sql()`select 1 from public.accounts where id = ${m.accountId}`).toHaveLength(0);
    expect(await sql()`select 1 from public.niyam_logs where profile_id = ${m.profileId}`).toHaveLength(0);
  });

  it("removing one person keeps the rest of the family", async () => {
    const m = await member(heer);
    const kid = await createProfile(m.accountId, m.phone, { name: "Kid", relation: "child", consent: true });
    if (!kid.ok) throw new Error("kid");
    expect(await removeProfile(heerAdmin, kid.profile.id)).toBe(true);
    const me = await getMe(m.accountId, null);
    expect(me.profiles.map((p) => p.name)).toEqual(["Member"]);
    // The freed place counts again: the family can add someone new.
    expect((await createProfile(m.accountId, m.phone, { name: "Kid 2", relation: "child", consent: true })).ok).toBe(true);
  });
});

describe("logging window", () => {
  async function setup(backHours: number) {
    const [s] = await sql()`insert into public.sanghs (name, city, join_code, log_back_hours) values ('Window test', 'Pune', ${`W${String(n++).padStart(5, "0")}`}, ${backHours}) returning id`;
    const m = await member(s.id);
    const [niyam] = await sql()`insert into public.niyams (sangh_id, name, type) values (${s.id}, 'Navkarsi', 'yesno') returning id`;
    const log = (daysBack: number) => asAccount(m.accountId, (tx) => tx`
      insert into public.niyam_logs (profile_id, niyam_id, log_date) values (${m.profileId}, ${niyam.id}, private.local_today() - ${daysBack}::int)`);
    return log;
  }

  it("with 24 hours: today and yesterday, never earlier and never the future", async () => {
    const log = await setup(24);
    await expect(log(0)).resolves.toBeTruthy();
    await expect(log(1)).resolves.toBeTruthy();
    await expect(log(2)).rejects.toMatchObject({ hint: "log_window_closed" });
    await expect(log(-1)).rejects.toMatchObject({ hint: "log_window_closed" });
  });

  it("with 0 hours: today only", async () => {
    const log = await setup(0);
    await expect(log(0)).resolves.toBeTruthy();
    await expect(log(1)).rejects.toMatchObject({ hint: "log_window_closed" });
  });

  it("a member can't log someone else's niyam", async () => {
    const m = await member(heer);
    const [shanNiyam] = await sql()`insert into public.niyams (sangh_id, name, type) values (${shan}, 'Other', 'yesno') returning id`;
    await expect(asAccount(m.accountId, (tx) => tx`
      insert into public.niyam_logs (profile_id, niyam_id, log_date) values (${m.profileId}, ${shanNiyam.id}, private.local_today())`))
      .rejects.toBeTruthy();
  });
});

describe("only the super admin approves a new sangh", () => {
  it("a request stays pending, hidden and closed until approved", async () => {
    const asker = phone();
    const r = await requestSangh(asker, "New Pathshala", "Nashik");
    if (!r.ok) throw new Error("request");
    const [s] = await sql()`select join_code, status from public.sanghs where id = ${r.id}`;
    expect(s.status).toBe("pending");
    expect(await findSanghByCode(s.join_code)).toBeNull();
    expect((await searchSanghs("New Pathshala", null)).sanghs).toHaveLength(0);
    expect((await joinSangh(phone(), r.id)).kind).toBe("closed");

    await expect(superApprove(asker, r.id)).rejects.toMatchObject({ code: "42501" });     // the asker can't
    await expect(superApprove(heerAdmin, r.id)).rejects.toMatchObject({ code: "42501" }); // nor another admin
    expect(await superApprove(SUPER, r.id)).toBe(true);
    expect(await findSanghByCode(s.join_code)).not.toBeNull();
    expect((await joinSangh(phone(), r.id)).kind).toBe("joined");
  });

  it("only the super admin creates sanghs directly; requests are limited", async () => {
    await expect(superCreateSangh(heerAdmin, "Direct", "Surat", null)).rejects.toMatchObject({ code: "42501" });
    expect(typeof (await superCreateSangh(SUPER, "Direct", "Surat", phone()))).toBe("string");
    const asker = phone();
    for (let i = 0; i < 3; i++) expect((await requestSangh(asker, `Req ${i}`, "Pune")).ok).toBe(true);
    expect(await requestSangh(asker, "Req 4", "Pune")).toEqual({ ok: false, reason: "too_many_requests" });
  });
});

describe("join settings", () => {
  it("paused joins stop new members but not existing ones", async () => {
    const [s] = await sql()`insert into public.sanghs (name, city, join_code) values ('Pause test', 'Pune', ${`P${String(n++).padStart(5, "0")}`}) returning id, join_code`;
    const old = phone();
    expect((await joinSangh(old, s.id)).kind).toBe("joined");
    await sql()`update public.sanghs set join_open = false where id = ${s.id}`;
    expect((await joinSangh(phone(), s.id)).kind).toBe("closed");
    expect((await joinSangh(old, s.id)).kind).toBe("logged_in");
    expect((await findSanghByCode(s.join_code))?.joinOpen).toBe(false);
  });
});

describe("changing the join form", () => {
  it("asks existing members new required questions and keeps answers to removed ones", async () => {
    const [s] = await sql()`insert into public.sanghs (name, city, join_code) values ('Form test', 'Pune', ${`F${String(n++).padStart(5, "0")}`}) returning id`;
    const admin = phone();
    await sql()`insert into public.sangh_admins (sangh_id, phone) values (${s.id}, ${admin})`;
    const [cls] = await sql()`insert into public.classes (sangh_id, name) values (${s.id}, 'All') returning id`;
    const roll = { key: "roll_no", type: "text", required: false, label: { en: "Roll number" } };
    const classField = { key: "class", type: "class", required: true, label: { en: "Class" } };
    expect((await saveForm(admin, s.id, [classField, roll])).ok).toBe(true);

    const m = await member(s.id);
    expect((await setupProfile(m.accountId, m.profileId, cls.id, { roll_no: "R-7" })).ok).toBe(true);
    expect((await getMe(m.accountId, m.profileId)).profiles[0].missing).toEqual([]);

    const sunday = { key: "q_sunday", type: "yesno", required: true, label: { en: "Sunday class?" } };
    expect((await saveForm(admin, s.id, [classField, sunday])).ok).toBe(true); // roll number turned off, a required question added
    expect((await getMe(m.accountId, m.profileId)).profiles[0].missing).toEqual(["q_sunday"]);

    expect((await setupProfile(m.accountId, m.profileId, cls.id, { q_sunday: "yes" })).ok).toBe(true);
    const [a] = await sql()`select answers from public.profile_answers where profile_id = ${m.profileId}`;
    expect(a.answers).toEqual({ roll_no: "R-7", q_sunday: "yes" });
    expect((await getMe(m.accountId, m.profileId)).profiles[0].missing).toEqual([]);
  });

  it("refuses a malformed form", async () => {
    expect(await saveForm(heerAdmin, heer, [{ key: "class", type: "text", label: { en: "Class" } }])).toEqual({ ok: false, reason: "invalid_field" });
    const q = { key: "q_a", type: "yesno", label: { en: "A" } };
    expect(await saveForm(heerAdmin, heer, [q, q])).toEqual({ ok: false, reason: "duplicate_key" });
  });
});
