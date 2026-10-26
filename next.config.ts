import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import type { NextConfig } from "next";

const projectRoot = process.cwd();
const writerSourceDirectories = ["src/app/actions", "src/app/api", "src/lib"];
const writerSourceFiles = [
  "next.config.ts",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.json",
  "src/app/actions.ts",
  "src/app/login/submit/route.ts",
  "src/app/logout/submit/route.ts",
  "src/app/oauth/authorize/action.ts",
  "src/proxy.ts",
];

function collectFiles(directory: string): string[] {
  return readdirSync(resolve(projectRoot, directory), { withFileTypes: true }).flatMap((entry) => {
    const entryPath = resolve(projectRoot, directory, entry.name);
    if (entry.isDirectory()) return collectFiles(relative(projectRoot, entryPath));
    if (!entry.isFile()) return [];
    return [relative(projectRoot, entryPath).split(sep).join("/")];
  });
}

const writerInputs = [
  ...new Set([...writerSourceFiles, ...writerSourceDirectories.flatMap(collectFiles)]),
].sort();
const writerRevisionHash = createHash("sha256");
for (const file of writerInputs) {
  writerRevisionHash.update(file);
  writerRevisionHash.update("\0");
  writerRevisionHash.update(readFileSync(resolve(projectRoot, file)));
  writerRevisionHash.update("\0");
}
const writerRevision = `writer-${writerRevisionHash.digest("hex").slice(0, 24)}`;

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
  // Stable across dashboard-only builds, but changes when writer code or dependencies change.
  env: { PERMINISTER_WRITER_REVISION: writerRevision },
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
