import { sql } from "drizzle-orm";
import {
  check,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Anything public moves draft -> approved -> published. Nothing skips a step
// (enforced by a trigger in the 0001 migration).
export const publishStatus = pgEnum("publish_status", ["draft", "approved", "published"]);
export const userRole = pgEnum("user_role", ["owner", "member"]);
export const contentType = pgEnum("content_type", ["guide", "insight", "page_copy"]);
export const revisionAuthor = pgEnum("revision_author", ["owner", "agent"]);
export const taskKind = pgEnum("task_kind", ["daily", "main_quest", "side_quest"]);
export const taskStatus = pgEnum("task_status", ["open", "done"]);
export const approvalStatus = pgEnum("approval_status", ["pending", "approved", "rejected"]);

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  role: userRole("role").notNull().default("owner"),
  createdAt: createdAt(),
});

// The agent's standing knowledge. brand_root is the identity root; each brand
// voice note names it as parent via parent_key.
export const memoryNotes = pgTable(
  "memory_notes",
  {
    id: id(),
    scope: text("scope").notNull(),
    key: text("key").notNull(),
    body: text("body").notNull(),
    parentKey: text("parent_key"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("memory_notes_scope_key").on(t.scope, t.key)],
);

export const projects = pgTable("projects", {
  id: id(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  brandVoiceId: uuid("brand_voice_id").references(() => memoryNotes.id),
  createdAt: createdAt(),
});

export const contentItems = pgTable(
  "content_items",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => projects.id),
    type: contentType("type").notNull(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    summary: text("summary"),
    body: text("body").notNull().default(""),
    seo: jsonb("seo").$type<Record<string, string>>(),
    status: publishStatus("status").notNull().default("draft"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("content_items_project_type_slug").on(t.projectId, t.type, t.slug)],
);

export const contentRevisions = pgTable("content_revisions", {
  id: id(),
  contentItemId: uuid("content_item_id").notNull().references(() => contentItems.id),
  title: text("title").notNull(),
  body: text("body").notNull(),
  author: revisionAuthor("author").notNull(),
  createdAt: createdAt(),
});

export const posts = pgTable("posts", {
  id: id(),
  contentItemId: uuid("content_item_id").references(() => contentItems.id),
  channel: text("channel").notNull(),
  caption: text("caption").notNull().default(""),
  imageRef: text("image_ref"),
  status: publishStatus("status").notNull().default("draft"),
  scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// Site enquiries. Personal information under POPIA: keep only what the form collects.
export const leads = pgTable("leads", {
  id: id(),
  projectId: uuid("project_id").notNull().references(() => projects.id),
  name: text("name").notNull(),
  contact: text("contact").notNull(),
  source: text("source"),
  status: text("status").notNull().default("new"),
  createdAt: createdAt(),
});

export const tasks = pgTable("tasks", {
  id: id(),
  projectId: uuid("project_id").notNull().references(() => projects.id),
  title: text("title").notNull(),
  kind: taskKind("kind").notNull(),
  xpValue: integer("xp_value").notNull().default(0),
  status: taskStatus("status").notNull().default("open"),
  due: timestamp("due", { withTimezone: true }),
  createdAt: createdAt(),
});

// The XP ledger. One row per award, never edited (trigger in the 0001 migration).
// A closed case is a count and a date here. Nothing that identifies a client.
export const xpEvents = pgTable(
  "xp_events",
  {
    id: id(),
    taskId: uuid("task_id").references(() => tasks.id),
    source: text("source"),
    amount: integer("amount").notNull(),
    reason: text("reason").notNull(),
    createdAt: createdAt(),
  },
  (t) => [check("xp_events_task_or_source", sql`${t.taskId} is not null or ${t.source} is not null`)],
);

export const documents = pgTable("documents", {
  id: id(),
  projectId: uuid("project_id").notNull().references(() => projects.id),
  title: text("title").notNull(),
  storagePath: text("storage_path").notNull(),
  tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
  createdAt: createdAt(),
});

export const approvals = pgTable("approvals", {
  id: id(),
  action: text("action").notNull(),
  payload: jsonb("payload").notNull(),
  status: approvalStatus("status").notNull().default("pending"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const agentRuns = pgTable("agent_runs", {
  id: id(),
  face: text("face").notNull(),
  request: text("request").notNull(),
  toolsCalled: jsonb("tools_called").notNull().default(sql`'[]'::jsonb`),
  tier: integer("tier").notNull().default(0),
  outcome: text("outcome"),
  createdAt: createdAt(),
});

// Every table, in the order the architecture document lists them.
export const allTables = {
  users,
  projects,
  content_items: contentItems,
  content_revisions: contentRevisions,
  posts,
  leads,
  tasks,
  xp_events: xpEvents,
  documents,
  memory_notes: memoryNotes,
  approvals,
  agent_runs: agentRuns,
} as const;
