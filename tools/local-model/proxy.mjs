// Fortitudo model proxy. Runs on Gert's PC in front of Ollama.
//
// It accepts only two requests, and only with the secret token:
//   POST /api/chat   forwarded to Ollama
//   GET  /health     says whether Ollama is up
// Everything else is refused, so the tunnel never exposes Ollama itself
// (no model downloads, deletes or other admin calls from outside).
//
// Needs Node 18 or newer. No packages to install.
//   set AGENT_MODEL_TOKEN=<the same secret as in Vercel>
//   node proxy.mjs

import { createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

const TOKEN = process.env.AGENT_MODEL_TOKEN ?? "";
const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "127.0.0.1";
const OLLAMA = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";
const MAX_BODY = 2 * 1024 * 1024;

if (TOKEN.length < 32) {
  console.error("Set AGENT_MODEL_TOKEN to a random secret of at least 32 characters (the same value as in Vercel).");
  process.exit(1);
}

const digest = (s) => createHash("sha256").update(s).digest();
const expected = digest(`Bearer ${TOKEN}`);
const authorized = (req) => timingSafeEqual(digest(req.headers.authorization ?? ""), expected);

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export const server = createServer(async (req, res) => {
  const started = Date.now();
  const path = new URL(req.url ?? "/", "http://x").pathname;
  const log = (status) => console.log(`${new Date().toISOString()} ${req.method} ${path} ${status} ${Date.now() - started}ms`);

  if (!authorized(req)) {
    log(401);
    return send(res, 401, { error: "unauthorized" });
  }

  try {
    if (req.method === "GET" && path === "/health") {
      const up = await fetch(`${OLLAMA}/api/tags`).then((r) => r.ok).catch(() => false);
      log(up ? 200 : 503);
      return send(res, up ? 200 : 503, { ollama: up ? "up" : "down" });
    }
    if (req.method === "POST" && path === "/api/chat") {
      const body = await readBody(req);
      const upstream = await fetch(`${OLLAMA}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
      const text = await upstream.text();
      log(upstream.status);
      res.writeHead(upstream.status, { "content-type": "application/json" });
      return res.end(text);
    }
    log(404);
    return send(res, 404, { error: "not found" });
  } catch (err) {
    log(502);
    return send(res, 502, { error: `ollama: ${err.message}` });
  }
});

if (process.env.PROXY_NO_LISTEN !== "1") {
  server.listen(PORT, HOST, () => console.log(`Fortitudo model proxy on http://${HOST}:${PORT} -> ${OLLAMA}`));
}
