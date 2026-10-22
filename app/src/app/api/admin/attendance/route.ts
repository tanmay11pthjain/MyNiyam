import { z } from "zod";
import { fail, ok, readJson } from "@/server/http";
import { sanghRouteFor } from "@/server/admin/http";
import { DAY, clearMarks, getSheet, marksInput, saveMarks } from "@/server/admin/attendance";
import { logActivity } from "@/server/admin/volunteers";
import type { AttendanceSheet } from "@/lib/admin-types";

// Admins, and volunteers with "attendance" (their classes only).
// GET    /api/admin/attendance?class=&day=             → AttendanceSheet (first class and today by default)
// PUT    /api/admin/attendance { classId, day, marks }  → AttendanceSheet
// DELETE /api/admin/attendance { classId, day }         → AttendanceSheet  clears that day's marks

const att = sanghRouteFor("attendance");

export const GET = att("admin.attendance.sheet", async (req, ctx) => {
  const q = req.nextUrl.searchParams;
  const cls = q.get("class"), day = q.get("day");
  if ((cls && !z.uuid().safeParse(cls).success) || (day && !DAY.test(day))) return fail(ctx, { error: "bad_request" });
  const r = await getSheet(ctx.admin.phone, ctx.sanghId, cls, day);
  return r ? ok<AttendanceSheet>(ctx, r) : fail(ctx, { error: "not_found" });
});

export const PUT = att("admin.attendance.save", async (req, ctx) => {
  const input = await readJson(req, marksInput);
  if (!input) return fail(ctx, { error: "bad_request" });
  const r = await saveMarks(ctx.admin.phone, ctx.sanghId, input);
  if (r === "day_out_of_range") return fail(ctx, { error: "bad_request" });
  if (r === "not_found") return fail(ctx, { error: "not_found" });
  const sheet = await getSheet(ctx.admin.phone, ctx.sanghId, input.classId, input.day);
  const cls = sheet?.classes.find((c) => c.id === input.classId)?.name ?? "";
  const came = input.marks.filter((m) => m.status !== "absent").length;
  await logActivity(ctx.admin.phone, ctx.sanghId, "Took attendance", `${cls}, ${input.day}: ${came} of ${input.marks.length} came`);
  return sheet ? ok<AttendanceSheet>(ctx, sheet) : fail(ctx, { error: "not_found" });
});

export const DELETE = att("admin.attendance.clear", async (req, ctx) => {
  const input = await readJson(req, z.object({ classId: z.uuid(), day: z.string().regex(DAY) }));
  if (!input) return fail(ctx, { error: "bad_request" });
  await clearMarks(ctx.admin.phone, ctx.sanghId, input.classId, input.day);
  const sheet = await getSheet(ctx.admin.phone, ctx.sanghId, input.classId, input.day);
  return sheet ? ok<AttendanceSheet>(ctx, sheet) : fail(ctx, { error: "not_found" });
});
