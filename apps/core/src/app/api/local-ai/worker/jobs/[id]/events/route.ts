import { db } from "@/db";
import { handleEvents } from "@/worker/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/local-ai/worker/jobs/:id/events. Bearer worker token; see docs/worker-contract.md.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleEvents(req, (await params).id, db());
}
