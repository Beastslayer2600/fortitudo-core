"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { StatusBoard as Board } from "@/lib/frontdesk";

// The status board reads straight from the core, never from the front desk, so
// it stays readable when the laptop is closed or unreachable. Jobs come from the
// worker queue (the one the laptop and PC claim from).
async function load(): Promise<Board> {
  const [jobs, drafts] = await Promise.all([
    fetch("/api/local-ai/jobs", { cache: "no-store" }),
    fetch("/api/drafts?status=pending", { cache: "no-store" }),
  ]);
  if (!jobs.ok || !drafts.ok) throw new Error("status unavailable");
  // The API lists oldest first; show newest first so recent work is not buried by old failures.
  const list: Board["jobs"] = (await jobs.json()).jobs;
  return { jobs: [...list].reverse(), drafts: (await drafts.json()).drafts };
}

// Open work first, then finished work (done or failed) newest first. The sort is stable.
const ORDER = { running: 0, queued: 1, failed: 2, done: 2 } as const;

export function StatusBoard({ refreshKey }: { refreshKey: number }) {
  const [board, setBoard] = useState<Board | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const next = await load();
        if (!stop) {
          setBoard(next);
          setFailed(false);
        }
      } catch {
        if (!stop) setFailed(true);
      }
    };
    void tick();
    const t = setInterval(tick, 10_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [refreshKey]);

  if (failed && !board) return <p className="label">Status unavailable · the core is not answering</p>;
  if (!board) return <p className="label">Loading status</p>;

  const jobs = [...board.jobs].sort((a, b) => ORDER[a.status] - ORDER[b.status]).slice(0, 8);
  const open = board.jobs.filter((j) => j.status === "queued" || j.status === "running").length;
  return (
    <details className="max-w-prose" open={open > 0 || board.drafts.length > 0}>
      <summary className="label cursor-pointer">
        Status · {open} open · {board.drafts.length} draft{board.drafts.length === 1 ? "" : "s"} waiting{failed ? " · out of date" : ""}
      </summary>
      <ul className="mt-3 flex flex-col gap-2 text-sm">
        {jobs.length === 0 ? <li className="text-muted">No jobs yet.</li> : null}
        {jobs.map((j) => (
          <li key={j.id} className="flex gap-3">
            <span className="label w-16 shrink-0">{j.status}</span>
            <Link href={`/jobs/${j.id}`} className="text-text hover:underline">
              {j.agent}: {j.task.length > 70 ? `${j.task.slice(0, 67)}...` : j.task}
            </Link>
          </li>
        ))}
        {board.drafts.length > 0 ? (
          <li>
            <Link href="/drafts" className="label !text-gold hover:underline">
              {board.drafts.length} draft{board.drafts.length === 1 ? "" : "s"} waiting for you · open
            </Link>
          </li>
        ) : null}
      </ul>
    </details>
  );
}
