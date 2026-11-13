// Checks the agent gateway's guard rails on an in-memory Postgres with a
// scripted fake model, then the real PC proxy against a fake Ollama.
// No network, no model, nothing billed.
import { PGlite } from "@electric-sql/pglite";
import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  DEFAULT_DAILY_REQUEST_CAP,
  getRun,
  HARD_STOP_MULTIPLE,
  MAX_TOOL_STEPS,
  runAgent,
  startOfDaySast,
  STALE_AFTER_MS,
} from "../src/agent/gateway";
import { ModelUnavailableError, ollamaClient, type ChatRequest, type ModelClient } from "../src/agent/model";
import { TOOLS, type AgentTool } from "../src/agent/tools";
import { agentRuns, contentItems, contentRevisions, projects } from "../src/db/schema";
import { seed } from "../src/db/seed-data";

const MODEL = "qwen3:4b";
let checks = 0;
function ok(cond: unknown, label: string) {
  if (!cond) throw new Error(`FAILED: ${label}`);
  checks++;
  console.log(`ok    ${label}`);
}

type Step = { tools?: { name: string; input: Record<string, unknown> }[]; text?: string };

// A fake model that plays back a script and records every request it gets.
function scripted(steps: Step[] | ((i: number) => Step)) {
  const calls: ChatRequest[] = [];
  const client: ModelClient = {
    async chat(req) {
      calls.push(structuredClone(req));
      const i = calls.length - 1;
      const step = typeof steps === "function" ? steps(i) : (steps[i] ?? { text: "done" });
      const toolCalls = (step.tools ?? []).map((t, n) => ({ id: `c${i}_${n}`, name: t.name, input: t.input }));
      return {
        text: step.text ?? "",
        toolCalls,
        finish: toolCalls.length ? "tool_calls" : "stop",
        usage: { inputTokens: 1000, outputTokens: 200 },
      };
    },
  };
  return { client, calls };
}

const lastToolMessage = (req: ChatRequest) => [...req.messages].reverse().find((m) => m.role === "tool");

function listen(server: Server) {
  return new Promise<string>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)),
  );
}

async function main() {
  const db = drizzle(new PGlite());
  await migrate(db, { migrationsFolder: "./drizzle" });
  await seed(db, "owner@example.com");
  const base = { db, modelName: MODEL };

  // 1. brand_root loads before the run; a draft is saved and logged.
  {
    const m = scripted([
      { tools: [{ name: "save_draft", input: { project: "advising", type: "guide", slug: "tax-free-savings", title: "Tax-free savings", body: "# Draft" } }] },
      { text: "Saved a draft for you to review." },
    ]);
    const r = (await runAgent({ ...base, model: m.client }, { face: "front-door", message: "Draft a guide on tax-free savings" }))!;
    ok(m.calls[0].system.includes("Strength to build it, patience to keep it."), "brand_root is in the instructions of the first model call");
    ok(r.status === "done" && r.reply === "Saved a draft for you to review.", "the agent's reply is stored on the run");
    const [item] = await db.select().from(contentItems).where(eq(contentItems.slug, "tax-free-savings"));
    ok(item?.status === "draft", "save_draft creates the item as a draft");
    const revs = await db.select().from(contentRevisions).where(eq(contentRevisions.contentItemId, item.id));
    ok(revs.length === 1 && revs[0].author === "agent", "the draft has a first revision by the agent");
    const [run] = await db.select().from(agentRuns).where(eq(agentRuns.id, r.runId));
    ok(run.outcome === "answered" && run.tier === 1 && run.face === "front-door" && run.model === MODEL, "the run is logged with outcome, tier, face and model");
    ok(run.inputTokens === 2000 && run.outputTokens === 400, "the run's token counts are logged");
    ok(!m.calls[0].tools.some((t) => t.name.includes("publish")), "no publish tool is offered to the model");
  }

  // 2. A publish tool the model invents is refused; nothing is published.
  {
    const [item] = await db.select().from(contentItems).where(eq(contentItems.slug, "tax-free-savings"));
    const m = scripted([{ tools: [{ name: "publish_content", input: { id: item.id } }] }, { text: "I can't publish." }]);
    const r = (await runAgent({ ...base, model: m.client }, { face: "front-door", message: "Publish it" }))!;
    ok(r.toolsCalled[0]?.allowed === false, "an unknown tool (publish_content) is refused by the gateway");
    const told = lastToolMessage(m.calls[1]);
    ok(told?.role === "tool" && told.isError === true, "the model is told the call was refused");
    const [after] = await db.select().from(contentItems).where(eq(contentItems.id, item.id));
    ok(after.status === "draft", "the item is still a draft");
  }

  // 3. A tool above tier 1 is refused in code even if it is registered.
  {
    let ran = false;
    const tierTwo: AgentTool = {
      name: "publish_now",
      tier: 2,
      definition: { name: "publish_now", description: "test only", parameters: { type: "object", properties: {} } },
      async run() {
        ran = true;
        return {};
      },
    };
    const m = scripted([{ tools: [{ name: "publish_now", input: {} }] }, { text: "ok" }]);
    const r = (await runAgent({ ...base, model: m.client, tools: [...TOOLS, tierTwo] }, { face: "front-door", message: "x" }))!;
    ok(!ran && r.toolsCalled[0]?.allowed === false && r.toolsCalled[0]?.tier === 2, "a registered tier-2 tool is refused and never runs");
    ok(!m.calls[0].tools.some((t) => t.name === "publish_now"), "tier-2 tools are not even offered");
  }

  // 4. save_draft cannot touch an approved or published item.
  {
    const [p] = await db.select().from(projects).where(eq(projects.slug, "advising"));
    const [live] = await db.insert(contentItems).values({ projectId: p.id, type: "guide", slug: "live-guide", title: "Live", body: "v1" }).returning();
    await db.update(contentItems).set({ status: "approved" }).where(eq(contentItems.id, live.id));
    await db.update(contentItems).set({ status: "published" }).where(eq(contentItems.id, live.id));
    const m = scripted([{ tools: [{ name: "save_draft", input: { id: live.id, title: "Hacked", body: "v2" } }] }, { text: "ok" }]);
    const r = (await runAgent({ ...base, model: m.client }, { face: "front-door", message: "Edit the live guide" }))!;
    const [after] = await db.select().from(contentItems).where(eq(contentItems.id, live.id));
    ok(after.title === "Live" && after.body === "v1" && r.toolsCalled[0]?.ok === false, "save_draft refuses to change a published item");
  }

  // 5. The tool step cap stops a looping run.
  {
    const m = scripted((i) => (i < 50 ? { tools: [{ name: "read_content", input: {} }] } : { text: "stop" }));
    const r = (await runAgent({ ...base, model: m.client }, { face: "front-door", message: "loop" }))!;
    const ran = r.toolsCalled.filter((t) => t.allowed).length;
    ok(ran === MAX_TOOL_STEPS, `only ${MAX_TOOL_STEPS} tool steps run in one request (ran ${ran})`);
    ok(m.calls[m.calls.length - 1].tools.length === 0, "after the cap the model is asked to answer without tools");
    ok(r.outcome === "answered: tool step cap reached" && m.calls.length <= MAX_TOOL_STEPS + 2, `the run ends (model called ${m.calls.length} times)`);
  }

  // 6. No model, PC down, and the daily request cap.
  {
    const r0 = (await runAgent({ ...base, model: null }, { face: "front-door", message: "hi" }))!;
    ok(r0.outcome === "refused: no model configured", "with no model connected the run is refused and logged");

    const down: ModelClient = { chat: async () => { throw new ModelUnavailableError("connect ECONNREFUSED"); } };
    const r1 = (await runAgent({ ...base, model: down }, { face: "front-door", message: "hi" }))!;
    ok(r1.outcome === "error: model unavailable" && /PC did not answer/.test(r1.reply ?? ""), "when the PC is off the run ends with a plain message");

    const used = await (async () => {
      const today = await db.select().from(agentRuns);
      return today.filter((r) => !(r.outcome ?? "").startsWith("refused")).length;
    })();
    const cap = used; // the cap is already reached
    const m2 = scripted([{ tools: [{ name: "save_draft", input: { project: "advising", type: "guide", slug: "over", title: "t", body: "b" } }] }, { text: "ok" }]);
    const r2 = (await runAgent({ ...base, model: m2.client, dailyRequestCap: cap }, { face: "front-door", message: "draft" }))!;
    const [over] = await db.select().from(contentItems).where(eq(contentItems.slug, "over"));
    ok(m2.calls[0].tools.length === 0 && !over && r2.toolsCalled.every((t) => !t.allowed), "past the daily cap no tools are offered and no action runs");

    const m3 = scripted([{ text: "hi" }]);
    const r3 = (await runAgent({ ...base, model: m3.client, dailyRequestCap: Math.floor(cap / HARD_STOP_MULTIPLE) }, { face: "front-door", message: "hi" }))!;
    ok(m3.calls.length === 0 && r3.outcome === "refused: daily hard stop", `past ${HARD_STOP_MULTIPLE}x the cap the model is not called`);
    ok(DEFAULT_DAILY_REQUEST_CAP === 100, "the default daily cap is 100 requests");

    const lateEvening = startOfDaySast(new Date("2026-11-11T21:30:00Z")).toISOString(); // 23:30 SAST
    const pastMidnight = startOfDaySast(new Date("2026-11-11T22:30:00Z")).toISOString(); // 00:30 SAST next day
    ok(lateEvening === "2026-11-10T22:00:00.000Z" && pastMidnight === "2026-11-11T22:00:00.000Z", "the day starts at midnight South African time");
  }

  // 7. An abandoned run is marked failed instead of spinning forever.
  {
    const old = new Date(Date.now() - STALE_AFTER_MS - 60_000);
    const [stuck] = await db.insert(agentRuns).values({ face: "front-door", request: "stuck", outcome: "running", createdAt: old }).returning();
    const v = await getRun(db, stuck.id, new Date());
    ok(v?.status === "done" && v.outcome === "error: run did not finish", "a run left running for too long is marked failed");
  }

  // 8. Every run was logged and none is left unfinished.
  const runs = await db.select().from(agentRuns).orderBy(desc(agentRuns.createdAt));
  ok(runs.filter((r) => r.face === "front-door").length === 10, "every front-door run, refused or not, has a row in agent_runs");
  ok(runs.every((r) => r.outcome !== "running" && r.outcome !== "queued"), "no run is left unfinished");

  // 9. The PC proxy in front of a fake Ollama: token check and message format.
  {
    let seen: Record<string, unknown> | null = null;
    const fakeOllama = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        if (req.url === "/api/tags") return res.end("{}");
        seen = JSON.parse(body);
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({
          message: { role: "assistant", content: "", tool_calls: [{ function: { name: "read_content", arguments: { status: "draft" } } }] },
          done_reason: "stop",
          prompt_eval_count: 321,
          eval_count: 12,
        }));
      });
    });
    const ollamaUrl = await listen(fakeOllama);
    const token = "t".repeat(40);
    process.env.AGENT_MODEL_TOKEN = token;
    process.env.OLLAMA_URL = ollamaUrl;
    process.env.PROXY_NO_LISTEN = "1";
    const { server: proxy } = (await import("../../../tools/local-model/proxy.mjs")) as { server: Server };
    const proxyUrl = await listen(proxy);

    const client = ollamaClient({ url: proxyUrl, token, model: MODEL, timeoutMs: 5000 });
    const res = await client.chat({
      system: "SYSTEM",
      messages: [{ role: "user", content: "hi" }],
      tools: TOOLS.map((t) => t.definition),
    });
    const sent = seen as unknown as { model: string; messages: { role: string; content: string }[]; tools: unknown[]; stream: boolean };
    ok(sent.model === MODEL && sent.stream === false && sent.messages[0].role === "system" && sent.messages[0].content === "SYSTEM", "the proxy forwards the chat to Ollama with the system prompt first");
    ok(sent.tools.length === TOOLS.length, "tool definitions reach Ollama");
    ok(res.toolCalls[0]?.name === "read_content" && res.toolCalls[0].input.status === "draft" && res.usage.inputTokens === 321, "Ollama's tool call and token counts come back in the gateway's format");

    const wrong = ollamaClient({ url: proxyUrl, token: "w".repeat(40), model: MODEL, timeoutMs: 5000 });
    const refused = await wrong.chat({ system: "", messages: [{ role: "user", content: "hi" }], tools: [] }).then(() => false, (e) => e instanceof ModelUnavailableError);
    ok(refused, "the proxy refuses a request with the wrong token");
    const pull = await fetch(`${proxyUrl}/api/pull`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: "{}" });
    ok(pull.status === 404, "the proxy refuses anything but chat and health, even with the token");

    proxy.close();
    fakeOllama.close();
  }

  console.log(`${checks} agent checks passed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
