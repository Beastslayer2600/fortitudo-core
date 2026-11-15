import { after, NextResponse } from "next/server";
import { currentUser } from "@/auth";
import { runConfig } from "@/agent/config";
import { executeRun, startRun, type HistoryTurn } from "@/agent/gateway";

export const dynamic = "force-dynamic";
// The run continues after the response, up to this limit.
export const maxDuration = 300;

const MAX_MESSAGE = 8000;
const MAX_HISTORY = 20;

function parseHistory(value: unknown): HistoryTurn[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (t): t is HistoryTurn =>
        !!t && typeof t === "object" && (t.role === "user" || t.role === "assistant") && typeof t.text === "string",
    )
    .slice(-MAX_HISTORY)
    .map((t) => ({ role: t.role, text: t.text.slice(0, MAX_MESSAGE) }));
}

// POST /api/agent  { message: string, history?: { role, text }[] }  ->  { runId }
// Logs the request, answers at once with the run id, and works the run in the
// background. The front door polls GET /api/agent/runs/:id for the reply.
// Owner-only for now; service tokens per face arrive when a second face connects.
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user || user.role !== "owner") {
    return NextResponse.json({ error: "Sign in as the owner to use the agent." }, { status: 401 });
  }

  let body: { message?: unknown; history?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Send JSON with a message." }, { status: 400 });
  }
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) return NextResponse.json({ error: "The message is empty." }, { status: 400 });
  if (message.length > MAX_MESSAGE) {
    return NextResponse.json({ error: `Keep the message under ${MAX_MESSAGE} characters.` }, { status: 400 });
  }

  const config = runConfig();
  const input = { face: "front-door", message, history: parseHistory(body.history) };
  const started = await startRun(config, input);
  if (started.queued) after(() => executeRun(config, started.runId, input, started.answerOnly));
  return NextResponse.json({ runId: started.runId }, { status: 202 });
}
