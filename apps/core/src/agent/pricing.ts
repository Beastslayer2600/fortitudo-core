import type Anthropic from "@anthropic-ai/sdk";

// USD per million tokens, Anthropic list price. Used only to meter the daily
// spend ceiling, so an unknown model is priced at the most expensive rate.
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-fable-5-2": { input: 8, output: 40 },
};
const MOST_EXPENSIVE = { input: 10, output: 50 };

export function priceFor(model: string) {
  return PRICES[model] ?? MOST_EXPENSIVE;
}

export function costOf(model: string, usage: Anthropic.Usage) {
  const p = priceFor(model);
  // Cache writes bill at 1.25x input, cache reads at 0.1x. Counting both
  // keeps the meter honest if caching is switched on later.
  const input =
    usage.input_tokens +
    (usage.cache_creation_input_tokens ?? 0) * 1.25 +
    (usage.cache_read_input_tokens ?? 0) * 0.1;
  return (input * p.input + usage.output_tokens * p.output) / 1_000_000;
}
