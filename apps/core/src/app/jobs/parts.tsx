import Link from "next/link";
import { KINDS, DEFAULT_TIER } from "@/worker/limits";

export function SubNav({ active }: { active: "jobs" | "schedules" | "workers" | "skills" }) {
  return (
    <nav className="flex gap-6 text-sm">
      {(["jobs", "schedules", "workers", "skills"] as const).map((k) => (
        <Link key={k} href={`/${k}`} aria-current={k === active ? "page" : undefined} className={k === active ? "text-text" : "text-muted hover:text-text"}>
          {k[0]!.toUpperCase() + k.slice(1)}
        </Link>
      ))}
    </nav>
  );
}

export const NoClientDetails = () => (
  <p className="max-w-prose border border-gold/60 px-4 py-3 text-sm text-headline" role="note">
    Never put client details in a job. A job is a prompt plus a skill; the answer is a draft you review.
  </p>
);

export const ErrorLine = ({ error }: { error?: string }) =>
  error ? (
    <p role="alert" className="text-sm text-gold">
      {error}
    </p>
  ) : null;

const field = "w-full border border-line bg-transparent px-3 py-2 text-text";
export const inputClass = field;
export const buttonClass = "border border-gold/60 px-4 py-2 text-sm text-headline hover:bg-line";

/** The fields a job and a schedule share. */
export function JobFields({ skills }: { skills: { name: string }[] }) {
  return (
    <>
      <label className="flex flex-col gap-1 text-sm">
        Kind
        <select name="kind" className={field} defaultValue="social_post">
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {k} (default {DEFAULT_TIER[k]})
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Skill
        <select name="skill" className={field} required>
          {skills.map((s) => (
            <option key={s.name} value={s.name}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Tier override
        <select name="tier" className={field} defaultValue="">
          <option value="">Default for the kind</option>
          <option value="small">small (laptop)</option>
          <option value="big">big (PC)</option>
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="allowSmallFallback" /> Allow the small worker to run a big job
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Max tokens (blank = default for the kind)
        <input name="maxTokens" inputMode="numeric" className={field} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Prompt
        <textarea name="prompt" rows={6} required maxLength={24000} className={field} />
      </label>
    </>
  );
}
