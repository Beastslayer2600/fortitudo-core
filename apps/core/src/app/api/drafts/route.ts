import { NextResponse } from "next/server";
import { db } from "@/db";
import { pendingDrafts } from "@/jobs/queue";
import { callerOf } from "@/jobs/service-auth";

export const dynamic = "force-dynamic";

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
