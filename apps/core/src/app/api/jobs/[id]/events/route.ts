import { NextResponse } from "next/server";
import { db } from "@/db";
import { callerOf } from "@/jobs/service-auth";
import { jobView } from "@/worker/service";

export const dynamic = "force-dynamic";

// GET /api/jobs/:id/events?after=<cursor>  ->  { job, attempts, events, cursor }
// Owner only (signed in). The live job page polls this every 2 to 3 seconds.
// `after` is the cursor from the last response (an event's id); events from all
// attempts come back in order, each tagged with its attempt.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if ((await callerOf(req)) !== "owner") return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  const after = Number(new URL(req.url).searchParams.get("after") ?? 0);
  const view = await jobView(db(), (await params).id, Number.isInteger(after) && after > 0 ? after : 0);
  return view ? NextResponse.json(view) : NextResponse.json({ error: "No job with that id." }, { status: 404 });
}
