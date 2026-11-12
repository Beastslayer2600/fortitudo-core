import Anthropic from "@anthropic-ai/sdk";
import { eq, gte, sum } from "drizzle-orm";
import { agentRuns } from "@/db/schema";
import { buildInstructions, MissingBrandRootError } from "./memory";
import { costOf } from "./pricing";
import { TOOLS, ToolInputError, type AgentTool, type Db, type Tier } from "./tools";

/** The highest tier this gateway will run. Tier 2 (publish) and up are refused in code. */
export const MAX_TIER: Tier = 1;
/** Tool calls allowed per request. A confused run stops instead of looping. */
export const MAX_TOOL_STEPS = 8;
/**
 * Past the daily ceiling the agent still answers but takes no actions (as the
 * architecture document says). Past this multiple of the ceiling it stops
 * calling the model at all, so spend has a hard limit too.
 */
export const HARD_STOP_MULTIPLE = 2;

/** The one call the gateway makes to a model. Swappable, so the model can change without touching the gateway. */
export type ModelClient = {
  create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>;
};

export function anthropicClient(apiKey: string): ModelClient {
  const client = new Anthropic({ apiKey });
  return { create: (params) => client.messages.create(params) };
}

export type HistoryTurn = { role: "user" | "assistant"; text: string };

export type ToolCallRecord = {
  name: string;
  tier: Tier | null;
  allowed: boolean;
  ok: boolean;
  note?: string;
};

export type RunResult = {
  runId: string;
  reply: string;
  outcome: string;
  toolsCalled: ToolCallRecord[];
  costUsd: number;
};

export type RunDeps = {
  db: Db;
  model: ModelClient | null;
  modelName: string | undefined;
  /** USD per day. Undefined or invalid means no runs at all. */
  ceilingUsd: number | undefined;
  tools?: readonly AgentTool[];
  now?: Date;
};

/** Start of the current day in South Africa (UTC+2, no daylight saving). */
export function startOfDaySast(now: Date) {
  const shifted = new Date(now.getTime() + 2 * 3600_000);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - 2 * 3600_000);
}

export async function spentToday(db: Db, now: Date) {
  const [row] = await db
    .select({ total: sum(agentRuns.costUsd) })
    .from(agentRuns)
    .where(gte(agentRuns.createdAt, startOfDaySast(now)));
  return Number(row?.total ?? 0);
}

/** The tier gate. Every tool call passes through here before anything runs. */
export function authorize(tools: readonly AgentTool[], name: string, answerOnly: boolean) {
  const tool = tools.find((t) => t.name === name);
  if (!tool) return { ok: false as const, tier: null, reason: `there is no tool called "${name}"` };
  if (tool.tier > MAX_TIER) {
    return { ok: false as const, tier: tool.tier, reason: `"${name}" is tier ${tool.tier}; this gateway runs tier ${MAX_TIER} and below` };
  }
  if (answerOnly) {
    return { ok: false as const, tier: tool.tier, reason: "the daily spend ceiling is reached, so tools are off for today" };
  }
  return { ok: true as const, tier: tool.tier, tool };
}

function textOf(message: Anthropic.Message) {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n\n")
    .trim();
}

function toMessages(history: HistoryTurn[], message: string): Anthropic.MessageParam[] {
  const turns = history.filter((t) => t.text.trim());
  while (turns.length && turns[0].role !== "user") turns.shift();
  return [...turns.map((t) => ({ role: t.role, content: t.text })), { role: "user", content: message }];
}

export async function runAgent(
  deps: RunDeps,
  input: { face: string; message: string; history?: HistoryTurn[] },
): Promise<RunResult> {
  const { db, model, modelName } = deps;
  const tools = deps.tools ?? TOOLS;
  const now = deps.now ?? new Date();

  // Every run is logged, including the ones refused before the model is called.
  const [run] = await db
    .insert(agentRuns)
    .values({ face: input.face, request: input.message, outcome: "running", model: modelName ?? null })
    .returning({ id: agentRuns.id });

  const toolsCalled: ToolCallRecord[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;
  let highestTier = 0;

  const finish = async (outcome: string, reply: string): Promise<RunResult> => {
    await db
      .update(agentRuns)
      .set({ outcome, tier: highestTier, toolsCalled, inputTokens, outputTokens, costUsd })
      .where(eq(agentRuns.id, run.id));
    return { runId: run.id, reply, outcome, toolsCalled, costUsd };
  };

  if (!model || !modelName) {
    return finish("refused: no model configured", "The agent has no model configured yet (AGENT_MODEL and its key).");
  }
  const ceiling = deps.ceilingUsd;
  if (ceiling === undefined || !Number.isFinite(ceiling) || ceiling < 0) {
    return finish("refused: no spend ceiling set", "The agent will not run until a daily spend ceiling is set (AGENT_DAILY_CEILING_USD).");
  }

  const spent = await spentToday(db, now);
  if (spent >= ceiling * HARD_STOP_MULTIPLE) {
    return finish("refused: daily hard stop", "Today's spend limit is used up. The agent is resting until tomorrow.");
  }
  const answerOnly = spent >= ceiling;

  let system: string;
  try {
    system = await buildInstructions(db);
  } catch (err) {
    if (err instanceof MissingBrandRootError) {
      return finish("refused: brand_root missing", "The identity root is missing, so the agent will not write.");
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
      const response = await model.create({
        model: modelName,
        max_tokens: 16000,
        system,
        messages,
        ...(offered.length ? { tools: offered, ...(capReached ? { tool_choice: { type: "none" as const } } : {}) } : {}),
      });
      inputTokens += response.usage.input_tokens + (response.usage.cache_read_input_tokens ?? 0) + (response.usage.cache_creation_input_tokens ?? 0);
      outputTokens += response.usage.output_tokens;
      costUsd += costOf(modelName, response.usage);
      messages.push({ role: "assistant", content: response.content });

      if (response.stop_reason === "refusal") {
        return finish("declined by model", textOf(response) || "I can't help with that request.");
      }
      if (response.stop_reason !== "tool_use") {
        const reply = textOf(response);
        const outcome = capReached ? "answered: tool step cap reached" : answerOnly ? "answered: over ceiling, no actions" : "answered";
        return finish(outcome, reply);
      }

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const use of response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")) {
        const gate = authorize(tools, use.name, answerOnly);
        if (!gate.ok) {
          toolsCalled.push({ name: use.name, tier: gate.tier, allowed: false, ok: false, note: gate.reason });
          results.push({ type: "tool_result", tool_use_id: use.id, is_error: true, content: `Refused: ${gate.reason}.` });
          continue;
        }
        if (steps >= MAX_TOOL_STEPS) {
          capReached = true;
          toolsCalled.push({ name: use.name, tier: gate.tier, allowed: false, ok: false, note: "tool step cap reached" });
          results.push({ type: "tool_result", tool_use_id: use.id, is_error: true, content: "Refused: the tool step cap for this request is reached. Reply with what you have." });
          continue;
        }
        steps++;
        highestTier = Math.max(highestTier, gate.tier);
        try {
          const raw = use.input && typeof use.input === "object" ? (use.input as Record<string, unknown>) : {};
          const output = await gate.tool.run({ db }, raw);
          const id = output && typeof output === "object" && "id" in output ? String((output as { id: unknown }).id) : undefined;
          toolsCalled.push({ name: use.name, tier: gate.tier, allowed: true, ok: true, ...(id ? { note: id } : {}) });
          results.push({ type: "tool_result", tool_use_id: use.id, content: JSON.stringify(output) });
        } catch (err) {
          const note = err instanceof ToolInputError ? err.message : "the tool failed";
          if (!(err instanceof ToolInputError)) console.error(`tool ${use.name} failed`, err);
          toolsCalled.push({ name: use.name, tier: gate.tier, allowed: true, ok: false, note });
          results.push({ type: "tool_result", tool_use_id: use.id, is_error: true, content: note });
        }
      }
      if (steps >= MAX_TOOL_STEPS) capReached = true;
      messages.push({ role: "user", content: results });
    }
    return finish("stopped: no reply within the step limit", "I stopped before finishing. Try a narrower request.");
  } catch (err) {
    console.error("agent run failed", err);
    const status = err instanceof Anthropic.APIError ? ` ${err.status}` : "";
    return finish(`error: model call failed${status}`, "The model call failed. Nothing further was changed. Try again in a moment.");
  }
}
