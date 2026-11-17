import { db } from "@/db";
import { xpEvents } from "@/db/schema";
import { handleLocalAi, methodNotAllowed } from "@/local-ai/closed-case";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/local-ai  { count: 1, date: "YYYY-MM-DD" }  ->  { ok: true }
// Bearer LOCAL_AI_SERVICE_TOKEN only; no session, no redirects. Records one
// closed case as an XP ledger row: count 1, the posted date, nothing else.
export async function POST(req: Request) {
  return handleLocalAi(req, async (createdAt) => {
    await db().insert(xpEvents).values({ source: "local-ai", amount: 1, reason: "closed case", createdAt });
  });
}

export const GET = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
