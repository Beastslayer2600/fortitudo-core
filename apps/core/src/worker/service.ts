import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { clientDetail } from "@/jobs/guard";
import {
  workerControl,
  workerJobAttempts,
  workerJobEvents,
  workerJobs,
  workerSchedules,
  workerSkills,
  workers,
} from "@/db/worker-schema";
import { hashToken, newToken, type Db } from "./auth";
import { parseCron, SCHEDULE_TZ } from "./cron";
import { DEFAULT_MAX_TOKENS, DEFAULT_TIER, KINDS, MAX_TOKENS_LIMIT, ONLINE_WINDOW_MS, TIERS, type Kind, type Tier } from "./limits";
import { buildSystem, checkPrompt } from "./prompt";
import { oneOf } from "./validate";

// Owner-side logic for the browser pages. The pages call requireOwner() first.

export type Failure = { error: string };
export const isFailure = (v: unknown): v is Failure => typeof v === "object" && v !== null && "error" in v;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type JobInput = {
  kind: unknown;
  skill: unknown;
  tier?: unknown; // blank = the default for the kind
  allowSmallFallback?: unknown;
  prompt: unknown;
  maxTokens?: unknown;
};

type Assembled = { kind: Kind; tier: Tier; skill: string; skillVersion: number; system: string; prompt: string; maxTokens: number; allowSmallFallback: boolean };

/** Checks a job request and builds what the table stores. Shared by jobs and schedules. */
export async function assembleJob(db: Db, input: JobInput): Promise<Failure | Assembled> {
  if (!oneOf(input.kind, KINDS)) return { error: "Pick a kind of job." };
  const kind: Kind = input.kind;
  const tier: Tier = input.tier === undefined || input.tier === "" || input.tier === null ? DEFAULT_TIER[kind] : TIERS.includes(input.tier as Tier) ? (input.tier as Tier) : DEFAULT_TIER[kind];
  if (typeof input.skill !== "string" || !input.skill) return { error: "Pick a skill." };
  if (typeof input.prompt !== "string") return { error: "Write a prompt." };
  const badPrompt = checkPrompt(input.prompt);
  if (badPrompt) return { error: badPrompt };
  const what = clientDetail(input.prompt);
  if (what) return { error: `The prompt looks like it contains ${what}. Client detail never goes into a job.` };
  const maxTokens = input.maxTokens === undefined || input.maxTokens === "" ? DEFAULT_MAX_TOKENS[kind] : Number(input.maxTokens);
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > MAX_TOKENS_LIMIT) return { error: `Max tokens must be 1 to ${MAX_TOKENS_LIMIT}.` };
  const [skill] = await db.select().from(workerSkills).where(eq(workerSkills.name, input.skill));
  if (!skill) return { error: "That skill does not exist." };
  const system = buildSystem(skill.body);
  if (!system) return { error: "That skill is too long to send to a worker." };
  return {
    kind,
    tier,
    skill: skill.name,
    skillVersion: skill.version,
    system,
    prompt: input.prompt,
    maxTokens,
    allowSmallFallback: tier === "big" && (input.allowSmallFallback === true || input.allowSmallFallback === "on"),
  };
}

export async function createJob(db: Db, input: JobInput, now = new Date()): Promise<{ id: string } | Failure> {
  const a = await assembleJob(db, input);
  if (isFailure(a)) return a;
  const [row] = await db.insert(workerJobs).values({ ...a, runAfter: now }).returning({ id: workerJobs.id });
  return { id: row!.id };
}

export async function listJobs(db: Db) {
  return db
    .select({ id: workerJobs.id, kind: workerJobs.kind, tier: workerJobs.tier, skill: workerJobs.skill, status: workerJobs.status, attempt: workerJobs.attempt, createdAt: workerJobs.createdAt })
    .from(workerJobs)
    .orderBy(desc(workerJobs.createdAt))
    .limit(50);
}

/** Everything the live view needs. `after` is an event cursor (the event row id), 0 for all. */
export async function jobView(db: Db, id: string, after: number) {
  if (!UUID.test(id)) return null;
  const [job] = await db.select().from(workerJobs).where(eq(workerJobs.id, id));
  if (!job) return null;
  const events = await db
    .select({ id: workerJobEvents.id, attempt: workerJobEvents.attempt, seq: workerJobEvents.seq, source: workerJobEvents.source, payload: workerJobEvents.payload, createdAt: workerJobEvents.createdAt })
    .from(workerJobEvents)
    .where(and(eq(workerJobEvents.jobId, id), gt(workerJobEvents.id, after)))
    .orderBy(asc(workerJobEvents.id))
    .limit(500);
  const attempts = await db
    .select({ attempt: workerJobAttempts.attempt, status: workerJobAttempts.status, reason: workerJobAttempts.reason })
    .from(workerJobAttempts)
    .where(eq(workerJobAttempts.jobId, id))
    .orderBy(asc(workerJobAttempts.attempt));
  return {
    job: { id: job.id, kind: job.kind, tier: job.tier, skill: job.skill, status: job.status, attempt: job.attempt, cancelRequested: job.cancelRequested, result: job.result, model: job.model },
    attempts,
    events: events.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() })),
    cursor: events.length ? events[events.length - 1]!.id : after,
  };
}

/** Queued jobs cancel at once; a running one is flagged and the worker stops at its next heartbeat. */
export async function cancelJob(db: Db, id: string, now = new Date()) {
  if (!UUID.test(id)) return;
  await db
    .update(workerJobs)
    .set({ status: "cancelled", cancelRequested: true, updatedAt: now })
    .where(and(eq(workerJobs.id, id), eq(workerJobs.status, "queued")));
  await db
    .update(workerJobs)
    .set({ cancelRequested: true, updatedAt: now })
    .where(and(eq(workerJobs.id, id), eq(workerJobs.status, "running")));
}

// ---- workers --------------------------------------------------------------

/** Makes a worker. The returned token is shown once; only its hash is stored. */
export async function createWorker(db: Db, name: unknown, maxTier: unknown): Promise<{ token: string; name: string } | Failure> {
  if (typeof name !== "string" || !/^[a-z0-9][a-z0-9-]{0,31}$/.test(name)) return { error: "Name: lowercase letters, digits and dashes, up to 32." };
  if (!oneOf(maxTier, TIERS)) return { error: "Pick small or big." };
  const token = newToken();
  try {
    await db.insert(workers).values({ name, maxTier, tokenHash: hashToken(token) });
  } catch {
    return { error: "A worker with that name already exists." };
  }
  return { token, name };
}

export async function revokeWorker(db: Db, id: string, now = new Date()) {
  if (UUID.test(id)) await db.update(workers).set({ revokedAt: now }).where(eq(workers.id, id));
}

export async function workerStatus(db: Db, now = new Date()) {
  const rows = await db
    .select({ id: workers.id, name: workers.name, maxTier: workers.maxTier, lastSeenAt: workers.lastSeenAt, revokedAt: workers.revokedAt })
    .from(workers)
    .orderBy(asc(workers.name));
  const [control] = await db.select().from(workerControl).where(eq(workerControl.id, 1));
  return {
    paused: control?.paused ?? false,
    workers: rows.map((w) => ({ ...w, online: !w.revokedAt && !!w.lastSeenAt && now.getTime() - w.lastSeenAt.getTime() <= ONLINE_WINDOW_MS })),
  };
}

export async function setPaused(db: Db, paused: boolean, now = new Date()) {
  await db
    .insert(workerControl)
    .values({ id: 1, paused, updatedAt: now })
    .onConflictDoUpdate({ target: workerControl.id, set: { paused, updatedAt: now } });
}

// ---- schedules ------------------------------------------------------------

export async function createSchedule(db: Db, input: JobInput & { name: unknown; cron: unknown }): Promise<{ id: string } | Failure> {
  if (typeof input.name !== "string" || !input.name.trim() || input.name.length > 80) return { error: "Give the schedule a name." };
  if (typeof input.cron !== "string" || !parseCron(input.cron)) return { error: "Cron needs five fields, like 0 8 * * 1-5." };
  const a = await assembleJob(db, input);
  if (isFailure(a)) return a;
  const [row] = await db
    .insert(workerSchedules)
    .values({ name: input.name.trim(), cron: input.cron.trim(), timezone: SCHEDULE_TZ, kind: a.kind, skill: a.skill, tier: a.tier, allowSmallFallback: a.allowSmallFallback, prompt: a.prompt, maxTokens: a.maxTokens })
    .returning({ id: workerSchedules.id });
  return { id: row!.id };
}

export async function setScheduleEnabled(db: Db, id: string, enabled: boolean) {
  if (UUID.test(id)) await db.update(workerSchedules).set({ enabled }).where(eq(workerSchedules.id, id));
}

export const listSchedules = (db: Db) => db.select().from(workerSchedules).orderBy(asc(workerSchedules.name));

// ---- skills ---------------------------------------------------------------

export async function saveSkill(db: Db, input: { name: unknown; description: unknown; body: unknown }): Promise<{ ok: true } | Failure> {
  const { name, description, body } = input;
  if (typeof name !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) return { error: "Skill name: lowercase letters, digits and dashes." };
  if (typeof description !== "string" || !description.trim() || description.length > 200) return { error: "One-line description, up to 200 characters." };
  if (typeof body !== "string" || !body.trim()) return { error: "The skill text is empty." };
  if (!buildSystem(body)) return { error: "The skill text is too long (the worker gets at most 12,000 characters with the guardrail)." };
  const now = new Date();
  const [have] = await db.select().from(workerSkills).where(eq(workerSkills.name, name));
  if (have) {
    const same = have.body === body && have.description === description;
    if (!same) await db.update(workerSkills).set({ description, body, version: have.version + 1, updatedAt: now }).where(eq(workerSkills.id, have.id));
  } else {
    await db.insert(workerSkills).values({ name, description, body });
  }
  return { ok: true };
}

export const listSkills = (db: Db) => db.select().from(workerSkills).orderBy(asc(workerSkills.name));

export async function activeJobCount(db: Db) {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(workerJobs).where(inArray(workerJobs.status, ["queued", "running"]));
  return r?.n ?? 0;
}
