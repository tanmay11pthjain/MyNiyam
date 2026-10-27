import { z } from "zod";
import { fail, ok, readJson } from "@/server/http";
import { logActivity } from "@/server/admin/volunteers";
import { sanghRouteFor } from "@/server/admin/http";
import { deleteGoal, goalInput, saveGoal } from "@/server/admin/goals";

// PUT    /api/admin/goals/:id { goal } → { goals }
// DELETE /api/admin/goals/:id          → { goals }

export const PUT = sanghRouteFor("niyams")<{ id: string }>("admin.goals.update", async (req, ctx, { id }) => {
  if (!z.uuid().safeParse(id).success) return fail(ctx, { error: "not_found" });
  const input = await readJson(req, goalInput);
  if (!input) return fail(ctx, { error: "invalid_field" });
  const goals = await saveGoal(ctx.admin.phone, ctx.sanghId, id, input);
  if (goals === "not_found") return fail(ctx, { error: "not_found" });
  return goals ? ok(ctx, { goals }) : fail(ctx, { error: "invalid_field" });
});

export const DELETE = sanghRouteFor("niyams")<{ id: string }>("admin.goals.delete", async (_req, ctx, { id }) => {
  if (!z.uuid().safeParse(id).success) return fail(ctx, { error: "not_found" });
  const goals = await deleteGoal(ctx.admin.phone, ctx.sanghId, id);
  if (!goals) return fail(ctx, { error: "not_found" });
  await logActivity(ctx.admin.phone, ctx.sanghId, "Removed a goal", null);
  return ok(ctx, { goals });
});
