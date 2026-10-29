import { NextResponse } from "next/server";
import { fail } from "@/server/http";
import { sanghRoute } from "@/server/admin/http";
import { DAY } from "@/server/admin/attendance";
import { reportWorkbook } from "@/server/admin/reports";
import { logActivity } from "@/server/admin/volunteers";
import { toXlsx } from "@/server/xlsx";

// GET /api/admin/reports/excel?from=YYYY-MM-DD&to=YYYY-MM-DD → myniyam-report.xlsx: members (Tej,
// days, attendance, gathas), attendance day by day, and niyams, for those dates (both counted; at most
// a year). No dates: the last 30 days. Admins only: it has phone numbers.
export const GET = sanghRoute("admin.reports.excel", async (req, ctx) => {
  const q = req.nextUrl.searchParams;
  const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10); // India date
  const to = q.get("to") ?? today;
  const from = q.get("from") ?? new Date(Date.parse(`${to}T00:00:00Z`) - 29 * 864e5).toISOString().slice(0, 10);
  const span = (Date.parse(to) - Date.parse(from)) / 864e5;
  if (!DAY.test(from) || !DAY.test(to) || Number.isNaN(span) || span < 0 || span >= 366) return fail(ctx, { error: "bad_request" });
  const file = toXlsx(await reportWorkbook(ctx.admin.phone, ctx.sanghId, from, to));
  await logActivity(ctx.admin.phone, ctx.sanghId, "Downloaded the Excel report", `${from} to ${to}`);
  return new NextResponse(Buffer.from(file), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="myniyam-report-${from}-to-${to}.xlsx"`,
      "cache-control": "no-store",
      "x-request-id": ctx.requestId,
    },
  });
});
