import { fail, ok, readJson } from "@/server/http";
import { sanghRouteFor } from "@/server/admin/http";
import { getSheet, holidayInput, setHoliday } from "@/server/admin/attendance";
import { logActivity } from "@/server/admin/volunteers";
import type { AttendanceSheet } from "@/lib/admin-types";

// POST /api/admin/attendance/holiday { day, holiday, note?, classId? } → AttendanceSheet
// Admins only: a holiday is for the whole pathshala and never counts against anyone.
export const POST = sanghRouteFor("admin")("admin.attendance.holiday", async (req, ctx) => {
  const input = await readJson(req, holidayInput);
  if (!input) return fail(ctx, { error: "bad_request" });
  const sheet = await getSheet(ctx.admin.phone, ctx.sanghId, input.classId, input.day);
  if (!sheet) return fail(ctx, { error: "not_found" });
  await setHoliday(ctx.admin.phone, ctx.sanghId, input.day, input.holiday, input.note);
  await logActivity(ctx.admin.phone, ctx.sanghId, input.holiday ? "Marked a holiday" : "Removed a holiday", `${input.day}${input.note ? `: ${input.note}` : ""}`);
  return ok<AttendanceSheet>(ctx, (await getSheet(ctx.admin.phone, ctx.sanghId, input.classId, input.day))!);
});
