import { createHash, timingSafeEqual } from "node:crypto";

// POST /api/local-ai  { count: 1, date: "YYYY-MM-DD" }
// The private "Fortitudo Local" app tells the core that one case was closed on
// a date. Only that count and date are kept, never anything that identifies a
// client (see the note on xp_events in db/schema.ts).
//
// The token is checked before the body is read or the database is touched.
// Same pattern as jobs/service-auth.ts: hash both sides, compare in constant
// time, and treat an unset token as matching nothing.

const sha = (s: string) => createHash("sha256").update(s).digest();

function tokenOk(req: Request): boolean {
  const expected = process.env.LOCAL_AI_SERVICE_TOKEN;
  if (!expected) return false;
  const h = req.headers.get("authorization") ?? "";
  if (!h.startsWith("Bearer ")) return false;
  return timingSafeEqual(sha(h.slice(7).trim()), sha(expected));
}

const DAY_MS = 86_400_000;
const SAST_OFFSET_MS = 2 * 3_600_000; // South Africa has no daylight saving

/** Today's date in South African time, as YYYY-MM-DD. */
function todaySast(now: Date): string {
  return new Date(now.getTime() + SAST_OFFSET_MS).toISOString().slice(0, 10);
}

/** A real calendar date, not in the future, not more than a year old. */
export function validDate(d: unknown, now: Date = new Date()): d is string {
  if (typeof d !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const t = new Date(`${d}T00:00:00Z`);
  if (Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== d) return false;
  const today = todaySast(now);
  const yearAgo = new Date(new Date(`${today}T00:00:00Z`).getTime() - 366 * DAY_MS).toISOString().slice(0, 10);
  return d <= today && d >= yearAgo;
}

/** The moment stored for a closed case: the posted date at 14:00 GMT+2. */
export function closedAt(date: string): Date {
  return new Date(`${date}T14:00:00+02:00`);
}

/** Writes one closed case. Injected so the checks can run without a database. */
export type RecordClosedCase = (at: Date) => Promise<void>;

const bad = () => Response.json({ error: "bad request" }, { status: 400 });

export async function handleLocalAi(
  req: Request,
  record: RecordClosedCase,
  now: Date = new Date(),
): Promise<Response> {
  if (!tokenOk(req)) return Response.json({ error: "unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return bad();
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return bad();
  const b = body as Record<string, unknown>;
  if (Object.keys(b).sort().join(",") !== "count,date") return bad();
  if (b.count !== 1 || !validDate(b.date, now)) return bad();

  try {
    await record(closedAt(b.date as string));
  } catch {
    return Response.json({ error: "could not record" }, { status: 500 });
  }
  return Response.json({ ok: true });
}

export const methodNotAllowed = () =>
  new Response(null, { status: 405, headers: { Allow: "POST" } });
