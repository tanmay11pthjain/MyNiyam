import "server-only";
import { randomInt } from "node:crypto";
import { asAdmin, pgCode, pgHint } from "../db";
import type { AdminMe, AdminSangh, SanghProfile, SuperSangh } from "@/lib/admin-types";
import { formatPhone, maskPhone } from "@/lib/phone";

// The admin's sanghs, the sangh profile and join settings, and the super admin's sangh list.
// Everything runs through asAdmin, so row-level security decides which sanghs are reachable.

// No 0/O or 1/I: codes are read aloud and copied from posters.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function randomJoinCode(): string {
  return Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
}

/** Tries fresh codes until one is free (a clash is about 1 in a billion per try). */
async function withFreshCode<T>(fn: (code: string) => Promise<T>): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn(randomJoinCode());
    } catch (e) {
      if (pgCode(e) === "23505" && i < 5) continue;
      throw e;
    }
  }
}

export async function adminMe(phone: string, isSuper: boolean, activeSanghId: string | null): Promise<AdminMe> {
  // Sanghs this phone runs, then those it volunteers in (an admin row wins if it is both).
  const sanghs = await asAdmin(phone, (tx) => tx<AdminSangh[]>`
    select s.id, s.name, s.city, s.status, 'admin' as role, '{}'::text[] as perms from public.sanghs s
    join public.sangh_admins sa on sa.sangh_id = s.id and sa.phone = ${phone}
    union all
    select s.id, s.name, s.city, s.status, 'volunteer', v.perms from public.sanghs s
    join public.sangh_volunteers v on v.sangh_id = s.id and v.phone = ${phone}
    where s.status = 'active' and not exists (select 1 from public.sangh_admins sa where sa.sangh_id = s.id and sa.phone = ${phone})
    order by name`);
  const active = sanghs.some((s) => s.id === activeSanghId) ? activeSanghId : null;
  return { phone: formatPhone(phone), isSuper, sanghs: [...sanghs], activeSanghId: active };
}

/** True if this phone is an admin or a volunteer of the sangh (used before switching to it, and for photos). */
export async function isAdminOf(phone: string, sanghId: string): Promise<boolean> {
  const [r] = await asAdmin(phone, (tx) => tx`select private.has_access(${sanghId}) as ok`);
  return r.ok;
}

type ProfileRow = {
  id: string; name: string; name_hi: string | null; city: string; area: string | null; sampraday: string | null;
  contact_phone: string | null; about: string | null; logo_url: string | null; join_code: string; status: SanghProfile["status"];
  join_open: boolean; searchable: boolean; log_back_hours: number; lat: number | null; lon: number | null;
};
const toProfile = (r: ProfileRow): SanghProfile => ({
  id: r.id, name: r.name, nameHi: r.name_hi, city: r.city, area: r.area, sampraday: r.sampraday, contactPhone: r.contact_phone,
  about: r.about, logoUrl: r.logo_url, joinCode: r.join_code, status: r.status, joinOpen: r.join_open, searchable: r.searchable,
  logBackHours: r.log_back_hours, location: r.lat !== null && r.lon !== null ? { lat: r.lat, lon: r.lon } : null,
});

export async function getSanghProfile(phone: string, sanghId: string): Promise<SanghProfile | null> {
  const [r] = await asAdmin(phone, (tx) => tx<ProfileRow[]>`
    select id, name, name_hi, city, area, sampraday, contact_phone, about, logo_url, join_code, status, join_open, searchable, log_back_hours, lat, lon
    from public.sanghs where id = ${sanghId} and private.is_sangh_admin(id)`);
  return r ? toProfile(r) : null;
}

export type SanghPatch = Partial<{
  name: string; nameHi: string | null; city: string; area: string | null; sampraday: string | null; contactPhone: string | null;
  about: string | null; joinOpen: boolean; searchable: boolean; logBackHours: number; lat: number | null; lon: number | null;
}>;

const COLUMNS: Record<keyof SanghPatch, string> = {
  name: "name", nameHi: "name_hi", city: "city", area: "area", sampraday: "sampraday", contactPhone: "contact_phone",
  about: "about", joinOpen: "join_open", searchable: "searchable", logBackHours: "log_back_hours", lat: "lat", lon: "lon",
};

export async function updateSanghProfile(phone: string, sanghId: string, patch: SanghPatch): Promise<SanghProfile | null> {
  const row: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) row[COLUMNS[k as keyof SanghPatch]] = v;
  return asAdmin(phone, async (tx) => {
    if (Object.keys(row).length) await tx`update public.sanghs set ${tx(row)} where id = ${sanghId}`;
    const [r] = await tx<ProfileRow[]>`
      select id, name, name_hi, city, area, sampraday, contact_phone, about, logo_url, join_code, status, join_open, searchable, log_back_hours, lat, lon
      from public.sanghs where id = ${sanghId} and private.is_sangh_admin(id)`;
    return r ? toProfile(r) : null;
  });
}

/** A new join code. The old code stops working straight away. */
export async function regenerateJoinCode(phone: string, sanghId: string): Promise<string> {
  return withFreshCode(async (code) => {
    await asAdmin(phone, (tx) => tx`select public.admin_set_join_code(${sanghId}, ${code})`);
    return code;
  });
}

/** Ticks "share the code" on the setup checklist (copy, WhatsApp, QR download or poster). */
export async function markCodeShared(phone: string, sanghId: string) {
  await asAdmin(phone, (tx) => tx`update public.sanghs set code_shared_at = coalesce(code_shared_at, now()) where id = ${sanghId}`);
}

export async function setLogo(phone: string, sanghId: string, url: string | null) {
  await asAdmin(phone, (tx) => tx`update public.sanghs set logo_url = ${url} where id = ${sanghId}`);
}

// ---------------------------------------------------------------------------
// New sanghs: anyone signed in as an admin may ask; only the super admin approves.
// ---------------------------------------------------------------------------
export async function requestSangh(phone: string, name: string, city: string): Promise<{ ok: true; id: string } | { ok: false; reason: "too_many_requests" }> {
  try {
    const id = await withFreshCode(async (code) => {
      const [r] = await asAdmin(phone, (tx) => tx`select public.request_sangh(${name}, ${city}, ${code}) as id`);
      return r.id as string;
    });
    return { ok: true, id };
  } catch (e) {
    if (pgHint(e) === "too_many_requests") return { ok: false, reason: "too_many_requests" };
    throw e;
  }
}

export async function superListSanghs(phone: string): Promise<SuperSangh[]> {
  const rows = await asAdmin(phone, (tx) => tx`
    select s.id, s.name, s.city, s.status, s.join_code, s.requested_by, s.created_at,
      coalesce((select array_agg(sa.phone order by sa.added_at) from public.sangh_admins sa where sa.sangh_id = s.id), '{}') as admins,
      coalesce(c.families, 0) as families
    from public.sanghs s left join public.super_family_counts() c on c.sangh_id = s.id
    where private.is_super_admin()
    order by (s.status = 'pending') desc, s.created_at desc limit 500`);
  return rows.map((r) => ({
    id: r.id, name: r.name, city: r.city, status: r.status, joinCode: r.join_code,
    admins: (r.admins as string[]).map(formatPhone), families: r.families,
    requestedBy: r.requested_by ? maskPhone(r.requested_by) : null, createdAt: new Date(r.created_at).toISOString(),
  }));
}

export async function superCreateSangh(phone: string, name: string, city: string, adminPhone: string | null): Promise<string> {
  return withFreshCode(async (code) => {
    const [r] = await asAdmin(phone, (tx) => tx`select public.super_create_sangh(${name}, ${city}, ${code}, ${adminPhone}) as id`);
    return r.id as string;
  });
}

export async function superApprove(phone: string, sanghId: string): Promise<boolean> {
  const [r] = await asAdmin(phone, (tx) => tx`select public.super_approve_sangh(${sanghId}) as ok`);
  return r.ok;
}

export async function superReject(phone: string, sanghId: string): Promise<boolean> {
  const [r] = await asAdmin(phone, (tx) => tx`select public.super_reject_sangh(${sanghId}) as ok`);
  return r.ok;
}

export async function superSetAdmin(phone: string, sanghId: string, adminPhone: string, makeAdmin: boolean) {
  await asAdmin(phone, (tx) => tx`select public.super_set_admin(${sanghId}, ${adminPhone}, ${makeAdmin})`);
}
