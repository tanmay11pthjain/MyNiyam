"use client";

// Sends a crash on this phone to the error alerts (/api/client-error), at most 3 per visit.
// Only the message and where it happened; never what the person typed.
let sent = 0;
let watching = false;

function send(message: string, stack?: string) {
  if (sent >= 3 || process.env.NODE_ENV !== "production") return;
  sent++;
  void fetch("/api/client-error", {
    method: "POST", headers: { "content-type": "application/json" }, keepalive: true,
    body: JSON.stringify({ message: message.slice(0, 500), where: location.pathname.slice(0, 200), stack: stack?.slice(0, 2000) }),
  }).catch(() => {});
}

export function watchErrors() {
  if (watching || typeof window === "undefined") return;
  watching = true;
  window.addEventListener("error", (e) => send(e.message || "error", (e.error as Error | undefined)?.stack));
  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason as Error | undefined;
    send(r?.message ?? String(e.reason), r?.stack);
  });
}
