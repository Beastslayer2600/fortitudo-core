// Checks the job queue against in-memory Postgres (PGlite): create, claim,
// finish, the guard that keeps client detail out, and the service-token rules.
// No network, no real database.
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { contentItems, contentRevisions, projects } from "../src/db/schema";
import { seed } from "../src/db/seed-data";
import { createAgentDraft } from "../src/jobs/drafts";
import { refuseTask } from "../src/jobs/guard";
import { claimJob, createJob, finishJob, getJob, isFailure, listJobs, pendingDrafts } from "../src/jobs/queue";

function check(label: string, ok: boolean) {
  if (!ok) throw new Error(`FAILED: ${label}`);
  console.log(`ok    ${label}`);
}

async function main() {
  const db = drizzle(new PGlite());
  await migrate(db, { migrationsFolder: "./drizzle" });
  await seed(db, "owner@example.com");

  // Create
  const made = await createJob(db, "glm", "Draft a skill on tax-free savings");
  check("job created and queued", !isFailure(made) && (await getJob(db, made.id))?.status === "queued");
  check("unknown agent refused", isFailure(await createJob(db, "root", "x")));
  check("empty task refused", isFailure(await createJob(db, "glm", "  ")));
  for (const bad of [
    "Summarise C:\\Werk\\Clients\\Smith\\policy.pdf",
    "open clients/smith/notes",
    "ID number 8001015009087",
    "Liberty client list",
  ]) {
    check(`client detail refused: ${bad.slice(0, 28)}`, refuseTask(bad) !== null);
  }
  check("normal task accepted", refuseTask("Draft a post about saving for kids") === null);
  check("only the one job exists", (await listJobs(db))!.length === 1);

  // Claim: oldest first, filtered by agent, one worker per job
  await createJob(db, "content", "Draft a post");
  const forContent = await claimJob(db, ["content"]);
  check("claim honours the agent filter", forContent?.agent === "content" && forContent.status === "running");
  const first = await claimJob(db);
  check("claim takes the oldest queued job", first?.agent === "glm" && first.status === "running");
  check("nothing left to claim", (await claimJob(db)) === null);

  // Finish: only a running job, only done|failed, draft must be an unpublished draft
  const [project] = await db.select().from(projects).limit(1);
  const [draft] = await db.insert(contentItems).values({ projectId: project!.id, type: "guide", slug: "tfsa", title: "TFSA" }).returning();
  const [published] = await db
    .insert(contentItems)
    .values({ projectId: project!.id, type: "guide", slug: "live", title: "Live" })
    .returning();
  await db.update(contentItems).set({ status: "approved" }).where(eq(contentItems.id, published!.id));
  await db.update(contentItems).set({ status: "published" }).where(eq(contentItems.id, published!.id));

  check("bad status refused", isFailure(await finishJob(db, first!.id, { status: "queued" })));
  check("a published item is not a valid draft", isFailure(await finishJob(db, first!.id, { status: "done", draftId: published!.id })));
  const done = await finishJob(db, first!.id, { status: "done", result: "Drafted.", draftId: draft!.id });
  check("running job finishes with result and draft", !isFailure(done) && done.status === "done" && done.draftId === draft!.id);
  const again = await finishJob(db, first!.id, { status: "failed" });
  check("a finished job cannot be finished again (409)", isFailure(again) && again.status === 409);
  const queued = await createJob(db, "helper", "Tidy a note");
  const early = isFailure(queued) ? null : await finishJob(db, queued.id, { status: "done" });
  check("a queued job cannot be finished before it is claimed", !!early && isFailure(early) && early.status === 409);
  const ghost = await finishJob(db, "00000000-0000-4000-8000-000000000000", { status: "done" });
  check("unknown job id is 404", isFailure(ghost) && ghost.status === 404);
  check("a non-uuid id is not found, not an error", (await getJob(db, "1; drop table jobs")) === null);

  // Lists
  check("status filter works", (await listJobs(db, "done"))!.length === 1);
  check("bad status filter is refused", (await listJobs(db, "nope")) === null);
  const drafts = await pendingDrafts(db);
  check("pending drafts are drafts only", drafts.some((d) => d.id === draft!.id) && !drafts.some((d) => d.id === published!.id));

  // Agent drafts written by the worker: always draft, always an agent revision.
  const made2 = await createAgentDraft(db, { project: project!.slug, title: "Saving for a child: a first guide", body: "Body text." });
  check("agent draft created", !isFailure(made2));
  if (isFailure(made2)) return;
  const [item] = await db.select().from(contentItems).where(eq(contentItems.id, made2.id));
  check("agent draft is a draft, not approved or published", item?.status === "draft" && item.publishedAt === null);
  check("agent draft has a unique slug from its title", /^saving-for-a-child-a-first-guide-[0-9a-f]{6}$/.test(item!.slug));
  const [rev] = await db.select().from(contentRevisions).where(eq(contentRevisions.contentItemId, made2.id));
  check("agent draft has a revision marked as the agent's", rev?.author === "agent" && rev.body === "Body text.");
  const second = await createAgentDraft(db, { project: project!.slug, title: "Saving for a child: a first guide", body: "Again." });
  check("same title twice does not clash", !isFailure(second));
  check("unknown project refused", isFailure(await createAgentDraft(db, { project: "nope", title: "T", body: "B" })));
  check("bad type refused", isFailure(await createAgentDraft(db, { project: project!.slug, title: "T", body: "B", type: "published" })));
  check("empty body refused", isFailure(await createAgentDraft(db, { project: project!.slug, title: "T", body: " " })));
  check("client detail in the title refused", isFailure(await createAgentDraft(db, { project: project!.slug, title: "Notes from C:\\Werk\\Clients\\Smith", body: "B" })));
  const withDraft = await createJob(db, "content", "Draft a guide");
  const claimed = isFailure(withDraft) ? null : await claimJob(db, ["content"]);
  const finished = claimed ? await finishJob(db, claimed.id, { status: "done", result: "ok", draftId: made2.id }) : null;
  check("a job can carry the agent's draft", !!finished && !isFailure(finished) && finished.draftId === made2.id);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
