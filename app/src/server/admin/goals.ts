import "server-only";
import { z } from "zod";
import { asAdmin, pgCode, type Tx } from "../db";
import type { Goal, GoalsPage } from "@/lib/admin-types";

// Pathshala goals and challenges (P3). A total adds up everyone's logs of one niyam between two dates;
// a challenge is finished by each person who keeps that niyam on enough days (they earn its badge).

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const goalInput = z.object({
  kind: z.enum(["total", "challenge"]),
  title: z.string().trim().min(2).max(80),
  titleHi: z.string().trim().max(80).nullable().default(null).transform((s) => s || null),
  niyamId: z.uuid(),
  target: z.number().int().min(1).max(100_000_000).nullable().default(null),
  days: z.number().int().min(1).max(367).nullable().default(null),
  startDate: date,
  endDate: date,
  allClasses: z.boolean().default(true),
  classIds: z.array(z.uuid()).max(100).default([]),
}).superRefine((g, ctx) => {
  const bad = (path: string) => ctx.addIssue({ code: "custom", path: [path], message: path });
  if (g.startDate > g.endDate) bad("dates");
  const span = (Date.parse(g.endDate) - Date.parse(g.startDate)) / 864e5 + 1;
  if (span > 367) bad("dates");
  if (g.kind === "total" && !g.target) bad("target");
  if (g.kind === "challenge" && (!g.days || g.days > span)) bad("days");
  if (!g.allClasses && !g.classIds.length) bad("classIds");
});
export type GoalBody = z.infer<typeof goalInput>;

async function list(tx: Tx, sanghId: string): Promise<Goal[]> {
  const rows = await tx`
    select g.id, g.kind, g.title, g.title_hi, g.niyam_id, n.name as niyam_name, g.target, g.days,
      g.start_date::text as start_date, g.end_date::text as end_date, g.all_classes, g.class_ids::text[] as class_ids,
      case when private.local_today() < g.start_date then 'upcoming' when private.local_today() > g.end_date then 'ended' else 'live' end as state,
      gp.total, gp.finishers
    from public.sangh_goals g join public.niyams n on n.id = g.niyam_id
    cross join lateral public.goal_progress(g.id) gp
    where g.sangh_id = ${sanghId}
    order by (private.local_today() > g.end_date), g.start_date desc`;
  return rows.map((r) => ({
    id: r.id, kind: r.kind, title: r.title, titleHi: r.title_hi, niyamId: r.niyam_id, niyamName: r.niyam_name,
    target: r.target, days: r.days, startDate: r.start_date, endDate: r.end_date, allClasses: r.all_classes,
    classIds: r.class_ids, state: r.state, total: Number(r.total), finishers: r.finishers,
  }));
}

export async function getGoals(phone: string, sanghId: string): Promise<GoalsPage> {
  return asAdmin(phone, async (tx) => {
    const niyams = await tx<{ id: string; name: string; type: GoalsPage["niyams"][number]["type"] }[]>`
      select id, name, type from public.niyams where sangh_id = ${sanghId} and status <> 'archived' order by sort_order, created_at`;
    const classes = await tx<{ id: string; name: string }[]>`select id, name from public.classes where sangh_id = ${sanghId} order by sort_order, name`;
    const [{ today }] = await tx<{ today: string }[]>`select private.local_today()::text as today`;
    return { goals: await list(tx, sanghId), niyams, classes, today };
  });
}

const row = (sanghId: string, g: GoalBody, phone: string) => ({
  sangh_id: sanghId, kind: g.kind, title: g.title, title_hi: g.titleHi, niyam_id: g.niyamId,
  target: g.kind === "total" ? g.target : null, days: g.kind === "challenge" ? g.days : null,
  start_date: g.startDate, end_date: g.endDate, all_classes: g.allClasses, class_ids: g.allClasses ? [] : g.classIds, created_by: phone,
});

/** Saves a new goal (id null) or changes one. Null when the niyam or a class isn't in this sangh. */
export async function saveGoal(phone: string, sanghId: string, id: string | null, g: GoalBody): Promise<Goal[] | null | "not_found"> {
  try {
    return await asAdmin(phone, async (tx) => {
      const r = row(sanghId, g, phone);
      if (id) {
        const change: Partial<typeof r> = { ...r };
        delete change.created_by;
        const done = await tx`update public.sangh_goals set ${tx(change)} where id = ${id} and sangh_id = ${sanghId} returning id`;
        if (!done.length) return "not_found" as const;
      } else {
        await tx`insert into public.sangh_goals ${tx(r)}`;
      }
      return list(tx, sanghId);
    });
  } catch (e) {
    if (pgCode(e) === "23514") return null; // check_violation: niyam or class from elsewhere, or bad dates
    throw e;
  }
}

export async function deleteGoal(phone: string, sanghId: string, id: string): Promise<Goal[] | null> {
  return asAdmin(phone, async (tx) => {
    const r = await tx`delete from public.sangh_goals where id = ${id} and sangh_id = ${sanghId} returning id`;
    return r.length ? list(tx, sanghId) : null;
  });
}
