"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

type ToolCall = { name: string; allowed: boolean; ok: boolean; note?: string };
type Turn = { role: "user" | "assistant"; text: string; tools?: ToolCall[]; failed?: boolean };

const STORE = "fortitudo-chat";

function load(): Turn[] {
  try {
    const raw = sessionStorage.getItem(STORE);
    return raw ? (JSON.parse(raw) as Turn[]) : [];
  } catch {
    return [];
  }
}

function ToolNote({ call }: { call: ToolCall }) {
  if (call.name === "save_draft" && call.ok && call.note) {
    return (
      <Link href={`/drafts/${call.note}`} className="label !text-gold hover:underline">
        Draft saved · open
      </Link>
    );
  }
  if (call.name === "read_content" && call.ok) return <span className="label">Read content</span>;
  return <span className="label">{call.allowed ? `${call.name} failed` : `${call.name} refused`}</span>;
}

export function Chat() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => setTurns(load()), []);
  useEffect(() => {
    try {
      sessionStorage.setItem(STORE, JSON.stringify(turns.slice(-40)));
    } catch {}
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns]);

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const message = draft.trim();
    if (!message || busy) return;
    const history = turns.filter((t) => !t.failed).map(({ role, text }) => ({ role, text }));
    setTurns((t) => [...t, { role: "user", text: message }]);
    setDraft("");
    setBusy(true);
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, history }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `The agent returned ${res.status}.`);
      setTurns((t) => [...t, { role: "assistant", text: data.reply || "(no reply)", tools: data.toolsCalled }]);
    } catch (err) {
      const text = err instanceof Error ? err.message : "The request failed.";
      setTurns((t) => [...t, { role: "assistant", text, failed: true }]);
    } finally {
      setBusy(false);
    }
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <main className="flex flex-1 flex-col px-gutter">
      <div className="flex flex-1 flex-col gap-10 py-10">
        {turns.length === 0 ? (
          <div className="flex max-w-prose flex-col gap-4 pt-[8vh]">
            <p className="label">The agent</p>
            <h1 className="text-display leading-tight text-headline">What are we building today?</h1>
            <p className="text-muted">
              Ask for angles on a guide, a draft of page copy, or a look at what is already written. Drafts land in Drafts. You publish.
            </p>
          </div>
        ) : (
          turns.map((turn, i) => (
            <div key={i} className={`rise flex max-w-prose flex-col gap-2 ${turn.role === "user" ? "self-end text-right" : ""}`}>
              <p className="label">{turn.role === "user" ? "You" : "Fortitudo"}</p>
              <p className={`whitespace-pre-wrap leading-relaxed ${turn.role === "user" ? "text-muted" : turn.failed ? "text-muted" : "text-text"}`}>
                {turn.text}
              </p>
              {turn.tools?.length ? (
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {turn.tools.map((call, j) => (
                    <ToolNote key={j} call={call} />
                  ))}
                </div>
              ) : null}
            </div>
          ))
        )}
        {busy ? <p className="label rise">Working</p> : null}
        <div ref={end} />
      </div>

      <form onSubmit={send} className="sticky bottom-0 flex items-end gap-4 border-t border-line bg-base pt-4 pb-6">
        <label htmlFor="message" className="sr-only">
          Message
        </label>
        <textarea
          id="message"
          rows={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          placeholder="Write to the agent"
          className="max-h-48 min-h-11 flex-1 resize-none rounded-sm border border-line bg-surface px-4 py-3 text-base text-text placeholder:text-muted focus:border-muted focus:outline-none [field-sizing:content]"
        />
        <button
          type="submit"
          disabled={busy || !draft.trim()}
          className="min-h-11 rounded-sm border border-line px-5 text-sm text-text transition-colors hover:border-muted disabled:text-muted disabled:hover:border-line"
        >
          Send
        </button>
      </form>
    </main>
  );
}
