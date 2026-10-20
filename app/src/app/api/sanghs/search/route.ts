import { config } from "@/server/config";
import { fail, limitIp, ok, route } from "@/server/http";
import { searchSanghs } from "@/server/onboarding";

// GET /api/sanghs/search?q=heer&city=Mumbai → { sanghs, cities }
export const GET = route("sanghs.search", async (req, ctx) => {
  const limited = await limitIp(ctx, "lookup", config().RL_LOOKUP_PER_IP_MIN, 60);
  if (limited) return limited;
  const q = (req.nextUrl.searchParams.get("q") || "").trim();
  const city = (req.nextUrl.searchParams.get("city") || "").trim() || null;
  if (q.length > 60 || (city && city.length > 80)) return fail(ctx, { error: "bad_request" });
  return ok(ctx, await searchSanghs(q, city));
});
