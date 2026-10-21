import "server-only";
import { asAccount, pgCode, pgHint, sql } from "./db";
import { config } from "./config";
import { missingRequired, parseFormFields, validateAnswers, type AnswerErrors, type FormField } from "@/lib/forms";
import { maskPhone } from "@/lib/phone";
import type { ClassItem, Me, Profile, SanghCard } from "@/lib/api-types";

// Data access for the join flow. Lookups before sign-in use the server's own connection and
// return only public columns; everything after sign-in runs through asAccount (row-level security).

type SanghRow = { id: string; name: string; city: string; logo_url: string | null; join_code: string };
const toCard = (r: SanghRow): SanghCard => ({ id: r.id, name: r.name, city: r.city, logoUrl: r.logo_url, joinCode: r.join_code });

/** An approved sangh by its join code. `joinOpen` is false while its admin has paused new joins. */
export async function findSanghByCode(code: string): Promise<(SanghCard & { joinOpen: boolean }) | null> {
  const [r] = await sql()<(SanghRow & { join_open: boolean })[]>`
    select id, name, city, logo_url, join_code, join_open from public.sanghs where join_code = ${code} and status = 'active'`;
  return r ? { ...toCard(r), joinOpen: r.join_open } : null;
}

export async function findSanghById(id: string): Promise<SanghCard | null> {
  const [r] = await sql()<SanghRow[]>`select id, name, city, logo_url, join_code from public.sanghs where id = ${id}`;
  return r ? toCard(r) : null;
}

/** Name search (contains, case-insensitive) with an optional exact city filter. At most 20 results. */
export async function searchSanghs(q: string, city: string | null): Promise<{ sanghs: SanghCard[]; cities: string[] }> {
  const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  const rows = await sql()<SanghRow[]>`
    select id, name, city, logo_url, join_code from public.sanghs
    where status = 'active' and searchable
      and (${q} = '' or name ilike ${like})
      and (${city}::text is null or lower(city) = lower(${city}))
    order by name limit 20`;
  const cities = await sql()<{ city: string }[]>`select distinct city from public.sanghs where status = 'active' and searchable order by city limit 200`;
  return { sanghs: rows.map(toCard), cities: cities.map((c) => c.city) };
}

export type JoinOutcome =
  | { kind: "joined"; accountId: string }
  | { kind: "logged_in"; accountId: string }
  | { kind: "other_sangh"; accountId: string; sangh: SanghCard }
  | { kind: "closed" };

/**
 * After the phone is verified: create the account in `sanghId`, or find the existing one.
 * The UNIQUE(phone) constraint makes this safe against double taps and two tabs: exactly one
 * insert wins and everyone else reads the winner's row. A sangh that is pending or has paused
 * joins refuses new accounts in the database (accounts_join_open); existing members still get in.
 */
export async function joinSangh(phone: string, sanghId: string): Promise<JoinOutcome> {
  const [existing] = await sql()`select id from public.accounts where phone = ${phone}`;
  if (!existing) {
    let inserted;
    try {
      inserted = await sql()`
        insert into public.accounts (phone, sangh_id) values (${phone}, ${sanghId})
        on conflict (phone) do nothing returning id`;
    } catch (e) {
      if (pgHint(e) === "joins_closed") return { kind: "closed" };
      throw e;
    }
    if (inserted.length) return { kind: "joined", accountId: inserted[0].id };
  }
  const [acc] = await sql()`select id, sangh_id from public.accounts where phone = ${phone}`;
  if (!acc) throw new Error("account vanished during join"); // removed between the two statements; caller retries
  if (acc.sangh_id === sanghId) return { kind: "logged_in", accountId: acc.id };
  const sangh = await findSanghById(acc.sangh_id);
  return { kind: "other_sangh", accountId: acc.id, sangh: sangh! };
}

export async function accountByPhone(phone: string): Promise<{ id: string } | null> {
  const [acc] = await sql()`select id from public.accounts where phone = ${phone}`;
  return acc ? { id: acc.id } : null;
}

type ProfileRow = {
  id: string; name: string; relation: "self" | "child"; role: Profile["role"]; class_id: string | null; setup_done_at: Date | null;
  photo_url?: string | null; answers?: Record<string, string | number> | null;
};
const toProfile = (p: ProfileRow, fields?: FormField[]): Profile => ({
  id: p.id, name: p.name, relation: p.relation, role: p.role, classId: p.class_id, setupDone: p.setup_done_at !== null,
  photoUrl: p.photo_url ?? null,
  answers: p.answers ?? {},
  // Only for people who finished joining: newly required questions are asked the next time they open the app.
  missing: fields && p.setup_done_at ? missingRequired(fields, { answers: p.answers ?? {}, classId: p.class_id, photoUrl: p.photo_url ?? null }) : [],
});

export async function getMe(accountId: string, profileId: string | null): Promise<Me> {
  return asAccount(accountId, async (tx) => {
    const [acc] = await tx`select a.phone, s.id, s.name, s.city, s.logo_url, s.join_code, s.form_fields
      from public.accounts a join public.sanghs s on s.id = a.sangh_id`;
    const classes = await tx<{ id: string; name: string; name_hi: string | null; hidden: boolean; age_min: number | null; age_max: number | null }[]>`
      select id, name, name_hi, hidden, age_min, age_max from public.classes order by sort_order, name`;
    const profiles = await tx<ProfileRow[]>`
      select p.id, p.name, p.relation, p.role, p.class_id, p.setup_done_at, p.photo_url, pa.answers
      from public.profiles p left join public.profile_answers pa on pa.profile_id = p.id
      where p.account_id = ${accountId} order by p.created_at`;
    const fields = parseFormFields(acc.form_fields);
    return {
      phone: maskPhone(acc.phone),
      sangh: toCard(acc as SanghRow),
      classes: classes.map((c): ClassItem => ({ id: c.id, name: c.name, nameHi: c.name_hi, hidden: c.hidden, ageMin: c.age_min, ageMax: c.age_max })),
      formFields: fields,
      profiles: profiles.map((p) => toProfile(p, fields)),
      activeProfileId: profiles.some((p) => p.id === profileId) ? profileId : null,
    };
  });
}

export type CreateProfileResult =
  | { ok: true; profile: Profile }
  | { ok: false; reason: "consent_required" | "self_exists" | "profile_limit" };

export async function createProfile(
  accountId: string, phone: string, input: { name: string; relation: "self" | "child"; consent: boolean },
): Promise<CreateProfileResult> {
  if (input.relation === "child" && !input.consent) return { ok: false, reason: "consent_required" };
  try {
    return await asAccount(accountId, async (tx) => {
      const [{ n }] = await tx`select count(*)::int as n from public.profiles where account_id = ${accountId}`;
      if (n >= config().MAX_PROFILES_PER_ACCOUNT) return { ok: false as const, reason: "profile_limit" as const };
      const consentAt = input.relation === "child" ? new Date() : null;
      const [p] = await tx<ProfileRow[]>`
        insert into public.profiles (account_id, name, relation, consent_at, consent_phone)
        values (${accountId}, ${input.name}, ${input.relation}, ${consentAt}, ${consentAt ? phone : null})
        returning id, name, relation, role, class_id, setup_done_at`;
      return { ok: true as const, profile: toProfile(p) };
    });
  } catch (e) {
    if (pgCode(e) === "23505") return { ok: false, reason: "self_exists" };
    if (pgCode(e) === "P0001") return { ok: false, reason: "profile_limit" };
    throw e;
  }
}

export type SetupResult =
  | { ok: true; profile: Profile }
  | { ok: false; reason: "not_found" | "invalid_class" }
  | { ok: false; reason: "invalid_answers"; fields: AnswerErrors };

/**
 * Saves the class and the sangh's questions for one profile. Can be repeated (it overwrites).
 * Follows the sangh's current join form: the class is needed only if the form asks for it,
 * a class hidden from new joins can't be picked (unless the person is already in it), and a
 * required photo must have been uploaded first (POST /api/profiles/:id/photo).
 */
export async function setupProfile(
  accountId: string, profileId: string, classId: string | null, rawAnswers: Record<string, unknown>,
): Promise<SetupResult> {
  return asAccount(accountId, async (tx) => {
    const [p] = await tx`select id, class_id, photo_url from public.profiles where id = ${profileId} and account_id = ${accountId} for update`;
    if (!p) return { ok: false as const, reason: "not_found" as const };
    const [s] = await tx`select form_fields from public.sanghs`;
    const fields = parseFormFields(s.form_fields);
    const classField = fields.find((f) => f.type === "class");
    if (classId) {
      const [cls] = await tx`select id, hidden from public.classes where id = ${classId}`; // RLS: own sangh only
      if (!cls || (cls.hidden && p.class_id !== classId)) return { ok: false as const, reason: "invalid_class" as const };
    } else if (classField?.required) {
      return { ok: false as const, reason: "invalid_class" as const };
    }
    const checked = validateAnswers(fields, rawAnswers);
    const errors: AnswerErrors = checked.ok ? {} : { ...checked.errors };
    if (fields.some((f) => f.type === "photo" && f.required) && !p.photo_url) errors.photo = "required";
    if (!checked.ok || Object.keys(errors).length) return { ok: false as const, reason: "invalid_answers" as const, fields: errors };
    // Answers to questions the form no longer asks are kept, so turning a question off never loses data.
    const [old] = await tx`select answers from public.profile_answers where profile_id = ${profileId}`;
    const asked = new Set(fields.map((f) => f.key));
    const kept = Object.fromEntries(Object.entries((old?.answers ?? {}) as Record<string, string | number>).filter(([k]) => !asked.has(k)));
    const answers = { ...kept, ...checked.answers };
    await tx`
      insert into public.profile_answers (profile_id, answers) values (${profileId}, ${tx.json(answers)})
      on conflict (profile_id) do update set answers = excluded.answers, updated_at = now()`;
    const [row] = await tx<ProfileRow[]>`
      update public.profiles set class_id = ${classId}, setup_done_at = coalesce(setup_done_at, now())
      where id = ${profileId}
      returning id, name, relation, role, class_id, setup_done_at, photo_url`;
    return { ok: true as const, profile: toProfile({ ...row, answers }, fields) };
  });
}

/** A member's own profile photo. The picture is already stored; this records where. */
export async function setProfilePhoto(accountId: string, profileId: string, url: string): Promise<boolean> {
  return asAccount(accountId, async (tx) => {
    const r = await tx`update public.profiles set photo_url = ${url} where id = ${profileId} and account_id = ${accountId} returning id`;
    return r.length === 1;
  });
}

export async function profileBelongs(accountId: string, profileId: string): Promise<boolean> {
  return asAccount(accountId, async (tx) => {
    const rows = await tx`select 1 from public.profiles where id = ${profileId}`;
    return rows.length === 1;
  });
}

/** Admin removes a number from their own sangh. Returns false if the number isn't in it. */
export async function adminRemoveNumber(accountId: string, phone: string): Promise<"removed" | "not_found" | "forbidden"> {
  try {
    const [r] = await asAccount(accountId, (tx) => tx`select public.admin_remove_account(${phone}) as removed`);
    return r.removed ? "removed" : "not_found";
  } catch (e) {
    if (pgCode(e) === "42501" || pgCode(e) === "P0001") return "forbidden";
    throw e;
  }
}
