// Integration tests against the local test database (see tests/global-setup.ts).
// They check the invariants where they are enforced: in Postgres, under concurrency.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAccount, sql } from "@/server/db";
import { sendOtp, verifyOtp, SIMULATED_CODE as TEST_CODE } from "@/server/otp";
import { hit } from "@/server/rate-limit";
import {
  adminRemoveNumber, createProfile, findSanghByCode, getMe, joinSangh, searchSanghs, setupProfile,
} from "@/server/onboarding";

let n = 0;
const phone = () => `+9198${String(Date.now() % 1e6).padStart(6, "0")}${String(n++ % 100).padStart(2, "0")}`;

let heer: string, shan: string;
beforeAll(async () => {
  heer = (await findSanghByCode("HEER01"))!.id;
  shan = (await findSanghByCode("SHAN01"))!.id;
});
afterAll(async () => { await sql().end(); });

async function joined(sanghId = heer) {
  const p = phone();
  const r = await joinSangh(p, sanghId);
  if (r.kind === "closed") throw new Error("sangh is not taking members");
  return { phone: p, accountId: r.accountId };
}

describe("OTP", () => {
  it("a correct code works exactly once", async () => {
    const p = phone();
    expect((await sendOtp(p, "whatsapp")).ok).toBe(true);
    expect(await verifyOtp(p, TEST_CODE)).toEqual({ ok: true });
    expect(await verifyOtp(p, TEST_CODE)).toEqual({ ok: false, reason: "no_code" });
  });

  it("two parallel verifies of the same code: only one wins", async () => {
    const p = phone();
    await sendOtp(p, "sms");
    const rs = await Promise.all(Array.from({ length: 6 }, () => verifyOtp(p, TEST_CODE)));
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
  });

  it("counts wrong guesses down and burns the code after 5", async () => {
    const p = phone();
    await sendOtp(p, "whatsapp");
    for (let left = 4; left >= 1; left--) expect(await verifyOtp(p, "0000")).toEqual({ ok: false, reason: "wrong_code", attemptsLeft: left });
    expect(await verifyOtp(p, "0000")).toEqual({ ok: false, reason: "code_expired" });
    expect(await verifyOtp(p, TEST_CODE)).toEqual({ ok: false, reason: "no_code" });
  });

  it("an expired code is refused", async () => {
    const p = phone();
    await sendOtp(p, "whatsapp");
    await sql()`update private.otp_codes set expires_at = now() - interval '1 second' where phone = ${p}`;
    expect(await verifyOtp(p, TEST_CODE)).toEqual({ ok: false, reason: "code_expired" });
  });

  it("allows 3 sends per number per 10 minutes, even when fired at once", async () => {
    const p = phone();
    const rs = await Promise.all(Array.from({ length: 10 }, () => sendOtp(p, "whatsapp")));
    expect(rs.filter((r) => r.ok)).toHaveLength(3);
    const blocked = rs.find((r) => !r.ok)!;
    expect(blocked).toMatchObject({ ok: false, reason: "too_many_requests" });
    if (!blocked.ok && blocked.reason === "too_many_requests") expect(blocked.retryAfterSec).toBeGreaterThan(590);
    // Once the window has passed, sending works again.
    await sql()`update private.otp_sends set sent_at = now() - interval '11 minutes' where phone = ${p}`;
    expect((await sendOtp(p, "whatsapp")).ok).toBe(true);
  });
});

describe("rate limit counter", () => {
  it("is exact under concurrency", async () => {
    const key = `t:${Date.now()}`;
    const rs = await Promise.all(Array.from({ length: 12 }, () => hit(key, 5, 60)));
    expect(rs.filter((r) => r.ok)).toHaveLength(5);
  });
});

describe("one number, one sangh", () => {
  it("parallel joins of one number create one account", async () => {
    const p = phone();
    const rs = await Promise.all(Array.from({ length: 10 }, () => joinSangh(p, heer)));
    expect(rs.filter((r) => r.kind === "joined")).toHaveLength(1);
    expect(rs.filter((r) => r.kind === "logged_in")).toHaveLength(9);
    expect(new Set(rs.map((r) => ("accountId" in r ? r.accountId : null))).size).toBe(1);
    const [{ c }] = await sql()`select count(*)::int as c from public.accounts where phone = ${p}`;
    expect(c).toBe(1);
  });

  it("a number already in another sangh is told where it is", async () => {
    const a = await joined(heer);
    const r = await joinSangh(a.phone, shan);
    expect(r).toMatchObject({ kind: "other_sangh", accountId: a.accountId, sangh: { joinCode: "HEER01" } });
  });

  it("the database itself refuses a second account for a number", async () => {
    const a = await joined(heer);
    await expect(sql()`insert into public.accounts (phone, sangh_id) values (${a.phone}, ${shan})`).rejects.toMatchObject({ code: "23505" });
  });
});

describe("profiles", () => {
  it("a child needs consent, in the API and in the schema", async () => {
    const a = await joined();
    expect(await createProfile(a.accountId, a.phone, { name: "Riya", relation: "child", consent: false })).toEqual({ ok: false, reason: "consent_required" });
    await expect(asAccount(a.accountId, (tx) => tx`insert into public.profiles (account_id, name, relation) values (${a.accountId}, 'Riya', 'child')`))
      .rejects.toMatchObject({ code: "23514" });
    const ok = await createProfile(a.accountId, a.phone, { name: "Riya", relation: "child", consent: true });
    expect(ok).toMatchObject({ ok: true, profile: { name: "Riya", relation: "child", role: "student", setupDone: false } });
    const [row] = await sql()`select consent_at, consent_phone from public.profiles where account_id = ${a.accountId}`;
    expect(row.consent_phone).toBe(a.phone);
    expect(row.consent_at).toBeInstanceOf(Date);
  });

  it("only one Myself per number", async () => {
    const a = await joined();
    expect((await createProfile(a.accountId, a.phone, { name: "Me", relation: "self", consent: false })).ok).toBe(true);
    expect(await createProfile(a.accountId, a.phone, { name: "Me again", relation: "self", consent: false })).toEqual({ ok: false, reason: "self_exists" });
  });

  it("at most 8 people per number, even when added at once", async () => {
    const a = await joined();
    const rs = await Promise.all(Array.from({ length: 12 }, (_, i) => createProfile(a.accountId, a.phone, { name: `Kid ${i}`, relation: "child", consent: true })));
    expect(rs.filter((r) => r.ok)).toHaveLength(8);
  });

  it("setup checks the class and the answers", async () => {
    const a = await joined();
    const r = await createProfile(a.accountId, a.phone, { name: "Me", relation: "self", consent: false });
    if (!r.ok) throw new Error("create failed");
    const me = await getMe(a.accountId, r.profile.id);
    const [shanClass] = await sql()`select id from public.classes where sangh_id = ${shan}`;
    expect(await setupProfile(a.accountId, r.profile.id, shanClass.id, { area: "Malad" })).toEqual({ ok: false, reason: "invalid_class" });
    expect(await setupProfile(a.accountId, r.profile.id, me.classes[0].id, {})).toEqual({ ok: false, reason: "invalid_answers", fields: { area: "required" } });
    const done = await setupProfile(a.accountId, r.profile.id, me.classes[0].id, { area: "Malad", school_std: "5-8" });
    expect(done).toMatchObject({ ok: true, profile: { classId: me.classes[0].id, setupDone: true } });
    const [ans] = await sql()`select answers from public.profile_answers where profile_id = ${r.profile.id}`;
    expect(ans.answers).toEqual({ area: "Malad", school_std: "5-8" });
  });
});

describe("row-level security keeps sanghs apart", () => {
  it("a member sees only their own sangh, classes, account and profiles", async () => {
    const a = await joined(heer);
    const b = await joined(shan);
    await createProfile(a.accountId, a.phone, { name: "A", relation: "self", consent: false });
    await createProfile(b.accountId, b.phone, { name: "B", relation: "self", consent: false });
    await asAccount(a.accountId, async (tx) => {
      expect((await tx`select join_code from public.sanghs`).map((r) => r.join_code)).toEqual(["HEER01"]);
      expect((await tx`select distinct sangh_id from public.classes`).map((r) => r.sangh_id)).toEqual([heer]);
      expect(await tx`select id from public.accounts`).toHaveLength(1);
      expect((await tx`select name from public.profiles`).map((r) => r.name)).toEqual(["A"]);
    });
    const me = await getMe(a.accountId, null);
    expect(me.sangh.joinCode).toBe("HEER01");
    expect(me.phone).not.toContain(a.phone.slice(5, 10));
  });

  it("a member cannot write into someone else's account or make themselves admin", async () => {
    const a = await joined(heer);
    const b = await joined(heer);
    await expect(asAccount(a.accountId, (tx) => tx`insert into public.profiles (account_id, name, relation) values (${b.accountId}, 'X', 'self')`))
      .rejects.toMatchObject({ code: "42501" });
    const r = await createProfile(a.accountId, a.phone, { name: "A", relation: "self", consent: false });
    if (!r.ok) throw new Error("create failed");
    await expect(asAccount(a.accountId, (tx) => tx`update public.profiles set role = 'admin' where id = ${r.profile.id}`))
      .rejects.toMatchObject({ code: "42501" });
    await expect(asAccount(a.accountId, (tx) => tx`select * from private.otp_codes`)).rejects.toMatchObject({ code: "42501" });
    await expect(asAccount(a.accountId, (tx) => tx`update public.accounts set sangh_id = ${heer}`)).rejects.toMatchObject({ code: "42501" });
  });

  it("search returns public cards and filters by city", async () => {
    const r = await searchSanghs("heer", null);
    expect(r.sanghs.map((s) => s.joinCode).sort()).toEqual(["HEER01", "HEERK2"]);
    expect((await searchSanghs("heer", "pune")).sanghs.map((s) => s.joinCode)).toEqual(["HEERK2"]);
    expect((await searchSanghs("50%_", null)).sanghs).toEqual([]);
    expect(r.cities).toEqual(expect.arrayContaining(["Mumbai", "Ahmedabad", "Pune"]));
  });
});

describe("admin removes a number", () => {
  it("frees the number for another sangh; only admins of the same sangh can do it", async () => {
    const admin = await joined(heer);
    const member = await joined(heer);
    const outsider = await joined(shan);
    const r = await createProfile(admin.accountId, admin.phone, { name: "Teacher", relation: "self", consent: false });
    if (!r.ok) throw new Error("create failed");

    expect(await adminRemoveNumber(member.accountId, admin.phone)).toBe("forbidden"); // not an admin
    await sql()`update public.profiles set role = 'admin' where id = ${r.profile.id}`;
    expect(await adminRemoveNumber(admin.accountId, outsider.phone)).toBe("not_found"); // other sangh
    expect(await adminRemoveNumber(admin.accountId, admin.phone)).toBe("forbidden");    // not yourself
    await createProfile(member.accountId, member.phone, { name: "Kid", relation: "child", consent: true });
    expect(await adminRemoveNumber(admin.accountId, member.phone)).toBe("removed");

    const [{ c }] = await sql()`select count(*)::int as c from public.profiles p join public.accounts a on a.id = p.account_id where a.phone = ${member.phone}`;
    expect(c).toBe(0);
    expect((await joinSangh(member.phone, shan)).kind).toBe("joined");
  });
});
