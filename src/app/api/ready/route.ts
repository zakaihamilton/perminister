import { withApiRoutePerformance } from "@/lib/auth/performance";
import { checkAuthStorageReadiness } from "@/lib/auth/service";
import { currentDeploymentId, currentWriterRevision } from "@/lib/deployment";
import {
  getConfiguredWriteProxySecret,
  matchesWriteProxySecret,
  WRITE_PROXY_SECRET_HEADER,
} from "@/lib/write-proxy-secret";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStoreHeaders = { "Cache-Control": "no-store" };

export const GET = withApiRoutePerformance("GET /api/ready", async function GET(request: Request) {
  try {
    await checkAuthStorageReadiness();
    const deploymentId = currentDeploymentId();
    const writerRevision = currentWriterRevision();
    if (process.env.VERCEL === "1" && process.env.VERCEL_ENV === "production") {
      const writerOrigin = process.env.PERMINISTER_WRITE_PROXY_URL;
      const writeProxySecret = getConfiguredWriteProxySecret();
      if (!deploymentId || !writerRevision || !writerOrigin || !writeProxySecret) {
        throw new Error("Release configuration is missing.");
      }
      const url = new URL(writerOrigin);
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.pathname !== "/" ||
        url.search ||
        url.hash
      ) {
        throw new Error("Writer origin is invalid.");
      }
      url.pathname = "/api/ready";
      const writerResponse = await fetch(url, {
        headers: { [WRITE_PROXY_SECRET_HEADER]: writeProxySecret },
        cache: "no-store",
        signal: AbortSignal.timeout(5_000),
      });
      const writer = (await writerResponse.json()) as {
        deploymentId?: string | null;
        proxySecretAccepted?: boolean;
        status?: string;
        writerRevision?: string | null;
      };
      const reportedWriterRevision = writer.writerRevision ?? writer.deploymentId;
      if (
        !writerResponse.ok ||
        writer.status !== "ready" ||
        reportedWriterRevision !== writerRevision ||
        writer.proxySecretAccepted !== true
      ) {
        return Response.json(
          {
            service: "perminister",
            status: "not-ready",
            deploymentId,
            writerDeploymentId: writer.deploymentId ?? null,
            writerRevision,
            writerReportedRevision: reportedWriterRevision ?? null,
          },
          { status: 503, headers: noStoreHeaders },
        );
      }
      return Response.json(
        {
          service: "perminister",
          status: "ready",
          deploymentId,
          writerDeploymentId: writer.deploymentId,
          writerRevision,
        },
        { headers: noStoreHeaders },
      );
    }
    return Response.json(
      {
        service: "perminister",
        status: "ready",
        ...(request.headers.has(WRITE_PROXY_SECRET_HEADER)
          ? {
              proxySecretAccepted: matchesWriteProxySecret(
                request.headers.get(WRITE_PROXY_SECRET_HEADER),
                getConfiguredWriteProxySecret(),
              ),
            }
          : {}),
        ...(deploymentId ? { deploymentId } : {}),
        ...(writerRevision ? { writerRevision } : {}),
      },
      { headers: noStoreHeaders },
    );
  } catch {
    return Response.json(
      { service: "perminister", status: "not-ready" },
      { status: 503, headers: noStoreHeaders },
    );
  }
});
