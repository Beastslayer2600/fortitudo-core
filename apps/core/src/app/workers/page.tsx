import { requireOwner } from "@/auth";
import { Shell } from "@/components/shell";
import { db } from "@/db";
import { workerStatus } from "@/worker/service";
import { revokeWorkerAction, setPausedAction } from "../jobs/actions";
import { buttonClass, SubNav } from "../jobs/parts";
import { NewWorkerForm } from "./new-worker";

export const dynamic = "force-dynamic";
const when = new Intl.DateTimeFormat("en-ZA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Africa/Johannesburg" });

export default async function WorkersPage() {
  await requireOwner();
  const { paused, workers } = await workerStatus(db());
  return (
    <Shell active="jobs">
      <main className="flex flex-col gap-8 px-gutter py-10">
        <SubNav active="workers" />
        <div className="flex flex-col gap-2">
          <p className="label">Workers</p>
          <h1 className="text-xl text-headline">Your machines</h1>
          <p className="max-w-prose text-sm text-muted">Online means seen in the last 60 seconds. Refresh to update.</p>
        </div>
        <form action={setPausedAction} className="flex items-center gap-4">
          <input type="hidden" name="paused" value={paused ? "0" : "1"} />
          <span>{paused ? "All workers are paused." : "Workers are running."}</span>
          <button type="submit" className={buttonClass}>
            {paused ? "Resume all" : "Pause all"}
          </button>
        </form>
        <ul className="flex max-w-3xl flex-col">
          {workers.map((w) => (
            <li key={w.id} className="flex items-center justify-between gap-4 border-b border-line py-4">
              <span className="flex flex-col">
                <span>
                  {w.name} · {w.maxTier}
                </span>
                <span className="text-sm text-muted">
                  {w.revokedAt ? "revoked" : w.online ? "online" : "offline"}
                  {w.lastSeenAt ? ` · last seen ${when.format(w.lastSeenAt)}` : " · never seen"}
                </span>
              </span>
              {w.revokedAt ? null : (
                <form action={revokeWorkerAction}>
                  <input type="hidden" name="id" value={w.id} />
                  <button type="submit" className={buttonClass}>
                    Revoke
                  </button>
                </form>
              )}
            </li>
          ))}
          {workers.length === 0 ? <li className="text-muted">No workers yet.</li> : null}
        </ul>
        <NewWorkerForm />
      </main>
    </Shell>
  );
}
