"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOwner } from "@/auth";
import { db } from "@/db";
import {
  cancelJob,
  createJob,
  createSchedule,
  createWorker,
  isFailure,
  revokeWorker,
  saveSkill,
  setPaused,
  setScheduleEnabled,
} from "@/worker/service";

// Every action here is for the signed-in owner. Job text is plain text, never HTML.
const text = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" ? v : "";
};
const jobFields = (f: FormData) => ({
  kind: text(f, "kind"),
  skill: text(f, "skill"),
  tier: text(f, "tier"),
  allowSmallFallback: f.get("allowSmallFallback") === "on",
  prompt: text(f, "prompt"),
  maxTokens: text(f, "maxTokens"),
});
const back = (path: string, error: string): never => redirect(`${path}?error=${encodeURIComponent(error)}`);

export async function createJobAction(f: FormData) {
  await requireOwner();
  const made = await createJob(db(), jobFields(f));
  if (isFailure(made)) back("/jobs", made.error);
  else redirect(`/jobs/${made.id}`);
}

export async function cancelJobAction(f: FormData) {
  await requireOwner();
  await cancelJob(db(), text(f, "id"));
  revalidatePath("/jobs");
}

export async function createScheduleAction(f: FormData) {
  await requireOwner();
  const made = await createSchedule(db(), { ...jobFields(f), name: text(f, "name"), cron: text(f, "cron") });
  if (isFailure(made)) back("/schedules", made.error);
  else redirect("/schedules");
}

export async function toggleScheduleAction(f: FormData) {
  await requireOwner();
  await setScheduleEnabled(db(), text(f, "id"), text(f, "enabled") === "1");
  revalidatePath("/schedules");
}

export async function setPausedAction(f: FormData) {
  await requireOwner();
  await setPaused(db(), text(f, "paused") === "1");
  revalidatePath("/workers");
}

export async function revokeWorkerAction(f: FormData) {
  await requireOwner();
  await revokeWorker(db(), text(f, "id"));
  revalidatePath("/workers");
}

export type NewWorker = { token?: string; name?: string; error?: string } | null;
/** Returns the token once, in this response only. It is not stored, logged or put in a URL. */
export async function createWorkerAction(_prev: NewWorker, f: FormData): Promise<NewWorker> {
  await requireOwner();
  const made = await createWorker(db(), text(f, "name"), text(f, "maxTier"));
  revalidatePath("/workers");
  return made;
}

export async function saveSkillAction(f: FormData) {
  await requireOwner();
  const r = await saveSkill(db(), { name: text(f, "name"), description: text(f, "description"), body: text(f, "body") });
  if (isFailure(r)) back("/skills", r.error);
  else redirect("/skills");
}
