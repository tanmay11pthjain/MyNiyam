import { z } from "zod";
import { fail, ok } from "@/server/http";
import { sanghRouteFor } from "@/server/admin/http";
import { getReportCards } from "@/server/admin/reports";
import type { ReportCards } from "@/lib/admin-types";

// GET /api/admin/reports/cards?class=&month=YYYY-MM → ReportCards
export const GET = sanghRouteFor("view_members")("admin.reports.cards", async (req, ctx) => {
  const q = req.nextUrl.searchParams;
  const cls = q.get("class") ?? "", month = q.get("month") ?? "";
  if (!z.uuid().safeParse(cls).success || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return fail(ctx, { error: "bad_request" });
  const r = await getReportCards(ctx.admin.phone, ctx.sanghId, cls, month);
  return r ? ok<ReportCards>(ctx, r) : fail(ctx, { error: "not_found" });
});
