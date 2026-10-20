"use client";
import type { Result } from "./api";
import type { ApiError } from "@/lib/api-types";

// Picture uploads (sangh logo, profile photo): shrink in the browser, then send the bytes.

/** Shrinks a picked image to at most `size` px and returns JPEG bytes, so uploads stay small. */
export async function shrinkImage(file: File, size = 512): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, size / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff"; // transparent PNG logos become white, not black
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
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
