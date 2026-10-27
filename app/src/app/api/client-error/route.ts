import { z } from "zod";
import { fail, limitIp, ok, readJson, route } from "@/server/http";
import { reportError } from "@/server/report";

const body = z.object({ message: z.string().max(500), where: z.string().max(200), stack: z.string().max(2000).optional() });

// POST /api/client-error { message, where, stack? } → { ok }. A crash on a member's phone, passed to the error alerts.
export const POST = route("client-error", async (req, ctx) => {
  const limited = await limitIp(ctx, "client-error", 10, 3600);
  if (limited) return limited;
  const input = await readJson(req, body);
  if (!input) return fail(ctx, { error: "bad_request" });
  await reportError(input.message, { where: input.where, stack: input.stack, requestId: ctx.requestId }, "browser");
  return ok(ctx, { ok: true });
});
