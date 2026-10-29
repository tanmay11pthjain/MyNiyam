import { z } from "zod";
import { fail, ok } from "@/server/http";
import { sanghRouteFor } from "@/server/admin/http";
import { getBoard } from "@/server/admin/leaderboard";
import type { AdminBoard } from "@/lib/admin-types";

// GET /api/admin/leaderboard?class=&week=this|last → AdminBoard (first class and this week by default)
export const GET = sanghRouteFor("view_members")("admin.leaderboard", async (req, ctx) => {
  const q = req.nextUrl.searchParams;
  const cls = q.get("class"), week = q.get("week") === "last" ? "last" : "this";
  if (cls && !z.uuid().safeParse(cls).success) return fail(ctx, { error: "bad_request" });
  const r = await getBoard(ctx.admin.phone, ctx.sanghId, cls, week);
  return r ? ok<AdminBoard>(ctx, r) : fail(ctx, { error: "not_found" });
});
