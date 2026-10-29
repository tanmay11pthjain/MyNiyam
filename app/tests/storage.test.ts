// Photo storage on Supabase: the address is cleaned up, and a missing bucket is made once.
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); });

async function storageWith(url: string) {
  vi.stubEnv("SUPABASE_URL", url);
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-key");
  vi.resetModules();
  return import("@/server/storage");
}

const key = `photos/${"0".repeat(8)}-0000-0000-0000-${"0".repeat(12)}/${"a".repeat(24)}.jpg`;
const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

describe("Supabase storage", () => {
  it("uses only the project's address, even when SUPABASE_URL has a path like /rest/v1/", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string) => { calls.push(u); return new Response("{}", { status: 200 }); }));
    const s = await storageWith("https://abcd.supabase.co/rest/v1/");
    await s.putFile(key, jpg, "image/jpeg");
    expect(calls).toEqual([`https://abcd.supabase.co/storage/v1/object/myniyam/${key}`]);
  });

  it("makes the private bucket when it is missing, then uploads", async () => {
    const calls: { u: string; body?: string }[] = [];
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async (u: string, init?: RequestInit) => {
      calls.push({ u, body: typeof init?.body === "string" ? init.body : undefined });
      n++;
      if (n === 1) return new Response(JSON.stringify({ statusCode: "404", error: "Bucket not found", message: "Bucket not found" }), { status: 400 });
      return new Response("{}", { status: 200 });
    }));
    const s = await storageWith("https://abcd.supabase.co");
    await s.putFile(key, jpg, "image/jpeg");
    expect(calls.map((c) => c.u)).toEqual([
      `https://abcd.supabase.co/storage/v1/object/myniyam/${key}`,
      "https://abcd.supabase.co/storage/v1/bucket",
      `https://abcd.supabase.co/storage/v1/object/myniyam/${key}`,
    ]);
    expect(JSON.parse(calls[1].body!)).toMatchObject({ id: "myniyam", public: false });
  });

  it("reports a missing bucket or a wrong key for /healthz", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 400 })));
    expect(await (await storageWith("https://abcd.supabase.co")).storageCheck()).toBe("no bucket");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 403 })));
    expect(await (await storageWith("https://abcd.supabase.co")).storageCheck()).toBe("bad key");
  });
});
