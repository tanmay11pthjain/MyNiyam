// One number in many pathshalas (up to 5), and the edit windows an admin sets.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAccount, sql } from "@/server/db";
import { accountByPhone, createProfile, familyAccountOf, getMe, joinSangh, setupProfile } from "@/server/onboarding";
import { clearMarks, getSheet, saveMarks } from "@/server/admin/attendance";
import { addOnBehalf } from "@/server/admin/member-tools";
import { getHistoryDay } from "@/server/today";

let n = 0;
const phone = () => `+9188${String(Date.now() % 1e6).padStart(6, "0")}${String(n++ % 100).padStart(2, "0")}`;
const FORM = [
  { key: "class", type: "class", required: false, label: { en: "Class" } },
  { key: "gender", type: "select", required: false, label: { en: "Gender" }, options: [{ value: "female", en: "Female" }, { value: "male", en: "Male" }] },
  { key: "dob", type: "date", required: false, label: { en: "Date of birth" } },
  { key: "city", type: "text", required: false, max: 60, label: { en: "City" } },
  { key: "roll_no", type: "text", required: false, max: 20, label: { en: "Roll number" } },
];
let code = 0;
async function sangh(name: string, extra: { form?: unknown[] } = {}) {
  const [s] = await sql()`insert into public.sanghs (name, city, join_code, form_fields)
    values (${name}, 'Surat', ${`M${String(Date.now() % 1e4).padStart(4, "0")}${String(code++ % 10)}`.slice(0, 6)}, ${sql().json((extra.form ?? FORM) as never)}) returning id`;
  return s.id as string;
}
async function joined(p: string, sanghId: string) {
  const r = await joinSangh(p, sanghId);
  if (r.kind === "closed" || r.kind === "limit") throw new Error(r.kind);
  return r.accountId;
}

let a: string, b: string;
beforeAll(async () => { a = await sangh("Pathshala A"); b = await sangh("Pathshala B"); });
afterAll(async () => { await sql().end(); });

describe("one number in many pathshalas", () => {
  it("each pathshala gets its own account; the family list shows everyone with their pathshala", async () => {
    const p = phone();
    const accA = await joined(p, a);
    const riyaA = await createProfile(accA, p, { name: "Riya", relation: "child", consent: true });
    if (!riyaA.ok) throw new Error("riya");
    const accB = await joined(p, b);
    expect(accB).not.toBe(accA);
    const meB = await getMe(accB, null);
    expect(meB.profiles).toEqual([]); // nobody in B yet
    expect(meB.family).toMatchObject([{ id: riyaA.profile.id, name: "Riya", sangh: { id: a, name: "Pathshala A" }, here: false }]);
    // Login opens the first pathshala; picking someone opens theirs.
    expect(await accountByPhone(p)).toEqual({ id: accA });
    expect(await familyAccountOf(p, riyaA.profile.id)).toBe(accA);
  });

  it("the same child joins a second pathshala with details copied (not roll number), as a separate profile", async () => {
    const p = phone();
    const accA = await joined(p, a);
    const riyaA = await createProfile(accA, p, { name: "Riya", relation: "child", consent: true });
    if (!riyaA.ok) throw new Error("riya");
    const done = await setupProfile(accA, riyaA.profile.id, null, { gender: "female", dob: "2015-04-02", city: "Surat", roll_no: "17" });
    expect(done.ok).toBe(true);
    const accB = await joined(p, b);
    // A child always needs consent again for the new pathshala.
    expect(await createProfile(accB, p, { name: "Riya", relation: "child", consent: false, fromProfileId: riyaA.profile.id }))
      .toEqual({ ok: false, reason: "consent_required" });
    const riyaB = await createProfile(accB, p, { name: "Riya", relation: "child", consent: true, fromProfileId: riyaA.profile.id });
    if (!riyaB.ok) throw new Error("riyaB");
    expect(riyaB.profile.id).not.toBe(riyaA.profile.id);
    expect(riyaB.profile.answers).toEqual({ gender: "female", dob: "2015-04-02", city: "Surat" });
    const me = await getMe(accB, riyaB.profile.id);
    expect(me.family.map((m) => [m.name, m.sangh.name, m.here])).toEqual([["Riya", "Pathshala B", true], ["Riya", "Pathshala A", false]]);
  });

  it("copying from someone on another number is refused", async () => {
    const p1 = phone(), p2 = phone();
    const acc1 = await joined(p1, a);
    const other = await createProfile(acc1, p1, { name: "Not mine", relation: "self", consent: false });
    if (!other.ok) throw new Error("other");
    const acc2 = await joined(p2, b);
    expect(await createProfile(acc2, p2, { name: "x", relation: "self", consent: false, fromProfileId: other.profile.id })).toEqual({ ok: false, reason: "not_found" });
    expect(await familyAccountOf(p2, other.profile.id)).toBeNull();
  });

  it("each pathshala still sees only its own people", async () => {
    const p = phone();
    const accA = await joined(p, a);
    const inA = await createProfile(accA, p, { name: "Self A", relation: "self", consent: false });
    const accB = await joined(p, b);
    await createProfile(accB, p, { name: "Self B", relation: "self", consent: false });
    if (!inA.ok) throw new Error("a");
    const seen = await asAccount(accB, (tx) => tx`select name from public.profiles where account_id = ${accA}`);
    expect(seen).toHaveLength(0);
    expect(await getHistoryDay(accB, inA.profile.id, "2026-10-01")).toBeNull();
  });

  it("at most 5 pathshalas per number, even when joined at once", async () => {
    const p = phone();
    const ids = await Promise.all(Array.from({ length: 7 }, (_, i) => sangh(`Limit ${i}`)));
    const rs = await Promise.all(ids.map((id) => joinSangh(p, id)));
    expect(rs.filter((r) => r.kind === "joined")).toHaveLength(5);
    expect(rs.filter((r) => r.kind === "limit")).toHaveLength(2);
    // Joining one it is already in still works.
    const inOne = ids[rs.findIndex((r) => r.kind === "joined")];
    expect((await joinSangh(p, inOne)).kind).toBe("logged_in");
    // An admin adding this number to a 6th pathshala is refused too.
    const sixth = await sangh("Limit admin");
    expect(await addOnBehalf("+919999900001", sixth, p, "Someone", null)).toEqual({ ok: false, reason: "pathshala_limit" });
  });
});

describe("edit windows", () => {
  it("niyam logs: an admin can allow up to 7 days back", async () => {
    const s = await sangh("Window 7");
    await sql()`update public.sanghs set log_back_hours = 168 where id = ${s}`;
    const p = phone();
    const acc = await joined(p, s);
    const me = await createProfile(acc, p, { name: "Me", relation: "self", consent: false });
    if (!me.ok) throw new Error("me");
    const [niyam] = await sql()`insert into public.niyams (sangh_id, name, type) values (${s}, 'Navkarsi', 'yesno') returning id`;
    const log = (back: number) => asAccount(acc, (tx) => tx`
      insert into public.niyam_logs (profile_id, niyam_id, log_date) values (${me.profile.id}, ${niyam.id}, private.local_today() - ${back}::int)`);
    await expect(log(7)).resolves.toBeTruthy();
    await expect(log(8)).rejects.toMatchObject({ hint: "log_window_closed" });
    const [{ d }] = await sql()`select (private.local_today() - 7)::text as d`;
    const day = (await getHistoryDay(acc, me.profile.id, d))!;
    expect([day.day.editable, (await getHistoryDay(acc, me.profile.id, d))!.isToday]).toEqual([true, false]);
    await expect(sql()`update public.sanghs set log_back_hours = 169 where id = ${s}`).rejects.toMatchObject({ code: "23514" });
  });

  it("attendance: only days inside the window can be marked or cleared", async () => {
    const s = await sangh("Att window");
    const admin = phone();
    await sql()`insert into public.sangh_admins (sangh_id, phone) values (${s}, ${admin})`;
    const [cls] = await sql()`insert into public.classes (sangh_id, name) values (${s}, 'Class 1') returning id`;
    const p = phone();
    const acc = await joined(p, s);
    const me = await createProfile(acc, p, { name: "Kid", relation: "self", consent: false });
    if (!me.ok) throw new Error("me");
    await sql()`update public.profiles set class_id = ${cls.id} where id = ${me.profile.id}`;
    const [{ d2, d5 }] = await sql()`select (private.local_today() - 2)::text as d2, (private.local_today() - 5)::text as d5`;
    const mark = (day: string) => saveMarks(admin, s, { classId: cls.id, day, marks: [{ profileId: me.profile.id, status: "present" }] });
    expect(await mark(d5)).toBe("ok"); // 30 days by default
    await sql()`update public.sanghs set attendance_back_days = 3 where id = ${s}`;
    expect(await mark(d2)).toBe("ok");
    expect(await mark(d5)).toBe("day_out_of_range");
    expect(await clearMarks(admin, s, cls.id, d5)).toBe("day_out_of_range");
    expect(await clearMarks(admin, s, cls.id, d2)).toBe("ok");
    expect(await getSheet(admin, s, cls.id, d5)).toBeNull();
    expect((await getSheet(admin, s, cls.id, null))!.minDay).toBe((await sql()`select (private.local_today() - 3)::text as d`)[0].d);
    // Removing the person still removes their old marks.
    await sql()`delete from public.accounts where id = ${acc}`;
    const [{ c }] = await sql()`select count(*)::int as c from public.attendance where profile_id = ${me.profile.id}`;
    expect(c).toBe(0);
  });
});
