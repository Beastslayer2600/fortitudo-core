import { db } from "@/db";
import { handleFail } from "@/worker/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/local-ai/worker/jobs/:id/fail. Bearer worker token; see docs/worker-contract.md.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleFail(req, (await params).id, db());
}
