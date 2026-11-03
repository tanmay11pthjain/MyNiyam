import "server-only";
import { config } from "./config";
import { sql } from "./db";
import { phoneReports } from "./sms-phone";
import type { OtpLog, OtpLogRow } from "@/lib/admin-types";

/**
 * The super admin's log of login codes, newest first. With OTP_DELIVERY=phone it first reads what the
 * SMS phone reported in the last day (sent / delivered / failed) and stores it on the matching rows.
 * `search` is any part of a mobile number.
 */
export async function otpLog(search: string | null): Promise<OtpLog> {
  const c = config();
  let relayOk: boolean | null = null;
  let lastPhoneReport: string | null = null;
  if (c.OTP_DELIVERY === "phone") {
    const { reports, reachable } = await phoneReports(86_400);
    relayOk = reachable;
    if (reports.length) {
      lastPhoneReport = new Date(Math.max(...reports.map((r) => r.at.getTime()))).toISOString();
      // Keep the newest report per code (they arrive in order), then store them in one statement.
      // A report never undoes "verified", "failed" never undoes "delivered", "sent" only moves a code forward.
      const latest = new Map<number, (typeof reports)[number]>();
      for (const r of reports) latest.set(r.logId, r);
      const list = [...latest.values()];
      await sql()`
        update private.otp_log l set status = r.status, error = case when r.status = 'failed' then r.error end, updated_at = now()
        from unnest(${list.map((r) => r.logId)}::bigint[], ${list.map((r) => r.status)}::text[], ${list.map((r) => r.error ?? "")}::text[])
          as r(id, status, error)
        where l.id = r.id and l.delivery = 'phone' and l.status <> 'verified' and l.status <> r.status
          and (r.status <> 'failed' or l.status <> 'delivered')
          and (r.status <> 'sent' or l.status in ('sending', 'queued'))`;
    }
  }
  const digits = (search ?? "").replace(/\D/g, "").slice(-10);
  const rows = await sql()<OtpLogRow[]>`
    select id::int, phone, code, delivery, channel, status, error,
           created_at as "createdAt", updated_at as "updatedAt", verified_at as "verifiedAt"
    from private.otp_log
    where ${digits ? sql()`phone like ${"%" + digits + "%"}` : sql()`true`}
    order by id desc limit 100`;
  return {
    rows: rows.map((r) => ({
      ...r,
      createdAt: new Date(r.createdAt).toISOString(), updatedAt: new Date(r.updatedAt).toISOString(),
      verifiedAt: r.verifiedAt ? new Date(r.verifiedAt).toISOString() : null,
    })),
    delivery: c.OTP_DELIVERY, relayOk, lastPhoneReport,
  };
}
