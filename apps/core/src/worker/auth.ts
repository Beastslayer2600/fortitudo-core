import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { workers } from "@/db/worker-schema";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = PgDatabase<any, any, any>;
export type WorkerRow = typeof workers.$inferSelect;

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** A fresh worker token. Shown once; only its hash is stored. */
export const newToken = () => `fw_${randomBytes(32).toString("base64url")}`;

export function bearer(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() || null : null;
}

/** The worker this request's token belongs to, or null. Never reads the body. */
export async function authenticateWorker(req: Request, db: Db): Promise<WorkerRow | null> {
  const token = bearer(req);
  if (!token) return null;
  const hash = hashToken(token);
  const [row] = await db.select().from(workers).where(eq(workers.tokenHash, hash)).limit(1);
  if (!row) return null;
  const a = Buffer.from(hash);
  const b = Buffer.from(row.tokenHash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return row.revokedAt ? null : row;
}
