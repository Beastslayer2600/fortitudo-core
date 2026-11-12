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
4. For the agent, set `AGENT_MODEL`, `ANTHROPIC_API_KEY` and `AGENT_DAILY_CEILING_USD`. Until all three are set the agent refuses every request (and logs the refusal).
5. Deploy. The build applies migrations and the seed before building the app.

## The agent gateway

- Every tool has a permission tier. The gateway runs tier 0 (read) and tier 1 (do and log) only, and checks the tier in code before any tool runs. There is no publish tool.
- Tools today: `read_content` (tier 0) and `save_draft` (tier 1). Neither can reach leads or any other table.
- `brand_root` is loaded into the instructions before every run. Without it the agent does not run.
- At most 8 tool steps per request. Past the daily spend ceiling the agent answers but takes no actions; past twice the ceiling it stops calling the model.
- Every request, including refused ones, is a row in `agent_runs` with its tools, tier, outcome, tokens and cost.

## Local checks

```
pnpm install
pnpm --filter @fortitudo/core db:verify   # migrations, seed, schema rules and agent guard rails on an in-memory Postgres
pnpm typecheck
```
