import { z } from "zod";
import { fail, ok } from "@/server/http";
import { sanghRoute } from "@/server/admin/http";
import { AGE_GROUPS, listMembers } from "@/server/admin/members";
import type { MembersPage } from "@/lib/admin-types";

// GET /api/admin/members?q=&class=&gender=&age=&inactive=1 → MembersPage (families, numbers masked)
const query = z.object({
  q: z.string().max(60).default(""),
  class: z.uuid().optional(),
  gender: z.enum(["male", "female"]).optional(),
  age: z.enum(AGE_GROUPS).optional(),
  inactive: z.enum(["1"]).optional(),
});

export const GET = sanghRoute("admin.members.list", async (req, ctx) => {
  const p = query.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!p.success) return fail(ctx, { error: "bad_request" });
  const f = p.data;
  return ok<MembersPage>(ctx, await listMembers(ctx.admin.phone, ctx.sanghId, {
    q: f.q, classId: f.class ?? null, gender: f.gender ?? null, age: f.age ?? null, inactive: f.inactive === "1",
  }));
});
