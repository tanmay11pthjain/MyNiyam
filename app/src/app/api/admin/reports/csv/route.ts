import { NextResponse } from "next/server";
import { sanghRoute } from "@/server/admin/http";
import { membersCsv } from "@/server/admin/reports";
import { logActivity } from "@/server/admin/volunteers";

// GET /api/admin/reports/csv → members.csv (opens in Excel or Google Sheets). Admins only: it has phone numbers.
export const GET = sanghRoute("admin.reports.csv", async (_req, ctx) => {
  const csv = await membersCsv(ctx.admin.phone, ctx.sanghId);
  await logActivity(ctx.admin.phone, ctx.sanghId, "Downloaded the member list");
  const day = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="myniyam-members-${day}.csv"`,
      "cache-control": "no-store",
      "x-request-id": ctx.requestId,
    },
  });
});
