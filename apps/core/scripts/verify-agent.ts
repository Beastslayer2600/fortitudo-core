// Checks the agent gateway's guard rails on an in-memory Postgres with a
// scripted fake model. No network, no API key, no spend.
import type Anthropic from "@anthropic-ai/sdk";
import { PGlite } from "@electric-sql/pglite";
import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import {
  HARD_STOP_MULTIPLE,
  MAX_TOOL_STEPS,
  runAgent,
  startOfDaySast,
  type ModelClient,
} from "../src/agent/gateway";
import { TOOLS, type AgentTool } from "../src/agent/tools";
import { agentRuns, contentItems, contentRevisions, projects } from "../src/db/schema";
import { seed } from "../src/db/seed-data";

const MODEL = "claude-sonnet-5-5";
let checks = 0;
function ok(cond: unknown, label: string) {
  if (!cond) throw new Error(`FAILED: ${label}`);
  checks++;
  console.log(`ok    ${label}`);
}

type Step = { tools?: { name: string; input: Record<string, unknown> }[]; text?: string };

// A fake model that plays back a script and records every request it gets.
function scripted(steps: Step[] | ((i: number) => Step)) {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const client: ModelClient = {
    async create(params) {
      calls.push(structuredClone(params));
      const i = calls.length - 1;
      const step = typeof steps === "function" ? steps(i) : (steps[i] ?? { text: "done" });
      const content: Anthropic.ContentBlock[] = [];
      if (step.text) content.push({ type: "text", text: step.text, citations: null } as Anthropic.TextBlock);
      (step.tools ?? []).forEach((t, n) =>
        content.push({ type: "tool_use", id: `tu_${i}_${n}`, name: t.name, input: t.input } as Anthropic.ToolUseBlock),
      );
      return {
        id: `msg_${i}`,
        type: "message",
        role: "assistant",
        model: params.model,
        content,
        stop_reason: step.tools?.length ? "tool_use" : "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 1000, output_tokens: 200 },
      } as unknown as Anthropic.Message;
    },
  };
  return { client, calls };
}

function toolResults(params: Anthropic.MessageCreateParamsNonStreaming) {
  const last = params.messages[params.messages.length - 1];
  return Array.isArray(last.content) ? (last.content as Anthropic.ToolResultBlockParam[]) : [];
}

async function main() {
  const db = drizzle(new PGlite());
  await migrate(db, { migrationsFolder: "./drizzle" });
  await seed(db, "owner@example.com");
  const base = { db, modelName: MODEL, ceilingUsd: 5 };

  // 1. brand_root loads before the run; a draft is saved and logged.
  {
    const m = scripted([
      { tools: [{ name: "save_draft", input: { project: "advising", type: "guide", slug: "tax-free-savings", title: "Tax-free savings", body: "# Draft" } }] },
      { text: "Saved a draft for you to review." },
    ]);
    const r = await runAgent({ ...base, model: m.client }, { face: "front-door", message: "Draft a guide on tax-free savings" });
    const system = String(m.calls[0].system);
    ok(system.includes("Strength to build it, patience to keep it."), "brand_root is in the instructions of the first model call");
    ok(r.reply === "Saved a draft for you to review.", "the agent's reply comes back");
    const [item] = await db.select().from(contentItems).where(eq(contentItems.slug, "tax-free-savings"));
    ok(item?.status === "draft", "save_draft creates the item as a draft");
    const revs = await db.select().from(contentRevisions).where(eq(contentRevisions.contentItemId, item.id));
    ok(revs.length === 1 && revs[0].author === "agent", "the draft has a first revision by the agent");
    const [run] = await db.select().from(agentRuns).where(eq(agentRuns.id, r.runId));
    ok(run.outcome === "answered" && run.tier === 1 && run.face === "front-door", "the run is logged with outcome, tier and face");
    ok(run.costUsd > 0 && run.inputTokens === 2000 && run.outputTokens === 400, "the run's tokens and cost are logged");
    ok(!m.calls[0].tools?.some((t) => "name" in t && t.name.includes("publish")), "no publish tool is offered to the model");
  }

  // 2. A publish tool the model invents is refused; nothing is published.
  {
    const [item] = await db.select().from(contentItems).where(eq(contentItems.slug, "tax-free-savings"));
    const m = scripted([{ tools: [{ name: "publish_content", input: { id: item.id } }] }, { text: "I can't publish." }]);
    const r = await runAgent({ ...base, model: m.client }, { face: "front-door", message: "Publish it" });
    ok(r.toolsCalled[0]?.allowed === false, "an unknown tool (publish_content) is refused by the gateway");
    ok(toolResults(m.calls[1])[0]?.is_error === true, "the model is told the call was refused");
    const [after] = await db.select().from(contentItems).where(eq(contentItems.id, item.id));
    ok(after.status === "draft", "the item is still a draft");
  }

  // 3. A tool above tier 1 is refused in code even if it is registered and offered.
  {
    let ran = false;
    const tierTwo: AgentTool = {
      name: "publish_now",
      tier: 2,
      definition: { name: "publish_now", description: "test only", input_schema: { type: "object", properties: {} } },
      async run() {
        ran = true;
        return {};
      },
    };
    const m = scripted([{ tools: [{ name: "publish_now", input: {} }] }, { text: "ok" }]);
    const r = await runAgent({ ...base, model: m.client, tools: [...TOOLS, tierTwo] }, { face: "front-door", message: "x" });
    ok(!ran && r.toolsCalled[0]?.allowed === false && r.toolsCalled[0]?.tier === 2, "a registered tier-2 tool is refused and never runs");
    ok(!m.calls[0].tools?.some((t) => "name" in t && t.name === "publish_now"), "tier-2 tools are not even offered");
  }

  // 4. save_draft cannot touch an approved or published item.
  {
    const [p] = await db.select().from(projects).where(eq(projects.slug, "advising"));
    const [live] = await db.insert(contentItems).values({ projectId: p.id, type: "guide", slug: "live-guide", title: "Live", body: "v1" }).returning();
    await db.update(contentItems).set({ status: "approved" }).where(eq(contentItems.id, live.id));
    await db.update(contentItems).set({ status: "published" }).where(eq(contentItems.id, live.id));
    const m = scripted([{ tools: [{ name: "save_draft", input: { id: live.id, title: "Hacked", body: "v2" } }] }, { text: "ok" }]);
    const r = await runAgent({ ...base, model: m.client }, { face: "front-door", message: "Edit the live guide" });
    const [after] = await db.select().from(contentItems).where(eq(contentItems.id, live.id));
    ok(after.title === "Live" && after.body === "v1" && r.toolsCalled[0]?.ok === false, "save_draft refuses to change a published item");
  }

  // 5. The tool step cap stops a looping run.
  {
    const m = scripted((i) => (i < 50 ? { tools: [{ name: "read_content", input: {} }] } : { text: "stop" }));
    const r = await runAgent({ ...base, model: m.client }, { face: "front-door", message: "loop" });
    const ran = r.toolsCalled.filter((t) => t.allowed).length;
    ok(ran === MAX_TOOL_STEPS, `only ${MAX_TOOL_STEPS} tool steps run in one request (ran ${ran})`);
    const lastCall = m.calls[m.calls.length - 1];
    ok(lastCall.tool_choice?.type === "none", "after the cap the model is asked to answer without tools");
    ok(m.calls.length <= MAX_TOOL_STEPS + 2, `the run ends (model called ${m.calls.length} times)`);
  }

  // 6. Spend ceiling: unset means no run; past it, answers only; past the hard stop, nothing.
  {
    const m0 = scripted([{ text: "hi" }]);
    const r0 = await runAgent({ ...base, ceilingUsd: undefined, model: m0.client }, { face: "front-door", message: "hi" });
    ok(m0.calls.length === 0 && r0.outcome.startsWith("refused"), "with no ceiling set the model is never called");

    const m00 = scripted([{ text: "hi" }]);
    const r00 = await runAgent({ ...base, model: null }, { face: "front-door", message: "hi" });
    ok(m00.calls.length === 0 && r00.outcome === "refused: no model configured", "with no model configured the run is refused and logged");

    const ceiling = 0.5;
    await db.insert(agentRuns).values({ face: "test", request: "spend", costUsd: ceiling, createdAt: new Date() });
    const m1 = scripted([{ tools: [{ name: "save_draft", input: { project: "advising", type: "guide", slug: "over", title: "t", body: "b" } }] }, { text: "ok" }]);
    const r1 = await runAgent({ ...base, ceilingUsd: ceiling, model: m1.client }, { face: "front-door", message: "draft" });
    ok(!m1.calls[0].tools?.length, "past the ceiling no tools are offered");
    const [over] = await db.select().from(contentItems).where(eq(contentItems.slug, "over"));
    ok(!over && r1.toolsCalled.every((t) => !t.allowed), "past the ceiling no action runs, even if the model asks");

    await db.insert(agentRuns).values({ face: "test", request: "spend", costUsd: ceiling * HARD_STOP_MULTIPLE, createdAt: new Date() });
    const m2 = scripted([{ text: "hi" }]);
    const r2 = await runAgent({ ...base, ceilingUsd: ceiling, model: m2.client }, { face: "front-door", message: "hi" });
    ok(m2.calls.length === 0 && r2.outcome === "refused: daily hard stop", `past ${HARD_STOP_MULTIPLE}x the ceiling the model is not called`);

    const lateEvening = startOfDaySast(new Date("2026-11-11T21:30:00Z")).toISOString(); // 23:30 SAST
    const pastMidnight = startOfDaySast(new Date("2026-11-11T22:30:00Z")).toISOString(); // 00:30 SAST next day
    ok(lateEvening === "2026-11-10T22:00:00.000Z" && pastMidnight === "2026-11-11T22:00:00.000Z", "the spend day starts at midnight South African time");
  }

  // 7. Every run above was logged.
  const runs = await db.select().from(agentRuns).orderBy(desc(agentRuns.createdAt));
  ok(runs.filter((r) => r.face === "front-door").length === 9, "every front-door run, refused or not, has a row in agent_runs");
  ok(runs.every((r) => r.outcome !== "running"), "no run is left unfinished");

  console.log(`${checks} agent checks passed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
