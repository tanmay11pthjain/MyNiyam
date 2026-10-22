import { NextResponse } from "next/server";
import { fail, route } from "@/server/http";
import { exportMyData } from "@/server/privacy";
import { readSession } from "@/server/session";

// GET /api/me/data → a JSON file with everything kept about this number and the people on it
export const GET = route("me.data", async (req, ctx) => {
  const s = await readSession(req);
  if (!s) return fail(ctx, { error: "unauthorized" });
  const data = await exportMyData(s.accountId);
  if (!data) return fail(ctx, { error: "not_found" });
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="myniyam-my-data-${data.exportedAt.slice(0, 10)}.json"`,
      "cache-control": "no-store",
      "x-request-id": ctx.requestId,
    },
  });
});
