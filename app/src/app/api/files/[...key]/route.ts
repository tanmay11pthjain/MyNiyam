import { NextResponse } from "next/server";
import { fail, route } from "@/server/http";
import { readSession } from "@/server/session";
import { readAdminSession } from "@/server/admin/session";
import { isAdminOf } from "@/server/admin/sangh";
import { getFile, isStorageKey } from "@/server/storage";

// GET /api/files/logos/<sanghId>/<name>   anyone (logos show on the join screens)
// GET /api/files/photos/<sanghId>/<name>  only that sangh's admins and members
// Keys never change content, so responses are cached for a year (privately for photos).
export const GET = route<{ key: string[] }>("files.get", async (req, ctx, { key }) => {
  const k = key.join("/");
  if (!isStorageKey(k)) return fail(ctx, { error: "not_found" });
  const [kind, sanghId] = key;
  if (kind === "photos") {
    const member = await readSession(req);
    let allowed = member?.sanghId === sanghId;
    if (!allowed) {
      const admin = await readAdminSession(req);
      allowed = Boolean(admin && (await isAdminOf(admin.phone, sanghId)));
    }
    if (!allowed) return fail(ctx, { error: "not_found" });
  }
  const file = await getFile(k);
  if (!file) return fail(ctx, { error: "not_found" });
  return new NextResponse(Buffer.from(file.bytes), {
    headers: {
      "content-type": file.type,
      "cache-control": kind === "photos" ? "private, max-age=31536000, immutable" : "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
      "x-request-id": ctx.requestId,
    },
  });
});
