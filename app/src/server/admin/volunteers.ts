import "server-only";
import { z } from "zod";
import { asAdmin } from "../db";
import { log } from "../log";
import { PERMS, type VolunteersPage } from "@/lib/admin-types";
import { formatPhone } from "@/lib/phone";

// Volunteers and teachers of one sangh, and the activity log. Only the sangh's admins manage these
// (row-level security on sangh_volunteers and activity_log says so too).

export const volunteerInput = z.object({
  phone: z.string().max(20),
  name: z.string().trim().min(1).max(60),
  classIds: z.array(z.uuid()).max(100).default([]),
  perms: z.array(z.enum(PERMS)).max(PERMS.length).default(["view_members", "attendance"]),
});

export async function getVolunteers(phone: string, sanghId: string): Promise<VolunteersPage> {
  return asAdmin(phone, async (tx) => {
    const vols = await tx`
      select phone, name, class_ids, perms, added_at from public.sangh_volunteers where sangh_id = ${sanghId} order by name`;
    const classes = await tx<{ id: string; name: string }[]>`select id, name from public.classes where sangh_id = ${sanghId} order by sort_order, name`;
    const members = await tx`
      select distinct on (a.phone) p.name, a.phone from public.accounts a
      join public.profiles p on p.account_id = a.id and p.relation = 'self' and p.removed_at is null
      where a.sangh_id = ${sanghId} order by a.phone, p.created_at limit 2000`;
    const activity = await tx`
      select l.at, l.actor, l.action, l.detail,
        (select v.name from public.sangh_volunteers v where v.sangh_id = l.sangh_id and v.phone = l.actor) as vname
      from public.activity_log l where l.sangh_id = ${sanghId} order by l.at desc limit 100`;
    return {
      volunteers: vols.map((v) => ({ phone: formatPhone(v.phone), name: v.name, classIds: v.class_ids, perms: v.perms, addedAt: new Date(v.added_at).toISOString() })),
      classes: [...classes],
      members: members.map((m) => ({ name: m.name, phone: formatPhone(m.phone) })).sort((a, b) => a.name.localeCompare(b.name)),
      activity: activity.map((a) => ({ at: new Date(a.at).toISOString(), who: a.vname ?? formatPhone(a.actor), action: a.action, detail: a.detail })),
    };
  });
}

/** Adds a volunteer, or changes one (same number). False if the number is already an admin here, or a class isn't this sangh's. */
export async function saveVolunteer(phone: string, sanghId: string, v: { phone: string; name: string; classIds: string[]; perms: string[] }): Promise<"ok" | "is_admin" | "invalid_class"> {
  return asAdmin(phone, async (tx) => {
    const [adm] = await tx`select 1 from public.sangh_admins where sangh_id = ${sanghId} and phone = ${v.phone}`;
    if (adm) return "is_admin" as const;
    if (v.classIds.length) {
      const [{ n }] = await tx`select count(*)::int as n from public.classes where sangh_id = ${sanghId} and id = any(${tx.array(v.classIds)}::uuid[])`;
      if (n !== new Set(v.classIds).size) return "invalid_class" as const;
    }
    await tx`
      insert into public.sangh_volunteers (sangh_id, phone, name, class_ids, perms, added_by)
      values (${sanghId}, ${v.phone}, ${v.name}, ${tx.array([...new Set(v.classIds)])}::uuid[], ${tx.array([...new Set(v.perms)])}::text[], ${phone})
      on conflict (sangh_id, phone) do update set name = excluded.name, class_ids = excluded.class_ids, perms = excluded.perms`;
    return "ok" as const;
  });
}

export async function removeVolunteer(phone: string, sanghId: string, volunteerPhone: string): Promise<boolean> {
  const r = await asAdmin(phone, (tx) => tx`delete from public.sangh_volunteers where sangh_id = ${sanghId} and phone = ${volunteerPhone} returning phone`);
  // Their open sessions lose this sangh at once: sanghRoute checks access on every request.
  return r.length > 0;
}

/** One line in the activity log. Never fails the action it records. */
export async function logActivity(phone: string, sanghId: string, action: string, detail: string | null = null): Promise<void> {
  try {
    await asAdmin(phone, (tx) => tx`
      insert into public.activity_log (sangh_id, actor, action, detail) values (${sanghId}, ${phone}, ${action.slice(0, 40)}, ${detail?.slice(0, 200) ?? null})`);
  } catch (e) {
    log.error("activity_log_failed", { action, error: (e as Error).message });
  }
}

/** A name to write in the activity log, read before the change (the row may be gone after it). */
export async function nameFor(phone: string, kind: "profile" | "niyam" | "announcement" | "class" | "family", id: string): Promise<string | null> {
  const [r] = await asAdmin(phone, (tx) => {
    switch (kind) {
      case "profile": return tx`select name from public.profiles where id = ${id}`;
      case "niyam": return tx`select name from public.niyams where id = ${id}`;
      case "announcement": return tx`select title as name from public.announcements where id = ${id}`;
      case "class": return tx`select name from public.classes where id = ${id}`;
      case "family": return tx`select string_agg(name, ', ' order by created_at) as name from public.profiles where account_id = ${id} and removed_at is null`;
    }
  });
  return r?.name ?? null;
}
