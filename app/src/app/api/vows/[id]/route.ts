import { z } from "zod";
import { fail, limitIp, ok, readJson, route } from "@/server/http";
import { readSession } from "@/server/session";
import { changeVow } from "@/server/engage";

const body = z.union([
  z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), done: z.boolean() }),
  z.object({ end: z.literal(true) }),
]);

// PATCH /api/vows/:id { date, done } (tick for today or yesterday) | { end: true } (end it early) → { ok }
export const PATCH = route<{ id: string }>("vows.change", async (req, ctx, { id }) => {
  const s = await readSession(req);
  if (!s) return fail(ctx, { error: "unauthorized" });
  if (!z.uuid().safeParse(id).success) return fail(ctx, { error: "not_found" });
  const limited = await limitIp(ctx, "log", 300, 60);
  if (limited) return limited;
  const input = await readJson(req, body);
  if (!input) return fail(ctx, { error: "bad_request" });
  const r = await changeVow(s.accountId, id, input);
  return r.ok ? ok(ctx, { ok: true }) : fail(ctx, { error: r.reason });
});
