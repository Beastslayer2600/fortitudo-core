import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";

async function main() {
  // A preview build must not change a database it may share with production.
  // Migrations run on production builds; set MIGRATE_ON_PREVIEW=1 to opt a preview in.
  if (process.env.VERCEL_ENV === "preview" && process.env.MIGRATE_ON_PREVIEW !== "1") {
    console.log("preview build: migrations skipped");
    return;
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Connect the Neon database in Vercel first.");
  await migrate(drizzle(neon(url)), { migrationsFolder: "./drizzle" });
  console.log("migrations applied");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
