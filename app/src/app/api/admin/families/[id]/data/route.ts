import { NextResponse } from "next/server";
import { z } from "zod";
import { fail } from "@/server/http";
import { sanghRoute } from "@/server/admin/http";
import { adminExportFamily } from "@/server/privacy";

// GET /api/admin/families/:accountId/data → a JSON file with everything kept about that family (for a DPDP request)
export const GET = sanghRoute<{ id: string }>("admin.families.data", async (_req, ctx, { id }) => {
  if (!z.uuid().safeParse(id).success) return fail(ctx, { error: "not_found" });
  const data = await adminExportFamily(ctx.admin.phone, ctx.sanghId, id);
  if (!data) return fail(ctx, { error: "not_found" });
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="myniyam-family-${data.exportedAt.slice(0, 10)}.json"`,
      "cache-control": "no-store",
      "x-request-id": ctx.requestId,
    },
  });
});
