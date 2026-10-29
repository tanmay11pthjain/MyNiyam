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

/** Only the project's address counts: a SUPABASE_URL pasted with a path (like ".../rest/v1/") still works. */
const storageBase = () => `${new URL(config().SUPABASE_URL!).origin}/storage/v1`;

function supabaseUrl(key: string) {
  return `${storageBase()}/object/${encodeURIComponent(config().STORAGE_BUCKET)}/${key}`;
}

/** Makes the PRIVATE photo bucket (same settings as migration 20261022000010). */
async function createBucket(): Promise<boolean> {
  const c = config();
  const res = await fetch(`${storageBase()}/bucket`, {
    method: "POST",
    headers: { apikey: c.SUPABASE_SERVICE_ROLE_KEY!, authorization: `Bearer ${c.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ id: c.STORAGE_BUCKET, name: c.STORAGE_BUCKET, public: false, file_size_limit: 2097152, allowed_mime_types: ["image/jpeg", "image/png", "image/webp"] }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  return !!res && (res.ok || res.status === 409); // 409: made meanwhile
}

/** Whether the photo bucket exists and the key can reach it (for /healthz). Never throws. */
export async function storageCheck(): Promise<"ok" | "no bucket" | "bad key" | "unreachable"> {
  const c = config();
  try {
    const res = await fetch(`${storageBase()}/bucket/${encodeURIComponent(c.STORAGE_BUCKET)}`, {
      headers: { apikey: c.SUPABASE_SERVICE_ROLE_KEY!, authorization: `Bearer ${c.SUPABASE_SERVICE_ROLE_KEY}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (res.ok) return "ok";
    if (res.status === 401 || res.status === 403) return "bad key";
    return "no bucket";
  } catch {
    return "unreachable";
  }
}

// Local dev only; the ignore keeps the build from bundling the whole project for this one path.
const localPath = (key: string) => path.resolve(/*turbopackIgnore: true*/ process.cwd(), config().LOCAL_STORAGE_DIR, key);

export async function putFile(key: string, bytes: Uint8Array, type: ImageType): Promise<void> {
  if (!isStorageKey(key)) throw new Error("bad storage key");
  const c = config();
  if (c.supabaseStorage) {
    const send = () => fetch(supabaseUrl(key), {
      method: "POST",
      headers: { apikey: c.SUPABASE_SERVICE_ROLE_KEY!, authorization: `Bearer ${c.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": type, "x-upsert": "false", "cache-control": "31536000" },
      body: Buffer.from(bytes),
      signal: AbortSignal.timeout(15_000),
    });
    let res = await send();
    let text = res.ok ? "" : await res.text();
    // The private bucket was never made (the database update that makes it didn't run there): make it once.
    if (!res.ok && /bucket not found/i.test(text) && (await createBucket())) {
      res = await send();
      text = res.ok ? "" : await res.text();
    }
    if (!res.ok) throw new Error(`storage upload failed: ${res.status} ${text.slice(0, 200)}`);
    return;
  }
  // Local disk is for one dev machine only: on a real server it would vanish on redeploy.
  if (c.NODE_ENV === "production") throw new Error("Uploads need SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in production.");
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
      headers: { apikey: c.SUPABASE_SERVICE_ROLE_KEY!, authorization: `Bearer ${c.SUPABASE_SERVICE_ROLE_KEY}` },
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

/** Deletes stored files. Best effort: a file that is already gone, or a storage hiccup, never blocks the caller. */
export async function deleteFiles(keys: string[]): Promise<void> {
  const ok = keys.filter(isStorageKey);
  if (!ok.length) return;
  const c = config();
  try {
    if (c.supabaseStorage) {
      await fetch(`${storageBase()}/object/${encodeURIComponent(c.STORAGE_BUCKET)}`, {
        method: "DELETE",
        headers: { apikey: c.SUPABASE_SERVICE_ROLE_KEY!, authorization: `Bearer ${c.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ prefixes: ok }),
        signal: AbortSignal.timeout(15_000),
      });
      return;
    }
    await Promise.all(ok.map((k) => fs.rm(localPath(k), { force: true })));
  } catch {
    // The rows are gone, so nothing points at these files any more.
  }
}

/** Public URL path the app uses for a stored file. */
export const fileUrl = (key: string) => `/api/files/${key}`;
/** The storage key back from a URL made by fileUrl, or null. */
export const keyFromUrl = (url: string | null) => (url && url.startsWith("/api/files/") ? url.slice("/api/files/".length) : null);
