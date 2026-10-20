import type { NextConfig } from "next";

const dev = process.env.NODE_ENV !== "production";

// Next's own bootstrap uses inline scripts, so script-src needs 'unsafe-inline' until we move to
// nonces (that needs proxy.ts and makes every page dynamic). Everything else is locked to self.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self'",
  "connect-src 'self'",
  "media-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
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
    return [{ source: "/j/:code", destination: "/join?code=:code", permanent: false }];
  },
};

export default nextConfig;
