import { NextResponse } from "next/server";
import { db } from "@/db";
import { callerOf } from "@/jobs/service-auth";
import { getFrontdeskJob } from "@/worker/frontdesk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/local-ai/jobs/:id  ->  one worker job with its result. Front desk or owner.
export async function GET(req: Request, { params }: Ctx) {
  const who = await callerOf(req);
  if (who !== "frontdesk" && who !== "owner") return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  const job = await getFrontdeskJob(db(), (await params).id);
  return job ? NextResponse.json(job) : NextResponse.json({ error: "No job with that id." }, { status: 404 });
}
