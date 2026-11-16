# Fortitudo Core

One shared backend for every Fortitudo face: one database, one agent, one login.

- `apps/core` — the Next.js app: the front door PWA (chat, drafts), the agent gateway at `POST /api/agent`, and `/admin`.
- `packages/tokens` — the shared design tokens. Edit `src/index.ts`, then run `pnpm --filter @fortitudo/tokens build` to regenerate `tokens.css`.

## Rules that hold everywhere

- No Liberty client data in this repo or its database, and no tool that can read it.
- The agent saves drafts. Only the owner publishes.
- Secrets live in environment variables (see `apps/core/.env.example`), never in the repo.

## Deploying (Vercel)

1. Import this repo in Vercel with **Root Directory** set to `apps/core`.
2. Add a Neon database from the Vercel Storage tab. It sets `DATABASE_URL`.
3. Set `AUTH_SECRET`, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET` and `OWNER_EMAIL`.
4. For the agent, set `AGENT_MODEL`, `AGENT_MODEL_URL` and `AGENT_MODEL_TOKEN` once your PC is serving the model (see `tools/local-model/SETUP.md`). Until then the agent refuses every request and logs the refusal.
5. Deploy. The build applies migrations and the seed before building the app.

## The agent gateway

The agent's model is Gert's own: an open-weight model served by Ollama on his PC, reached through a Tailscale tunnel and a token-checked proxy (`tools/local-model`). No model vendor is involved and nothing is billed per message. A request returns at once with a run id; the run works in the background and the front door polls `GET /api/agent/runs/:id` for the reply.

- Every tool has a permission tier. The gateway runs tier 0 (read) and tier 1 (do and log) only, and checks the tier in code before any tool runs. There is no publish tool.
- Tools today: `read_content` (tier 0) and `save_draft` (tier 1). Neither can reach leads or any other table.
- `brand_root` is loaded into the instructions before every run. Without it the agent does not run.
- At most 8 tool steps per request. Past the daily request cap (default 100) the agent answers but takes no actions; past twice the cap it stops calling the model.
- Every request, including refused ones, is a row in `agent_runs` with its tools, tier, outcome, reply and token counts.

## The front desk setting

The chat screen has a **Front desk setting**: the https address of the front-desk service on Gert's laptop (published with Tailscale Serve). It is saved in this browser only.

- Set: replies stream from the front desk, which can hand work to the slow agents and report status. Empty: the chat uses the core's own agent, as before.
- Only `https://` addresses are accepted (the front door is https, so browsers block calls to plain http), plus `http://127.0.0.1` for local work.
- The front door checks `/health` every 15 s. When the laptop is closed or unreachable it shows **Front desk offline** and stops sending. It never falls back silently to a different agent.
- The status board reads from the core (`/api/jobs`, `/api/drafts`), never from the front desk, so it stays readable when the laptop is off. It needs the job queue API.
## The job queue

The front desk (a small model on Gert's laptop) hands work to slower agents through a queue in this database. Two service tokens, each opening only its own routes; both are refused while unset.

| Route | Caller | What it does |
|---|---|---|
| `POST /api/jobs` `{agent, task}` | front desk | Creates a queued job. `agent` is `glm`, `content` or `helper`. Returns `{id}`. |
| `GET /api/jobs?status=` | front desk, worker, owner | The 50 most recent jobs, oldest first. |
| `GET /api/jobs/:id` | front desk, worker, owner | One job with its result and draft id. |
| `GET /api/drafts?status=pending` | front desk, owner | Content items still in the draft state. |
| `POST /api/jobs/claim` `{agents?}` | worker | Atomically takes the oldest queued job and marks it running. |
| `POST /api/drafts` `{project, title, body, type?}` | worker | Saves what an agent wrote as a **draft** (never approved or published) with an agent revision. Returns `{id}` to attach to the job. |
| `PATCH /api/jobs/:id` `{status, result?, draftId?}` | worker | Finishes a running job as `done` or `failed`. |

- A job is `queued`, then `running`, then `done` or `failed`. Nothing skips a step or finishes twice.
- A task that looks like a file path, a client folder or an ID number is refused. Client detail never goes into a job.
- Nothing here publishes or deletes. A draft a job produces stays a draft until the owner approves it.
- Set `FRONTDESK_TOKEN` and `WORKER_TOKEN` in Vercel. Calls from outside a browser to a `*.vercel.app` URL also need Vercel's deployment-protection bypass, or a custom domain.

## Local checks

```
pnpm install
pnpm --filter @fortitudo/core db:verify   # migrations, seed, schema rules, agent guard rails and the PC proxy, all offline
pnpm typecheck
```
