import "server-only";
import type { NextRequest } from "next/server";
import { config } from "./config";
import { TooLarge } from "./http";
import { sniffImage, type ImageType } from "./storage";

/**
 * Reads an image upload sent as the raw request body. The browser has already shrunk it to 512 px,
 * so it is small; anything over MAX_UPLOAD_BYTES is refused (413). The type comes from the bytes.
 */
export async function readImage(req: NextRequest): Promise<{ bytes: Uint8Array; type: ImageType } | null> {
  const max = config().MAX_UPLOAD_BYTES;
  if (Number(req.headers.get("content-length") || 0) > max) throw new TooLarge();
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.length > max) throw new TooLarge();
  const type = bytes.length > 12 ? sniffImage(bytes) : null;
  return type ? { bytes, type } : null;
}
