import { ok, route } from "@/server/http";
import { clearSession } from "@/server/session";

// POST /api/session/logout → { ok: true }
export const POST = route("session.logout", async (_req, ctx) => {
  const res = ok(ctx, { ok: true });
  clearSession(res);
  return res;
});
