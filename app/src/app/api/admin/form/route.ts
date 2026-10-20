import { z } from "zod";
import { fail, ok, readJson } from "@/server/http";
import { sanghRoute } from "@/server/admin/http";
import { getForm, saveForm } from "@/server/admin/form";
import type { FormPage } from "@/lib/admin-types";

// GET /api/admin/form           → FormPage (the fields, plus the classes for the preview)
// PUT /api/admin/form { fields } → { fields } | 400 invalid_field / duplicate_key

export const GET = sanghRoute("admin.form.get", async (_req, ctx) => {
  const f = await getForm(ctx.admin.phone, ctx.sanghId);
  return f ? ok<FormPage>(ctx, f) : fail(ctx, { error: "no_sangh" });
});

const body = z.object({ fields: z.array(z.unknown()).max(30) });

export const PUT = sanghRoute("admin.form.save", async (req, ctx) => {
  const input = await readJson(req, body);
  if (!input) return fail(ctx, { error: "bad_request" });
  const r = await saveForm(ctx.admin.phone, ctx.sanghId, input.fields);
  return r.ok ? ok(ctx, { fields: r.fields }) : fail(ctx, { error: r.reason });
});
