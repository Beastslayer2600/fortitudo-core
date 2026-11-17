// Checks POST /api/local-ai: the token rule, the body rules and the date rules.
// The database write is a stub that only counts calls. No database, no network.
import { closedAt, handleLocalAi, methodNotAllowed, validDate } from "../src/local-ai/closed-case";

function check(label: string, ok: boolean) {
  if (!ok) throw new Error(`FAILED: ${label}`);
  console.log(`ok    ${label}`);
}

const TOKEN = "test-token-not-a-real-secret";
const NOW = new Date("2026-11-17T10:00:00Z"); // 12:00 in South Africa

let writes: Date[] = [];
const record = async (at: Date) => {
  writes.push(at);
};

async function call(opts: { auth?: string | null; body?: unknown; raw?: string; record?: typeof record } = {}) {
  writes = [];
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.auth !== null) headers.authorization = opts.auth ?? `Bearer ${TOKEN}`;
  const req = new Request("https://example.test/api/local-ai", {
    method: "POST",
    headers,
    body: opts.raw ?? JSON.stringify("body" in opts ? opts.body : { count: 1, date: "2026-11-17" }),
  });
  const res = await handleLocalAi(req, opts.record ?? record, NOW);
  return { status: res.status, redirected: res.headers.has("location"), json: await res.json().catch(() => null) };
}

async function main() {
  process.env.LOCAL_AI_SERVICE_TOKEN = TOKEN;

  // Auth first: a bad caller learns nothing and nothing is written.
  for (const [label, auth] of [
    ["no Authorization header", null],
    ["wrong token", "Bearer nope"],
    ["wrong scheme", `Basic ${TOKEN}`],
    ["empty bearer", "Bearer "],
  ] as const) {
    const r = await call({ auth });
    check(`401 for ${label}`, r.status === 401 && writes.length === 0);
  }
  const unreadable = await call({ auth: null, raw: "not json" });
  check("401 (not 400) for no token and a broken body: auth is checked before the body", unreadable.status === 401);

  delete process.env.LOCAL_AI_SERVICE_TOKEN;
  check("401 for every request while the token is unset", (await call()).status === 401 && writes.length === 0);
  process.env.LOCAL_AI_SERVICE_TOKEN = TOKEN;

  // Body rules.
  const badBodies: [string, unknown][] = [
    ["extra field", { count: 1, date: "2026-11-17", note: "x" }],
    ["missing date", { count: 1 }],
    ["missing count", { date: "2026-11-17" }],
    ["count 2", { count: 2, date: "2026-11-17" }],
    ["count 0", { count: 0, date: "2026-11-17" }],
    ["count as a string", { count: "1", date: "2026-11-17" }],
    ["date not a string", { count: 1, date: 20261117 }],
    ["date with a time", { count: 1, date: "2026-11-17T10:00:00Z" }],
    ["not a real date (Feb 30)", { count: 1, date: "2026-02-30" }],
    ["not a real date (month 13)", { count: 1, date: "2026-13-01" }],
    ["tomorrow", { count: 1, date: "2026-11-18" }],
    ["over a year old", { count: 1, date: "2025-11-01" }],
    ["array body", [{ count: 1, date: "2026-11-17" }]],
    ["null body", null],
  ];
  for (const [label, body] of badBodies) {
    const r = await call({ body });
    check(`400 for ${label}`, r.status === 400 && writes.length === 0);
  }
  check("400 for a body that is not JSON", (await call({ raw: "not json" })).status === 400 && writes.length === 0);

  // Good requests.
  const ok = await call();
  check("200 {ok:true} for today, one write, no redirect", ok.status === 200 && ok.json?.ok === true && !ok.redirected && writes.length === 1);
  check("stored as the posted date at 14:00 GMT+2", writes[0].toISOString() === "2026-11-17T12:00:00.000Z");
  check("oldest allowed date (366 days back) accepted", (await call({ body: { count: 1, date: "2025-11-16" } })).status === 200);
  check("stored time for another date", closedAt("2026-03-05").toISOString() === "2026-03-05T12:00:00.000Z");

  // South African "today" decides what is the future: 00:30 SAST is still the 17th in UTC.
  check("date is judged in South African time",
    validDate("2026-11-18", new Date("2026-11-17T22:30:00Z")) && !validDate("2026-11-18", NOW));

  // A failing write is a 500 that says nothing about why.
  const boom = await call({ record: async () => { throw new Error("secret detail"); } });
  check("500 when the write fails, error text not leaked", boom.status === 500 && !JSON.stringify(boom.json).includes("secret"));

  const na = methodNotAllowed();
  check("405 with Allow: POST", na.status === 405 && na.headers.get("allow") === "POST");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
