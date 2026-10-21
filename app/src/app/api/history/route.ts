import { fail, ok, route } from "@/server/http";
import { readSession } from "@/server/session";
import { getHistory, getHistoryDay } from "@/server/today";

// GET /api/history?month=YYYY-MM → days of that month, newest first, up to today
// GET /api/history?date=YYYY-MM-DD → one day with what was kept
export const GET = route("history", async (req, ctx) => {
  const s = await readSession(req);
  if (!s) return fail(ctx, { error: "unauthorized" });
  if (!s.profileId) return fail(ctx, { error: "not_found" });
  const q = req.nextUrl.searchParams;
  const date = q.get("date");
  if (date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) return fail(ctx, { error: "bad_request" });
    const r = await getHistoryDay(s.accountId, s.profileId, date);
    return r ? ok(ctx, r) : fail(ctx, { error: "not_found" });
  }
  const month = q.get("month") ?? "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return fail(ctx, { error: "bad_request" });
  const r = await getHistory(s.accountId, s.profileId, month);
  return r ? ok(ctx, r) : fail(ctx, { error: "not_found" });
});
