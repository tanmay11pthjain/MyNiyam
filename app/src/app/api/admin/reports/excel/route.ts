import { NextResponse } from "next/server";
import { sanghRoute } from "@/server/admin/http";
import { reportWorkbook } from "@/server/admin/reports";
import { logActivity } from "@/server/admin/volunteers";
import { toXlsx } from "@/server/xlsx";

// GET /api/admin/reports/excel → myniyam-report.xlsx: members, attendance (P/L/A and gathas) and niyams.
// Admins only: it has phone numbers.
export const GET = sanghRoute("admin.reports.excel", async (_req, ctx) => {
  const file = toXlsx(await reportWorkbook(ctx.admin.phone, ctx.sanghId));
  await logActivity(ctx.admin.phone, ctx.sanghId, "Downloaded the Excel report");
  const day = new Date().toISOString().slice(0, 10);
  return new NextResponse(Buffer.from(file), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="myniyam-report-${day}.xlsx"`,
      "cache-control": "no-store",
      "x-request-id": ctx.requestId,
    },
  });
});
