import "server-only";
import { z } from "zod";
import { asAdmin, type Tx } from "../db";
import type { Niyam, NiyamsPage } from "@/lib/admin-types";

// Niyams of one sangh. Pausing or archiving keeps every past log; archived niyams are hidden
// from members. Which classes a niyam is for lives in niyam_classes (empty when allClasses).

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
// points: a tapasya level's own Tej (Upvas earns more than Navkarsi). Missing = the niyam's points.
const option = z.object({ value: z.string().min(1).max(40), en: z.string().trim().min(1).max(40), hi: z.string().trim().max(40).optional(),
  points: z.number().int().min(0).max(500).optional() });

export const niyamInput = z.object({
  name: z.string().trim().min(1).max(60),
  nameHi: z.string().trim().max(60).nullable().default(null).transform((s) => s || null),
  type: z.enum(["yesno", "count", "duration", "choice"]),
  target: z.number().int().min(1).max(100000).nullable().default(null),
  options: z.array(option).max(12).default([]),
  icon: z.string().max(24).nullable().default(null),
  note: z.string().trim().max(200).nullable().default(null).transform((s) => s || null),
  allClasses: z.boolean().default(true),
  classIds: z.array(z.uuid()).max(100).default([]),
  schedule: z.enum(["daily", "weekdays", "range", "dates"]).default("daily"),
  /** Tithi days and other chosen dates, for schedule "dates". */
  dates: z.array(date).max(120).default([]),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  startDate: date.nullable().default(null),
  endDate: date.nullable().default(null),
  isCore: z.boolean().default(true),
  timeHint: z.enum(["navkarsi", "chauvihar"]).nullable().default(null),
  /** Tej each time it is kept (for count and minutes: each count, up to 10 a day). */
  points: z.number().int().min(0).max(100).default(10),
}).superRefine((n, ctx) => {
  const bad = (path: string) => ctx.addIssue({ code: "custom", path: [path], message: path });
  if ((n.type === "count" || n.type === "duration") && !n.target) bad("target");
  if (n.type === "choice" && (n.options.length < 2 || new Set(n.options.map((o) => o.value)).size !== n.options.length)) bad("options");
  if (n.schedule === "weekdays" && n.weekdays.length === 0) bad("weekdays");
  if (n.schedule === "range" && (!n.startDate || !n.endDate || n.startDate > n.endDate)) bad("dates");
  if (n.schedule === "dates" && n.dates.length === 0) bad("dates");
  if (!n.allClasses && n.classIds.length === 0) bad("classIds");
});
export type NiyamBody = z.infer<typeof niyamInput>;

type Row = {
  id: string; name: string; name_hi: string | null; type: Niyam["type"]; target: number | null; options: Niyam["options"];
  icon: string | null; note: string | null; all_classes: boolean; class_ids: string[]; schedule: Niyam["schedule"];
  weekdays: number[] | null; start_date: string | null; end_date: string | null; is_core: boolean; status: Niyam["status"];
  time_hint: Niyam["timeHint"]; points: number; dates: string[] | null;
};
const toNiyam = (r: Row): Niyam => ({
  id: r.id, name: r.name, nameHi: r.name_hi, type: r.type, target: r.target, options: r.options, icon: r.icon, note: r.note,
  allClasses: r.all_classes, classIds: r.class_ids, schedule: r.schedule, weekdays: r.weekdays ?? [], startDate: r.start_date,
  endDate: r.end_date, isCore: r.is_core, status: r.status, timeHint: r.time_hint, points: r.points, dates: r.dates ?? [],
});

async function list(tx: Tx, sanghId: string): Promise<Niyam[]> {
  const rows = await tx<Row[]>`
    select n.id, n.name, n.name_hi, n.type, n.target, n.options, n.icon, n.note, n.all_classes, n.schedule, n.weekdays,
      to_char(n.start_date, 'YYYY-MM-DD') as start_date, to_char(n.end_date, 'YYYY-MM-DD') as end_date, n.is_core, n.status, n.time_hint, n.points, n.dates::text[] as dates,
      coalesce((select array_agg(nc.class_id) from public.niyam_classes nc where nc.niyam_id = n.id), '{}') as class_ids
    from public.niyams n where n.sangh_id = ${sanghId}
    order by n.sort_order, n.created_at`;
  return rows.map(toNiyam);
}

export async function getNiyams(phone: string, sanghId: string): Promise<NiyamsPage> {
  return asAdmin(phone, async (tx) => {
    const classes = await tx<{ id: string; name: string }[]>`select id, name from public.classes where sangh_id = ${sanghId} order by sort_order, name`;
    const [s] = await tx`select log_back_hours from public.sanghs where id = ${sanghId}`;
    return { niyams: await list(tx, sanghId), classes: [...classes], logBackHours: s?.log_back_hours ?? 24 };
  });
}

function columns(n: NiyamBody) {
  const typed = n.type === "count" || n.type === "duration";
  return {
    name: n.name, name_hi: n.nameHi, type: n.type, target: typed ? n.target : null, options: n.type === "choice" ? n.options : [],
    icon: n.icon, note: n.note, all_classes: n.allClasses, schedule: n.schedule,
    weekdays: n.schedule === "weekdays" ? [...new Set(n.weekdays)].sort() : null,
    start_date: n.schedule === "range" ? n.startDate : null, end_date: n.schedule === "range" ? n.endDate : null, is_core: n.isCore,
    time_hint: n.type === "yesno" ? n.timeHint : null, points: n.points,
    dates: n.schedule === "dates" ? [...new Set(n.dates)].sort() : null,
  };
}

async function setClasses(tx: Tx, niyamId: string, n: NiyamBody) {
  await tx`delete from public.niyam_classes where niyam_id = ${niyamId}`;
  if (!n.allClasses && n.classIds.length) {
    await tx`insert into public.niyam_classes (niyam_id, class_id) select ${niyamId}, unnest(${tx.array(n.classIds)}::uuid[])`;
  }
}

export async function createNiyam(phone: string, sanghId: string, n: NiyamBody): Promise<Niyam[]> {
  return asAdmin(phone, async (tx) => {
    const c = columns(n);
    const [{ next }] = await tx`select coalesce(max(sort_order), 0) + 1 as next from public.niyams where sangh_id = ${sanghId}`;
    const [row] = await tx`
      insert into public.niyams ${tx({ ...c, options: tx.json(c.options), sangh_id: sanghId, sort_order: next })}
      returning id`;
    await setClasses(tx, row.id, n);
    return list(tx, sanghId);
  });
}

export async function updateNiyam(phone: string, sanghId: string, id: string, n: NiyamBody): Promise<Niyam[] | null> {
  return asAdmin(phone, async (tx) => {
    const c = columns(n);
    const r = await tx`update public.niyams set ${tx({ ...c, options: tx.json(c.options) })} where id = ${id} and sangh_id = ${sanghId} returning id`;
    if (!r.length) return null;
    await setClasses(tx, id, n);
    return list(tx, sanghId);
  });
}

export async function setNiyamStatus(phone: string, sanghId: string, id: string, status: Niyam["status"]): Promise<Niyam[] | null> {
  return asAdmin(phone, async (tx) => {
    const r = await tx`update public.niyams set status = ${status} where id = ${id} and sangh_id = ${sanghId} returning id`;
    return r.length ? list(tx, sanghId) : null;
  });
}

export async function reorderNiyams(phone: string, sanghId: string, ids: string[]): Promise<Niyam[] | null> {
  return asAdmin(phone, async (tx) => {
    const have = await tx`select id from public.niyams where sangh_id = ${sanghId} for update`;
    if (have.length !== ids.length || !have.every((r) => ids.includes(r.id))) return null;
    await tx`update public.niyams n set sort_order = o.ord
      from unnest(${tx.array(ids)}::uuid[]) with ordinality as o(id, ord) where n.id = o.id`;
    return list(tx, sanghId);
  });
}

/** Gives class `to` every niyam that class `from` has (niyams for all classes already include both). */
export async function copyClassNiyams(phone: string, sanghId: string, from: string, to: string): Promise<{ added: number; niyams: Niyam[] } | null> {
  return asAdmin(phone, async (tx) => {
    const ok = await tx`select id from public.classes where sangh_id = ${sanghId} and id in (${from}, ${to})`;
    if (from === to || ok.length !== 2) return null;
    const added = await tx`
      insert into public.niyam_classes (niyam_id, class_id)
      select nc.niyam_id, ${to} from public.niyam_classes nc join public.niyams n on n.id = nc.niyam_id
      where nc.class_id = ${from} and n.sangh_id = ${sanghId} and not n.all_classes and n.status <> 'archived'
      on conflict do nothing returning niyam_id`;
    return { added: added.length, niyams: await list(tx, sanghId) };
  });
}
