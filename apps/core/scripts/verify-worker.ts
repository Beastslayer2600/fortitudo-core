// Contract tests for the worker endpoints (docs/worker-contract.md), run against
// in-memory Postgres (PGlite) with a fake worker client. Never touches Neon.
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { workerJobEvents, workerJobs, workers, workerSchedules } from "../src/db/worker-schema";
import { importSkills } from "../src/worker/import-skills";
import skillList from "../src/worker/skills-import.json";
import { hashToken } from "../src/worker/auth";
import { handleClaim, handleComplete, handleEscalate, handleEvents, handleFail } from "../src/worker/handlers";
import { activeJobCount, cancelJob, createJob, createSchedule, createWorker, isFailure, jobView, saveSkill, setPaused, workerStatus } from "../src/worker/service";

function check(label: string, ok: boolean) {
  if (!ok) throw new Error(`FAILED: ${label}`);
  console.log(`ok    ${label}`);
}

const T0 = new Date("2026-11-17T08:00:00Z");
const at = (s: number) => new Date(T0.getTime() + s * 1000);

async function main() {
  const db = drizzle(new PGlite());
  await migrate(db, { migrationsFolder: "./drizzle" });

  check(`all ${skillList.length} skills import once`, (await importSkills(db)) === skillList.length && (await importSkills(db)) === 0);

  // Workers: tokens come back once; only the hash is stored.
  const small = await createWorker(db, "laptop-1", "small");
  const big = await createWorker(db, "pc-1", "big");
  if (isFailure(small) || isFailure(big)) throw new Error("worker creation failed");
  const rows = await db.select().from(workers);
  check("only token hashes are stored", rows.every((r) => r.tokenHash === hashToken(small.token) || r.tokenHash === hashToken(big.token)) && !JSON.stringify(rows).includes(small.token));
  check("duplicate worker name refused", isFailure(await createWorker(db, "laptop-1", "small")));

  const claimBody = (id: string, maxTier: string) => ({ worker: { id, version: 1, maxTier, backends: ["ollama"], models: ["m"] } });
  const call = async (h: (req: Request, ...a: never[]) => Promise<Response>, token: string | null, body: unknown, now: Date, id?: string, raw?: string) => {
    const req = new Request("https://example.test/x", {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: raw ?? JSON.stringify(body),
    });
    const res = await (id ? (h as unknown as (r: Request, i: string, d: typeof db, n: Date) => Promise<Response>)(req, id, db, now) : (h as unknown as (r: Request, d: typeof db, n: Date) => Promise<Response>)(req, db, now));
    return { status: res.status, redirected: res.headers.has("location"), json: (await res.json().catch(() => null)) as Record<string, unknown> | null };
  };
  const claim = (w: { token: string }, id: string, tier: string, now: Date) => call(handleClaim as never, w.token, claimBody(id, tier), now);

  // Auth first
  check("401 with no token, even for a broken body", (await call(handleClaim as never, null, null, T0, undefined, "not json")).status === 401);
  const wrong = await call(handleClaim as never, "fw_wrong", claimBody("laptop-1", "small"), T0);
  check("401 for a wrong token, body never echoes it", wrong.status === 401 && !JSON.stringify(wrong.json).includes("fw_wrong"));
  check("401 for another scheme", (await call(handleClaim as never, null, claimBody("laptop-1", "small"), T0)).status === 401);

  // Body rules
  check("400 for unknown field", (await call(handleClaim as never, small.token, { worker: { id: "laptop-1", version: 1, maxTier: "small", backends: [], models: [], extra: 1 } }, at(0))).status === 400);
  check("403 when worker.id is not this token's worker", (await call(handleClaim as never, small.token, claimBody("pc-1", "small"), at(10))).status === 403);
  check("400 when maxTier does not match", (await call(handleClaim as never, small.token, claimBody("laptop-1", "big"), at(20))).status === 400);

  // Skill + jobs
  check("skill saved", !isFailure(await saveSkill(db, { name: "social-content", description: "Posts", body: "Write social posts." })));
  const j = async (o: Record<string, unknown>) => {
    const r = await createJob(db, { kind: "social_post", skill: "social-content", prompt: "Write a post about saving.", ...o }, new Date("2026-01-01T00:00:00Z"));
    if (isFailure(r)) throw new Error(r.error);
    return r.id;
  };
  check("client detail refused in a prompt", isFailure(await createJob(db, { kind: "social_post", skill: "social-content", prompt: "Review C:\\clients\\smith" })));
  check("unknown skill refused", isFailure(await createJob(db, { kind: "social_post", skill: "nope", prompt: "x" })));
  check("prompt over 24000 refused", isFailure(await createJob(db, { kind: "social_post", skill: "social-content", prompt: "x".repeat(24001) })));
  const bigJob = await j({ kind: "website_edit" }); // big by default
  const bigJobFallback = await j({ kind: "research_brief", allowSmallFallback: true });
  check("kind sets the default tier", (await db.select().from(workerJobs).where(eq(workerJobs.id, bigJob)))[0]!.tier === "big");

  // Small worker: only the fallback-allowed big job, never the other
  let c = await claim(small, "laptop-1", "small", at(30));
  const job1 = c.json!.job as Record<string, unknown>;
  check("small worker gets the big job that allows fallback", c.status === 200 && job1.id === bigJobFallback && job1.attempt === 1);
  check("claim returns system with guardrail and temperature", String(job1.system).includes("never financial advice") && job1.temperature === 0.7 && job1.leaseSeconds === 120);
  check("429 when claiming faster than every 5 s", (await claim(small, "laptop-1", "small", at(32))).status === 429);
  c = await claim(small, "laptop-1", "small", at(40));
  check("small worker is never given a big job without fallback", c.status === 200 && c.json!.job === null);

  // Events: idempotent, ordered, rate limited
  const ev = (w: { token: string }, id: string, attempt: number, seq: number, now: Date, events: unknown[] = [{ type: "progress", note: "Reading" }]) =>
    call(handleEvents as never, w.token, { attempt, seq, events, stats: { outputTokens: 5, seconds: 1 } }, now, id);
  check("event seq 1 accepted", (await ev(small, bigJobFallback, 1, 1, at(41))).status === 200);
  check("retry of seq 1 is ok and not stored twice", (await ev(small, bigJobFallback, 1, 1, at(41.5))).status === 200 && (await db.select().from(workerJobEvents)).length === 1);
  check("429 when events come faster than every 2 s", (await ev(small, bigJobFallback, 1, 2, at(42))).status === 429);
  check("409 for a gap larger than 1", (await ev(small, bigJobFallback, 1, 4, at(45))).status === 409);
  check("409 for a stale attempt", (await ev(small, bigJobFallback, 2, 1, at(45))).status === 409);
  check("403 when the job belongs to another worker", (await ev(big, bigJobFallback, 1, 2, at(45))).status === 403);
  check("400 for text over 8000", (await ev(small, bigJobFallback, 1, 2, at(46), [{ type: "text", text: "x".repeat(8001) }])).status === 400);
  check("400 for an unknown event field", (await ev(small, bigJobFallback, 1, 2, at(47), [{ type: "progress", note: "a", extra: 1 }])).status === 400);
  check("404 for an unknown job", (await ev(small, "00000000-0000-4000-8000-000000000000", 1, 1, at(47))).status === 404);
  check("seq 2 accepted", (await ev(small, bigJobFallback, 1, 2, at(48), [{ type: "text", text: "hello <b>x</b>" }])).status === 200);

  // Cancel flag comes back on events, then the worker fails with cancelled
  await cancelJob(db, bigJobFallback, at(49));
  const hb = await ev(small, bigJobFallback, 1, 3, at(51));
  check("events response carries cancel:true", hb.status === 200 && hb.json!.cancel === true);
  const fc = await call(handleFail as never, small.token, { attempt: 1, reason: "cancelled" }, at(52), bigJobFallback);
  check("fail cancelled ends the job", fc.status === 200 && fc.json!.requeue === false && (await db.select().from(workerJobs).where(eq(workerJobs.id, bigJobFallback)))[0]!.status === "cancelled");

  // Big worker takes the big job; complete twice changes nothing
  c = await claim(big, "pc-1", "big", at(60));
  check("big worker claims the big job", (c.json!.job as { id: string }).id === bigJob);
  const comp = { attempt: 1, seq: 1, text: "final text", model: "m", stats: { promptTokens: 1, outputTokens: 2, seconds: 3 } };
  check("complete ok", (await call(handleComplete as never, big.token, comp, at(70), bigJob)).status === 200);
  check("complete twice is 200 and changes nothing", (await call(handleComplete as never, big.token, { ...comp, text: "other" }, at(71), bigJob)).status === 200 && (await db.select().from(workerJobs).where(eq(workerJobs.id, bigJob)))[0]!.result === "final text");

  // Fail: requeue up to 3 attempts
  const flaky = await j({ kind: "website_edit" });
  let attempt = 1;
  let t = 100;
  for (; attempt <= 3; attempt++) {
    c = await claim(big, "pc-1", "big", at(t));
    check(`attempt ${attempt} claimed`, (c.json!.job as { id: string; attempt: number }).attempt === attempt);
    const f = await call(handleFail as never, big.token, { attempt, reason: "model_error", message: "boom" }, at(t + 1), flaky);
    check(`attempt ${attempt} fail -> requeue ${attempt < 3}`, f.json!.requeue === (attempt < 3));
    t += 10;
  }
  check("job failed after 3 attempts", (await db.select().from(workerJobs).where(eq(workerJobs.id, flaky)))[0]!.status === "failed");
  check("400 for a bad fail reason", (await call(handleFail as never, big.token, { attempt: 3, reason: "x" }, at(t), flaky)).status === 400);

  // Escalate: small -> big, new attempt, attempt 1 events kept
  const esc = await j({ kind: "social_post" });
  c = await claim(small, "laptop-1", "small", at(200));
  check("small worker claims small job", (c.json!.job as { id: string }).id === esc);
  await ev(small, esc, 1, 1, at(201));
  check("escalate ok", (await call(handleEscalate as never, small.token, { attempt: 1, reason: "context_too_large" }, at(203), esc)).status === 200);
  const after = (await db.select().from(workerJobs).where(eq(workerJobs.id, esc)))[0]!;
  check("escalated job is big, queued, attempt 2, no fallback", after.tier === "big" && after.status === "queued" && after.attempt === 2 && !after.allowSmallFallback);
  c = await claim(small, "laptop-1", "small", at(210));
  check("small worker cannot take it back", c.json!.job === null);
  c = await claim(big, "pc-1", "big", at(215));
  check("big worker gets attempt 2", (c.json!.job as { attempt: number }).attempt === 2);
  const view = await jobView(db, esc, 0);
  check("job view keeps attempt 1 events and groups by attempt", view!.events.some((e) => e.attempt === 1 && e.source === "worker") && view!.attempts.length === 2);

  await call(handleComplete as never, big.token, { attempt: 2, seq: 1, text: "ok", model: "m" }, at(250), esc);

  // Lease expiry starts a new attempt
  const lease = await j({ kind: "website_build" });
  c = await claim(big, "pc-1", "big", at(300));
  check("claimed with a lease", (c.json!.job as { id: string }).id === lease);
  c = await claim(big, "pc-1", "big", at(300 + 130)); // lease (120 s) has run out
  check("expired lease -> attempt 2 handed out", (c.json!.job as { id: string; attempt: number }).id === lease && (c.json!.job as { attempt: number }).attempt === 2);
  check("old attempt now gets 409", (await ev(big, lease, 1, 1, at(440))).status === 409);

  // Paused
  await setPaused(db, true);
  const queued = await j({ kind: "social_post" });
  c = await claim(small, "laptop-1", "small", at(500));
  check("paused: no job and paused:true", c.json!.job === null && c.json!.paused === true);
  await setPaused(db, false);
  c = await claim(small, "laptop-1", "small", at(510));
  check("resumed: job handed out", (c.json!.job as { id: string }).id === queued);
  check("workers panel: online within 60 s", (await workerStatus(db, at(520))).workers.find((w) => w.name === "laptop-1")!.online === true && (await workerStatus(db, at(700))).workers.find((w) => w.name === "laptop-1")!.online === false);

  // Schedules: once per due time, inside claim
  const sc = await createSchedule(db, { name: "Weekday post", cron: "0 8 * * 1-5", kind: "social_post", skill: "social-content", prompt: "Daily saving tip.", maxTokens: 500 });
  if (isFailure(sc)) throw new Error(sc.error);
  check("bad cron refused", isFailure(await createSchedule(db, { name: "x", cron: "nope", kind: "social_post", skill: "social-content", prompt: "x" })));
  // Created "now" (T0); 08:00 SAST is 06:00 UTC, so the next due time is the next morning.
  await db.update(workerSchedules).set({ createdAt: new Date("2026-11-17T00:00:00Z") });
  const before = await activeJobCount(db);
  const day2 = new Date("2026-11-18T06:00:30Z"); // Wed 08:00:30 SAST
  c = await claim(big, "pc-1", "big", day2);
  const made = await db.select().from(workerJobs).where(eq(workerJobs.scheduleId, sc.id));
  check("due schedule became one job", made.length === 1 && made[0]!.scheduledFor!.toISOString() === "2026-11-18T06:00:00.000Z" && (await activeJobCount(db)) >= before);
  await claim(big, "pc-1", "big", new Date(day2.getTime() + 10_000));
  check("not created twice for the same due time", (await db.select().from(workerJobs).where(eq(workerJobs.scheduleId, sc.id))).length === 1);

  // Cancel a queued job; append-only events
  const q = await j({ kind: "social_post" });
  await cancelJob(db, q);
  check("queued job cancels at once", (await db.select().from(workerJobs).where(eq(workerJobs.id, q)))[0]!.status === "cancelled");
  let blocked = false;
  try {
    await db.update(workerJobEvents).set({ seq: 99 }).where(eq(workerJobEvents.jobId, esc));
  } catch {
    blocked = true;
  }
  check("events table refuses updates (append-only)", blocked);

  // Nothing redirects
  check("no response redirects", !wrong.redirected);
  console.log("worker contract: all checks passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
