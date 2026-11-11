import type { PgDatabase } from "drizzle-orm/pg-core";
import { memoryNotes, projects, users } from "./schema";

export const BRAND_ROOT_SCOPE = "identity";
export const BRAND_ROOT_KEY = "brand_root";

// The identity root, as written in the architecture document. Owned by Gert.
// Seeding inserts it once and never overwrites an existing row.
const BRAND_ROOT_BODY = `Name and meaning. Fortitudo: strength, courage, patient endurance under trial. Studio: the room where a visionary works.

Character. A man of principles, grounded and calm, with authority that is softly spoken.

Line. "Strength to build it, patience to keep it."`;

const PROJECTS = [
  { slug: "advising", name: "Advising" },
  { slug: "web-design", name: "Web design" },
  { slug: "craft-studio", name: "Craft studio" },
  { slug: "adjudication", name: "Adjudication" },
  { slug: "personal-brand", name: "Personal brand" },
];

// Safe to run on every deploy: every insert skips rows that already exist.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function seed(db: PgDatabase<any, any, any>, ownerEmail?: string) {
  await db
    .insert(memoryNotes)
    .values({ scope: BRAND_ROOT_SCOPE, key: BRAND_ROOT_KEY, body: BRAND_ROOT_BODY })
    .onConflictDoNothing();

  await db.insert(projects).values(PROJECTS).onConflictDoNothing();

  if (ownerEmail) {
    await db
      .insert(users)
      .values({ email: ownerEmail.trim().toLowerCase(), role: "owner" })
      .onConflictDoNothing();
  }
}
