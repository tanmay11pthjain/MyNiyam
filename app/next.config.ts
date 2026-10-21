import type { NextConfig } from "next";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const dev = process.env.NODE_ENV !== "production";

// Next's own bootstrap uses inline scripts, so script-src needs 'unsafe-inline' until we move to
// nonces (that needs proxy.ts and makes every page dynamic). Everything else is locked to self.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  // The landing page (public/landing.html) loads its two fonts from Google Fonts.
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob: https:",
  "font-src 'self' https://fonts.gstatic.com",
  "connect-src 'self'",
  "media-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

// The footer shows the version and the commit it was built from. Hosts set their own commit variable.
const version = (JSON.parse(readFileSync("./package.json", "utf8")) as { version: string }).version;
const commit = (process.env.VERCEL_GIT_COMMIT_SHA || process.env.RENDER_GIT_COMMIT || process.env.GITHUB_SHA || "").slice(0, 7) || (() => {
  try { return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return "dev"; }
})();

const nextConfig: NextConfig = {
  // A second dev server (for example one on the local database) needs its own build folder.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  env: { NEXT_PUBLIC_APP_VERSION: version, NEXT_PUBLIC_APP_COMMIT: commit },
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          // Camera for the QR scanner, location for a join form's "home location" question; this site only.
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(self), payment=()" },
          ...(dev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]),
        ],
      },
    ];
  },
  async redirects() {
    // The QR code on the pathshala poster holds https://<app>/j/HEER01.
    return [
      { source: "/j/:code", destination: "/join?code=:code", permanent: false },
      // Signed-in members go straight to their Today screen; everyone else sees the landing page.
      { source: "/", has: [{ type: "cookie", key: "mn_session" }], destination: "/home", permanent: false },
    ];
  },
  async rewrites() {
    // "/" is the landing page (a static page in public/), not the app's own start screen.
    return { beforeFiles: [{ source: "/", destination: "/landing.html" }] };
  },
};

export default nextConfig;
