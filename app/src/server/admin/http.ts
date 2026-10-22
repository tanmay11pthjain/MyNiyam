import "server-only";
import type { NextRequest, NextResponse } from "next/server";
import { config } from "../config";
import { asAdmin } from "../db";
import { fail, limitIp, route, type Ctx } from "../http";
import { readAdminSession, type AdminSession } from "./session";
import type { Perm } from "@/lib/admin-types";

export type AdminCtx = Ctx & { admin: AdminSession };
export type SanghCtx = AdminCtx & { sanghId: string; role: "admin" | "volunteer"; perms: Perm[] };

/** An /api/admin route for any signed-in admin (or the super admin with `superOnly`). */
export function adminRoute<P = unknown>(
  name: string,
  fn: (req: NextRequest, ctx: AdminCtx, params: P) => Promise<NextResponse>,
  opts: { superOnly?: boolean } = {},
) {
  return route<P>(name, async (req, ctx, params) => {
    const limited = await limitIp(ctx, "admin", config().RL_ADMIN_PER_IP_MIN, 60);
    if (limited) return limited;
    const admin = await readAdminSession(req);
    if (!admin) return fail(ctx, { error: "unauthorized" });
    if (opts.superOnly && !admin.isSuper) return fail(ctx, { error: "forbidden" });
    return fn(req, { ...ctx, admin }, params);
  });
}

/**
 * An /api/admin route that works on the open sangh. Checks, on every request, that this phone still
 * has the access the route needs: `perm` "admin" (the default) is for the sangh's admins only, "any" for
 * any admin or volunteer, and a permission name for admins and the volunteers given it. The database
 * checks the same rules again (row-level security), so this is the first gate, not the only one.
 */
export function sanghRoute<P = unknown>(
  name: string,
  fn: (req: NextRequest, ctx: SanghCtx, params: P) => Promise<NextResponse>,
  opts: { perm?: Perm | "admin" | "any" } = {},
) {
  const need = opts.perm ?? "admin";
  return adminRoute<P>(name, async (req, ctx, params) => {
    const sanghId = ctx.admin.activeSanghId;
    if (!sanghId) return fail(ctx, { error: "no_sangh" });
    const [r] = await asAdmin(ctx.admin.phone, (tx) => tx<{ admin: boolean; perms: Perm[] | null }[]>`
      select private.is_sangh_admin(${sanghId}) as admin,
        (select perms from public.sangh_volunteers where sangh_id = ${sanghId} and phone = ${ctx.admin.phone}) as perms`);
    if (!r.admin && !r.perms) return fail(ctx, { error: "no_sangh" });
    const role = r.admin ? "admin" as const : "volunteer" as const;
    const perms = r.perms ?? [];
    if (role === "volunteer" && (need === "admin" || (need !== "any" && !perms.includes(need)))) return fail(ctx, { error: "forbidden" });
    return fn(req, { ...ctx, sanghId, role, perms }, params);
  });
}

/** sanghRoute for one permission: `sanghRouteFor("niyams")("admin.niyams.list", handler)`. */
export const sanghRouteFor = (perm: Perm | "admin" | "any") =>
  <P = unknown>(name: string, fn: (req: NextRequest, ctx: SanghCtx, params: P) => Promise<NextResponse>) => sanghRoute<P>(name, fn, { perm });
