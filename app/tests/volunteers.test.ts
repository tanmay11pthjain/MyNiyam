// Volunteers: they see and do only what the admin allowed, in their own classes. Checked in the database.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAdmin, sql } from "@/server/db";
import { createProfile, findSanghByCode, joinSangh } from "@/server/onboarding";
import { listMembers, removeProfile } from "@/server/admin/members";
import { createNiyam } from "@/server/admin/niyams";
import { adminMe } from "@/server/admin/sangh";
import { getVolunteers, logActivity, saveVolunteer } from "@/server/admin/volunteers";
import { niyamInput } from "@/server/admin/niyams";

let n = 0;
const phone = () => `+9193${String(Date.now() % 1e6).padStart(6, "0")}${String(n++ % 100).padStart(2, "0")}`;
const noFilters = { q: "", classId: null, gender: null, age: null, inactive: false };
let heer: string, classA: string, classB: string;
const admin = phone();

beforeAll(async () => {
  heer = (await findSanghByCode("HEER01"))!.id;
  await sql()`insert into public.sangh_admins (sangh_id, phone) values (${heer}, ${admin})`;
  [classA, classB] = (await sql()`select id from public.classes where sangh_id = ${heer} order by sort_order limit 2`).map((r) => r.id);
});
afterAll(async () => { await sql().end(); });

async function member(classId: string, name: string) {
  const p = phone();
  const r = await joinSangh(p, heer);
  if (r.kind === "closed") throw new Error("closed");
  const prof = await createProfile(r.accountId, p, { name, relation: "self", consent: false });
  if (!prof.ok) throw new Error("profile");
  await sql()`update public.profiles set class_id = ${classId} where id = ${prof.profile.id}`;
  return prof.profile.id;
}
async function volunteer(perms: string[], classIds: string[]) {
  const v = phone();
  expect(await saveVolunteer(admin, heer, { phone: v, name: "Teacher", classIds, perms })).toBe("ok");
  return v;
}

describe("volunteers", () => {
  it("see members only in their classes, and only with view_members", async () => {
    const a = await member(classA, "In A");
    const b = await member(classB, "In B");
    const teacher = await volunteer(["view_members"], [classA]);
    const ids = (await listMembers(teacher, heer, noFilters)).families.flatMap((f) => f.profiles.map((p) => p.id));
    expect(ids).toContain(a);
    expect(ids).not.toContain(b);
    const blind = await volunteer(["attendance"], [classA]);
    expect((await listMembers(blind, heer, noFilters)).total).toBe(0);
  });

  it("remove members only when allowed, and only in their classes", async () => {
    const a = await member(classA, "Remove me");
    const b = await member(classB, "Not yours");
    const viewer = await volunteer(["view_members"], [classA]);
    expect(await removeProfile(viewer, a)).toBe(false);
    const remover = await volunteer(["view_members", "remove_members"], [classA]);
    expect(await removeProfile(remover, b)).toBe(false);
    expect(await removeProfile(remover, a)).toBe(true);
  });

  it("change niyams only with the niyams permission", async () => {
    const body = niyamInput.parse({ name: "Volunteer niyam", type: "yesno" });
    const no = await volunteer(["view_members"], []);
    await expect(createNiyam(no, heer, body)).rejects.toThrow();
    const yes = await volunteer(["niyams"], []);
    expect((await createNiyam(yes, heer, body)).some((x) => x.name === "Volunteer niyam")).toBe(true);
  });

  it("open the sangh as volunteers, can't manage volunteers or read the log; admins can", async () => {
    const v = await volunteer(["attendance"], []);
    const me = await adminMe(v, false, null);
    expect(me.sanghs.find((s) => s.id === heer)).toMatchObject({ role: "volunteer", perms: ["attendance"] });
    await logActivity(v, heer, "Test action", "by volunteer");
    const seen = await asAdmin(v, (tx) => tx`select 1 from public.activity_log where sangh_id = ${heer}`);
    expect(seen).toHaveLength(0);
    await expect(asAdmin(v, (tx) => tx`insert into public.sangh_volunteers (sangh_id, phone, name) values (${heer}, ${phone()}, 'x')`)).rejects.toThrow();
    const page = await getVolunteers(admin, heer);
    expect(page.activity.some((a) => a.action === "Test action")).toBe(true);
  });

  it("an admin's own number can't be added as a volunteer", async () => {
    expect(await saveVolunteer(admin, heer, { phone: admin, name: "Me", classIds: [], perms: [] })).toBe("is_admin");
  });
});
