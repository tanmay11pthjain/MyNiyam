import "server-only";
import { SignJWT, jwtVerify } from "jose";
import type { NextRequest, NextResponse } from "next/server";
import { config } from "./config";
import { sql } from "./db";

// Stateless session: a signed cookie holding the account id and the chosen profile.
// Any server instance can read it. Each request re-checks that the account still exists,
// so when an admin removes a number its session stops working at once.

export const SESSION_COOKIE = "mn_session";

export type Session = { accountId: string; profileId: string | null };

const key = () => new TextEncoder().encode(config().sessionSecret);

export async function setSession(res: NextResponse, s: Session) {
  const days = config().SESSION_DAYS;
  const token = await new SignJWT({ pid: s.profileId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(s.accountId)
    .setIssuedAt()
    .setExpirationTime(`${days}d`)
    .sign(key());
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: config().NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: days * 24 * 3600,
  });
}

export function clearSession(res: NextResponse) {
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}

/** The session, or null if there is none, it is invalid, or the account has been removed. */
export async function readSession(req: NextRequest): Promise<(Session & { sanghId: string; phone: string }) | null> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    if (!payload.sub) return null;
    const [acc] = await sql()`select sangh_id, phone from public.accounts where id = ${payload.sub}`;
    if (!acc) return null;
    return { accountId: payload.sub, profileId: typeof payload.pid === "string" ? payload.pid : null, sanghId: acc.sangh_id, phone: acc.phone };
  } catch {
    return null;
  }
}
