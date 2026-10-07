import { getCurrentSession } from "@/lib/auth/service";

export const runtime = "nodejs";

export async function GET() {
  try {
    const current = await getCurrentSession();
    if (!current) {
      return Response.json(
        { authenticated: false },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      );
    }
    return Response.json(
      {
        authenticated: true,
        account: {
          subjectId: current.subject.subjectId,
          email: current.subject.primaryEmail,
          firstName: current.subject.firstName ?? null,
          lastName: current.subject.lastName ?? null,
          emailVerified: !!current.subject.emailVerifiedAt,
          status: current.subject.status,
        },
        session: {
          createdAt: current.session.createdAt,
          expiresAt: current.session.expiresAt,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { error: "Session service is temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
