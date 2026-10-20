import "server-only";
import { z } from "zod";
import { asAdmin, pgCode, pgHint } from "../db";
import { fail, ok } from "../http";
import type { SanghCtx } from "./http";
import type { AdminClass } from "@/lib/admin-types";

// Classes of one sangh. A class with members can't be deleted (classes_no_delete_with_members);
// it can be hidden from new joins instead, and its members keep it.

type Row = { id: string; name: string; name_hi: string | null; hidden: boolean; age_min: number | null; age_max: number | null; members: number };
const toClass = (r: Row): AdminClass => ({ id: r.id, name: r.name, nameHi: r.name_hi, hidden: r.hidden, ageMin: r.age_min, ageMax: r.age_max, members: r.members });

export async function listClasses(phone: string, sanghId: string): Promise<AdminClass[]> {
  const rows = await asAdmin(phone, (tx) => tx<Row[]>`
    select c.id, c.name, c.name_hi, c.hidden, c.age_min, c.age_max,
      (select count(*)::int from public.profiles p join public.accounts a on a.id = p.account_id
       where p.class_id = c.id and p.removed_at is null and a.removed_at is null) as members
    from public.classes c where c.sangh_id = ${sanghId}
    order by c.sort_order, c.name`);
  return rows.map(toClass);
}

export type ClassInput = { name: string; nameHi: string | null; ageMin: number | null; ageMax: number | null; hidden?: boolean };
export type ClassResult = { ok: true; classes: AdminClass[] } | { ok: false; reason: "duplicate_key" | "class_has_members" | "not_found" };

export async function createClass(phone: string, sanghId: string, input: ClassInput): Promise<ClassResult> {
  try {
    await asAdmin(phone, (tx) => tx`
      insert into public.classes (sangh_id, name, name_hi, age_min, age_max, sort_order)
      values (${sanghId}, ${input.name}, ${input.nameHi}, ${input.ageMin}, ${input.ageMax},
              (select coalesce(max(sort_order), 0) + 1 from public.classes where sangh_id = ${sanghId}))`);
  } catch (e) {
    if (pgCode(e) === "23505") return { ok: false, reason: "duplicate_key" };
    throw e;
  }
  return { ok: true, classes: await listClasses(phone, sanghId) };
}

export async function updateClass(phone: string, sanghId: string, id: string, input: Partial<ClassInput>): Promise<ClassResult> {
  const row: Record<string, unknown> = {};
  if (input.name !== undefined) row.name = input.name;
  if (input.nameHi !== undefined) row.name_hi = input.nameHi;
  if (input.ageMin !== undefined) row.age_min = input.ageMin;
  if (input.ageMax !== undefined) row.age_max = input.ageMax;
  if (input.hidden !== undefined) row.hidden = input.hidden;
  try {
    const r = await asAdmin(phone, (tx) => (Object.keys(row).length
      ? tx`update public.classes set ${tx(row)} where id = ${id} and sangh_id = ${sanghId} returning id`
      : tx`select id from public.classes where id = ${id} and sangh_id = ${sanghId}`));
    if (!r.length) return { ok: false, reason: "not_found" };
  } catch (e) {
    if (pgCode(e) === "23505") return { ok: false, reason: "duplicate_key" };
    throw e;
  }
  return { ok: true, classes: await listClasses(phone, sanghId) };
}

export async function deleteClass(phone: string, sanghId: string, id: string): Promise<ClassResult> {
  try {
    const r = await asAdmin(phone, (tx) => tx`delete from public.classes where id = ${id} and sangh_id = ${sanghId} returning id`);
    if (!r.length) return { ok: false, reason: "not_found" };
  } catch (e) {
    if (pgHint(e) === "class_has_members") return { ok: false, reason: "class_has_members" };
    throw e;
  }
  return { ok: true, classes: await listClasses(phone, sanghId) };
}

/** Saves a new order. `ids` must be exactly this sangh's classes. */
export async function reorderClasses(phone: string, sanghId: string, ids: string[]): Promise<ClassResult> {
  const ok = await asAdmin(phone, async (tx) => {
    const have = await tx`select id from public.classes where sangh_id = ${sanghId} for update`;
    if (have.length !== ids.length || !have.every((r) => ids.includes(r.id))) return false;
    await tx`update public.classes c set sort_order = o.ord
      from unnest(${tx.array(ids)}::uuid[]) with ordinality as o(id, ord) where c.id = o.id`;
    return true;
  });
  if (!ok) return { ok: false, reason: "not_found" };
  return { ok: true, classes: await listClasses(phone, sanghId) };
}

// Shared by the /api/admin/classes routes.
export const classBody = z.object({
  name: z.string().trim().min(1).max(80),
  nameHi: z.string().trim().max(80).nullable().default(null).transform((s) => s || null),
  ageMin: z.number().int().min(0).max(120).nullable().default(null),
  ageMax: z.number().int().min(0).max(120).nullable().default(null),
}).refine((c) => c.ageMin === null || c.ageMax === null || c.ageMin <= c.ageMax);

export function classReply(ctx: SanghCtx, r: ClassResult) {
  return r.ok ? ok(ctx, { classes: r.classes }) : fail(ctx, { error: r.reason });
}
