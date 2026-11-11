// Applies the migrations and seed to an in-memory Postgres (PGlite) and checks
// the schema rules. No network, no real database.
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { allTables, contentItems, projects, xpEvents } from "../src/db/schema";
import { seed } from "../src/db/seed-data";

async function fails(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch {
    console.log(`ok    refused: ${label}`);
    return;
  }
  throw new Error(`NOT refused: ${label}`);
}

async function main() {
  const db = drizzle(new PGlite());
  await migrate(db, { migrationsFolder: "./drizzle" });
  await seed(db, "owner@example.com");
  await seed(db, "owner@example.com"); // second run must change nothing

  for (const [name, table] of Object.entries(allTables)) {
    console.log(`${name.padEnd(18)} ${await db.$count(table)}`);
  }

  const [advising] = await db.select().from(projects).where(eq(projects.slug, "advising"));
  const base = { projectId: advising.id, type: "guide" as const, title: "T" };

  await fails("content inserted as published", () =>
    db.insert(contentItems).values({ ...base, slug: "a", status: "published" }));
  const [item] = await db.insert(contentItems).values({ ...base, slug: "b" }).returning();
  await fails("draft -> published in one step", () =>
    db.update(contentItems).set({ status: "published" }).where(eq(contentItems.id, item.id)));
  await db.update(contentItems).set({ status: "approved" }).where(eq(contentItems.id, item.id));
  await db.update(contentItems).set({ status: "published" }).where(eq(contentItems.id, item.id));
  console.log("ok    draft -> approved -> published");

  await fails("xp event with no task and no source", () =>
    db.insert(xpEvents).values({ amount: 1, reason: "x" }));
  const [xp] = await db.insert(xpEvents).values({ source: "test", amount: 10, reason: "x" }).returning();
  await fails("xp event edited", () =>
    db.update(xpEvents).set({ amount: 99 }).where(eq(xpEvents.id, xp.id)));
  await fails("xp event deleted", () => db.delete(xpEvents).where(eq(xpEvents.id, xp.id)));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
