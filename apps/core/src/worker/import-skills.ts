import type { Db } from "./auth";
import { workerSkills } from "@/db/worker-schema";
import skills from "./skills-import.json";
import { buildSystem } from "./prompt";

/** Adds the approved, pinned skills. Never overwrites a skill that already exists (edits made on the Skills page stay). */
export async function importSkills(db: Db): Promise<number> {
  let added = 0;
  for (const s of skills) {
    if (!buildSystem(s.body)) throw new Error(`skill ${s.name} is too long for a worker`);
    const rows = await db.insert(workerSkills).values(s).onConflictDoNothing().returning({ id: workerSkills.id });
    added += rows.length;
  }
  return added;
}
