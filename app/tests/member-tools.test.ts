// Member tools: edit details, add on behalf, move a whole class, hand the pathshala over.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "@/server/db";
import { createProfile, findSanghByCode, joinSangh } from "@/server/onboarding";
import { addOnBehalf, editMember, memberForm, moveClass, transferSangh } from "@/server/admin/member-tools";
import { saveVolunteer } from "@/server/admin/volunteers";

let n = 0;
const phone = () => `+9189${String(Date.now() % 1e6).padStart(6, "0")}${String(n++ % 100).padStart(2, "0")}`;
let heer: string, classA: string, classB: string;
const admin = phone();

beforeAll(async () => {
  heer = (await findSanghByCode("HEER01"))!.id;
  await sql()`insert into public.sangh_admins (sangh_id, phone) values (${heer}, ${admin})`;
  [classA, classB] = (await sql()`select id from public.classes where sangh_id = ${heer} order by sort_order limit 2`).map((r) => r.id);
});
afterAll(async () => { await sql().end(); });

async function member(classId: string) {
  const p = phone();
  const r = await joinSangh(p, heer);
  if (r.kind === "closed") throw new Error("closed");
  const prof = await createProfile(r.accountId, p, { name: "Tool Person", relation: "self", consent: false });
  if (!prof.ok) throw new Error("profile");
  await sql()`update public.profiles set class_id = ${classId} where id = ${prof.profile.id}`;
  return prof.profile.id;
}

describe("member tools", () => {
  it("an admin corrects a member's name and answers; bad answers are refused", async () => {
    const id = await member(classA);
    await sql()`insert into public.profile_answers (profile_id, answers) values (${id}, ${sql().json({ area: "Old area", legacy: "kept" })})`;
    expect((await memberForm(admin, heer, id))!.answers.area).toBe("Old area");
    expect(await editMember(admin, heer, id, "Fixed Name", { area: "New area", dob: "2015-05-01" })).toEqual({ ok: true });
    const [r] = await sql()`select p.name, pa.answers from public.profiles p join public.profile_answers pa on pa.profile_id = p.id where p.id = ${id}`;
    expect(r.name).toBe("Fixed Name");
    expect(r.answers).toMatchObject({ area: "New area", dob: "2015-05-01", legacy: "kept" });
    const bad = await editMember(admin, heer, id, "Fixed Name", { area: "" });
    expect(bad.ok).toBe(false);
  });

  it("a volunteer with setup edits only in their classes", async () => {
    const a = await member(classA), b = await member(classB);
    const t = phone();
    await saveVolunteer(admin, heer, { phone: t, name: "Setup A", classIds: [classA], perms: ["setup"] });
    expect((await editMember(t, heer, a, "By teacher", { area: "X" })).ok).toBe(true);
    expect(await editMember(t, heer, b, "Not mine", { area: "X" })).toEqual({ ok: false, reason: "not_found" });
  });

  it("adds a member on their behalf, once, with their class", async () => {
    const p = phone();
    const r = await addOnBehalf(admin, heer, p, "Dadi Ji", classB);
    expect(r.ok).toBe(true);
    const [row] = await sql()`select p.name, p.class_id, p.setup_done_at from public.profiles p join public.accounts a on a.id = p.account_id where a.phone = ${p}`;
    expect(row).toMatchObject({ name: "Dadi Ji", class_id: classB, setup_done_at: null });
    expect(await addOnBehalf(admin, heer, p, "Again", null)).toEqual({ ok: false, reason: "already_member" });
  });

  it("moves a whole class", async () => {
    const [{ id: c1 }] = await sql()`insert into public.classes (sangh_id, name) values (${heer}, ${"Year 1 " + n++}) returning id`;
    const [{ id: c2 }] = await sql()`insert into public.classes (sangh_id, name) values (${heer}, ${"Year 2 " + n++}) returning id`;
    await member(c1); await member(c1);
    expect(await moveClass(admin, heer, c1, c2)).toBe(2);
    const [{ left }] = await sql()`select count(*)::int as left from public.profiles where class_id = ${c1}`;
    expect(left).toBe(0);
    expect(await moveClass(admin, heer, c1, c1)).toBeNull();
  });

  it("hands the pathshala over: the new number is admin, the old one isn't", async () => {
    const [{ id: s }] = await sql()`insert into public.sanghs (name, city, join_code, status) values ('Handover test', 'Pune', ${"HO" + String(Date.now()).slice(-4)}, 'active') returning id`;
    const oldAdmin = phone(), newAdmin = phone();
    await sql()`insert into public.sangh_admins (sangh_id, phone) values (${s}, ${oldAdmin})`;
    expect(await transferSangh(oldAdmin, s, oldAdmin)).toBe("same_number");
    expect(await transferSangh(oldAdmin, s, newAdmin)).toBe("ok");
    const admins = (await sql()`select phone from public.sangh_admins where sangh_id = ${s}`).map((r) => r.phone);
    expect(admins).toEqual([newAdmin]);
    await expect(transferSangh(oldAdmin, s, phone())).rejects.toThrow();
  });
});
