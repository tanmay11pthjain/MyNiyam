// Data rights: a family's copy of its data, deleting it itself, and an admin deleting it on request.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "@/server/db";
import { createProfile, findSanghByCode, joinSangh } from "@/server/onboarding";
import { setLog } from "@/server/today";
import { adminEraseFamily, adminExportFamily, deleteMyAccount, exportMyData } from "@/server/privacy";

let n = 0;
const phone = () => `+9195${String(Date.now() % 1e6).padStart(6, "0")}${String(n++ % 100).padStart(2, "0")}`;
let heer: string, shan: string;
const heerAdmin = phone();

beforeAll(async () => {
  heer = (await findSanghByCode("HEER01"))!.id;
  shan = (await findSanghByCode("SHAN01"))!.id;
  await sql()`insert into public.sangh_admins (sangh_id, phone) values (${heer}, ${heerAdmin})`;
});
afterAll(async () => { await sql().end(); });

async function family(sanghId = heer) {
  const p = phone();
  const r = await joinSangh(p, sanghId);
  if (r.kind === "closed") throw new Error("closed");
  const prof = await createProfile(r.accountId, p, { name: "Asha", relation: "self", consent: false });
  if (!prof.ok) throw new Error("profile");
  return { phone: p, accountId: r.accountId, profileId: prof.profile.id };
}

describe("data rights", () => {
  it("a member downloads their own data, with logs", async () => {
    const f = await family();
    const [nm] = await sql()`select id from public.niyams where sangh_id = ${heer} and type = 'yesno' and status = 'active' limit 1`;
    const [{ d }] = await sql()`select private.local_today()::text as d`;
    await setLog(f.accountId, f.profileId, { niyamId: nm.id, date: d });
    const x = await exportMyData(f.accountId);
    expect(x!.phone).toBe(f.phone);
    expect(x!.people).toHaveLength(1);
    expect(x!.people[0].logs).toHaveLength(1);
  });

  it("a member deletes their number and everything on it", async () => {
    const f = await family();
    expect(await deleteMyAccount(f.accountId)).toBe(true);
    expect(await sql()`select 1 from public.accounts where id = ${f.accountId}`).toHaveLength(0);
    expect(await sql()`select 1 from public.profiles where id = ${f.profileId}`).toHaveLength(0);
  });

  it("an admin exports and erases only their own sangh's families", async () => {
    const mine = await family();
    const other = await family(shan);
    expect((await adminExportFamily(heerAdmin, heer, mine.accountId))!.people[0].name).toBe("Asha");
    expect(await adminExportFamily(heerAdmin, heer, other.accountId)).toBeNull();
    expect(await adminEraseFamily(heerAdmin, heer, other.accountId)).toBe(false);
    expect(await sql()`select 1 from public.accounts where id = ${other.accountId}`).toHaveLength(1);
    expect(await adminEraseFamily(heerAdmin, heer, mine.accountId)).toBe(true);
    expect(await sql()`select 1 from public.accounts where id = ${mine.accountId}`).toHaveLength(0);
  });
});
