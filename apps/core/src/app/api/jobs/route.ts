import { NextResponse } from "next/server";
import { db } from "@/db";
import { createJob, isFailure, listJobs } from "@/jobs/queue";
import { callerOf } from "@/jobs/service-auth";

export const dynamic = "force-dynamic";

const unauthorized = () => NextResponse.json({ error: "Not allowed." }, { status: 401 });

// POST /api/jobs  { agent: "glm" | "content" | "helper", task: string }  ->  { id }
// Front desk only. Creates a queued job; the worker claims it.
export async function POST(req: Request) {
  if ((await callerOf(req)) !== "frontdesk") return unauthorized();
  let body: { agent?: unknown; task?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Send JSON with an agent and a task." }, { status: 400 });
  }
  const made = await createJob(db(), body.agent, body.task);
  if (isFailure(made)) return NextResponse.json({ error: made.error }, { status: made.status });
  return NextResponse.json(made, { status: 201 });
}

// GET /api/jobs?status=queued|running|done|failed  ->  { jobs: Job[] }
// The 50 most recent jobs, oldest first.
export async function GET(req: Request) {
  if (!(await callerOf(req))) return unauthorized();
  const status = new URL(req.url).searchParams.get("status");
  const jobs = await listJobs(db(), status);
  if (!jobs) return NextResponse.json({ error: "status must be queued, running, done or failed." }, { status: 400 });
  return NextResponse.json({ jobs });
}
