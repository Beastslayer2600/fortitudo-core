import type Anthropic from "@anthropic-ai/sdk";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { contentItems, contentRevisions, contentType, projects } from "@/db/schema";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = PgDatabase<any, any, any>;

/**
 * Permission tiers from the architecture document. The gateway checks the tier
 * in code before any tool runs; the model cannot talk its way past it.
 *   0 Read          always allowed
 *   1 Do and log    runs at once, written to agent_runs
 *   2 You publish   the agent only drafts; the owner presses publish
 *   3 Pull request  opens a PR the owner reviews
 * "Never" (client data, DNS, money, deleting) has no tool at all.
 */
export type Tier = 0 | 1 | 2 | 3;

export type ToolContext = { db: Db };

export type AgentTool = {
  name: string;
  tier: Tier;
  definition: Anthropic.Tool;
  run: (ctx: ToolContext, input: Record<string, unknown>) => Promise<unknown>;
};

/** A tool error the model should see and can recover from. */
export class ToolInputError extends Error {}

const TYPES = contentType.enumValues;

function str(input: Record<string, unknown>, key: string, opts: { required?: boolean; max?: number } = {}) {
  const v = input[key];
  if (v === undefined || v === null || v === "") {
    if (opts.required) throw new ToolInputError(`"${key}" is required`);
    return undefined;
  }
  if (typeof v !== "string") throw new ToolInputError(`"${key}" must be a string`);
  if (opts.max && v.length > opts.max) throw new ToolInputError(`"${key}" is longer than ${opts.max} characters`);
  return v;
}

function oneOf<T extends string>(value: string | undefined, allowed: readonly T[], key: string) {
  if (value === undefined) return undefined;
  if (!allowed.includes(value as T)) throw new ToolInputError(`"${key}" must be one of: ${allowed.join(", ")}`);
  return value as T;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

async function projectBySlug(db: Db, slug: string) {
  const [p] = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
  if (!p) {
    const all = await db.select({ slug: projects.slug }).from(projects);
    throw new ToolInputError(`unknown project "${slug}". Projects: ${all.map((r) => r.slug).join(", ")}`);
  }
  return p;
}

const readContent: AgentTool = {
  name: "read_content",
  tier: 0,
  definition: {
    name: "read_content",
    description:
      "Read Fortitudo content: guides, insights and page copy. With no id, lists items (newest first), " +
      "optionally filtered by project, type and status. With an id, returns that item in full with its revision history. " +
      "This is the only data the agent can read. There is no client data here and no tool for it.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Content item id, to read one item in full." },
        project: { type: "string", description: "Project slug, e.g. advising, web-design, craft-studio, adjudication, personal-brand." },
        type: { type: "string", enum: [...TYPES] },
        status: { type: "string", enum: ["draft", "approved", "published"] },
      },
      additionalProperties: false,
    },
  },
  async run({ db }, input) {
    const id = str(input, "id");
    if (id) {
      if (!UUID.test(id)) throw new ToolInputError(`"id" is not a valid id`);
      const [row] = await db
        .select({ item: contentItems, project: projects.slug })
        .from(contentItems)
        .innerJoin(projects, eq(projects.id, contentItems.projectId))
        .where(eq(contentItems.id, id))
        .limit(1);
      if (!row) throw new ToolInputError(`no content item with id ${id}`);
      const revisions = await db
        .select({ title: contentRevisions.title, author: contentRevisions.author, createdAt: contentRevisions.createdAt })
        .from(contentRevisions)
        .where(eq(contentRevisions.contentItemId, id))
        .orderBy(desc(contentRevisions.createdAt));
      return { ...row.item, project: row.project, revisions };
    }

    const filters = [];
    const project = str(input, "project");
    if (project) filters.push(eq(contentItems.projectId, (await projectBySlug(db, project)).id));
    const type = oneOf(str(input, "type"), TYPES, "type");
    if (type) filters.push(eq(contentItems.type, type));
    const status = oneOf(str(input, "status"), ["draft", "approved", "published"] as const, "status");
    if (status) filters.push(inArray(contentItems.status, [status]));

    const items = await db
      .select({
        id: contentItems.id,
        project: projects.slug,
        type: contentItems.type,
        slug: contentItems.slug,
        title: contentItems.title,
        status: contentItems.status,
        updatedAt: contentItems.updatedAt,
      })
      .from(contentItems)
      .innerJoin(projects, eq(projects.id, contentItems.projectId))
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(contentItems.updatedAt))
      .limit(50);
    return { count: items.length, items };
  },
};

const saveDraft: AgentTool = {
  name: "save_draft",
  tier: 1,
  definition: {
    name: "save_draft",
    description:
      "Save a draft of a guide, insight or page copy. Without an id it creates a new draft; with an id it updates an " +
      "existing item that is still a draft. Every save is kept as a revision. This never publishes: only the owner " +
      "publishes, from the front door. Items that are approved or published cannot be changed by this tool.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Id of an existing draft to update. Leave out to create a new draft." },
        project: { type: "string", description: "Project slug. Required for a new draft." },
        type: { type: "string", enum: [...TYPES], description: "Required for a new draft." },
        slug: { type: "string", description: "URL slug in lowercase-with-hyphens. Required for a new draft." },
        title: { type: "string" },
        summary: { type: "string", description: "One or two sentences." },
        body: { type: "string", description: "The full text, in Markdown." },
      },
      required: ["title", "body"],
      additionalProperties: false,
    },
  },
  async run({ db }, input) {
    const title = str(input, "title", { required: true, max: 200 })!;
    const body = str(input, "body", { required: true, max: 100_000 })!;
    const summary = str(input, "summary", { max: 600 });
    const id = str(input, "id");

    if (id) {
      if (!UUID.test(id)) throw new ToolInputError(`"id" is not a valid id`);
      const [existing] = await db.select().from(contentItems).where(eq(contentItems.id, id)).limit(1);
      if (!existing) throw new ToolInputError(`no content item with id ${id}`);
      if (existing.status !== "draft") {
        throw new ToolInputError(`item ${id} is ${existing.status}; only drafts can be changed by the agent`);
      }
      // The status condition is repeated in the update so a publish between the
      // read and the write cannot be overwritten.
      const [updated] = await db
        .update(contentItems)
        .set({ title, body, summary: summary ?? existing.summary, updatedAt: new Date() })
        .where(and(eq(contentItems.id, id), eq(contentItems.status, "draft")))
        .returning({ id: contentItems.id });
      if (!updated) throw new ToolInputError(`item ${id} is no longer a draft`);
      await db.insert(contentRevisions).values({ contentItemId: id, title, body, author: "agent" });
      return { saved: "updated", id, status: "draft" };
    }

    const project = await projectBySlug(db, str(input, "project", { required: true })!);
    const type = oneOf(str(input, "type", { required: true }), TYPES, "type")!;
    const slug = str(input, "slug", { required: true, max: 120 })!;
    if (!SLUG.test(slug)) throw new ToolInputError(`"slug" must be lowercase words joined by hyphens`);

    const [clash] = await db
      .select({ id: contentItems.id, status: contentItems.status })
      .from(contentItems)
      .where(and(eq(contentItems.projectId, project.id), eq(contentItems.type, type), eq(contentItems.slug, slug)))
      .limit(1);
    if (clash) {
      throw new ToolInputError(
        `a ${type} with slug "${slug}" already exists in ${project.slug} (id ${clash.id}, ${clash.status}). ` +
          `Pass its id to update it if it is a draft, or choose another slug.`,
      );
    }

    const [created] = await db
      .insert(contentItems)
      .values({ projectId: project.id, type, slug, title, summary, body, status: "draft" })
      .returning({ id: contentItems.id });
    await db.insert(contentRevisions).values({ contentItemId: created.id, title, body, author: "agent" });
    return { saved: "created", id: created.id, status: "draft" };
  },
};

/** Every tool the gateway knows. This phase ships tiers 0 and 1 only; no publish tool exists. */
export const TOOLS: readonly AgentTool[] = [readContent, saveDraft];
