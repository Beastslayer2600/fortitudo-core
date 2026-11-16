"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { StatusBoard } from "@/components/status-board";
import { FRONTDESK_STORE, normalizeBaseUrl, parseSseChunk, toolNote } from "@/lib/frontdesk";

type ToolCall = { name: string; allowed: boolean; ok: boolean; note?: string };
type Turn = { role: "user" | "assistant"; text: string; tools?: ToolCall[]; failed?: boolean };
type LinkState = "unknown" | "online" | "offline";

const STORE = "fortitudo-chat";

type RunView = { status: "working" | "done"; outcome: string; reply: string | null; toolsCalled: ToolCall[] };

// The model runs on Gert's PC and can take a few minutes, so the run works in
// the background and the chat checks on it.
async function waitForRun(runId: string): Promise<RunView> {
  const started = Date.now();
  while (Date.now() - started < 7 * 60_000) {
    await new Promise((r) => setTimeout(r, Date.now() - started < 20_000 ? 1500 : 4000));
    const res = await fetch(`/api/agent/runs/${runId}`, { cache: "no-store" });
    if (!res.ok) continue;
    const run = (await res.json()) as RunView;
    if (run.status === "done") return run;
  }
  throw new Error("No reply yet. The run may still finish; check Drafts in a few minutes.");
}

function load(): Turn[] {
  try {
    const raw = sessionStorage.getItem(STORE);
    return raw ? (JSON.parse(raw) as Turn[]) : [];
  } catch {
    return [];
  }
}

function loadFrontDesk(): string | null {
  try {
    const raw = localStorage.getItem(FRONTDESK_STORE);
    return raw ? normalizeBaseUrl(raw) : null;
  } catch {
    return null;
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
  if (call.name === "hand_off" && call.ok) return <span className="label !text-gold">Handed off{call.note ? ` · ${call.note}` : ""}</span>;
  if ((call.name === "get_status" || call.name === "get_job") && call.ok) return <span className="label">Checked status</span>;
  return <span className="label">{call.allowed ? `${call.name} failed` : `${call.name} refused`}</span>;
}

export function Chat() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [frontDesk, setFrontDesk] = useState<string | null>(null);
  const [link, setLink] = useState<LinkState>("unknown");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [urlError, setUrlError] = useState("");
  const [boardKey, setBoardKey] = useState(0);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTurns(load());
    const saved = loadFrontDesk();
    setFrontDesk(saved);
    setUrlInput(saved ?? "");
  }, []);
  useEffect(() => {
    try {
      sessionStorage.setItem(STORE, JSON.stringify(turns.slice(-40)));
    } catch {}
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns]);

  // Is the front desk reachable? Checked now and every 15 s. When it is not,
  // the chat says so and the status board (read from the core) carries on.
  useEffect(() => {
    if (!frontDesk) {
      setLink("unknown");
      return;
    }
    let stop = false;
    const ping = async () => {
      try {
        const res = await fetch(`${frontDesk}/health`, { cache: "no-store", signal: AbortSignal.timeout(4000) });
        if (!stop) setLink(res.ok ? "online" : "offline");
      } catch {
        if (!stop) setLink("offline");
      }
    };
    void ping();
    const t = setInterval(ping, 15_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [frontDesk]);

  function saveFrontDesk(e: FormEvent) {
    e.preventDefault();
    if (!urlInput.trim()) {
      clearFrontDesk();
      return;
    }
    const url = normalizeBaseUrl(urlInput);
    if (!url) {
      setUrlError("Use the https address from Tailscale Serve, for example https://laptop.your-tailnet.ts.net");
      return;
    }
    try {
      localStorage.setItem(FRONTDESK_STORE, url);
    } catch {}
    setUrlError("");
    setUrlInput(url);
    setFrontDesk(url);
    setSettingsOpen(false);
  }

  function clearFrontDesk() {
    try {
      localStorage.removeItem(FRONTDESK_STORE);
    } catch {}
    setUrlInput("");
    setUrlError("");
    setFrontDesk(null);
    setSettingsOpen(false);
  }

  // Streams the reply from the front desk and fills the last turn as it arrives.
  async function sendToFrontDesk(base: string, message: string, history: Turn[]) {
    const messages = [...history.map((t) => ({ role: t.role, content: t.text })), { role: "user", content: message }];
    let res: Response;
    try {
      res = await fetch(`${base}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages }),
      });
    } catch {
      setLink("offline");
      throw new Error("Front desk offline. Your laptop is closed or out of reach. The status board below still shows the queue.");
    }
    if (!res.ok || !res.body) throw new Error(`The front desk returned ${res.status}.`);
    setLink("online");

    setTurns((t) => [...t, { role: "assistant", text: "", tools: [] }]);
    const patch = (fn: (turn: Turn) => Turn) => setTurns((t) => t.map((x, i) => (i === t.length - 1 ? fn(x) : x)));
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { events, rest } = parseSseChunk(buffer);
      buffer = rest;
      for (const ev of events) {
        if (ev.type === "token") patch((x) => ({ ...x, text: x.text + ev.text }));
        else if (ev.type === "tool") {
          const { ok, note } = toolNote(ev.name, ev.result);
          patch((x) => ({ ...x, tools: [...(x.tools ?? []), { name: ev.name, allowed: true, ok, note }] }));
          setBoardKey((k) => k + 1);
        } else if (ev.type === "error") patch((x) => ({ ...x, text: x.text || ev.message, failed: true }));
      }
    }
    patch((x) => ({ ...x, text: x.text || "(no reply)" }));
  }

  async function sendToCore(message: string, history: Turn[]) {
    const res = await fetch("/api/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message, history: history.map(({ role, text }) => ({ role, text })) }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.runId) throw new Error(data.error ?? `The agent returned ${res.status}.`);
    const run = await waitForRun(data.runId);
    const failed = run.outcome.startsWith("error") || run.outcome.startsWith("refused");
    setTurns((t) => [...t, { role: "assistant", text: run.reply || "(no reply)", tools: run.toolsCalled, failed }]);
  }

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const message = draft.trim();
    if (!message || busy) return;
    const history = turns.filter((t) => !t.failed);
    setTurns((t) => [...t, { role: "user", text: message }]);
    setDraft("");
    setBusy(true);
    try {
      if (frontDesk) await sendToFrontDesk(frontDesk, message, history);
      else await sendToCore(message, history);
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

  const offline = !!frontDesk && link === "offline";

  return (
    <main className="flex flex-1 flex-col px-gutter">
      <div className="flex flex-1 flex-col gap-10 py-10">
        <section className="flex max-w-prose flex-col gap-4" aria-label="Front desk">
          <div className="flex items-baseline gap-4">
            <p className="label">
              {frontDesk ? (link === "online" ? "Front desk · online" : link === "offline" ? "Front desk offline" : "Front desk · checking") : "The agent"}
            </p>
            <button type="button" onClick={() => setSettingsOpen((o) => !o)} className="label hover:text-text" aria-expanded={settingsOpen}>
              {settingsOpen ? "Close" : "Front desk setting"}
            </button>
          </div>
          {settingsOpen ? (
            <form onSubmit={saveFrontDesk} className="flex flex-col gap-3">
              <label htmlFor="frontdesk-url" className="text-sm text-muted">
                Front desk address. The https address Tailscale Serve gives your laptop. Leave empty to chat with the core&apos;s own agent.
              </label>
              <input
                id="frontdesk-url"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="https://laptop.your-tailnet.ts.net"
                className="min-h-11 rounded-sm border border-line bg-surface px-4 py-3 text-base text-text placeholder:text-muted focus:border-muted focus:outline-none"
              />
              {urlError ? <p className="text-sm text-muted">{urlError}</p> : null}
              <div className="flex gap-4">
                <button type="submit" className="min-h-11 rounded-sm border border-line px-5 text-sm text-text hover:border-muted">
                  Save
                </button>
                {frontDesk ? (
                  <button type="button" onClick={clearFrontDesk} className="min-h-11 px-3 text-sm text-muted hover:text-text">
                    Remove
                  </button>
                ) : null}
              </div>
            </form>
          ) : null}
          {offline ? (
            <p className="text-sm text-muted">
              The front desk can&apos;t be reached, so it is not taking messages. The status board still reads from the core.
            </p>
          ) : null}
          <StatusBoard refreshKey={boardKey} />
        </section>

        {turns.length === 0 ? (
          <div className="flex max-w-prose flex-col gap-4 pt-[4vh]">
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
        {busy ? (
          <p className="label rise">{frontDesk ? "Front desk is replying" : "Working on your PC · this can take a minute or two"}</p>
        ) : null}
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
          placeholder={offline ? "Front desk offline" : frontDesk ? "Write to the front desk" : "Write to the agent"}
          className="max-h-48 min-h-11 flex-1 resize-none rounded-sm border border-line bg-surface px-4 py-3 text-base text-text placeholder:text-muted focus:border-muted focus:outline-none [field-sizing:content]"
        />
        <button
          type="submit"
          disabled={busy || !draft.trim() || offline}
          className="min-h-11 rounded-sm border border-line px-5 text-sm text-text transition-colors hover:border-muted disabled:text-muted disabled:hover:border-line"
        >
          Send
        </button>
      </form>
    </main>
  );
}
