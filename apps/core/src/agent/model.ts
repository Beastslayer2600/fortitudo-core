// The gateway's own message format and the one connection it makes to a model.
// The model is Gert's: an open-weight model served by Ollama on his PC, reached
// through a token-checked proxy. Nothing here depends on a model vendor.

export type ToolDefinition = {
  name: string;
  description: string;
  /** JSON Schema for the tool's input. */
  parameters: Record<string, unknown>;
};

export type ToolCall = { id: string; name: string; input: Record<string, unknown> };

export type ChatMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string; isError?: boolean };

export type ChatRequest = {
  system: string;
  messages: ChatMessage[];
  /** Empty means the model must answer in words. */
  tools: ToolDefinition[];
};

export type ChatResponse = {
  text: string;
  toolCalls: ToolCall[];
  /** "length" means the reply was cut off by the token limit. */
  finish: "stop" | "tool_calls" | "length";
  usage: { inputTokens: number; outputTokens: number };
};

export type ModelClient = { chat(req: ChatRequest): Promise<ChatResponse> };

/** The PC did not answer (off, asleep, tunnel down) or answered with an error. */
export class ModelUnavailableError extends Error {}

type OllamaMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[];
  tool_name?: string;
};

type OllamaResponse = {
  message?: { content?: string; tool_calls?: { function?: { name?: string; arguments?: unknown } }[] };
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
  error?: string;
};

export function toOllamaMessages(req: ChatRequest): OllamaMessage[] {
  const out: OllamaMessage[] = [{ role: "system", content: req.system }];
  for (const m of req.messages) {
    if (m.role === "user") out.push({ role: "user", content: m.content });
    else if (m.role === "assistant") {
      out.push({
        role: "assistant",
        content: m.content,
        ...(m.toolCalls?.length
          ? { tool_calls: m.toolCalls.map((c) => ({ function: { name: c.name, arguments: c.input } })) }
          : {}),
      });
    } else {
      out.push({ role: "tool", tool_name: m.name, content: m.isError ? `Error: ${m.content}` : m.content });
    }
  }
  return out;
}

export function fromOllamaResponse(data: OllamaResponse, idPrefix: string): ChatResponse {
  const calls = (data.message?.tool_calls ?? [])
    .filter((c) => typeof c.function?.name === "string")
    .map((c, i) => {
      let input: unknown = c.function?.arguments ?? {};
      if (typeof input === "string") {
        try {
          input = JSON.parse(input);
        } catch {
          input = {};
        }
      }
      return {
        id: `${idPrefix}_${i}`,
        name: c.function!.name!,
        input: input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {},
      };
    });
  return {
    text: (data.message?.content ?? "").trim(),
    toolCalls: calls,
    finish: calls.length ? "tool_calls" : data.done_reason === "length" ? "length" : "stop",
    usage: { inputTokens: data.prompt_eval_count ?? 0, outputTokens: data.eval_count ?? 0 },
  };
}

/**
 * Talks to Ollama's /api/chat on Gert's PC. `url` is the public address of the
 * token-checked proxy (tools/local-model/proxy.mjs), never Ollama itself.
 */
export function ollamaClient(opts: { url: string; token: string; model: string; timeoutMs: number }): ModelClient {
  let call = 0;
  return {
    async chat(req) {
      let res: Response;
      try {
        res = await fetch(new URL("/api/chat", opts.url), {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${opts.token}` },
          body: JSON.stringify({
            model: opts.model,
            messages: toOllamaMessages(req),
            ...(req.tools.length
              ? { tools: req.tools.map((t) => ({ type: "function", function: t })) }
              : {}),
            stream: false,
            think: false,
            keep_alive: "24h",
            options: { num_ctx: 8192, num_predict: 2048 },
          }),
          signal: AbortSignal.timeout(opts.timeoutMs),
        });
      } catch (err) {
        throw new ModelUnavailableError(`could not reach the model: ${(err as Error).message}`);
      }
      const data = (await res.json().catch(() => ({}))) as OllamaResponse;
      if (!res.ok || data.error) {
        throw new ModelUnavailableError(`the model answered ${res.status}${data.error ? `: ${data.error}` : ""}`);
      }
      return fromOllamaResponse(data, `call${call++}`);
    },
  };
}
