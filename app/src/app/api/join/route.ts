import { z } from "zod";
import { fail, limitIp, ok, readJson, route } from "@/server/http";
import { findSanghById, joinSangh } from "@/server/onboarding";
import { readSession, setSession } from "@/server/session";
import type { VerifyOtpResponse } from "@/lib/api-types";

const body = z.object({ sanghId: z.uuid() });

// POST /api/join { sanghId } → { status: "joined" | "logged_in" } | 401 | 403 joins_closed | 409 pathshala_limit
// Someone already signed in joins another pathshala with the same number: it is already verified, so no new code.
// The session moves to that pathshala; the Who screen then asks who is joining.
export const POST = route("join", async (req, ctx) => {
  const s = await readSession(req);
  if (!s) return fail(ctx, { error: "unauthorized" });
  const limited = await limitIp(ctx, "join", 30, 3600);
  if (limited) return limited;
  const input = await readJson(req, body);
  if (!input) return fail(ctx, { error: "bad_request" });
  if (!(await findSanghById(input.sanghId))) return fail(ctx, { error: "not_found" });
  let outcome;
  try {
    outcome = await joinSangh(s.phone, input.sanghId);
  } catch {
    outcome = await joinSangh(s.phone, input.sanghId); // the number was freed mid-join; one retry settles it
  }
  if (outcome.kind === "closed") return fail(ctx, { error: "joins_closed" });
  if (outcome.kind === "limit") return fail(ctx, { error: "pathshala_limit" });
  const res = ok<VerifyOtpResponse>(ctx, { status: outcome.kind });
  await setSession(res, { accountId: outcome.accountId, profileId: null });
  return res;
});
