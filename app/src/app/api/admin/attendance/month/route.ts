import { z } from "zod";
import { fail, ok } from "@/server/http";
import { sanghRouteFor } from "@/server/admin/http";
import { MONTH, getMonth } from "@/server/admin/attendance";
import type { AttendanceMonth } from "@/lib/admin-types";

// GET /api/admin/attendance/month?class=&month=YYYY-MM → AttendanceMonth
export const GET = sanghRouteFor("attendance")("admin.attendance.month", async (req, ctx) => {
  const q = req.nextUrl.searchParams;
  const cls = q.get("class") ?? "", month = q.get("month") ?? "";
  if (!z.uuid().safeParse(cls).success || !MONTH.test(month)) return fail(ctx, { error: "bad_request" });
  const r = await getMonth(ctx.admin.phone, ctx.sanghId, cls, month);
  return r ? ok<AttendanceMonth>(ctx, r) : fail(ctx, { error: "not_found" });
});
