import { NextResponse } from "next/server";
import { db } from "@/db";
import { finishJob, getJob, isFailure } from "@/jobs/queue";
import { callerOf } from "@/jobs/service-auth";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/jobs/:id  ->  Job
export async function GET(req: Request, { params }: Ctx) {
  if (!(await callerOf(req))) return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  const job = await getJob(db(), (await params).id);
  return job ? NextResponse.json(job) : NextResponse.json({ error: "No job with that id." }, { status: 404 });
}

// PATCH /api/jobs/:id  { status: "done" | "failed", result?: string, draftId?: string }  ->  Job
// Worker only, and only for a job it has claimed (running).
export async function PATCH(req: Request, { params }: Ctx) {
  if ((await callerOf(req)) !== "worker") return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  let body: { status?: unknown; result?: unknown; draftId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Send JSON with a status." }, { status: 400 });
  }
  const done = await finishJob(db(), (await params).id, body);
  return isFailure(done) ? NextResponse.json({ error: done.error }, { status: done.status }) : NextResponse.json(done);
}
