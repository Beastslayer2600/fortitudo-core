"use client";

import { useActionState } from "react";
import { createWorkerAction, type NewWorker } from "../jobs/actions";
import { buttonClass, inputClass } from "../jobs/parts";

// The token appears here once, in this response. It is not stored, logged or put in a URL.
export function NewWorkerForm() {
  const [made, action, pending] = useActionState<NewWorker, FormData>(createWorkerAction, null);
  return (
    <div className="flex max-w-xl flex-col gap-4">
      <form action={action} className="flex flex-col gap-4">
        <h2 className="text-lg text-headline">Add a worker</h2>
        <label className="flex flex-col gap-1 text-sm">
          Name (the worker.id in that machine&apos;s config), e.g. laptop-1
          <input name="name" required className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Biggest jobs it can take
          <select name="maxTier" className={inputClass} defaultValue="small">
            <option value="small">small (laptop, Ollama)</option>
            <option value="big">big (PC, colibri)</option>
          </select>
        </label>
        <button type="submit" disabled={pending} className={buttonClass}>
          Create worker and show token
        </button>
      </form>
      {made?.error ? (
        <p role="alert" className="text-sm text-gold">
          {made.error}
        </p>
      ) : null}
      {made?.token ? (
        <div className="flex flex-col gap-2 border border-gold/60 p-4" role="status">
          <p className="text-sm">
            Token for {made.name}. It is shown once and cannot be looked up later. Put it in that machine&apos;s .env.local as CORE_WORKER_TOKEN.
          </p>
          <code className="break-all text-sm text-headline">{made.token}</code>
        </div>
      ) : null}
    </div>
  );
}
