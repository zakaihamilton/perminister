export function currentDeploymentId(): string | null {
  if (process.env.VERCEL === "1") {
    // Vercel's deployment ID is unique per platform build; use the Git SHA so it
    // matches the Railway writer's NEXT_DEPLOYMENT_ID during coordinated deploys.
    return process.env.VERCEL_GIT_COMMIT_SHA ?? null;
  }

  return process.env.NEXT_DEPLOYMENT_ID ?? process.env.RAILWAY_GIT_COMMIT_SHA ?? null;
}
