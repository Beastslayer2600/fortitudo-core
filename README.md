# Fortitudo Core

One shared backend for every Fortitudo face: one database, one agent, one login.

- `apps/core` — the Next.js app (core API, admin page, and from Phase 2 the front door PWA).
- `packages/tokens` — shared design tokens and signature (filled in Phase 2).

## Rules that hold everywhere

- No Liberty client data in this repo or its database, and no tool that can read it.
- The agent saves drafts. Only the owner publishes.
- Secrets live in environment variables (see `apps/core/.env.example`), never in the repo.

## Deploying (Vercel)

1. Import this repo in Vercel with **Root Directory** set to `apps/core`.
2. Add a Neon database from the Vercel Storage tab. It sets `DATABASE_URL`.
3. Set `AUTH_SECRET`, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET` and `OWNER_EMAIL`.
4. Deploy. The build applies migrations and the seed before building the app.

## Local checks

```
pnpm install
pnpm --filter @fortitudo/core db:verify   # migrations + seed + schema rules on an in-memory Postgres
pnpm typecheck
```
