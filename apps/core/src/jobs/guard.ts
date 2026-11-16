// Keeps client detail out of jobs. Deliberately blunt: a false positive costs a
// rephrase, a false negative puts client data in the queue. Mirrors the check in
// the front-desk service, so a job is refused at both ends.

export const JOB_AGENTS = ["glm", "content", "helper"] as const;
export type JobAgent = (typeof JOB_AGENTS)[number];

export const MAX_TASK_CHARS = 2000;
export const MAX_RESULT_CHARS = 20000;

const PATTERNS: [RegExp, string][] = [
  [/[a-z]:[\\/]/i, "a file path"],
  [/\\\\[\w.-]+\\/, "a network path"],
  [/\bclients?\b[\\/]/i, "a client folder"],
  [/\b(?:werk[\\/]clients|liberty)\b/i, "client data"],
  [/\b\d{13}\b/, "an ID number"],
  [/\b\d{9,}\b/, "a long account or ID number"],
];

export function isJobAgent(v: unknown): v is JobAgent {
  return typeof v === "string" && (JOB_AGENTS as readonly string[]).includes(v);
}

/** Returns a reason when the task must be refused, otherwise null. */
export function refuseTask(task: string): string | null {
  if (!task.trim()) return "The task is empty.";
  if (task.length > MAX_TASK_CHARS) return `Keep the task under ${MAX_TASK_CHARS} characters.`;
  for (const [re, what] of PATTERNS) {
    if (re.test(task)) return `The task looks like it contains ${what}. Client detail never goes into a job.`;
  }
  return null;
}
