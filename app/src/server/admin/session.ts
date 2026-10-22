import "server-only";
import { SignJWT, jwtVerify } from "jose";
import type { NextRequest, NextResponse } from "next/server";
import { config } from "../config";
import { sql } from "../db";

// Admin sessions live in private.admin_sessions; the cookie only carries the signed session id.
// Every request bumps last_used_at, and a session unused for ADMIN_SESSION_IDLE_DAYS stops working.
// Separate from the member session (mn_session): being an admin and being a member are different things.

export const ADMIN_COOKIE = "mn_admin";

export type AdminSession = { sessionId: string; phone: string; isSuper: boolean; activeSanghId: string | null };

const key = () => new TextEncoder().encode(config().sessionSecret);

/** Keeps private.super_admins in step with SUPER_ADMIN_PHONE for this phone. */
async function syncSuper(phone: string): Promise<boolean> {
  const isSuper = config().superAdmins.includes(phone);
  if (isSuper) await sql()`insert into private.super_admins (phone) values (${phone}) on conflict do nothing`;
  else await sql()`delete from private.super_admins where phone = ${phone}`;
  return isSuper;
}

/** After the OTP is verified: start a session, opening the first sangh this phone runs. */
export async function startAdminSession(res: NextResponse, phone: string): Promise<void> {
  await syncSuper(phone);
  const [first] = await sql()`
    select x.sangh_id from (
      select sangh_id, true as admin from public.sangh_admins where phone = ${phone}
      union all select sangh_id, false from public.sangh_volunteers where phone = ${phone}
    ) x join public.sanghs s on s.id = x.sangh_id
    order by (s.status = 'active') desc, x.admin desc, s.name limit 1`;
  const [row] = await sql()`
    insert into private.admin_sessions (phone, active_sangh_id) values (${phone}, ${first?.sangh_id ?? null}) returning id`;
  const token = await new SignJWT({ k: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(row.id)
    .setIssuedAt()
    .sign(key());
  res.cookies.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    secure: config().NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 365 * 24 * 3600, // the database decides when it really ends
  });
}

export function clearAdminCookie(res: NextResponse) {
  res.cookies.set(ADMIN_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}

/** The admin session, or null if there is none, it is forged, or it has been idle too long. */
export async function readAdminSession(req: NextRequest): Promise<AdminSession | null> {
  const token = req.cookies.get(ADMIN_COOKIE)?.value;
  if (!token) return null;
  let id: string;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    if (payload.k !== "admin" || !payload.sub) return null;
    id = payload.sub;
  } catch {
    return null;
  }
  const days = config().ADMIN_SESSION_IDLE_DAYS;
  const [row] = await sql()`
    update private.admin_sessions set last_used_at = now()
    where id = ${id} and last_used_at > now() - make_interval(days => ${days})
    returning phone, active_sangh_id`;
  if (!row) return null;
  return { sessionId: id, phone: row.phone, isSuper: config().superAdmins.includes(row.phone), activeSanghId: row.active_sangh_id };
}

export async function setActiveSangh(sessionId: string, sanghId: string | null) {
  await sql()`update private.admin_sessions set active_sangh_id = ${sanghId} where id = ${sessionId}`;
}

export async function endAdminSession(sessionId: string) {
  await sql()`delete from private.admin_sessions where id = ${sessionId}`;
}
