import { fail, ok } from "@/server/http";
import { sanghRoute } from "@/server/admin/http";
import { setLogo } from "@/server/admin/sangh";
import { fileUrl, newKey, putFile } from "@/server/storage";
import { readImage } from "@/server/upload";

// POST   /api/admin/sangh/logo  (body: the image bytes, JPEG/PNG/WebP, ≤ MAX_UPLOAD_BYTES) → { logoUrl }
// DELETE /api/admin/sangh/logo → { logoUrl: null }
export const POST = sanghRoute("admin.sangh.logo", async (req, ctx) => {
  const img = await readImage(req);
  if (!img) return fail(ctx, { error: "unsupported_type" });
  const key = newKey("logos", ctx.sanghId, img.type);
  await putFile(key, img.bytes, img.type);
  await setLogo(ctx.admin.phone, ctx.sanghId, fileUrl(key));
  return ok(ctx, { logoUrl: fileUrl(key) });
});

export const DELETE = sanghRoute("admin.sangh.logo.remove", async (_req, ctx) => {
  await setLogo(ctx.admin.phone, ctx.sanghId, null);
  return ok(ctx, { logoUrl: null });
});
