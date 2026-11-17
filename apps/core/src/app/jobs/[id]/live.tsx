"use client";

import { useEffect, useRef, useState } from "react";
import { cancelJobAction } from "../actions";

type Ev = { id: number; attempt: number; seq: number; source: string; payload: ({ type: "progress"; note: string } | { type: "text"; text: string })[]; createdAt: string };
type View = {
  job: { id: string; kind: string; tier: string; skill: string; status: string; attempt: number; cancelRequested: boolean; result: string | null; model: string | null };
  attempts: { attempt: number; status: string; reason: string | null }[];
  events: Ev[];
  cursor: number;
};
const DONE = ["done", "failed", "cancelled"];

// Polls GET /api/jobs/{id}/events?after=<cursor> every 2.5 s. Everything is rendered
// as React text (escaped), inside <pre>: job output is never treated as HTML.
export function LiveJob({ id, first }: { id: string; first: View }) {
  const [view, setView] = useState(first.job);
  const [attempts, setAttempts] = useState(first.attempts);
  const [events, setEvents] = useState(first.events);
  const cursor = useRef(first.cursor);

  useEffect(() => {
    let stop = DONE.includes(first.job.status);
    const tick = async () => {
      if (stop) return;
      try {
        const res = await fetch(`/api/jobs/${id}/events?after=${cursor.current}`, { cache: "no-store" });
        if (res.ok) {
          const v: View = await res.json();
          setView(v.job);
          setAttempts(v.attempts);
          if (v.events.length) setEvents((e) => [...e, ...v.events]);
          cursor.current = v.cursor;
          if (DONE.includes(v.job.status)) stop = true;
        }
      } catch {
        // try again on the next tick
      }
    };
    const timer = setInterval(tick, 2500);
    return () => clearInterval(timer);
  }, [id, first.job.status]);

  const byAttempt = new Map<number, Ev[]>();
  for (const e of events) byAttempt.set(e.attempt, [...(byAttempt.get(e.attempt) ?? []), e]);
  const numbers = [...new Set([...attempts.map((a) => a.attempt), ...byAttempt.keys()])].sort((a, b) => a - b);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <p className="label">{view.kind}</p>
        <h1 className="text-xl text-headline">
          {view.status}
          {view.cancelRequested && !DONE.includes(view.status) ? " (cancel requested)" : ""}
        </h1>
        <p className="text-sm text-muted">
          {view.skill} · {view.tier} · attempt {view.attempt}
          {view.model ? ` · ${view.model}` : ""}
        </p>
      </div>
      {!DONE.includes(view.status) && !view.cancelRequested ? (
        <form action={cancelJobAction}>
          <input type="hidden" name="id" value={id} />
          <button type="submit" className="border border-gold/60 px-4 py-2 text-sm text-headline hover:bg-line">
            Cancel
          </button>
        </form>
      ) : null}
      {numbers.map((n) => {
        const a = attempts.find((x) => x.attempt === n);
        return (
          <section key={n} className="flex flex-col gap-2 border-t border-line pt-4">
            <h2 className="text-sm text-muted">
              Attempt {n}
              {a ? ` · ${a.status}${a.reason ? ` (${a.reason})` : ""}` : ""}
            </h2>
            <pre className="whitespace-pre-wrap break-words font-sans text-sm">
              {(byAttempt.get(n) ?? []).flatMap((e) => e.payload.map((p) => (p.type === "text" ? p.text : `\n[${e.source === "core" ? "core" : "progress"}] ${p.note}\n`))).join("")}
            </pre>
          </section>
        );
      })}
      {view.result ? (
        <section className="flex flex-col gap-2 border-t border-gold/60 pt-4">
          <h2 className="text-sm text-muted">Final output</h2>
          <pre className="whitespace-pre-wrap break-words font-sans text-sm text-headline">{view.result}</pre>
        </section>
      ) : null}
    </div>
  );
}
