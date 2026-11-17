import { db } from "@/db";
import { handleEscalate } from "@/worker/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/local-ai/worker/jobs/:id/escalate. Bearer worker token; see docs/worker-contract.md.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleEscalate(req, (await params).id, db());
}
