import { desc, eq, inArray, sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { contentItems, jobs } from "@/db/schema";
import { isJobAgent, MAX_RESULT_CHARS, refuseTask, type JobAgent } from "./guard";

// Data access for the job queue. Takes any drizzle Postgres database, so the
// routes use Neon and db:verify uses in-memory PGlite with the same code.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = PgDatabase<any, any, any>;
type JobRow = typeof jobs.$inferSelect;

export type JobStatus = JobRow["status"];
export const JOB_STATUSES: readonly JobStatus[] = ["queued", "running", "done", "failed"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIST_LIMIT = 50;

export function present(j: JobRow) {
  return {
    id: j.id,
    agent: j.agent,
    task: j.task,
    status: j.status,
    result: j.result,
    draftId: j.draftId,
    createdAt: j.createdAt.toISOString(),
    updatedAt: j.updatedAt.toISOString(),
  };
}

export type Failure = { error: string; status: 400 | 404 | 409 };

export async function createJob(db: Db, agent: unknown, task: unknown): Promise<{ id: string } | Failure> {
  if (!isJobAgent(agent)) return { error: "agent must be glm, content or helper.", status: 400 };
  if (typeof task !== "string") return { error: "task must be text.", status: 400 };
  const why = refuseTask(task);
  if (why) return { error: why, status: 400 };
  const [row] = await db.insert(jobs).values({ agent, task: task.trim() }).returning({ id: jobs.id });
  return { id: row!.id };
}

/** The most recent jobs, oldest first, optionally one status. */
export async function listJobs(db: Db, status?: string | null) {
  if (status && !(JOB_STATUSES as readonly string[]).includes(status)) return null;
  const rows = await db
    .select()
    .from(jobs)
    .where(status ? eq(jobs.status, status as JobStatus) : undefined)
    .orderBy(desc(jobs.createdAt))
    .limit(LIST_LIMIT);
  return rows.reverse().map(present);
}

export async function getJob(db: Db, id: string) {
  if (!UUID.test(id)) return null;
  const [row] = await db.select().from(jobs).where(eq(jobs.id, id)).limit(1);
  return row ? present(row) : null;
}

/** Atomically takes the oldest queued job (optionally for given agents) and marks it running. */
export async function claimJob(db: Db, agents?: JobAgent[]) {
  const pick = sql`(select ${jobs.id} from ${jobs} where ${jobs.status} = 'queued'
    ${agents?.length ? sql`and ${inArray(jobs.agent, agents)}` : sql``}
    order by ${jobs.createdAt} limit 1 for update skip locked)`;
  const [row] = await db
    .update(jobs)
    .set({ status: "running", updatedAt: new Date() })
    .where(eq(jobs.id, pick))
    .returning();
  return row ? present(row) : null;
}

/** running -> done | failed, with the result and, optionally, the draft it produced. */
export async function finishJob(
  db: Db,
  id: string,
  input: { status?: unknown; result?: unknown; draftId?: unknown },
): Promise<ReturnType<typeof present> | Failure> {
  if (!UUID.test(id)) return { error: "No job with that id.", status: 404 };
  if (input.status !== "done" && input.status !== "failed") {
    return { error: 'status must be "done" or "failed".', status: 400 };
  }
  let result: string | null = null;
  if (input.result != null) {
    if (typeof input.result !== "string") return { error: "result must be text.", status: 400 };
    if (input.result.length > MAX_RESULT_CHARS) return { error: `Keep the result under ${MAX_RESULT_CHARS} characters.`, status: 400 };
    result = input.result;
  }
  let draftId: string | null = null;
  if (input.draftId != null) {
    if (typeof input.draftId !== "string" || !UUID.test(input.draftId)) return { error: "draftId must be a draft's id.", status: 400 };
    const [draft] = await db.select({ status: contentItems.status }).from(contentItems).where(eq(contentItems.id, input.draftId)).limit(1);
    if (!draft || draft.status !== "draft") return { error: "draftId must point at an unpublished draft.", status: 400 };
    draftId = input.draftId;
  }
  const [row] = await db
    .update(jobs)
    .set({ status: input.status, result, draftId, updatedAt: new Date() })
    .where(sql`${jobs.id} = ${id} and ${jobs.status} = 'running'`)
    .returning();
  if (row) return present(row);
  const [exists] = await db.select({ status: jobs.status }).from(jobs).where(eq(jobs.id, id)).limit(1);
  return exists
    ? { error: `The job is ${exists.status}; only a running job can be finished.`, status: 409 }
    : { error: "No job with that id.", status: 404 };
}

/** Drafts waiting for the owner: content items still in the draft state. */
export async function pendingDrafts(db: Db) {
  const rows = await db
    .select({ id: contentItems.id, title: contentItems.title, createdAt: contentItems.createdAt })
    .from(contentItems)
    .where(eq(contentItems.status, "draft"))
    .orderBy(desc(contentItems.createdAt))
    .limit(LIST_LIMIT);
  return rows.map((d) => ({ id: d.id, title: d.title, createdAt: d.createdAt.toISOString() }));
}

export const isFailure = (v: unknown): v is Failure =>
  !!v && typeof v === "object" && "error" in v && "status" in v && typeof (v as Failure).status === "number";
