export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    { service: "authodox", status: "ok" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
