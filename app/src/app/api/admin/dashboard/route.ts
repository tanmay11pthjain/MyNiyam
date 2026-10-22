import { fail, ok } from "@/server/http";
import { sanghRouteFor } from "@/server/admin/http";
import { getDashboard } from "@/server/admin/dashboard";
import type { Dashboard } from "@/lib/admin-types";

// GET /api/admin/dashboard → Dashboard (today's numbers and the setup checklist)
export const GET = sanghRouteFor("any")("admin.dashboard", async (_req, ctx) => {
  const d = await getDashboard(ctx.admin.phone, ctx.sanghId);
  return d ? ok<Dashboard>(ctx, d) : fail(ctx, { error: "no_sangh" });
});
