import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { contentItems, contentRevisions, contentType, projects } from "@/db/schema";
import { clientDetail, MAX_RESULT_CHARS } from "./guard";
import type { Failure } from "./queue";

// How the worker hands back what an agent wrote: always a content item in the
// DRAFT state, with a revision marked as written by the agent. Nothing here
// approves or publishes; only the owner does that.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = PgDatabase<any, any, any>;

const TYPES = contentType.enumValues as readonly string[];
const MAX_TITLE = 200;

function slugify(title: string): string {
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80).replace(/-+$/g, "");
  return `${base || "draft"}-${randomBytes(3).toString("hex")}`; // suffix keeps the slug unique
}

export async function createAgentDraft(
  db: Db,
  input: { project?: unknown; title?: unknown; body?: unknown; type?: unknown },
): Promise<{ id: string } | Failure> {
  if (typeof input.project !== "string" || !input.project) return { error: "project must be a project slug.", status: 400 };
  if (typeof input.title !== "string" || !input.title.trim()) return { error: "title must be text.", status: 400 };
  if (input.title.length > MAX_TITLE) return { error: `Keep the title under ${MAX_TITLE} characters.`, status: 400 };
  if (typeof input.body !== "string" || !input.body.trim()) return { error: "body must be text.", status: 400 };
  if (input.body.length > MAX_RESULT_CHARS) return { error: `Keep the body under ${MAX_RESULT_CHARS} characters.`, status: 400 };
  const type = input.type === undefined ? "guide" : input.type;
  if (typeof type !== "string" || !TYPES.includes(type)) return { error: `type must be one of ${TYPES.join(", ")}.`, status: 400 };

  const what = clientDetail(input.title);
  if (what) return { error: `The title looks like it contains ${what}. Client detail never goes into a draft.`, status: 400 };

  const [project] = await db.select({ id: projects.id }).from(projects).where(eq(projects.slug, input.project)).limit(1);
  if (!project) return { error: `unknown project "${input.project}".`, status: 400 };

  const title = input.title.trim();
  const [item] = await db
    .insert(contentItems)
    .values({ projectId: project.id, type: type as (typeof contentType.enumValues)[number], slug: slugify(title), title, body: input.body, status: "draft" })
    .returning({ id: contentItems.id });
  await db.insert(contentRevisions).values({ contentItemId: item!.id, title, body: input.body, author: "agent" });
  return { id: item!.id };
}
