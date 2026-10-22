import { z } from "zod";
import { fail, ok } from "@/server/http";
import { sanghRouteFor } from "@/server/admin/http";
import { getReport } from "@/server/admin/reports";
import type { Report } from "@/lib/admin-types";

// GET /api/admin/reports?days=7|30&class= → Report. Volunteers see their own classes only.
export const GET = sanghRouteFor("view_members")("admin.reports", async (req, ctx) => {
  const q = req.nextUrl.searchParams;
  const days = q.get("days") === "30" ? 30 : 7;
  const cls = q.get("class") || null;
  if (cls && !z.uuid().safeParse(cls).success) return fail(ctx, { error: "bad_request" });
  return ok<Report>(ctx, await getReport(ctx.admin.phone, ctx.sanghId, { days, classId: cls }));
});
