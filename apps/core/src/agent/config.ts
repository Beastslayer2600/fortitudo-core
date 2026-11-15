import { db } from "@/db";
import { DEFAULT_DAILY_REQUEST_CAP, RUN_DEADLINE_MS, type RunConfig } from "./gateway";
import { ollamaClient } from "./model";

// Reads the agent's settings from the environment. The model is Gert's own,
// served from his PC; nothing runs until all three model settings are present.
export function runConfig(): RunConfig {
  const modelName = process.env.AGENT_MODEL?.trim() || undefined;
  const url = process.env.AGENT_MODEL_URL?.trim();
  const token = process.env.AGENT_MODEL_TOKEN?.trim();
  const cap = Number(process.env.AGENT_DAILY_REQUEST_CAP);
  return {
    db: db(),
    modelName,
    model: modelName && url && token ? ollamaClient({ url, token, model: modelName, timeoutMs: RUN_DEADLINE_MS }) : null,
    dailyRequestCap: Number.isFinite(cap) && cap > 0 ? cap : DEFAULT_DAILY_REQUEST_CAP,
  };
}
