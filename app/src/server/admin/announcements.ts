import "server-only";
import { z } from "zod";
import { asAdmin, type Tx } from "../db";
import type { Announcement, AnnouncementsPage } from "@/lib/admin-types";

// Announcements of one sangh. Which classes one is for lives in announcement_classes (empty when allClasses).

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const blank = (s: string | null) => s || null;

export const announcementInput = z.object({
  title: z.string().trim().min(1).max(60),
  body: z.string().trim().max(200).nullable().default(null).transform(blank),
  imageUrl: z.string().max(300).regex(/^\/api\/files\/photos\//).nullable().default(null),
  buttonLabel: z.string().trim().max(30).nullable().default(null).transform(blank),
  buttonUrl: z.string().trim().max(500).nullable().default(null).transform(blank),
  allClasses: z.boolean().default(true),
  classIds: z.array(z.uuid()).max(100).default([]),
  startDate: date.nullable().default(null),
  endDate: date.nullable().default(null),
  pinned: z.boolean().default(false),
}).superRefine((a, ctx) => {
  const bad = (path: string) => ctx.addIssue({ code: "custom", path: [path], message: path });
  if (!a.buttonLabel !== !a.buttonUrl) bad("button");
  if (a.buttonUrl && !/^https:\/\/[^\s]+\.[^\s]+$/.test(a.buttonUrl)) bad("buttonUrl");
  if (a.startDate && a.endDate && a.startDate > a.endDate) bad("dates");
  if (!a.allClasses && a.classIds.length === 0) bad("classIds");
  if (!a.imageUrl) bad("imageUrl"); // every slide has a wide (16:9) picture
});
export type AnnouncementBody = z.infer<typeof announcementInput>;

async function list(tx: Tx, sanghId: string): Promise<Announcement[]> {
  const rows = await tx`
    select an.id, an.title, an.body, an.image_url, an.button_label, an.button_url, an.all_classes, an.pinned,
      to_char(an.start_date, 'YYYY-MM-DD') as start_date, to_char(an.end_date, 'YYYY-MM-DD') as end_date,
      case when an.end_date < private.local_today() then 'ended'
           when an.start_date > private.local_today() then 'scheduled' else 'live' end as state,
      coalesce((select array_agg(ac.class_id) from public.announcement_classes ac where ac.announcement_id = an.id), '{}') as class_ids,
      (select count(*)::int from public.announcement_views v where v.announcement_id = an.id) as views
    from public.announcements an where an.sangh_id = ${sanghId}
    order by (an.end_date < private.local_today()) nulls first, an.pinned desc, an.sort_order, an.created_at desc`;
  return rows.map((r) => ({
    id: r.id, title: r.title, body: r.body, imageUrl: r.image_url, buttonLabel: r.button_label, buttonUrl: r.button_url,
    allClasses: r.all_classes, classIds: r.class_ids, startDate: r.start_date, endDate: r.end_date, pinned: r.pinned,
    state: r.state, views: r.views,
  }));
}

export async function getAnnouncements(phone: string, sanghId: string): Promise<AnnouncementsPage> {
  return asAdmin(phone, async (tx) => {
    const classes = await tx<{ id: string; name: string }[]>`select id, name from public.classes where sangh_id = ${sanghId} order by sort_order, name`;
    const [{ today }] = await tx`select private.local_today()::text as today`;
    return { announcements: await list(tx, sanghId), classes: [...classes], today };
  });
}

/** An image must be one of this sangh's own uploads. */
const imageOk = (sanghId: string, url: string | null) => !url || url.startsWith(`/api/files/photos/${sanghId}/`);

function columns(a: AnnouncementBody) {
  return {
    title: a.title, body: a.body, image_url: a.imageUrl, button_label: a.buttonLabel, button_url: a.buttonUrl,
    all_classes: a.allClasses, start_date: a.startDate, end_date: a.endDate, pinned: a.pinned,
  };
}

async function setClasses(tx: Tx, id: string, a: AnnouncementBody) {
  await tx`delete from public.announcement_classes where announcement_id = ${id}`;
  if (!a.allClasses && a.classIds.length) {
    await tx`insert into public.announcement_classes (announcement_id, class_id) select ${id}, unnest(${tx.array(a.classIds)}::uuid[])`;
  }
}

/** Pinning one unpins the others (only one is pinned at a time). */
async function unpinOthers(tx: Tx, sanghId: string, a: AnnouncementBody, keep: string | null) {
  if (a.pinned) await tx`update public.announcements set pinned = false where sangh_id = ${sanghId} and pinned and id is distinct from ${keep}`;
}

export async function createAnnouncement(phone: string, sanghId: string, a: AnnouncementBody): Promise<Announcement[] | null> {
  if (!imageOk(sanghId, a.imageUrl)) return null;
  return asAdmin(phone, async (tx) => {
    await unpinOthers(tx, sanghId, a, null);
    const [{ next }] = await tx`select coalesce(min(sort_order), 1) - 1 as next from public.announcements where sangh_id = ${sanghId}`;
    const [row] = await tx`
      insert into public.announcements ${tx({ ...columns(a), sangh_id: sanghId, sort_order: next, created_by: phone })} returning id`;
    await setClasses(tx, row.id, a);
    return list(tx, sanghId);
  });
}

export async function updateAnnouncement(phone: string, sanghId: string, id: string, a: AnnouncementBody): Promise<Announcement[] | null> {
  if (!imageOk(sanghId, a.imageUrl)) return null;
  return asAdmin(phone, async (tx) => {
    await unpinOthers(tx, sanghId, a, id);
    const r = await tx`update public.announcements set ${tx(columns(a))} where id = ${id} and sangh_id = ${sanghId} returning id`;
    if (!r.length) return null;
    await setClasses(tx, id, a);
    return list(tx, sanghId);
  });
}

export async function deleteAnnouncement(phone: string, sanghId: string, id: string): Promise<Announcement[] | null> {
  return asAdmin(phone, async (tx) => {
    const r = await tx`delete from public.announcements where id = ${id} and sangh_id = ${sanghId} returning id`;
    return r.length ? list(tx, sanghId) : null;
  });
}

export async function reorderAnnouncements(phone: string, sanghId: string, ids: string[]): Promise<Announcement[] | null> {
  return asAdmin(phone, async (tx) => {
    const have = await tx`select id from public.announcements where sangh_id = ${sanghId} for update`;
    if (have.length !== ids.length || !have.every((r) => ids.includes(r.id))) return null;
    await tx`update public.announcements an set sort_order = o.ord
      from unnest(${tx.array(ids)}::uuid[]) with ordinality as o(id, ord) where an.id = o.id`;
    return list(tx, sanghId);
  });
}
