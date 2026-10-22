import { z } from "zod";
import { fail, ok, readJson } from "@/server/http";
import { logActivity } from "@/server/admin/volunteers";
import { sanghRouteFor } from "@/server/admin/http";
import { announcementInput, createAnnouncement, getAnnouncements, reorderAnnouncements } from "@/server/admin/announcements";
import type { AnnouncementsPage } from "@/lib/admin-types";

// GET  /api/admin/announcements                → AnnouncementsPage
// POST /api/admin/announcements { ...slide }   → { announcements }
// PUT  /api/admin/announcements { ids: [...] } → { announcements }  (new order)

export const GET = sanghRouteFor("announcements")("admin.announcements.list", async (_req, ctx) =>
  ok<AnnouncementsPage>(ctx, await getAnnouncements(ctx.admin.phone, ctx.sanghId)));

export const POST = sanghRouteFor("announcements")("admin.announcements.create", async (req, ctx) => {
  const input = await readJson(req, announcementInput);
  if (!input) return fail(ctx, { error: "invalid_field" });
  const announcements = await createAnnouncement(ctx.admin.phone, ctx.sanghId, input);
  if (!announcements) return fail(ctx, { error: "invalid_field" });
  await logActivity(ctx.admin.phone, ctx.sanghId, "Posted an announcement", input.title);
  return ok(ctx, { announcements }, { status: 201 });
});

const order = z.object({ ids: z.array(z.uuid()).max(200) });

export const PUT = sanghRouteFor("announcements")("admin.announcements.order", async (req, ctx) => {
  const input = await readJson(req, order);
  if (!input) return fail(ctx, { error: "bad_request" });
  const announcements = await reorderAnnouncements(ctx.admin.phone, ctx.sanghId, input.ids);
  return announcements ? ok(ctx, { announcements }) : fail(ctx, { error: "not_found" });
});
