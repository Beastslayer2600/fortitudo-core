import { NextResponse } from "next/server";
import { currentUser } from "@/auth";
import { anthropicClient, runAgent, type HistoryTurn } from "@/agent/gateway";
import { db } from "@/db";

export const dynamic = "force-dynamic";
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

// POST /api/agent  { message: string, history?: { role, text }[] }
// The front door's only way to the agent. Owner-only for now; service tokens
// per face arrive when a second face connects.
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

  const modelName = process.env.AGENT_MODEL?.trim() || undefined;
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  const ceilingRaw = process.env.AGENT_DAILY_CEILING_USD?.trim();

  const result = await runAgent(
    {
      db: db(),
      model: apiKey ? anthropicClient(apiKey) : null,
      modelName,
      ceilingUsd: ceilingRaw ? Number(ceilingRaw) : undefined,
    },
    { face: "front-door", message, history: parseHistory(body.history) },
  );

  return NextResponse.json({
    reply: result.reply,
    outcome: result.outcome,
    toolsCalled: result.toolsCalled,
    runId: result.runId,
  });
}
