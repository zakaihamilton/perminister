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

// The authorization form's 303 is checked against form-action by Chrome.
// Allow only the registered PostParticle callback on that page.
const consumerAuthorizationHeaders = [
  {
    key: "Content-Security-Policy",
    value:
      "frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://postparticle.vercel.app/auth/perminister/callback",
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
      {
        source: "/oauth/authorize",
        headers: consumerAuthorizationHeaders,
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
