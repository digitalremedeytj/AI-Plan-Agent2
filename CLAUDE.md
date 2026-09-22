# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

**AI Plan Agent** (a.k.a. Audience Profile Builder) — a full-stack tool that generates
research-backed audience profiles and CTV-first media plans. React 19 + Vite frontend,
Express backend, Google Gemini with Search Grounding plus OpenAI for validation scoring.

Deployed as a **Google AI Studio applet running on Cloud Run**, which constrains a lot of
what follows.

## Commands

```bash
npm run dev      # Express + Vite middleware on :3000 (NODE_ENV=development)
npm run build    # vite build + esbuild bundle of the server -> dist/
npm start        # production: node dist/server.cjs
npm run lint     # tsc --noEmit
npm test         # node:test suite via tsx
```

There is no watch mode for tests. Run a single file directly:

```bash
npx tsx --test src/storage/localFileAdapter.test.ts
```

### Local setup

**Use Node 22** (`nvm use` — there is an `.nvmrc`). Node 18 does not satisfy this repo's
own dependencies: `@vitejs/plugin-react` requires `^20.19.0 || >=22.12.0`. Production
runs nodejs22, so Node 22 also keeps local and deployed behaviour aligned.

**Use npm**, not bun or pnpm, despite `bun.lock` being tracked alongside
`package-lock.json`. Installing with another package manager is what produces the
failures below.

If the tree is broken, reinstall — **stop any running dev server first**, since this
deletes the tree it is using:

```bash
nvm use
rm -rf node_modules && npm install
```

Three different-looking failures all trace back to an install done on the wrong Node
version or package manager, and all three are fixed by that reinstall:

| Symptom | Cause |
| --- | --- |
| `SyntaxError: Invalid or unexpected token` from `esbuild/bin/esbuild` | a pnpm-style `.bin` shim execs `node` against what is actually a native Mach-O binary |
| `Cannot find native binding` from `@tailwindcss/oxide` | npm's optional-dependency bug skipped the platform package (older npm only) |
| `ERR_INVALID_URL_SCHEME` from tsx loading `vite.config.ts` | tsx 4.22.4 resolving tsconfig `paths` on Node 18 |

## Architecture

```
server.ts               ~3000 lines. All API routes, Gemini/OpenAI orchestration,
                        prompt construction, and static/Vite serving.
src/App.tsx             ~5800 lines. Nearly the entire UI.
src/planning/           Deterministic planning engine + knowledge base
                        (settings, product registry, CTV publishers).
src/storage/            Shared server-side persistence. See below.
src/server/session.ts   Signed-cookie auth, requireAuth / requireAdmin middleware.
src/server/geminiInteractions.ts  Every Gemini text call goes through here (3.8, Interactions API).
src/qa/                 Deterministic chart guardrails applied after the QA scoring and
                        auto-remediation agents. Read the header comment before editing:
                        these run last, so a check that misreads a chart's metric type
                        creates the defect rather than catching it.
src/api/                Typed browser client for the shared store + one-time
                        localStorage migration.
src/components/         Extracted UI (SettingsDrawer, charts, tabs).
documentation/          Technical guides. SHARED_PLANS_AND_SETTINGS.md is the
                        storage/auth reference.
```

`server.ts` and `App.tsx` are large by design of the original codebase. Prefer extending
them in place over speculative refactors, but new subsystems belong in their own module.

## Storage — read this before persisting anything

**Never write application state to the container filesystem.** Cloud Run runs this
service with `minScale 0` / `maxScale 100`: a file written by one instance is invisible
to the next and gone after a redeploy. This was a real bug — settings were stored in
`data/*.json` and silently reverted to defaults on every deploy.

All durable state goes through `StorageAdapter` (`src/storage/types.ts`):

- **`LocalFileAdapter`** — development, writes `data/store/`, no credentials needed.
- **`FirestoreAdapter`** — production, Firestore REST over ADC.
- `createStorage()` auto-selects. `STORAGE_DRIVER=firestore` forces a loud failure
  instead of degrading to a disk that will not persist.

Rules that follow from this:

- **`localStorage` is a display cache only.** It must never be authoritative for plans or
  settings. The one legitimate exception is the media-plan parse cache
  (`media_plan_parsed_cache_*`), which is a performance optimization and safe to lose.
- **Settings are versioned.** Every save writes an immutable
  `settings_revisions/{n}`; each plan pins the revision it was generated against, so a
  later settings change cannot move the numbers under a saved plan. Preserve this.
- **Plan writes are compare-and-swap.** Clients send `If-Match: <revision>`; a stale
  write gets 409. Never add a write path that skips the revision check.
- **Deletes are soft** (`archived: true`). Nothing destroys a plan record.
- Plan payloads are stored as one JSON string field, which sidesteps Firestore's
  no-nested-arrays rule and keeps drivers independent of the app schema. Keep payloads
  under Firestore's 1MB document limit.

## Auth

One shared `TEST_USER`/`TEST_PASSWORD`, plus a per-person **display name** carried in an
HMAC-signed, HTTP-only cookie. The name is what gets recorded on writes — never trust an
actor from a request body.

- All `/api/*` routes require a session except `/api/health` and `/api/auth/*`.
  This matters: the Cloud Run service is public (`invoker-iam-disabled: true`), so an
  unguarded route is open to the internet.
- `ADMIN_PASSWORD` gates global settings writes (`requireAdmin`). If it is unset,
  every signed-in user can write — deliberate, so deploying cannot brick settings.
- `src/server/session.ts` is a thin seam. Swapping in Google Sign-In means changing only
  how a `SessionUser` is produced at login; routes keep calling `getSession()`.

## Deployment

`git push origin main` → pull in AI Studio's GitHub panel → **Publish** to Cloud Run.

- AI Studio reporting **"in sync"** only means it matches GitHub. Unpushed local work
  will not deploy, and publishing then ships the old code.
- Verify every deploy: `curl -s <url>/api/health` must report
  `"storageDriver":"firestore"`. `local-file` in production means plans are not shared
  and will be lost.
- **Avoid adding npm dependencies.** The AI Studio buildpack resolves them at deploy
  time, and a failure there is slow to diagnose. The Firestore layer deliberately uses
  `fetch` + `node:crypto` rather than `@google-cloud/firestore` for exactly this reason.
  Prefer the same approach for new integrations.

Environment variables are set in the AI Studio **Secrets** panel; see `.env.example` for
the full list and what each does.

## Testing

`node:test` + `node:assert/strict`, executed through `tsx`. No Jest, no Vitest, no jsdom
— component tests exercise pure logic, and browser APIs are hand-stubbed where needed
(see `src/api/migrateLocalPlans.test.ts` for the `Storage` stand-in pattern).

Test names state the behaviour being protected, not the function being called:

```ts
test("a stale revision is rejected instead of clobbering the other writer", ...)
```

## Gotchas

- **Node 22 everywhere.** `.nvmrc` pins it and production runs nodejs22. Node 18
  appears to work until the dev server or a build fails confusingly - see Local setup.
- **Two dev servers in this folder collide** on Vite's HMR port 24678. Harmless, but the
  WebSocket errors in the console are a red herring.
- **Never run the Vite dev server in production.** `init()` in `server.ts` guards this;
  it is far heavier than static serving and an OOM kill severs SSE mid-request.
- **`data/` is gitignored** local development state. `data/planning-settings.json` and
  `data/ctv-publishers.json` are orphaned leftovers from the pre-Firestore design and are
  read by nothing.
- **Custom publisher logos are data URLs**, not files under `/assets/pub-logos/` — a disk
  write would vanish on redeploy. Bundled default logos are still real files in git.

## Conventions

- Comments explain **why**, not what, and match the density of surrounding code. The
  existing codebase comments non-obvious decisions and constraints; follow that.
- Match the style of the file you are editing rather than importing outside idioms.
- Prefer server-authoritative behaviour. When in doubt about where state should live, it
  is the server — that is the theme of this codebase's hardest-won bugs.
