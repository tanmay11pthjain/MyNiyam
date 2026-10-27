import "server-only";
import { randomUUID } from "node:crypto";
import { config } from "./config";

// Error alerts to Sentry (free plan is enough), through its plain HTTP API so no SDK is needed.
// Without SENTRY_DSN this does nothing; errors are always in the host's logs as well (log.ts).
// Never pass phone numbers, codes or answers here.

function target(): { url: string; key: string } | null {
  const dsn = config().SENTRY_DSN;
  if (!dsn) return null;
  const u = new URL(dsn);
  const project = u.pathname.replace(/^\//, "");
  return { url: `${u.protocol}//${u.host}/api/${project}/envelope/`, key: u.username };
}

/** Sends one error event. Waits at most 2 seconds and never throws. */
export async function reportError(message: string, data: Record<string, unknown> = {}, source: "server" | "browser" = "server"): Promise<void> {
  const t = target();
  if (!t) return;
  const id = randomUUID().replace(/-/g, "");
  const event = {
    event_id: id, timestamp: Date.now() / 1000, platform: "javascript", level: "error",
    environment: config().NODE_ENV, release: process.env.NEXT_PUBLIC_APP_VERSION,
    tags: { source, commit: process.env.NEXT_PUBLIC_APP_COMMIT ?? "" },
    message: { formatted: message.slice(0, 500) }, extra: data,
  };
  const body = `${JSON.stringify({ event_id: id, sent_at: new Date().toISOString() })}\n${JSON.stringify({ type: "event" })}\n${JSON.stringify(event)}`;
  try {
    await fetch(t.url, {
      method: "POST", body, signal: AbortSignal.timeout(2000),
      headers: { "content-type": "application/x-sentry-envelope", "x-sentry-auth": `Sentry sentry_version=7, sentry_key=${t.key}, sentry_client=myniyam/1.0` },
    });
  } catch { /* the alert is lost; the log line is still there */ }
}
