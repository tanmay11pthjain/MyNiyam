// Tithi niyams, tapasya levels with their own Tej, and copying niyams to another class.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "@/server/db";
import { createProfile, findSanghByCode, joinSangh } from "@/server/onboarding";
import { copyClassNiyams, createNiyam, niyamInput } from "@/server/admin/niyams";
import { getProgress, getToday, setLog } from "@/server/today";

let n = 0;
const phone = () => `+9190${String(Date.now() % 1e6).padStart(6, "0")}${String(n++ % 100).padStart(2, "0")}`;
let heer: string, classA: string, classB: string, today: string, tomorrow: string;
const admin = phone();

beforeAll(async () => {
  heer = (await findSanghByCode("HEER01"))!.id;
  await sql()`insert into public.sangh_admins (sangh_id, phone) values (${heer}, ${admin})`;
  [classA, classB] = (await sql()`select id from public.classes where sangh_id = ${heer} order by sort_order limit 2`).map((r) => r.id);
  [{ today, tomorrow }] = await sql()`select private.local_today()::text as today, (private.local_today() + 1)::text as tomorrow`;
});
afterAll(async () => { await sql().end(); });

async function member(classId: string) {
  const p = phone();
  const r = await joinSangh(p, heer);
  if (r.kind === "closed") throw new Error("closed");
  const prof = await createProfile(r.accountId, p, { name: "Tithi Person", relation: "self", consent: false });
  if (!prof.ok) throw new Error("profile");
  await sql()`update public.profiles set class_id = ${classId} where id = ${prof.profile.id}`;
  return { accountId: r.accountId, id: prof.profile.id };
}

describe("tithi niyams and tapasya levels", () => {
  it("a tithi niyam shows only on its dates", async () => {
    expect(niyamInput.safeParse({ name: "Ashtami", type: "yesno", schedule: "dates", dates: [] }).success).toBe(false);
    const list = await createNiyam(admin, heer, niyamInput.parse({ name: "Ashtami upvas " + n, type: "yesno", schedule: "dates", dates: [today] }));
    const ok = list.find((x) => x.name === "Ashtami upvas " + (n))!;
    const other = await createNiyam(admin, heer, niyamInput.parse({ name: "Chaudas " + n, type: "yesno", schedule: "dates", dates: [tomorrow] }));
    const later = other.find((x) => x.name.startsWith("Chaudas"))!;
    expect(ok.dates).toEqual([today]);
    const m = await member(classA);
    const names = (await getToday(m.accountId, m.id))!.today.niyams.map((x) => x.id);
    expect(names).toContain(ok.id);
    expect(names).not.toContain(later.id);
  });

  it("a tapasya level earns its own Tej", async () => {
    const body = niyamInput.parse({ name: "Tap levels " + n, type: "choice", points: 10, allClasses: false, classIds: [classB],
      options: [{ value: "e", en: "Ekasna", points: 30 }, { value: "u", en: "Upvas", points: 100 }, { value: "x", en: "Other" }] });
    const id = (await createNiyam(admin, heer, body)).find((x) => x.name === body.name)!.id;
    const m = await member(classB);
    await setLog(m.accountId, m.id, { niyamId: id, date: today, choice: "u" });
    expect((await getProgress(m.accountId, m.id))!.tejToday).toBe(100);
    await setLog(m.accountId, m.id, { niyamId: id, date: today, choice: "x" });
    expect((await getProgress(m.accountId, m.id))!.tejToday).toBe(10);
  });

  it("copies one class's niyams to another, once", async () => {
    const [{ id: c1 }] = await sql()`insert into public.classes (sangh_id, name) values (${heer}, ${"Copy from " + n++}) returning id`;
    const [{ id: c2 }] = await sql()`insert into public.classes (sangh_id, name) values (${heer}, ${"Copy to " + n++}) returning id`;
    await createNiyam(admin, heer, niyamInput.parse({ name: "Only c1 " + n, type: "yesno", allClasses: false, classIds: [c1] }));
    const r = (await copyClassNiyams(admin, heer, c1, c2))!;
    expect(r.added).toBe(1);
    expect(r.niyams.find((x) => x.name === "Only c1 " + n)!.classIds.sort()).toEqual([c1, c2].sort());
    expect((await copyClassNiyams(admin, heer, c1, c2))!.added).toBe(0);
    expect(await copyClassNiyams(admin, heer, c1, c1)).toBeNull();
  });
});
