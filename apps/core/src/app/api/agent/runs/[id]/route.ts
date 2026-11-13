import { NextResponse } from "next/server";
import { currentUser } from "@/auth";
import { getRun } from "@/agent/gateway";
import { db } from "@/db";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/agent/runs/:id  ->  { status: "working" | "done", reply, outcome, toolsCalled }
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user || user.role !== "owner") {
    return NextResponse.json({ error: "Sign in as the owner." }, { status: 401 });
  }
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const run = await getRun(db(), id, new Date());
  if (!run) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json(run);
}
