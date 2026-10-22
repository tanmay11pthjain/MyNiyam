import { z } from "zod";
import { fail, ok, readJson } from "@/server/http";
import { logActivity, nameFor } from "@/server/admin/volunteers";
import { sanghRouteFor } from "@/server/admin/http";
import { announcementInput, deleteAnnouncement, updateAnnouncement } from "@/server/admin/announcements";

// PUT    /api/admin/announcements/:id { ...slide } → { announcements }
// DELETE /api/admin/announcements/:id              → { announcements }

export const PUT = sanghRouteFor("announcements")<{ id: string }>("admin.announcements.update", async (req, ctx, { id }) => {
  if (!z.uuid().safeParse(id).success) return fail(ctx, { error: "not_found" });
  const input = await readJson(req, announcementInput);
  if (!input) return fail(ctx, { error: "invalid_field" });
  const announcements = await updateAnnouncement(ctx.admin.phone, ctx.sanghId, id, input);
  return announcements ? ok(ctx, { announcements }) : fail(ctx, { error: "not_found" });
});

export const DELETE = sanghRouteFor("announcements")<{ id: string }>("admin.announcements.delete", async (_req, ctx, { id }) => {
  if (!z.uuid().safeParse(id).success) return fail(ctx, { error: "not_found" });
  const title = await nameFor(ctx.admin.phone, "announcement", id);
  const announcements = await deleteAnnouncement(ctx.admin.phone, ctx.sanghId, id);
  if (!announcements) return fail(ctx, { error: "not_found" });
  await logActivity(ctx.admin.phone, ctx.sanghId, "Deleted an announcement", title);
  return ok(ctx, { announcements });
});
