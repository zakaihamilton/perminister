import { withApiRoutePerformance } from "@/lib/auth/performance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApiRoutePerformance("GET /api/health", async function GET() {
  return Response.json(
    { service: "perminister", status: "ok" },
    { headers: { "Cache-Control": "no-store" } },
  );
});
