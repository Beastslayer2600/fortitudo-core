import { MAX_PROMPT_CHARS, MAX_SYSTEM_CHARS } from "./limits";

// Appended to every skill. The worker model gets no tools; this keeps drafts safe to review.
export const GUARDRAIL =
  "Rules for every answer: give general information only, never financial advice, and never use or ask for client data. Write a draft for a person to review.";

/** system = the skill's text plus the guardrail. Null when it would not fit the contract's limit. */
export function buildSystem(skillBody: string): string | null {
  const system = `${skillBody.trim()}\n\n${GUARDRAIL}`;
  return system.length <= MAX_SYSTEM_CHARS ? system : null;
}

export function checkPrompt(prompt: string): string | null {
  if (!prompt.trim()) return "The prompt is empty.";
  if (prompt.length > MAX_PROMPT_CHARS) return `Keep the prompt under ${MAX_PROMPT_CHARS} characters.`;
  return null;
}
