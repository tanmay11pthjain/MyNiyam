"use client";
import type { Result } from "./api";
import type { ApiError } from "@/lib/api-types";

// Picture uploads (sangh logo, profile photo): shrink in the browser, then send the bytes.

/** Shrinks a picked image to at most `size` px and returns JPEG bytes, so uploads stay small.
 *  With `aspect` (width / height, e.g. 16 / 9) the middle of the picture is cut to that shape. */
export async function shrinkImage(file: File, size = 512, aspect?: number): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  let sw = bmp.width, sh = bmp.height;
  if (aspect) { if (sw / sh > aspect) sw = Math.round(sh * aspect); else sh = Math.round(sw / aspect); }
  const scale = Math.min(1, size / Math.max(sw, sh));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sh * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff"; // transparent PNG logos become white, not black
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, (bmp.width - sw) / 2, (bmp.height - sh) / 2, sw, sh, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode failed"))), "image/jpeg", 0.85));
}

/** Uploads raw bytes (fetch, not api(), because the body isn't JSON). */
export async function upload<T>(path: string, body: Blob): Promise<Result<T>> {
  try {
    const res = await fetch(path, { method: "POST", body, headers: { "content-type": body.type || "application/octet-stream" }, credentials: "same-origin" });
    const json = await res.json().catch(() => ({ error: "server_error" }));
    return res.ok ? { ok: true, data: json as T } : { ok: false, err: json as ApiError };
  } catch {
    return { ok: false, err: { error: "offline" } };
  }
}
