import "server-only";
import { asAdmin } from "../db";
import { checkFormFields, parseFormFields, type FormField } from "@/lib/forms";
import type { FormPage } from "@/lib/admin-types";

// The join form of one sangh (sanghs.form_fields). Saving never touches members' answers:
// a newly required question is simply asked the next time each member opens the app.

export async function getForm(phone: string, sanghId: string): Promise<FormPage | null> {
  return asAdmin(phone, async (tx) => {
    const [s] = await tx`select name, form_fields from public.sanghs where id = ${sanghId} and private.is_sangh_admin(id)`;
    if (!s) return null;
    const classes = await tx<FormPage["classes"]>`
      select id, name, name_hi as "nameHi", hidden, age_min as "ageMin", age_max as "ageMax"
      from public.classes where sangh_id = ${sanghId} order by sort_order, name`;
    return { fields: parseFormFields(s.form_fields), classes: [...classes], sanghName: s.name };
  });
}

export async function saveForm(phone: string, sanghId: string, raw: unknown):
  Promise<{ ok: true; fields: FormField[] } | { ok: false; reason: "invalid_field" | "duplicate_key" | "no_sangh" }> {
  const checked = checkFormFields(raw);
  if (!checked.ok) return { ok: false, reason: checked.reason === "duplicate_key" ? "duplicate_key" : "invalid_field" };
  const r = await asAdmin(phone, (tx) => tx`
    update public.sanghs set form_fields = ${tx.json(checked.fields)}, form_updated_at = now()
    where id = ${sanghId} returning id`);
  if (!r.length) return { ok: false, reason: "no_sangh" };
  return { ok: true, fields: checked.fields };
}
