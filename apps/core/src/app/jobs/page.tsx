import Link from "next/link";
import { requireOwner } from "@/auth";
import { Shell } from "@/components/shell";
import { db } from "@/db";
import { listJobs, listSkills } from "@/worker/service";
import { createJobAction } from "./actions";
import { buttonClass, ErrorLine, JobFields, NoClientDetails, SubNav } from "./parts";

export const dynamic = "force-dynamic";
const when = new Intl.DateTimeFormat("en-ZA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Johannesburg" });

export default async function JobsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requireOwner();
  const { error } = await searchParams;
  const [jobs, skills] = await Promise.all([listJobs(db()), listSkills(db())]);
  return (
    <Shell active="jobs">
      <main className="flex flex-col gap-8 px-gutter py-10">
        <SubNav active="jobs" />
        <div className="flex flex-col gap-2">
          <p className="label">Jobs</p>
          <h1 className="text-xl text-headline">Work for your machines</h1>
        </div>
        <NoClientDetails />
        {skills.length === 0 ? (
          <p className="text-muted">
            Add a skill first on the <Link href="/skills" className="underline">Skills</Link> page.
          </p>
        ) : (
          <form action={createJobAction} className="flex max-w-xl flex-col gap-4">
            <JobFields skills={skills} />
            <ErrorLine error={error} />
            <button type="submit" className={buttonClass}>
              Create job
            </button>
          </form>
        )}
        <ul className="flex max-w-3xl flex-col">
          {jobs.map((j) => (
            <li key={j.id} className="border-b border-line">
              <Link href={`/jobs/${j.id}`} className="flex flex-col gap-1 py-4 hover:text-headline">
                <span>
                  {j.kind} · {j.skill}
                </span>
                <span className="text-sm text-muted">
                  {j.status} · {j.tier} · attempt {j.attempt} · {when.format(j.createdAt)}
                </span>
              </Link>
            </li>
          ))}
          {jobs.length === 0 ? <li className="text-muted">No jobs yet.</li> : null}
        </ul>
      </main>
    </Shell>
  );
}
