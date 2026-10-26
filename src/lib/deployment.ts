export function currentDeploymentId(): string | null {
  if (process.env.VERCEL === "1") {
    // Keep the full application revision for Next.js client version-skew checks.
    return process.env.VERCEL_GIT_COMMIT_SHA ?? null;
  }

  return process.env.NEXT_DEPLOYMENT_ID ?? process.env.RAILWAY_GIT_COMMIT_SHA ?? null;
}

export function currentWriterRevision(): string | null {
  // next.config.ts derives this from writer inputs so UI-only builds stay compatible.
  return process.env.PERMINISTER_WRITER_REVISION || currentDeploymentId();
}
