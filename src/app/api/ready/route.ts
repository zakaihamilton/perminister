import { checkAuthStorageReadiness } from "@/lib/auth/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStoreHeaders = { "Cache-Control": "no-store" };

export async function GET() {
  try {
    await checkAuthStorageReadiness();
    return Response.json({ service: "perminister", status: "ready" }, { headers: noStoreHeaders });
  } catch {
    return Response.json(
      { service: "perminister", status: "not-ready" },
      { status: 503, headers: noStoreHeaders },
    );
  }
}
