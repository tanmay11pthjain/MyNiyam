import { fail, ok } from "@/server/http";
import { sanghRouteFor } from "@/server/admin/http";
import { fileUrl, newKey, putFile } from "@/server/storage";
import { readImage } from "@/server/upload";

// POST /api/admin/announcements/image (body: image bytes) → { imageUrl }
// Stored with the sangh's photos, so only its members and admins can open it.
export const POST = sanghRouteFor("announcements")("admin.announcements.image", async (req, ctx) => {
  const img = await readImage(req);
  if (!img) return fail(ctx, { error: "unsupported_type" });
  const key = newKey("photos", ctx.sanghId, img.type);
  await putFile(key, img.bytes, img.type);
  return ok(ctx, { imageUrl: fileUrl(key) });
});
