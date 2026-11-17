import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { importSkills } from "../src/worker/import-skills";

async function main() {
  // Same rule as migrations: a preview build must not write to a database it may share with production.
  if (process.env.VERCEL_ENV === "preview" && process.env.MIGRATE_ON_PREVIEW !== "1") {
    console.log("preview build: skill import skipped");
    return;
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  console.log(`skills added: ${await importSkills(drizzle(neon(url)))}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
