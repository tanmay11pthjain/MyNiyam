import { z } from "zod";
import { fail, ok, route } from "@/server/http";
import { profileBelongs, setProfilePhoto } from "@/server/onboarding";
import { readSession } from "@/server/session";
import { fileUrl, newKey, putFile } from "@/server/storage";
import { readImage } from "@/server/upload";

// POST /api/profiles/:id/photo  (body: the image bytes, shrunk to 512 px by the browser) → { photoUrl }
// For the join form's photo question. Only the number's own profiles; the photo is private to the sangh.
export const POST = route<{ id: string }>("profiles.photo", async (req, ctx, { id }) => {
  const s = await readSession(req);
  if (!s) return fail(ctx, { error: "unauthorized" });
  if (!z.uuid().safeParse(id).success || !(await profileBelongs(s.accountId, id))) return fail(ctx, { error: "not_found" });
  const img = await readImage(req);
  if (!img) return fail(ctx, { error: "unsupported_type" });
  const key = newKey("photos", s.sanghId, img.type);
  await putFile(key, img.bytes, img.type);
  if (!(await setProfilePhoto(s.accountId, id, fileUrl(key)))) return fail(ctx, { error: "not_found" });
  return ok(ctx, { photoUrl: fileUrl(key) });
});
