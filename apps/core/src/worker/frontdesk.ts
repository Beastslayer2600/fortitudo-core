import { desc, eq } from "drizzle-orm";
import { workerJobs } from "@/db/worker-schema";
import { isJobAgent, JOB_AGENTS, refuseTask, type JobAgent } from "@/jobs/guard";
import type { Db } from "./auth";
import type { Kind, Tier } from "./limits";
import { createJob, isFailure, type Failure } from "./service";

// The front desk hands work to the worker queue (the one the PC and laptop
// workers claim from). It speaks in agents and plain tasks; this maps them
// onto a kind, a skill and a tier. The task goes in as the prompt, unchanged.

type Route = { kind: Kind; skill: string; tier: Tier; allowSmallFallback: boolean };

export const AGENT_ROUTES: Record<JobAgent, Route> = {
  // Heavy drafting or analysis: a big worker, but a small one may take it if no big one is free.
  glm: { kind: "research_brief", skill: "general-draft", tier: "big", allowSmallFallback: true },
  // Public content drafts.
  content: { kind: "social_post", skill: "gert-social-post", tier: "small", allowSmallFallback: false },
  // Small chores.
  helper: { kind: "research_brief", skill: "general-draft", tier: "small", allowSmallFallback: false },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type FrontdeskStatus = "queued" | "running" | "done" | "failed";
export type FrontdeskJob = {
  id: string;
  agent: JobAgent;
  task: string;
  status: FrontdeskStatus;
  result: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Creates a worker job from a front-desk hand-off. Same client-detail guard as the old queue. */
export async function createFrontdeskJob(db: Db, agent: unknown, task: unknown, now = new Date()): Promise<{ id: string } | (Failure & { status: number })> {
  if (!isJobAgent(agent)) return { error: `agent must be one of ${JOB_AGENTS.join(", ")}.`, status: 400 };
  if (typeof task !== "string") return { error: "Send a task.", status: 400 };
  const refused = refuseTask(task);
  if (refused) return { error: refused, status: 422 };
  const r = AGENT_ROUTES[agent];
  const made = await createJob(db, { ...r, prompt: task }, now);
  if (isFailure(made)) return { error: made.error, status: 422 };
  return made;
}

function agentOf(kind: string, skill: string, tier: string): JobAgent {
  for (const a of JOB_AGENTS) {
    const r = AGENT_ROUTES[a];
    if (r.kind === kind && r.skill === skill && r.tier === tier) return a;
  }
  return kind === "social_post" ? "content" : tier === "big" ? "glm" : "helper";
}

type Row = typeof workerJobs.$inferSelect;
function view(j: Row): FrontdeskJob {
  return {
    id: j.id,
    agent: agentOf(j.kind, j.skill, j.tier),
    task: j.prompt,
    // A cancelled job will never finish, so the front desk sees it as failed.
    status: j.status === "cancelled" ? "failed" : j.status,
    result: j.result ?? null,
    createdAt: j.createdAt.toISOString(),
    updatedAt: j.updatedAt.toISOString(),
  };
}

/** The 50 most recent worker jobs, oldest first, in the front desk's shape. */
export async function listFrontdeskJobs(db: Db): Promise<FrontdeskJob[]> {
  const rows = await db.select().from(workerJobs).orderBy(desc(workerJobs.createdAt)).limit(50);
  return rows.reverse().map(view);
}

export async function getFrontdeskJob(db: Db, id: string): Promise<FrontdeskJob | null> {
  if (!UUID.test(id)) return null;
  const [row] = await db.select().from(workerJobs).where(eq(workerJobs.id, id));
  return row ? view(row) : null;
}
