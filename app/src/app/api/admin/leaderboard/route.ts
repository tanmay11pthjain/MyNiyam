import { z } from "zod";
import { fail, ok } from "@/server/http";
import { sanghRouteFor } from "@/server/admin/http";
import { DAY } from "@/server/admin/attendance";
import { getBoard } from "@/server/admin/leaderboard";
import type { AdminBoard } from "@/lib/admin-types";

// GET /api/admin/leaderboard?class=&from=YYYY-MM-DD&to=YYYY-MM-DD → AdminBoard
// (first class, and this week, by default). Ranked by Tej earned in those dates.
export const GET = sanghRouteFor("view_members")("admin.leaderboard", async (req, ctx) => {
  const q = req.nextUrl.searchParams;
  const cls = q.get("class"), from = q.get("from"), to = q.get("to");
  if ((cls && !z.uuid().safeParse(cls).success) || (from && !DAY.test(from)) || (to && !DAY.test(to)) || !from !== !to) return fail(ctx, { error: "bad_request" });
  const r = await getBoard(ctx.admin.phone, ctx.sanghId, cls, from, to);
  return r ? ok<AdminBoard>(ctx, r) : fail(ctx, { error: "bad_request" });
});
