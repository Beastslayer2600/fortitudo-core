// Checks the front desk helpers the chat screen relies on: which addresses the
// setting accepts, how the stream is read, and how tool results are shown.
// No network.
import { normalizeBaseUrl, parseSseChunk, toolNote } from "../src/lib/frontdesk";

function check(label: string, ok: boolean) {
  if (!ok) throw new Error(`FAILED: ${label}`);
  console.log(`ok    ${label}`);
}

// The setting: https only (the front door is https), plus http on this machine.
check("https tailnet address accepted", normalizeBaseUrl("https://laptop.tail1234.ts.net") === "https://laptop.tail1234.ts.net");
check("trailing slash and path reduced to the origin", normalizeBaseUrl("https://laptop.tail1234.ts.net/chat/") === "https://laptop.tail1234.ts.net");
check("whitespace is trimmed", normalizeBaseUrl("  https://a.ts.net  ") === "https://a.ts.net");
check("plain http to another host refused (browsers block it)", normalizeBaseUrl("http://laptop.ts.net") === null);
check("http on localhost allowed for local work", normalizeBaseUrl("http://127.0.0.1:8787") === "http://127.0.0.1:8787");
check("credentials in the address refused", normalizeBaseUrl("https://user:pw@a.ts.net") === null);
check("not a url refused", normalizeBaseUrl("laptop") === null);
check("javascript: refused", normalizeBaseUrl("javascript:alert(1)") === null);

// The stream: events split across chunks are held until complete.
const a = parseSseChunk('data: {"type":"token","text":"Hel"}\n\ndata: {"type":"tok');
check("one complete event read, partial kept", a.events.length === 1 && a.events[0]?.type === "token" && a.rest.startsWith("data: {"));
const b = parseSseChunk(a.rest + 'en","text":"lo"}\n\ndata: {"type":"done"}\n\n');
check("partial completes on the next chunk", b.events.length === 2 && b.events[0]?.type === "token" && b.events[1]?.type === "done" && b.rest === "");
check("a malformed event is skipped", parseSseChunk("data: {nope\n\ndata: {\"type\":\"done\"}\n\n").events.length === 1);

// Tool results shown in the chat.
const ok = toolNote("hand_off", { id: "abc" });
check("hand_off shows the job id", ok.ok && ok.note === "abc");
const bad = toolNote("hand_off", { error: "task looks like a file path" });
check("a refused hand_off shows as failed", !bad.ok && /file path/.test(bad.note ?? ""));
check("get_status is ok without a note", toolNote("get_status", { queued: [] }).ok);
