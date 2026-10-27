import { fail, ok, readJson } from "@/server/http";
import { logActivity } from "@/server/admin/volunteers";
import { sanghRouteFor } from "@/server/admin/http";
import { getGoals, goalInput, saveGoal } from "@/server/admin/goals";
import type { GoalsPage } from "@/lib/admin-types";

// GET  /api/admin/goals          → GoalsPage
// POST /api/admin/goals { goal } → { goals } | 400 invalid_field

export const GET = sanghRouteFor("niyams")("admin.goals.list", async (_req, ctx) =>
  ok<GoalsPage>(ctx, await getGoals(ctx.admin.phone, ctx.sanghId)));

export const POST = sanghRouteFor("niyams")("admin.goals.create", async (req, ctx) => {
  const input = await readJson(req, goalInput);
  if (!input) return fail(ctx, { error: "invalid_field" });
  const goals = await saveGoal(ctx.admin.phone, ctx.sanghId, null, input);
  if (!goals || goals === "not_found") return fail(ctx, { error: "invalid_field" });
  await logActivity(ctx.admin.phone, ctx.sanghId, input.kind === "total" ? "Started a goal" : "Started a challenge", input.title);
  return ok(ctx, { goals }, { status: 201 });
});
