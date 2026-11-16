import { NextResponse } from "next/server";
import { db } from "@/db";
import { createAgentDraft } from "@/jobs/drafts";
import { isFailure, pendingDrafts } from "@/jobs/queue";
import { callerOf } from "@/jobs/service-auth";

export const dynamic = "force-dynamic";

// POST /api/drafts  { project, title, body, type? }  ->  { id }
// Worker only. Saves what an agent wrote as a DRAFT (never approved or
// published) with a revision marked as the agent's. The worker then attaches
// the id to its job. Only the owner approves and publishes.
export async function POST(req: Request) {
  if ((await callerOf(req)) !== "worker") return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  let body: { project?: unknown; title?: unknown; body?: unknown; type?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Send JSON with a project, title and body." }, { status: 400 });
  }
  const made = await createAgentDraft(db(), body);
  if (isFailure(made)) return NextResponse.json({ error: made.error }, { status: made.status });
  return NextResponse.json(made, { status: 201 });
}

// GET /api/drafts?status=pending  ->  { drafts: { id, title, createdAt }[] }
// Drafts waiting for the owner (content items still in the draft state).
// Read only: nothing here approves or publishes.
export async function GET(req: Request) {
  const caller = await callerOf(req);
  if (caller !== "frontdesk" && caller !== "owner") return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  const status = new URL(req.url).searchParams.get("status") ?? "pending";
  if (status !== "pending") return NextResponse.json({ error: "status must be pending." }, { status: 400 });
  return NextResponse.json({ drafts: await pendingDrafts(db()) });
}
