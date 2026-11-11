import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { seed } from "../src/db/seed-data";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  if (!process.env.OWNER_EMAIL) {
    console.warn("OWNER_EMAIL is not set: no user seeded, so nobody can log in yet.");
  }
  await seed(drizzle(neon(url)), process.env.OWNER_EMAIL);
  console.log("seed applied");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
