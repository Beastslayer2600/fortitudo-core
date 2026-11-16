import { NextResponse } from "next/server";
import { db } from "@/db";
import { isJobAgent, type JobAgent } from "@/jobs/guard";
import { claimJob } from "@/jobs/queue";
import { callerOf } from "@/jobs/service-auth";

export const dynamic = "force-dynamic";

// POST /api/jobs/claim  { agents?: ("glm" | "content" | "helper")[] }  ->  { job: Job | null }
// Worker only. Atomically takes the oldest queued job and marks it running.
export async function POST(req: Request) {
  if ((await callerOf(req)) !== "worker") return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  let agents: JobAgent[] | undefined;
  try {
    const body = (await req.json()) as { agents?: unknown };
    if (body.agents !== undefined) {
      if (!Array.isArray(body.agents) || !body.agents.every(isJobAgent)) {
        return NextResponse.json({ error: "agents must be glm, content or helper." }, { status: 400 });
      }
      agents = body.agents;
    }
  } catch {
    // An empty body means any agent.
  }
  return NextResponse.json({ job: await claimJob(db(), agents) });
}
