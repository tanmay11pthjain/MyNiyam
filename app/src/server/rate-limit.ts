import "server-only";
import { sql } from "./db";

/**
 * Fixed-window counter stored in Postgres, so it holds across server instances and restarts.
 * Returns whether this hit is allowed and, if not, how long until the window resets.
 */
export async function hit(key: string, limit: number, windowSec: number): Promise<{ ok: boolean; retryAfterSec: number }> {
  const [row] = await sql()`
    with w as (select to_timestamp(floor(extract(epoch from now()) / ${windowSec}) * ${windowSec}) as start)
    insert into private.rate_limits (key, window_start, hits)
    select ${key}, w.start, 1 from w
    on conflict (key, window_start) do update set hits = private.rate_limits.hits + 1
    returning hits, ceil(extract(epoch from (window_start + make_interval(secs => ${windowSec}) - now())))::int as retry
  `;
  return { ok: row.hits <= limit, retryAfterSec: Math.max(1, Number(row.retry)) };
}
