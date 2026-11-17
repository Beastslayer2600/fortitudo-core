// Limits and constants from docs/worker-contract.md.
export const MAX_BODY_BYTES = 256 * 1024;
export const CLAIM_MIN_GAP_MS = 5_000;
export const EVENTS_MIN_GAP_MS = 2_000;
export const POLL_SECONDS = 15;
export const LEASE_SECONDS = 120;
export const MAX_ATTEMPTS = 3;
export const MAX_SYSTEM_CHARS = 12_000;
export const MAX_PROMPT_CHARS = 24_000;
export const MAX_NOTE_CHARS = 200;
export const MAX_TEXT_EVENT_CHARS = 8_000;
export const MAX_FINAL_CHARS = 200_000;
export const MAX_EVENTS_PER_CALL = 50;
export const MAX_TOKENS_LIMIT = 8_000;
export const TEMPERATURE = 0.7;
export const ONLINE_WINDOW_MS = 60_000;

export const KINDS = ["social_post", "website_edit", "website_build", "outreach_draft", "research_brief"] as const;
export type Kind = (typeof KINDS)[number];
export const TIERS = ["small", "big"] as const;
export type Tier = (typeof TIERS)[number];

export const DEFAULT_TIER: Record<Kind, Tier> = {
  social_post: "small",
  outreach_draft: "small",
  website_edit: "big",
  website_build: "big",
  research_brief: "big",
};
export const DEFAULT_MAX_TOKENS: Record<Kind, number> = {
  social_post: 600,
  outreach_draft: 800,
  website_edit: 4000,
  website_build: 6000,
  research_brief: 3000,
};
export const FAIL_REASONS = ["timeout", "model_error", "cancelled", "backend_unavailable", "internal"] as const;
export const ESCALATE_REASONS = ["context_too_large", "too_slow", "needs_bigger_model"] as const;
