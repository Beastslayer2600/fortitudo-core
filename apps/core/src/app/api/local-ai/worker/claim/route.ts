import { db } from "@/db";
import { handleClaim } from "@/worker/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/local-ai/worker/claim. Bearer worker token; see docs/worker-contract.md.
export async function POST(req: Request) {
  return handleClaim(req, db());
}
