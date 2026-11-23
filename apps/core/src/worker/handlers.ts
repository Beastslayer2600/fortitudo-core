import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import {
  workerControl,
  workerJobAttempts,
  workerJobEvents,
  workerJobs,
  workerSchedules,
  workerSkills,
  workers,
  type WorkerEvent,
} from "@/db/worker-schema";
import { authenticateWorker, type Db, type WorkerRow } from "./auth";
import { latestDue, SCHEDULE_TZ } from "./cron";
import {
  CLAIM_MIN_GAP_MS,
  ESCALATE_REASONS,
  EVENTS_MIN_GAP_MS,
  FAIL_REASONS,
  LEASE_SECONDS,
  MAX_ATTEMPTS,
  MAX_BODY_BYTES,
  MAX_EVENTS_PER_CALL,
  MAX_FINAL_CHARS,
  MAX_NOTE_CHARS,
  MAX_TEXT_EVENT_CHARS,
  POLL_SECONDS,
  TEMPERATURE,
  TIERS,
} from "./limits";
import { buildSystem } from "./prompt";
import { isInt, isObj, isStr, onlyKeys, oneOf, statsOf, strList } from "./validate";

// The worker side of docs/worker-contract.md. Each handler takes a Request and a
// database, so the contract tests run the same code on in-memory Postgres.
// Neon's HTTP driver has no transactions: every step is one conditional statement.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const headers = { "cache-control": "no-store" };
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers });
// Error bodies are fixed short text: never the token, the prompt or the output.
const fail = (status: number, error: string) => reply({ error }, status);
const secs = (now: Date, s: number) => new Date(now.getTime() + s * 1000);

type Early = Response;
async function enter(req: Request, db: Db, now: Date): Promise<WorkerRow | Early> {
  const worker = await authenticateWorker(req, db); // before the body is read
  if (!worker) return fail(401, "Unauthorized");
  await db.update(workers).set({ lastSeenAt: now }).where(eq(workers.id, worker.id));
  return worker;
}

async function readJson(req: Request): Promise<Record<string, unknown> | Early> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) return fail(400, "Body too large");
  const text = await req.text();
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) return fail(400, "Body too large");
  try {
    const v: unknown = JSON.parse(text);
    return isObj(v) ? v : fail(400, "Bad body");
  } catch {
    return fail(400, "Bad body");
  }
}

const bad = () => fail(400, "Bad body");

// ---- claim ---------------------------------------------------------------

export async function handleClaim(req: Request, db: Db, now = new Date()): Promise<Response> {
  const w = await enter(req, db, now);
  if (w instanceof Response) return w;
  const body = await readJson(req);
  if (body instanceof Response) return body;
  const d = body.worker;
  if (!onlyKeys(body, ["worker"]) || !isObj(d)) return bad();
  if (
    !onlyKeys(d, ["id", "version", "maxTier", "backends", "models", "onlyBig"]) ||
    !isStr(d.id, 64, 1) ||
    !isInt(d.version, 1) ||
    !oneOf(d.maxTier, TIERS) ||
    !strList(d.backends, 10, 40) ||
    !strList(d.models, 20, 120) ||
    (d.onlyBig !== undefined && typeof d.onlyBig !== "boolean")
  ) {
    return bad();
  }
  if (d.id !== w.name) return fail(403, "Wrong worker id");
  if (d.maxTier !== w.maxTier) return fail(400, "maxTier does not match this worker");

  const gate = await db
    .update(workers)
    .set({ lastClaimAt: now })
    .where(and(eq(workers.id, w.id), or(isNull(workers.lastClaimAt), lt(workers.lastClaimAt, new Date(now.getTime() - CLAIM_MIN_GAP_MS)))))
    .returning({ id: workers.id });
  if (gate.length === 0) return fail(429, "Too fast");

  const [control] = await db.select().from(workerControl).where(eq(workerControl.id, 1));
  if (control?.paused) return reply({ job: null, pollSeconds: POLL_SECONDS, paused: true });

  await materialiseSchedules(db, now);
  await expireLeases(db, now);

  const tierOk = w.maxTier === "big" ? (d.onlyBig === true ? sql`${workerJobs.tier} = 'big'` : sql`true`) : sql`(${workerJobs.tier} = 'small' or ${workerJobs.allowSmallFallback})`;
  const pick = sql`(select ${workerJobs.id} from ${workerJobs}
    where ${workerJobs.status} = 'queued' and ${workerJobs.runAfter} <= ${now.toISOString()}
    and not ${workerJobs.cancelRequested} and ${tierOk}
    order by (${workerJobs.tier} = ${w.maxTier}) desc, ${workerJobs.createdAt} limit 1 for update skip locked)`;
  const [job] = await db
    .update(workerJobs)
    .set({ status: "running", claimedBy: w.id, leaseExpiresAt: secs(now, LEASE_SECONDS), updatedAt: now })
    .where(eq(workerJobs.id, pick))
    .returning();
  if (!job) return reply({ job: null, pollSeconds: POLL_SECONDS, paused: false });

  await db
    .insert(workerJobAttempts)
    .values({ jobId: job.id, attempt: job.attempt, workerId: w.id, startedAt: now })
    .onConflictDoNothing();
  return reply({
    job: {
      id: job.id,
      attempt: job.attempt,
      kind: job.kind,
      tier: job.tier,
      system: job.system,
      prompt: job.prompt,
      maxTokens: job.maxTokens,
      temperature: TEMPERATURE,
      leaseSeconds: LEASE_SECONDS,
    },
    pollSeconds: POLL_SECONDS,
    paused: false,
  });
}

/** Turns due schedules into jobs: once per schedule per due time (unique index). */
export async function materialiseSchedules(db: Db, now: Date) {
  const due = await db.select().from(workerSchedules).where(eq(workerSchedules.enabled, true));
  for (const s of due) {
    if (s.timezone !== SCHEDULE_TZ) continue;
    const at = latestDue(s.cron, now, s.lastDueAt ?? s.createdAt);
    if (!at) continue;
    const [skill] = await db.select().from(workerSkills).where(eq(workerSkills.name, s.skill));
    const system = skill ? buildSystem(skill.body) : null;
    if (!skill || !system) continue; // try again on a later claim
    await db
      .insert(workerJobs)
      .values({
        kind: s.kind,
        tier: s.tier,
        skill: skill.name,
        skillVersion: skill.version,
        system,
        prompt: s.prompt,
        maxTokens: s.maxTokens,
        allowSmallFallback: s.allowSmallFallback,
        scheduleId: s.id,
        scheduledFor: at,
        runAfter: at,
      })
      .onConflictDoNothing();
    await db
      .update(workerSchedules)
      .set({ lastDueAt: at })
      .where(and(eq(workerSchedules.id, s.id), or(isNull(workerSchedules.lastDueAt), lt(workerSchedules.lastDueAt, at))));
  }
}

/** A running job whose lease ran out starts a new attempt (at most 3), or ends. */
export async function expireLeases(db: Db, now: Date) {
  const stale = await db
    .select()
    .from(workerJobs)
    .where(and(eq(workerJobs.status, "running"), lt(workerJobs.leaseExpiresAt, now)))
    .limit(20);
  for (const j of stale) {
    const next = j.cancelRequested ? "cancelled" : j.attempt >= MAX_ATTEMPTS ? "failed" : "queued";
    const moved = await db
      .update(workerJobs)
      .set({
        status: next,
        attempt: next === "queued" ? j.attempt + 1 : j.attempt,
        claimedBy: null,
        leaseExpiresAt: null,
        updatedAt: now,
      })
      .where(and(eq(workerJobs.id, j.id), eq(workerJobs.attempt, j.attempt), eq(workerJobs.status, "running"), lt(workerJobs.leaseExpiresAt, now)))
      .returning({ id: workerJobs.id });
    if (moved.length === 0) continue;
    await endAttempt(db, j.id, j.attempt, "expired", "lease expired", now);
    await coreNote(db, j.id, j.attempt, `Lease expired; ${next === "queued" ? `retrying as attempt ${j.attempt + 1}` : next}`, now);
  }
}

// ---- shared pieces --------------------------------------------------------

async function endAttempt(db: Db, jobId: string, attempt: number, status: "done" | "failed" | "escalated" | "expired" | "cancelled", reason: string | null, now: Date) {
  await db
    .update(workerJobAttempts)
    .set({ status, reason, endedAt: now })
    .where(and(eq(workerJobAttempts.jobId, jobId), eq(workerJobAttempts.attempt, attempt), eq(workerJobAttempts.status, "running")));
}

/** A note written by the core (not a worker) onto an attempt's event stream. */
async function coreNote(db: Db, jobId: string, attempt: number, note: string, now: Date) {
  const [m] = await db
    .select({ n: sql<number>`coalesce(max(${workerJobEvents.seq}), 0)::int` })
    .from(workerJobEvents)
    .where(and(eq(workerJobEvents.jobId, jobId), eq(workerJobEvents.attempt, attempt)));
  await db
    .insert(workerJobEvents)
    .values({ jobId, attempt, seq: (m?.n ?? 0) + 1, source: "core", payload: [{ type: "progress", note: note.slice(0, MAX_NOTE_CHARS) }], createdAt: now })
    .onConflictDoNothing();
}

type Job = typeof workerJobs.$inferSelect;
/** The job and attempt checks every job endpoint shares: 404, 409 (stale attempt), 403 (another worker). */
async function jobFor(db: Db, w: WorkerRow, id: string, attempt: number): Promise<Job | Early> {
  if (!UUID.test(id)) return fail(404, "No such job");
  const [job] = await db.select().from(workerJobs).where(eq(workerJobs.id, id)).limit(1);
  if (!job) return fail(404, "No such job");
  if (job.attempt !== attempt) return fail(409, "Stale attempt");
  if (job.claimedBy !== w.id) {
    // A finished attempt that was this worker's stays answerable (idempotent retries).
    const [a] = await db
      .select()
      .from(workerJobAttempts)
      .where(and(eq(workerJobAttempts.jobId, id), eq(workerJobAttempts.attempt, attempt)));
    if (!a || a.workerId !== w.id) return fail(403, "Not your job");
  }
  return job;
}

// ---- events ---------------------------------------------------------------

function eventList(v: unknown): WorkerEvent[] | null {
  if (!Array.isArray(v) || v.length > MAX_EVENTS_PER_CALL) return null;
  const out: WorkerEvent[] = [];
  for (const e of v) {
    if (!isObj(e)) return null;
    if (e.type === "progress" && onlyKeys(e, ["type", "note"]) && isStr(e.note, MAX_NOTE_CHARS)) out.push({ type: "progress", note: e.note });
    else if (e.type === "text" && onlyKeys(e, ["type", "text"]) && isStr(e.text, MAX_TEXT_EVENT_CHARS)) out.push({ type: "text", text: e.text });
    else return null;
  }
  return out;
}

export async function handleEvents(req: Request, id: string, db: Db, now = new Date()): Promise<Response> {
  const w = await enter(req, db, now);
  if (w instanceof Response) return w;
  const body = await readJson(req);
  if (body instanceof Response) return body;
  if (!onlyKeys(body, ["attempt", "seq", "events", "stats"]) || !isInt(body.attempt, 1) || !isInt(body.seq, 1)) return bad();
  const events = eventList(body.events);
  const stats = statsOf(body.stats, ["outputTokens", "seconds"]);
  if (!events || stats === null) return bad();

  const job = await jobFor(db, w, id, body.attempt);
  if (job instanceof Response) return job;
  if (job.status !== "running") return fail(409, "Job is not running");
  const [att] = await db
    .select()
    .from(workerJobAttempts)
    .where(and(eq(workerJobAttempts.jobId, job.id), eq(workerJobAttempts.attempt, body.attempt)));
  if (!att) return fail(409, "Stale attempt");

  const ok = () => reply({ ok: true, cancel: job.cancelRequested, leaseSeconds: LEASE_SECONDS });
  if (body.seq <= att.lastSeq) return ok(); // already have it: a retry
  if (body.seq > att.lastSeq + 1) return fail(409, "Sequence gap");

  const gate = await db
    .update(workerJobAttempts)
    .set({ lastEventAt: now })
    .where(
      and(
        eq(workerJobAttempts.id, att.id),
        or(isNull(workerJobAttempts.lastEventAt), lt(workerJobAttempts.lastEventAt, new Date(now.getTime() - EVENTS_MIN_GAP_MS))),
      ),
    )
    .returning({ id: workerJobAttempts.id });
  if (gate.length === 0) return fail(429, "Too fast");

  await db
    .insert(workerJobEvents)
    .values({ jobId: job.id, attempt: body.attempt, seq: body.seq, source: "worker", payload: events, stats: stats ?? null, createdAt: now })
    .onConflictDoNothing();
  await db
    .update(workerJobAttempts)
    .set({ lastSeq: body.seq })
    .where(and(eq(workerJobAttempts.id, att.id), eq(workerJobAttempts.lastSeq, body.seq - 1)));
  const [fresh] = await db
    .update(workerJobs)
    .set({ leaseExpiresAt: secs(now, LEASE_SECONDS), updatedAt: now })
    .where(and(eq(workerJobs.id, job.id), eq(workerJobs.attempt, body.attempt), eq(workerJobs.status, "running")))
    .returning({ cancel: workerJobs.cancelRequested });
  if (!fresh) return fail(409, "Stale attempt");
  return reply({ ok: true, cancel: fresh.cancel, leaseSeconds: LEASE_SECONDS });
}

// ---- complete -------------------------------------------------------------

export async function handleComplete(req: Request, id: string, db: Db, now = new Date()): Promise<Response> {
  const w = await enter(req, db, now);
  if (w instanceof Response) return w;
  const body = await readJson(req);
  if (body instanceof Response) return body;
  if (!onlyKeys(body, ["attempt", "seq", "text", "model", "stats"]) || !isInt(body.attempt, 1) || !isInt(body.seq, 1)) return bad();
  const stats = statsOf(body.stats, ["promptTokens", "outputTokens", "seconds"]);
  if (!isStr(body.text, MAX_FINAL_CHARS) || !isStr(body.model, 200, 1) || stats === null) return bad();

  const job = await jobFor(db, w, id, body.attempt);
  if (job instanceof Response) return job;
  if (job.status === "done") return reply({ ok: true }); // completing twice changes nothing
  if (job.status !== "running") return fail(409, "Job is not running");
  const [att] = await db
    .select()
    .from(workerJobAttempts)
    .where(and(eq(workerJobAttempts.jobId, job.id), eq(workerJobAttempts.attempt, body.attempt)));
  if (att && body.seq > att.lastSeq + 1) return fail(409, "Sequence gap");

  const done = await db
    .update(workerJobs)
    .set({ status: "done", result: body.text, model: body.model, leaseExpiresAt: null, updatedAt: now })
    .where(and(eq(workerJobs.id, job.id), eq(workerJobs.attempt, body.attempt), eq(workerJobs.status, "running"), eq(workerJobs.claimedBy, w.id)))
    .returning({ id: workerJobs.id });
  if (done.length === 0) {
    const [again] = await db.select({ s: workerJobs.status, a: workerJobs.attempt }).from(workerJobs).where(eq(workerJobs.id, job.id));
    return again?.s === "done" && again.a === body.attempt ? reply({ ok: true }) : fail(409, "Stale attempt");
  }
  await db
    .insert(workerJobEvents)
    .values({ jobId: job.id, attempt: body.attempt, seq: body.seq, source: "core", payload: [{ type: "progress", note: "Finished" }], stats: stats ?? null, createdAt: now })
    .onConflictDoNothing();
  await endAttempt(db, job.id, body.attempt, "done", null, now);
  return reply({ ok: true });
}

// ---- fail -----------------------------------------------------------------

export async function handleFail(req: Request, id: string, db: Db, now = new Date()): Promise<Response> {
  const w = await enter(req, db, now);
  if (w instanceof Response) return w;
  const body = await readJson(req);
  if (body instanceof Response) return body;
  if (!onlyKeys(body, ["attempt", "reason", "message"]) || !isInt(body.attempt, 1) || !oneOf(body.reason, FAIL_REASONS)) return bad();
  if (body.message !== undefined && !isStr(body.message, MAX_NOTE_CHARS)) return bad();

  const job = await jobFor(db, w, id, body.attempt);
  if (job instanceof Response) return job;
  if (job.status !== "running") return reply({ requeue: job.status === "queued" }); // already settled: retry-safe

  const cancelled = body.reason === "cancelled" || job.cancelRequested;
  const next = cancelled ? "cancelled" : job.attempt >= MAX_ATTEMPTS ? "failed" : "queued";
  const moved = await db
    .update(workerJobs)
    .set({
      status: next,
      attempt: next === "queued" ? job.attempt + 1 : job.attempt,
      claimedBy: null,
      leaseExpiresAt: null,
      updatedAt: now,
    })
    .where(and(eq(workerJobs.id, job.id), eq(workerJobs.attempt, body.attempt), eq(workerJobs.status, "running"), eq(workerJobs.claimedBy, w.id)))
    .returning({ id: workerJobs.id });
  if (moved.length === 0) return fail(409, "Stale attempt");
  await endAttempt(db, job.id, body.attempt, cancelled ? "cancelled" : "failed", body.reason, now);
  await coreNote(db, job.id, body.attempt, `Attempt ${body.attempt} ${cancelled ? "cancelled" : "failed"} (${body.reason})${body.message ? `: ${body.message}` : ""}`, now);
  return reply({ requeue: next === "queued" });
}

// ---- escalate -------------------------------------------------------------

export async function handleEscalate(req: Request, id: string, db: Db, now = new Date()): Promise<Response> {
  const w = await enter(req, db, now);
  if (w instanceof Response) return w;
  const body = await readJson(req);
  if (body instanceof Response) return body;
  if (!onlyKeys(body, ["attempt", "reason"]) || !isInt(body.attempt, 1) || !oneOf(body.reason, ESCALATE_REASONS)) return bad();

  const job = await jobFor(db, w, id, body.attempt);
  if (job instanceof Response) return job;
  if (job.status !== "running") return reply({ ok: true }); // already moved on: retry-safe

  const next = job.cancelRequested ? "cancelled" : job.attempt >= MAX_ATTEMPTS ? "failed" : "queued";
  const moved = await db
    .update(workerJobs)
    .set({
      tier: "big",
      allowSmallFallback: false, // a small worker must not take it back
      status: next,
      attempt: next === "queued" ? job.attempt + 1 : job.attempt,
      claimedBy: null,
      leaseExpiresAt: null,
      updatedAt: now,
    })
    .where(and(eq(workerJobs.id, job.id), eq(workerJobs.attempt, body.attempt), eq(workerJobs.status, "running"), eq(workerJobs.claimedBy, w.id)))
    .returning({ id: workerJobs.id });
  if (moved.length === 0) return fail(409, "Stale attempt");
  await endAttempt(db, job.id, body.attempt, "escalated", body.reason, now);
  await coreNote(db, job.id, body.attempt, `Handed to a bigger worker (${body.reason})`, now);
  return reply({ ok: true });
}
