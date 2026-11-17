import { requireOwner } from "@/auth";
import { Shell } from "@/components/shell";
import { db } from "@/db";
import { listSchedules, listSkills } from "@/worker/service";
import { createScheduleAction, toggleScheduleAction } from "../jobs/actions";
import { buttonClass, ErrorLine, inputClass, JobFields, NoClientDetails, SubNav } from "../jobs/parts";

export const dynamic = "force-dynamic";

export default async function SchedulesPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requireOwner();
  const { error } = await searchParams;
  const [schedules, skills] = await Promise.all([listSchedules(db()), listSkills(db())]);
  return (
    <Shell active="jobs">
      <main className="flex flex-col gap-8 px-gutter py-10">
        <SubNav active="schedules" />
        <div className="flex flex-col gap-2">
          <p className="label">Schedules</p>
          <h1 className="text-xl text-headline">Repeating jobs</h1>
          <p className="max-w-prose text-sm text-muted">Times are Africa/Johannesburg. A due schedule becomes one job the next time a worker checks in.</p>
        </div>
        <NoClientDetails />
        <ul className="flex max-w-3xl flex-col">
          {schedules.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-4 border-b border-line py-4">
              <span className="flex flex-col">
                <span>{s.name}</span>
                <span className="text-sm text-muted">
                  {s.cron} · {s.kind} · {s.skill} · {s.tier} · {s.enabled ? "on" : "off"}
                </span>
              </span>
              <form action={toggleScheduleAction}>
                <input type="hidden" name="id" value={s.id} />
                <input type="hidden" name="enabled" value={s.enabled ? "0" : "1"} />
                <button type="submit" className={buttonClass}>
                  {s.enabled ? "Turn off" : "Turn on"}
                </button>
              </form>
            </li>
          ))}
          {schedules.length === 0 ? <li className="text-muted">No schedules yet.</li> : null}
        </ul>
        {skills.length > 0 ? (
          <form action={createScheduleAction} className="flex max-w-xl flex-col gap-4">
            <label className="flex flex-col gap-1 text-sm">
              Name
              <input name="name" required maxLength={80} className={inputClass} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Cron (minute hour day month weekday), e.g. 0 8 * * 1-5
              <input name="cron" required className={inputClass} />
            </label>
            <JobFields skills={skills} />
            <ErrorLine error={error} />
            <button type="submit" className={buttonClass}>
              Create schedule
            </button>
          </form>
        ) : (
          <p className="text-muted">Add a skill first.</p>
        )}
      </main>
    </Shell>
  );
}
