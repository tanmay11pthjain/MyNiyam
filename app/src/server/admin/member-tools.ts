import "server-only";
import { asAdmin, pgHint, sql } from "../db";
import { createProfile, joinSangh } from "../onboarding";
import { parseFormFields, validateAnswers, type AnswerErrors } from "@/lib/forms";

// Member tools for the admin panel: correct a member's details, add a member who has no phone of
// their own to use (the admin types the code the member reads out), move a whole class up, and hand
// the pathshala over to another number.

/** The form and current answers, for the edit sheet. */
export async function memberForm(phone: string, sanghId: string, profileId: string) {
  return asAdmin(phone, async (tx) => {
    // can_on_profile checks the person is in this sangh and in the caller's classes.
    const [r] = await tx`
      select p.name, coalesce(pa.answers, '{}') as answers, (select form_fields from public.sanghs where id = ${sanghId}) as form_fields
      from public.profiles p left join public.profile_answers pa on pa.profile_id = p.id
      where p.id = ${profileId} and private.can_on_profile(p.id, 'setup')
        and private.profile_sangh(p.id) = ${sanghId}`;
    if (!r) return null;
    const fields = parseFormFields(r.form_fields).filter((f) => f.type !== "class" && f.type !== "photo");
    return { name: r.name as string, fields, answers: r.answers as Record<string, string> };
  });
}

export type EditResult = { ok: true } | { ok: false; reason: "not_found" } | { ok: false; reason: "invalid_answers"; fields: AnswerErrors };

/** Saves a corrected name and answers. Answers to questions no longer asked are kept. */
export async function editMember(phone: string, sanghId: string, profileId: string, name: string, raw: Record<string, unknown>): Promise<EditResult> {
  return asAdmin(phone, async (tx) => {
    const [r] = await tx`
      select (select form_fields from public.sanghs where id = ${sanghId}) as form_fields, coalesce(pa.answers, '{}') as answers
      from public.profiles p left join public.profile_answers pa on pa.profile_id = p.id
      where p.id = ${profileId} and private.can_on_profile(p.id, 'setup') and private.profile_sangh(p.id) = ${sanghId}`;
    if (!r) return { ok: false as const, reason: "not_found" as const };
    const fields = parseFormFields(r.form_fields);
    const checked = validateAnswers(fields, raw);
    if (!checked.ok) return { ok: false as const, reason: "invalid_answers" as const, fields: checked.errors };
    const asked = new Set(fields.map((f) => f.key));
    const kept = Object.fromEntries(Object.entries(r.answers as Record<string, unknown>).filter(([k]) => !asked.has(k)));
    await tx`update public.profiles set name = ${name} where id = ${profileId}`;
    await tx`
      insert into public.profile_answers (profile_id, answers) values (${profileId}, ${tx.json({ ...kept, ...checked.answers } as never)})
      on conflict (profile_id) do update set answers = excluded.answers, updated_at = now()`;
    return { ok: true as const };
  });
}

export type AddResult = { ok: true; profileId: string } | { ok: false; reason: "already_member" | "other_sangh" | "joins_closed" };

/**
 * Adds a member on their behalf, after the admin typed the code sent to that member's number.
 * They finish the join form themselves the first time they open the app.
 */
export async function addOnBehalf(adminPhone: string, sanghId: string, phone: string, name: string, classId: string | null): Promise<AddResult> {
  const [existing] = await sql()`select sangh_id from public.accounts where phone = ${phone}`;
  if (existing) return { ok: false, reason: existing.sangh_id === sanghId ? "already_member" : "other_sangh" };
  const j = await joinSangh(phone, sanghId);
  if (j.kind === "closed") return { ok: false, reason: "joins_closed" };
  if (j.kind !== "joined") return { ok: false, reason: j.kind === "other_sangh" ? "other_sangh" : "already_member" };
  const p = await createProfile(j.accountId, phone, { name, relation: "self", consent: false });
  if (!p.ok) throw new Error(`could not add profile: ${p.reason}`);
  if (classId) {
    await asAdmin(adminPhone, (tx) => tx`update public.profiles set class_id = ${classId} where id = ${p.profile.id}`);
  }
  return { ok: true, profileId: p.profile.id };
}

/** Moves everyone in class `from` to class `to` (the yearly promotion). Returns how many moved, or null. */
export async function moveClass(phone: string, sanghId: string, from: string, to: string): Promise<number | null> {
  return asAdmin(phone, async (tx) => {
    const ok = await tx`select id from public.classes where sangh_id = ${sanghId} and id in (${from}, ${to})`;
    if (from === to || ok.length !== 2) return null;
    const moved = await tx`
      update public.profiles p set class_id = ${to} from public.accounts a
      where a.id = p.account_id and a.sangh_id = ${sanghId} and p.class_id = ${from} and p.removed_at is null
      returning p.id`;
    return moved.length;
  });
}

/** Hands the pathshala to `newPhone` (both numbers already verified). The caller stops being its admin. */
export async function transferSangh(phone: string, sanghId: string, newPhone: string): Promise<"ok" | "same_number"> {
  try {
    await asAdmin(phone, (tx) => tx`select public.transfer_sangh(${sanghId}, ${newPhone})`);
    return "ok";
  } catch (e) {
    if (pgHint(e) === "same_number") return "same_number";
    throw e;
  }
}
