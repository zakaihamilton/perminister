export function currentDeploymentId(): string | null {
  return (
    process.env.NEXT_DEPLOYMENT_ID ??
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.RAILWAY_GIT_COMMIT_SHA ??
    null
  );
}
