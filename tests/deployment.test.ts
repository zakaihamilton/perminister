import { afterEach, describe, expect, it, vi } from "vitest";
import { currentDeploymentId } from "../src/lib/deployment";

describe("currentDeploymentId", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses Vercel's Git commit SHA when the deployment ID is also set", () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("NEXT_DEPLOYMENT_ID", "dpl_vercel-deployment-id");
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "shared-git-commit");

    expect(currentDeploymentId()).toBe("shared-git-commit");
  });

  it("uses NEXT_DEPLOYMENT_ID for the Railway writer", () => {
    vi.stubEnv("VERCEL", "0");
    vi.stubEnv("NEXT_DEPLOYMENT_ID", "shared-git-commit");
    vi.stubEnv("RAILWAY_GIT_COMMIT_SHA", "fallback-commit");

    expect(currentDeploymentId()).toBe("shared-git-commit");
  });
});
