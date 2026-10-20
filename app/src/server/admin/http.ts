import "server-only";
import type { NextRequest, NextResponse } from "next/server";
import { config } from "../config";
import { asAdmin } from "../db";
import { fail, limitIp, route, type Ctx } from "../http";
import { readAdminSession, type AdminSession } from "./session";

export type AdminCtx = Ctx & { admin: AdminSession };
export type SanghCtx = AdminCtx & { sanghId: string };

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
 * An /api/admin route that works on the admin's open sangh. Checks, on every request, that this phone
 * is still an admin of it: the super admin can take an admin off a sangh at any time.
 */
export function sanghRoute<P = unknown>(name: string, fn: (req: NextRequest, ctx: SanghCtx, params: P) => Promise<NextResponse>) {
  return adminRoute<P>(name, async (req, ctx, params) => {
    const sanghId = ctx.admin.activeSanghId;
    if (!sanghId) return fail(ctx, { error: "no_sangh" });
    const still = await asAdmin(ctx.admin.phone, (tx) => tx`select private.is_sangh_admin(${sanghId}) as ok`);
    if (!still[0].ok) return fail(ctx, { error: "no_sangh" });
    return fn(req, { ...ctx, sanghId }, params);
  });
}
