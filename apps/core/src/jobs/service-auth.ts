import { createHash, timingSafeEqual } from "node:crypto";
import { currentUser } from "@/auth";

// Who may call the job API.
//   frontdesk: the front-desk service (FRONTDESK_TOKEN): create and read jobs, read drafts.
//   worker:    the background worker (WORKER_TOKEN): claim and finish jobs, read jobs.
//   owner:     the signed-in owner (reads only, for the status board).
// A token holder can never publish, delete or reach any other table: these
// routes are the only thing a token opens.
export type Caller = "frontdesk" | "worker" | "owner";

const sha = (s: string) => createHash("sha256").update(s).digest();

function sameSecret(given: string, expected: string | undefined): boolean {
  if (!expected) return false; // an unset token matches nothing
  return timingSafeEqual(sha(given), sha(expected));
}

export function bearer(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : null;
}

export async function callerOf(req: Request): Promise<Caller | null> {
  const token = bearer(req);
  if (token) {
    if (sameSecret(token, process.env.FRONTDESK_TOKEN)) return "frontdesk";
    if (sameSecret(token, process.env.WORKER_TOKEN)) return "worker";
    return null; // a wrong token is never rescued by a session
  }
  const user = await currentUser();
  return user?.role === "owner" ? "owner" : null;
}
