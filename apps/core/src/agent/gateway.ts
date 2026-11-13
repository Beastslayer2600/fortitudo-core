import { and, eq, gte, inArray, lt, notLike } from "drizzle-orm";
import { agentRuns } from "@/db/schema";
import { buildInstructions, MissingBrandRootError } from "./memory";
import { ModelUnavailableError, type ChatMessage, type ModelClient } from "./model";
import { TOOLS, ToolInputError, type AgentTool, type Db, type Tier } from "./tools";

/** The highest tier this gateway will run. Tier 2 (publish) and up are refused in code. */
export const MAX_TIER: Tier = 1;
/** Tool calls allowed per request. A confused run stops instead of looping. */
export const MAX_TOOL_STEPS = 8;
/** Requests per day before the agent stops taking actions (it still answers). */
export const DEFAULT_DAILY_REQUEST_CAP = 100;
/** Past this multiple of the daily cap the agent does not run at all. */
export const HARD_STOP_MULTIPLE = 2;
/** A run has this long to finish, inside the 300-second function limit. */
export const RUN_DEADLINE_MS = 280_000;
/** A run still queued or running after this long is marked failed. */
export const STALE_AFTER_MS = 6 * 60_000;

export type HistoryTurn = { role: "user" | "assistant"; text: string };

export type ToolCallRecord = {
  name: string;
  tier: Tier | null;
  allowed: boolean;
  ok: boolean;
  note?: string;
};

export type RunConfig = {
  db: Db;
  model: ModelClient | null;
  modelName: string | undefined;
  dailyRequestCap?: number;
  tools?: readonly AgentTool[];
  now?: () => Date;
};

export type RunInput = { face: string; message: string; history?: HistoryTurn[] };

export type RunView = {
  runId: string;
  status: "working" | "done";
  outcome: string;
  reply: string | null;
  toolsCalled: ToolCallRecord[];
};

/** Start of the current day in South Africa (UTC+2, no daylight saving). */
export function startOfDaySast(now: Date) {
  const shifted = new Date(now.getTime() + 2 * 3600_000);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - 2 * 3600_000);
}

/** Runs today that reached the model or were meant to (refusals do not count). */
export async function requestsToday(db: Db, now: Date) {
  return db.$count(
    agentRuns,
    and(gte(agentRuns.createdAt, startOfDaySast(now)), notLike(agentRuns.outcome, "refused%")),
  );
}

/** The tier gate. Every tool call passes through here before anything runs. */
export function authorize(tools: readonly AgentTool[], name: string, answerOnly: boolean) {
  const tool = tools.find((t) => t.name === name);
  if (!tool) return { ok: false as const, tier: null, reason: `there is no tool called "${name}"` };
  if (tool.tier > MAX_TIER) {
    return { ok: false as const, tier: tool.tier, reason: `"${name}" is tier ${tool.tier}; this gateway runs tier ${MAX_TIER} and below` };
  }
  if (answerOnly) {
    return { ok: false as const, tier: tool.tier, reason: "today's request cap is reached, so tools are off until tomorrow" };
  }
  return { ok: true as const, tier: tool.tier, tool };
}

function toMessages(history: HistoryTurn[], message: string): ChatMessage[] {
  const turns = history.filter((t) => t.text.trim());
  while (turns.length && turns[0].role !== "user") turns.shift();
  return [...turns.map((t) => ({ role: t.role, content: t.text })), { role: "user", content: message }];
}

async function finish(
  db: Db,
  runId: string,
  outcome: string,
  reply: string,
  extra: { toolsCalled?: ToolCallRecord[]; tier?: number; inputTokens?: number; outputTokens?: number } = {},
) {
  await db
    .update(agentRuns)
    .set({ outcome, reply, ...extra })
    .where(eq(agentRuns.id, runId));
}

/**
 * Logs the request and decides whether it may run. Returns the run id and
 * whether it is queued for the model or already finished (refused).
 */
export async function startRun(config: RunConfig, input: RunInput) {
  const { db, modelName } = config;
  const now = (config.now ?? (() => new Date()))();
  const cap = config.dailyRequestCap ?? DEFAULT_DAILY_REQUEST_CAP;
  const used = await requestsToday(db, now);

  // Every request is logged, including the ones refused before the model is called.
  const [run] = await db
    .insert(agentRuns)
    .values({ face: input.face, request: input.message, outcome: "queued", model: modelName ?? null })
    .returning({ id: agentRuns.id });

  if (!config.model || !modelName) {
    await finish(db, run.id, "refused: no model configured", "The agent has no model connected yet. Set AGENT_MODEL, AGENT_MODEL_URL and AGENT_MODEL_TOKEN.");
    return { runId: run.id, queued: false };
  }
  if (used >= cap * HARD_STOP_MULTIPLE) {
    await finish(db, run.id, "refused: daily hard stop", "Today's request limit is used up. The agent is resting until midnight.");
    return { runId: run.id, queued: false };
  }
  return { runId: run.id, queued: true, answerOnly: used >= cap };
}

/** Works a queued run: brand_root, then the tool loop, then the log. */
export async function executeRun(config: RunConfig, runId: string, input: RunInput, answerOnly = false) {
  const { db, model, modelName } = config;
  const tools = config.tools ?? TOOLS;
  const clock = config.now ?? (() => new Date());
  const deadline = clock().getTime() + RUN_DEADLINE_MS;

  const toolsCalled: ToolCallRecord[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let highestTier = 0;
  const done = (outcome: string, reply: string) =>
    finish(db, runId, outcome, reply, { toolsCalled, tier: highestTier, inputTokens, outputTokens });

  await db.update(agentRuns).set({ outcome: "running" }).where(eq(agentRuns.id, runId));
  if (!model || !modelName) return done("refused: no model configured", "The agent has no model connected yet.");

  let system: string;
  try {
    system = await buildInstructions(db);
  } catch (err) {
    if (err instanceof MissingBrandRootError) {
      return done("refused: brand_root missing", "The identity root is missing, so the agent will not write.");
    }
    throw err;
  }

  // Only tools the gateway would run are offered. The offer is a courtesy; the
  // gate in authorize() is what enforces the tier.
  const offered = answerOnly ? [] : tools.filter((t) => t.tier <= MAX_TIER).map((t) => t.definition);
  const messages = toMessages(input.history ?? [], input.message);
  let steps = 0;
  let capReached = false;

  try {
    for (let turn = 0; turn < MAX_TOOL_STEPS + 2; turn++) {
      if (clock().getTime() > deadline) {
        return done("stopped: time limit", "That took longer than the agent is allowed. Try a smaller request.");
      }
      const response = await model.chat({ system, messages, tools: capReached ? [] : offered });
      inputTokens += response.usage.inputTokens;
      outputTokens += response.usage.outputTokens;
      messages.push({ role: "assistant", content: response.text, toolCalls: response.toolCalls });

      if (!response.toolCalls.length || capReached) {
        const outcome = capReached
          ? "answered: tool step cap reached"
          : answerOnly
            ? "answered: over daily cap, no actions"
            : response.finish === "length"
              ? "answered: cut off at length limit"
              : "answered";
        return done(outcome, response.text || "(The model gave no reply.)");
      }

      for (const call of response.toolCalls) {
        const gate = authorize(tools, call.name, answerOnly);
        if (!gate.ok) {
          toolsCalled.push({ name: call.name, tier: gate.tier, allowed: false, ok: false, note: gate.reason });
          messages.push({ role: "tool", toolCallId: call.id, name: call.name, isError: true, content: `Refused: ${gate.reason}.` });
          continue;
        }
        if (steps >= MAX_TOOL_STEPS) {
          capReached = true;
          toolsCalled.push({ name: call.name, tier: gate.tier, allowed: false, ok: false, note: "tool step cap reached" });
          messages.push({ role: "tool", toolCallId: call.id, name: call.name, isError: true, content: "Refused: the tool step cap for this request is reached. Reply with what you have." });
          continue;
        }
        steps++;
        highestTier = Math.max(highestTier, gate.tier);
        try {
          const output = await gate.tool.run({ db }, call.input);
          const id = output && typeof output === "object" && "id" in output ? String((output as { id: unknown }).id) : undefined;
          toolsCalled.push({ name: call.name, tier: gate.tier, allowed: true, ok: true, ...(id ? { note: id } : {}) });
          messages.push({ role: "tool", toolCallId: call.id, name: call.name, content: JSON.stringify(output) });
        } catch (err) {
          const note = err instanceof ToolInputError ? err.message : "the tool failed";
          if (!(err instanceof ToolInputError)) console.error(`tool ${call.name} failed`, err);
          toolsCalled.push({ name: call.name, tier: gate.tier, allowed: true, ok: false, note });
          messages.push({ role: "tool", toolCallId: call.id, name: call.name, isError: true, content: note });
        }
      }
      if (steps >= MAX_TOOL_STEPS) capReached = true;
    }
    return done("stopped: no reply within the step limit", "I stopped before finishing. Try a narrower request.");
  } catch (err) {
    if (err instanceof ModelUnavailableError) {
      return done("error: model unavailable", "Your PC did not answer. Check that it is on, awake, and running Ollama and the proxy.");
    }
    console.error("agent run failed", err);
    return done("error: run failed", "Something went wrong during the run. Nothing further was changed.");
  }
}

/** Start and work a run in one go (used by the checks). */
export async function runAgent(config: RunConfig, input: RunInput) {
  const started = await startRun(config, input);
  if (started.queued) await executeRun(config, started.runId, input, started.answerOnly);
  return getRun(config.db, started.runId, (config.now ?? (() => new Date()))());
}

/** What the front door shows for a run. Marks abandoned runs as failed. */
export async function getRun(db: Db, runId: string, now: Date): Promise<RunView | null> {
  await db
    .update(agentRuns)
    .set({ outcome: "error: run did not finish", reply: "The run stopped without finishing. Try again." })
    .where(
      and(
        eq(agentRuns.id, runId),
        inArray(agentRuns.outcome, ["queued", "running"]),
        lt(agentRuns.createdAt, new Date(now.getTime() - STALE_AFTER_MS)),
      ),
    );
  const [run] = await db.select().from(agentRuns).where(eq(agentRuns.id, runId)).limit(1);
  if (!run) return null;
  const working = run.outcome === "queued" || run.outcome === "running";
  return {
    runId: run.id,
    status: working ? "working" : "done",
    outcome: run.outcome ?? "",
    reply: run.reply,
    toolsCalled: (run.toolsCalled as ToolCallRecord[]) ?? [],
  };
}

