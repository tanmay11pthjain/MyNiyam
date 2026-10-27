import { z } from "zod";
import { fail, limitIp, ok, readJson, route } from "@/server/http";
import { readSession } from "@/server/session";
import { addVow } from "@/server/engage";

const body = z.object({
  name: z.string().trim().min(1).max(60),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

// POST /api/vows { name, endDate } → { ok } | 409 vow_limit (5 running) | 400
export const POST = route("vows.add", async (req, ctx) => {
  const s = await readSession(req);
  if (!s) return fail(ctx, { error: "unauthorized" });
  if (!s.profileId) return fail(ctx, { error: "not_found" });
  const limited = await limitIp(ctx, "vows", 60, 60);
  if (limited) return limited;
  const input = await readJson(req, body);
  if (!input) return fail(ctx, { error: "bad_request" });
  const r = await addVow(s.accountId, s.profileId, input.name, input.endDate);
  return r.ok ? ok(ctx, { ok: true }) : fail(ctx, { error: r.reason });
});
