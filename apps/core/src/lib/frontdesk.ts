// Client helpers for the front desk: a small model on Gert's laptop that chats,
// hands tasks to the slow agents and reports status. The front door only needs
// its address (a setting) and a way to read its stream.

export const FRONTDESK_STORE = "fortitudo-frontdesk-url";

/**
 * The base URL from the setting, reduced to its origin, or null if it is not
 * usable. The front door is HTTPS and browsers block calls from it to plain
 * HTTP, so only https is accepted, plus http on this machine for local work.
 */
export function normalizeBaseUrl(input: string): string | null {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]";
  if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) return null;
  if (u.username || u.password) return null;
  return u.origin;
}

export type FrontDeskEvent =
  | { type: "token"; text: string }
  | { type: "tool"; name: string; args: Record<string, unknown>; result: unknown }
  | { type: "error"; message: string }
  | { type: "done" };

/** Splits a server-sent-events buffer into complete events and the unfinished rest. */
export function parseSseChunk(buffer: string): { events: FrontDeskEvent[]; rest: string } {
  const events: FrontDeskEvent[] = [];
  let rest = buffer;
  let i: number;
  while ((i = rest.indexOf("\n\n")) >= 0) {
    const block = rest.slice(0, i);
    rest = rest.slice(i + 2);
    const line = block.split("\n").find((l) => l.startsWith("data:"));
    if (!line) continue;
    try {
      events.push(JSON.parse(line.slice(5).trim()) as FrontDeskEvent);
    } catch {
      // A malformed event is skipped, not fatal.
    }
  }
  return { events, rest };
}

/** What the chat shows next to a tool the front desk used. */
export function toolNote(name: string, result: unknown): { ok: boolean; note?: string } {
  const r = (result ?? {}) as { id?: unknown; error?: unknown };
  if (r.error) return { ok: false, note: String(r.error) };
  return { ok: true, note: name === "hand_off" && typeof r.id === "string" ? r.id : undefined };
}

export type StatusJob = { id: string; agent: string; task: string; status: "queued" | "running" | "done" | "failed" };
export type StatusDraft = { id: string; title: string };
export type StatusBoard = { jobs: StatusJob[]; drafts: StatusDraft[] };
