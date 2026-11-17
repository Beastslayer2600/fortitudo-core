import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// The worker job queue (docs/worker-contract.md in fortitudo-local). Separate
// from the older front-desk `jobs` table, which it never touches.
// Workers pull jobs over outbound HTTPS; nothing here calls a worker.

export const workerJobKind = pgEnum("worker_job_kind", [
  "social_post",
  "website_edit",
  "website_build",
  "outreach_draft",
  "research_brief",
]);
export const jobTier = pgEnum("job_tier", ["small", "big"]);
export const workerJobStatus = pgEnum("worker_job_status", ["queued", "running", "done", "failed", "cancelled"]);
export const attemptStatus = pgEnum("worker_attempt_status", [
  "running",
  "done",
  "failed",
  "escalated",
  "expired",
  "cancelled",
]);

const tstz = (name: string) => timestamp(name, { withTimezone: true });

export const workers = pgTable("workers", {
  id: uuid("id").primaryKey().defaultRandom(),
  // The fixed worker.id the machine sends, e.g. "laptop-1".
  name: text("name").notNull().unique(),
  // SHA-256 of the token, hex. The token itself is never stored.
  tokenHash: text("token_hash").notNull().unique(),
  maxTier: jobTier("max_tier").notNull(),
  lastSeenAt: tstz("last_seen_at"),
  lastClaimAt: tstz("last_claim_at"),
  revokedAt: tstz("revoked_at"),
  createdAt: tstz("created_at").notNull().defaultNow(),
});

export const workerSkills = pgTable("worker_skills", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  description: text("description").notNull(),
  body: text("body").notNull(),
  version: integer("version").notNull().default(1),
  sourceUrl: text("source_url"),
  sourceSha: text("source_sha"),
  license: text("license"),
  createdAt: tstz("created_at").notNull().defaultNow(),
  updatedAt: tstz("updated_at").notNull().defaultNow(),
});

export const workerSchedules = pgTable("worker_schedules", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  cron: text("cron").notNull(),
  timezone: text("timezone").notNull().default("Africa/Johannesburg"),
  enabled: boolean("enabled").notNull().default(true),
  kind: workerJobKind("kind").notNull(),
  skill: text("skill").notNull(),
  tier: jobTier("tier").notNull(),
  allowSmallFallback: boolean("allow_small_fallback").notNull().default(false),
  prompt: text("prompt").notNull(),
  maxTokens: integer("max_tokens").notNull(),
  lastDueAt: tstz("last_due_at"),
  createdAt: tstz("created_at").notNull().defaultNow(),
});

export const workerJobs = pgTable(
  "worker_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: workerJobKind("kind").notNull(),
    tier: jobTier("tier").notNull(),
    skill: text("skill").notNull(),
    skillVersion: integer("skill_version").notNull(),
    // Assembled when the job is created, so a later skill edit cannot change a queued job.
    system: text("system").notNull(),
    prompt: text("prompt").notNull(),
    maxTokens: integer("max_tokens").notNull(),
    status: workerJobStatus("status").notNull().default("queued"),
    attempt: integer("attempt").notNull().default(1),
    cancelRequested: boolean("cancel_requested").notNull().default(false),
    runAfter: tstz("run_after").notNull().defaultNow(),
    allowSmallFallback: boolean("allow_small_fallback").notNull().default(false),
    claimedBy: uuid("claimed_by").references(() => workers.id),
    leaseExpiresAt: tstz("lease_expires_at"),
    result: text("result"),
    model: text("model"),
    scheduleId: uuid("schedule_id").references(() => workerSchedules.id),
    // The due time a schedule made this job for. Unique per schedule: once per due time.
    scheduledFor: tstz("scheduled_for"),
    createdAt: tstz("created_at").notNull().defaultNow(),
    updatedAt: tstz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("worker_jobs_schedule_due").on(t.scheduleId, t.scheduledFor),
    index("worker_jobs_status_run_after").on(t.status, t.runAfter),
  ],
);

export const workerJobAttempts = pgTable(
  "worker_job_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id").notNull().references(() => workerJobs.id),
    attempt: integer("attempt").notNull(),
    workerId: uuid("worker_id").references(() => workers.id),
    status: attemptStatus("status").notNull().default("running"),
    reason: text("reason"),
    lastSeq: integer("last_seq").notNull().default(0),
    lastEventAt: tstz("last_event_at"),
    startedAt: tstz("started_at").notNull().defaultNow(),
    endedAt: tstz("ended_at"),
  },
  (t) => [uniqueIndex("worker_job_attempts_job_attempt").on(t.jobId, t.attempt)],
);

// Append-only (a trigger in the migration refuses UPDATE and DELETE). One row
// per worker call, or per core note; `payload` holds that call's events.
export const workerJobEvents = pgTable(
  "worker_job_events",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    jobId: uuid("job_id").notNull().references(() => workerJobs.id),
    attempt: integer("attempt").notNull(),
    seq: integer("seq").notNull(),
    source: text("source").notNull().default("worker"),
    payload: jsonb("payload").$type<WorkerEvent[]>().notNull().default(sql`'[]'::jsonb`),
    stats: jsonb("stats").$type<Record<string, number>>(),
    createdAt: tstz("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("worker_job_events_job_attempt_seq").on(t.jobId, t.attempt, t.seq)],
);

export type WorkerEvent = { type: "progress"; note: string } | { type: "text"; text: string };

// One row (id = 1): the owner's "pause all workers" switch.
export const workerControl = pgTable("worker_control", {
  id: integer("id").primaryKey().default(1),
  paused: boolean("paused").notNull().default(false),
  updatedAt: tstz("updated_at").notNull().defaultNow(),
});
