import type { NextConfig } from "next";

const deploymentId =
  process.env.NEXT_DEPLOYMENT_ID ??
  process.env.VERCEL_GIT_COMMIT_SHA ??
  process.env.RAILWAY_GIT_COMMIT_SHA;

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
];

const nextConfig: NextConfig = {
  ...(deploymentId ? { deploymentId } : {}),
  headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
  experimental: {
    serverActions: {
      // Permit old open tabs to reach the stale-action refresh handler during rollout.
      allowedOrigins: ["perminister.com", "www.perminister.com"],
    },
  },
};

export default nextConfig;
