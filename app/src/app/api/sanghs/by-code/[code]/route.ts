import { config } from "@/server/config";
import { fail, limitIp, ok, route } from "@/server/http";
import { findSanghByCode } from "@/server/onboarding";
import { normalizeJoinCode } from "@/lib/join-code";

// GET /api/sanghs/by-code/HEER01 → { sangh }
export const GET = route<{ code: string }>("sanghs.byCode", async (_req, ctx, { code }) => {
  const limited = await limitIp(ctx, "lookup", config().RL_LOOKUP_PER_IP_MIN, 60);
  if (limited) return limited;
  const clean = normalizeJoinCode(decodeURIComponent(code));
  if (!clean) return fail(ctx, { error: "invalid_code" });
  const sangh = await findSanghByCode(clean);
  if (!sangh) return fail(ctx, { error: "code_not_found" });
  return ok(ctx, { sangh });
});
