import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { config } from "./config";

// Small image storage for sangh logos and profile photos.
// Production: one private Supabase Storage bucket (STORAGE_BUCKET), reached with the service-role key
// from the server only. Local dev without Supabase keys: files on disk under LOCAL_STORAGE_DIR.
// Files are served by GET /api/files/<key>, which checks who may see them (photos are private).
//
// Keys look like  logos/<sanghId>/<random>.jpg  or  photos/<sanghId>/<random>.jpg.
// A new upload gets a new key, so a served file never changes and can be cached hard.

export type ImageType = "image/jpeg" | "image/png" | "image/webp";
const EXT: Record<ImageType, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const KEY = /^(logos|photos)\/[0-9a-f-]{36}\/[a-z0-9]{24}\.(jpg|png|webp)$/;

export const isStorageKey = (key: string) => KEY.test(key);

/** The real type of an image from its first bytes; never trust the request's content-type. */
export function sniffImage(b: Uint8Array): ImageType | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}

export function newKey(kind: "logos" | "photos", sanghId: string, type: ImageType): string {
  return `${kind}/${sanghId}/${randomBytes(12).toString("hex")}.${EXT[type]}`;
}

function supabaseUrl(key: string) {
  const c = config();
  return `${c.SUPABASE_URL!.replace(/\/$/, "")}/storage/v1/object/${encodeURIComponent(c.STORAGE_BUCKET)}/${key}`;
}

const localPath = (key: string) => path.resolve(process.cwd(), config().LOCAL_STORAGE_DIR, key);

export async function putFile(key: string, bytes: Uint8Array, type: ImageType): Promise<void> {
  if (!isStorageKey(key)) throw new Error("bad storage key");
  const c = config();
  if (c.supabaseStorage) {
    const res = await fetch(supabaseUrl(key), {
      method: "POST",
      headers: { authorization: `Bearer ${c.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": type, "x-upsert": "false", "cache-control": "31536000" },
      body: Buffer.from(bytes),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`storage upload failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    return;
  }
  const file = localPath(key);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, bytes);
}

export async function getFile(key: string): Promise<{ bytes: Uint8Array; type: ImageType } | null> {
  if (!isStorageKey(key)) return null;
  const type = (Object.entries(EXT).find(([, e]) => key.endsWith(`.${e}`))?.[0] ?? "image/jpeg") as ImageType;
  const c = config();
  if (c.supabaseStorage) {
    const res = await fetch(supabaseUrl(key), {
      headers: { authorization: `Bearer ${c.SUPABASE_SERVICE_ROLE_KEY}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 404 || res.status === 400) return null;
    if (!res.ok) throw new Error(`storage read failed: ${res.status}`);
    return { bytes: new Uint8Array(await res.arrayBuffer()), type };
  }
  try {
    return { bytes: new Uint8Array(await fs.readFile(localPath(key))), type };
  } catch {
    return null;
  }
}

/** Public URL path the app uses for a stored file. */
export const fileUrl = (key: string) => `/api/files/${key}`;
/** The storage key back from a URL made by fileUrl, or null. */
export const keyFromUrl = (url: string | null) => (url && url.startsWith("/api/files/") ? url.slice("/api/files/".length) : null);
