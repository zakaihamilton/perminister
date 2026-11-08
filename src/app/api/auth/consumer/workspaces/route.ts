import { consumerResourceBootstrapRoute } from "@/lib/auth/consumer-route";

export const runtime = "nodejs";

export const POST = consumerResourceBootstrapRoute("workspace");
