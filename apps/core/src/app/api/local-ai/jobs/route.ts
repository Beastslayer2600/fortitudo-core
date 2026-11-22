import { NextResponse } from "next/server";
import { db } from "@/db";
import { callerOf } from "@/jobs/service-auth";
import { createFrontdeskJob, listFrontdeskJobs } from "@/worker/frontdesk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const notAllowed = () => NextResponse.json({ error: "Not allowed." }, { status: 401 });

// POST /api/local-ai/jobs  { agent: "glm" | "content" | "helper", task: string }  ->  { id }
// Front desk token only. Puts the task on the worker queue that the PC and laptop workers claim from.
export async function POST(req: Request) {
  if ((await callerOf(req)) !== "frontdesk") return notAllowed();
  let body: { agent?: unknown; task?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Send JSON with an agent and a task." }, { status: 400 });
  }
  const made = await createFrontdeskJob(db(), body.agent, body.task);
  if ("error" in made) return NextResponse.json({ error: made.error }, { status: made.status });
  return NextResponse.json(made, { status: 201 });
}

// GET /api/local-ai/jobs  ->  { jobs }  The 50 most recent worker jobs, oldest first. Front desk or owner.
export async function GET(req: Request) {
  const who = await callerOf(req);
  if (who !== "frontdesk" && who !== "owner") return notAllowed();
  return NextResponse.json({ jobs: await listFrontdeskJobs(db()) });
}
