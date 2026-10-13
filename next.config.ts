import type { NextConfig } from "next";

const deploymentId =
  process.env.NEXT_DEPLOYMENT_ID ??
  process.env.VERCEL_GIT_COMMIT_SHA ??
  process.env.RAILWAY_GIT_COMMIT_SHA;

const nextConfig: NextConfig = {
  ...(deploymentId ? { deploymentId } : {}),
  experimental: {
    serverActions: {
      // Permit old open tabs to reach the stale-action refresh handler during rollout.
      allowedOrigins: ["perminister.com", "www.perminister.com"],
    },
  },
};

export default nextConfig;
