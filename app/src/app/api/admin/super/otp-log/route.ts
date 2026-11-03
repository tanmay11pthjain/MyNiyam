import { ok } from "@/server/http";
import { adminRoute } from "@/server/admin/http";
import { otpLog } from "@/server/otp-log";
import type { OtpLog } from "@/lib/admin-types";

// Super admin only.
// GET /api/admin/super/otp-log?phone=98200 → OtpLog: the last 100 login codes (optionally for one number)
export const GET = adminRoute("super.otp_log", async (req, ctx) =>
  ok<OtpLog>(ctx, await otpLog(req.nextUrl.searchParams.get("phone"))), { superOnly: true });
