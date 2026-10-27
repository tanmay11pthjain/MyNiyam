import { z } from "zod";
import { config } from "@/server/config";
import { fail, ok, readJson, route } from "@/server/http";
import { readSession } from "@/server/session";
import { getSubscription, removeSubscription, saveSubscription } from "@/server/push";

const sub = z.object({
  endpoint: z.string().url().startsWith("https://").max(1000),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(4).max(100) }),
});
const settings = {
  remindAt: z.string().regex(/^([01]\d|2[0-3]):[03]0$/),   // on the hour or half hour
  chauvihar: z.boolean(),
};

// GET    /api/push?endpoint=...                       → { enabled, publicKey, settings | null }
// POST   /api/push { subscription, remindAt, chauvihar } → { ok } (turn on, or change the times)
// DELETE /api/push { endpoint }                        → { ok } (turn off on this phone)
export const GET = route("push.get", async (req, ctx) => {
  const s = await readSession(req);
  if (!s) return fail(ctx, { error: "unauthorized" });
  const c = config();
  const endpoint = req.nextUrl.searchParams.get("endpoint");
  return ok(ctx, {
    enabled: c.pushEnabled, publicKey: c.pushEnabled ? c.VAPID_PUBLIC_KEY : null,
    settings: endpoint ? await getSubscription(s.accountId, endpoint) : null,
  });
});

export const POST = route("push.save", async (req, ctx) => {
  const s = await readSession(req);
  if (!s) return fail(ctx, { error: "unauthorized" });
  if (!s.profileId) return fail(ctx, { error: "not_found" });
  if (!config().pushEnabled) return fail(ctx, { error: "push_off" });
  const input = await readJson(req, z.object({ subscription: sub, ...settings }));
  if (!input) return fail(ctx, { error: "bad_request" });
  const saved = await saveSubscription(s.accountId, s.profileId, input.subscription, { remindAt: input.remindAt, chauvihar: input.chauvihar });
  return saved ? ok(ctx, { ok: true }) : fail(ctx, { error: "not_found" });
});

export const DELETE = route("push.remove", async (req, ctx) => {
  const s = await readSession(req);
  if (!s) return fail(ctx, { error: "unauthorized" });
  const input = await readJson(req, z.object({ endpoint: z.string().max(1000) }));
  if (!input) return fail(ctx, { error: "bad_request" });
  await removeSubscription(s.accountId, input.endpoint);
  return ok(ctx, { ok: true });
});
