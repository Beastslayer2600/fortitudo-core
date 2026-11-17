import { requireOwner } from "@/auth";
import { Shell } from "@/components/shell";
import { db } from "@/db";
import { listSkills } from "@/worker/service";
import { saveSkillAction } from "../jobs/actions";
import { buttonClass, ErrorLine, inputClass, SubNav } from "../jobs/parts";

export const dynamic = "force-dynamic";

export default async function SkillsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requireOwner();
  const { error } = await searchParams;
  const skills = await listSkills(db());
  return (
    <Shell active="jobs">
      <main className="flex flex-col gap-8 px-gutter py-10">
        <SubNav active="skills" />
        <div className="flex flex-col gap-2">
          <p className="label">Skills</p>
          <h1 className="text-xl text-headline">Skill library</h1>
          <p className="max-w-prose text-sm text-muted">A job sends the skill text, plus a short safety line, as the system prompt. Saving a changed skill raises its version.</p>
        </div>
        <ul className="flex max-w-3xl flex-col">
          {skills.map((s) => (
            <li key={s.id} className="border-b border-line py-4">
              <details>
                <summary className="cursor-pointer">
                  {s.name} <span className="text-sm text-muted">v{s.version} · {s.description}</span>
                </summary>
                <pre className="mt-3 whitespace-pre-wrap break-words font-sans text-sm text-muted">{s.body}</pre>
                {s.sourceUrl ? (
                  <p className="mt-2 text-sm text-muted">
                    Source: {s.sourceUrl}
                    {s.sourceSha ? ` @ ${s.sourceSha.slice(0, 10)}` : ""}
                    {s.license ? ` · ${s.license}` : ""}
                  </p>
                ) : null}
              </details>
            </li>
          ))}
          {skills.length === 0 ? <li className="text-muted">No skills yet.</li> : null}
        </ul>
        <form action={saveSkillAction} className="flex max-w-xl flex-col gap-4">
          <h2 className="text-lg text-headline">Add or update a skill</h2>
          <label className="flex flex-col gap-1 text-sm">
            Name (lowercase, dashes)
            <input name="name" required className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            One-line description
            <input name="description" required maxLength={200} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Full text
            <textarea name="body" rows={12} required className={inputClass} />
          </label>
          <ErrorLine error={error} />
          <button type="submit" className={buttonClass}>
            Save skill
          </button>
        </form>
      </main>
    </Shell>
  );
}
