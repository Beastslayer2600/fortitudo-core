// The front desk's hand-off onto the worker queue (src/worker/frontdesk.ts), run
// against in-memory Postgres (PGlite). Never touches Neon.
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { workerJobs } from "../src/db/worker-schema";
import { createFrontdeskJob, getFrontdeskJob, listFrontdeskJobs } from "../src/worker/frontdesk";
import { handleClaim } from "../src/worker/handlers";
import { importSkills } from "../src/worker/import-skills";
import { cancelJob, createWorker, isFailure } from "../src/worker/service";

function check(label: string, ok: boolean) {
  if (!ok) throw new Error(`FAILED: ${label}`);
  console.log(`ok    ${label}`);
}

async function main() {
  const db = drizzle(new PGlite());
  await migrate(db, { migrationsFolder: "./drizzle" });
  await importSkills(db);

  // Every agent maps onto a real skill and kind.
  const ids: Record<string, string> = {};
  for (const agent of ["glm", "content", "helper"]) {
    const made = await createFrontdeskJob(db, agent, `Draft three ideas for a post about saving (${agent}).`);
    check(`${agent} hand-off creates a worker job`, !("error" in made));
    if (!("error" in made)) ids[agent] = made.id;
  }
  const [glm] = await db.select().from(workerJobs).where(eq(workerJobs.id, ids.glm!));
  check("glm goes to a big worker, small fallback allowed", glm?.tier === "big" && glm.allowSmallFallback === true && glm.kind === "research_brief");
  const [content] = await db.select().from(workerJobs).where(eq(workerJobs.id, ids.content!));
  check("content becomes a small social_post with the gert-social-post skill", content?.tier === "small" && content.kind === "social_post" && content.skill === "gert-social-post");
  check("the task is stored unchanged as the prompt", content?.prompt === "Draft three ideas for a post about saving (content).");
  check("the skill text is assembled into the system prompt", !!content?.system && content.system.length > 100);

  // Refusals: same guard as the old queue.
  const refused = async (agent: unknown, task: unknown) => {
    const r = await createFrontdeskJob(db, agent, task);
    return "error" in r ? r.status : 0;
  };
  check("unknown agent is 400", (await refused("boss", "x")) === 400);
  check("missing task is 400", (await refused("helper", undefined)) === 400);
  check("empty task is 422", (await refused("helper", "   ")) === 422);
  check("file path is refused", (await refused("helper", "Summarise C:\\Werk\\notes.txt")) === 422);
  check("client folder is refused", (await refused("helper", "read clients/smith")) === 422);
  check("ID number is refused", (await refused("content", "client 9001015009087 needs a post")) === 422);
  check("task over 2000 characters is refused", (await refused("helper", "a".repeat(2001))) === 422);
  const count = (await db.select().from(workerJobs)).length;
  check("refused hand-offs leave nothing in the queue", count === 3);

  // The laptop worker (small) can claim what the front desk queued, including glm via fallback.
  const laptop = await createWorker(db, "laptop-1", "small");
  if (isFailure(laptop)) throw new Error("worker creation failed");
  const claimed: string[] = [];
  for (let i = 0; i < 4; i++) {
    const req = new Request("https://example.test/claim", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${laptop.token}` },
      body: JSON.stringify({ worker: { id: "laptop-1", version: 1, maxTier: "small", backends: ["ollama"], models: ["m"] } }),
    });
    const res = await handleClaim(req, db, new Date(Date.now() + i * 10_000));
    const json = (await res.json()) as { job?: { id: string } | null };
    if (json.job) claimed.push(json.job.id);
  }
  check("a small worker claims all three front-desk jobs", claimed.length === 3 && Object.values(ids).every((id) => claimed.includes(id)));

  // Status in the front desk's shape.
  const list = await listFrontdeskJobs(db);
  check("list returns the jobs, oldest first", list.length === 3 && list[0]!.id === ids.glm);
  check("agents are read back from the job", list.map((j) => j.agent).join() === "glm,content,helper");
  check("claimed jobs show as running", list.every((j) => j.status === "running"));
  const one = await getFrontdeskJob(db, ids.helper!);
  check("get returns one job with task and result fields", one?.task.startsWith("Draft three ideas") === true && one.result === null);
  check("bad id is null", (await getFrontdeskJob(db, "not-a-uuid")) === null);

  const extra = await createFrontdeskJob(db, "helper", "One more chore.");
  if ("error" in extra) throw new Error("extra job failed");
  await cancelJob(db, extra.id);
  check("a cancelled job shows as failed", (await getFrontdeskJob(db, extra.id))?.status === "failed");

  console.log("frontdesk queue checks passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
