# Shared Plans and Settings

How saved plans and global settings are stored, why the previous design could not work
on Cloud Run, and the steps needed to finish the deployment.

---

## What changed and why

### Before

**Plans were never on the server.** `savedProfiles` lived in `localStorage` under
`audience_builder_saved_profiles`. A plan saved on one laptop was invisible everywhere
else, and clearing site data destroyed it. There was no `/api/plans` route at all.

**Settings were on the server, but on storage that cannot hold them.**
`data/planning-settings.json` and `data/ctv-publishers.json` were written to
`process.cwd()` inside the container. The deployed service runs with:

| Setting | Value | Consequence |
| --- | --- | --- |
| `autoscaling.knative.dev/minScale` | `0` | scales to zero; the disk goes with it |
| `autoscaling.knative.dev/maxScale` | `100` | instances disagree about "the" settings |
| `run.googleapis.com/sessionAffinity` | `true` | masked the problem, best-effort only |
| `run.googleapis.com/invoker-iam-disabled` | `true` | the service is public |

`data/` is not in git, so every fresh container booted with **defaults** and wrote them
back. A redeploy silently reverted settings.

There was also a corruption path: the client seeded settings from `localStorage`, then
overwrote that state with whatever the server returned on mount. A fresh instance
answering with defaults would overwrite good settings in a live tab, and the next save
pushed those defaults up as the shared truth.

Three smaller problems in the same family:

- **The login was a client-side gate only.** `/api/auth/login` compared credentials, but
  no API route checked anything. Every endpoint, including the expensive AI ones, was
  reachable by anyone with the URL.
- **Any user could rewrite global settings** from the header menu. No role check.
- **Plans snapshotted `planningSettings` on save but never restored it.** An old plan
  re-rendered against today's settings, so its numbers could shift under it.

### After

Plans and settings live in **Firestore**, shared by everyone and surviving redeploys.
The container filesystem is no longer a store. The browser keeps no authoritative copy.

---

## Architecture

```
src/storage/
  types.ts              StorageAdapter contract, records, typed errors
  localFileAdapter.ts   development driver (data/store/), no credentials needed
  firestoreAdapter.ts   production driver, Firestore REST over ADC
  firestoreValue.ts     Firestore typed-value encode/decode
  googleAuth.ts         access tokens from the metadata server or a service-account key
  index.ts              createStorage() driver selection

src/server/session.ts   signed HTTP-only session cookie, auth + admin middleware
src/api/client.ts       typed browser client for the shared store
src/api/migrateLocalPlans.ts  one-time import of pre-existing localStorage plans
```

**No new npm dependencies.** The Firestore driver talks to the REST API using `fetch`
and mints tokens with `node:crypto`, so the AI Studio buildpack has nothing new to
resolve on deploy.

### Firestore layout

| Path | Contents |
| --- | --- |
| `plans/{id}` | plan metadata as real fields, plus `payloadJson` (the plan body as one JSON string) |
| `plans/{id}/versions/{vid}` | version history checkpoints of that plan, same shape (see below) |
| `settings/current` | the live planning settings and their revision number |
| `settings_revisions/{n}` | immutable settings history, referenced by each plan |
| `publishers/current` | the live CTV publisher list |
| `scout_logs/{id}` | one ScoutAI question and answer each, as `body` (JSON string) plus filter fields; expires via TTL on `expireAt` (see ANALYTICS.md) |

Payloads are stored as a **JSON string**, not a Firestore map. That sidesteps Firestore's
no-nested-arrays rule (chart data hits it) and keeps the storage layer independent of the
app's evolving schema. Listing uses a field mask that excludes `payloadJson`, so the plan
sidebar never downloads payloads.

### Concurrency

Every plan write is compare-and-swap. Clients send the revision they last read as
`If-Match`; the Firestore driver additionally pins the document's `updateTime`. A save
against a stale revision returns **409** with the current revision, and the UI tells the
user to reload rather than overwriting a colleague's work.

### Auto-save and version history

An open plan saves itself about 1.5s after each edit (`queueAutoSave` in `App.tsx`), one save
at a time, against the revision it last read. It writes the workspace's profile onto the plan
as last saved; the brief form is not included, so filling it in for the next run never
rewrites the open plan. A 409 stops auto-save and offers a reload. Share links read the plan
itself, so a client's link shows the latest saved edits.

Because there is no "unsaved" state to back out of, every write path checkpoints first
(`src/storage/planHistory.ts`). A checkpoint holds the plan as it stood *before* that write:

- `editing`: at most one per 15 minutes of saves.
- `scout`, `qa_fixes`, `recap`, `restore`: always, before those bigger changes.
- `original`: the plan as generation or its first save created it.

The oldest checkpoint and the newest 20 are kept; the rest are deleted (checkpoints are the one
thing pruned - plan records are still never destroyed). Each is about the size of the plan,
0.4-0.5 MB. A checkpoint that fails to write is logged and never blocks the save. Restoring a
version writes it back as the plan's newest revision, checkpointing the current plan first, so
a restore can be undone.

### Settings revisions

Each settings save writes a new immutable `settings_revisions/{n}` document and advances
`settings/current`. A plan records the revision it was generated against, and opening it
loads that revision. **A settings change can no longer move the numbers under a plan
somebody already saved.** Plans imported from the old localStorage store fall back to the
`planningSettings` snapshot embedded in their payload.

---

## API

All routes require a session cookie except `/api/health` and `/api/auth/*`.

| Method | Route | Notes |
| --- | --- | --- |
| `GET` | `/api/health` | reports the active storage driver - use this to verify a deploy |
| `POST` | `/api/auth/login` | `{username, password, displayName, adminPassword?}` |
| `GET` | `/api/auth/me` | current user; replaces the localStorage timestamp |
| `POST` | `/api/auth/logout` | clears the cookie |
| `GET` | `/api/plans` | metadata only; `?includeArchived=true` to see archived |
| `GET` | `/api/plans/:id` | full plan with payload |
| `POST` | `/api/plans` | server assigns id, author, timestamps, `revision: 1` |
| `PUT` | `/api/plans/:id` | requires `If-Match: <revision>`; 409 on conflict, 428 if absent |
| `DELETE` | `/api/plans/:id` | soft delete (archive) - never destroys the record |
| `POST` | `/api/plans/:id/restore` | un-archive |
| `GET` | `/api/plans/:id/versions` | version history checkpoints, newest first, without payloads |
| `POST` | `/api/plans/:id/versions/:versionId/restore` | requires `If-Match`; puts that version back as the newest revision |
| `GET` | `/api/settings` | any signed-in user |
| `GET` | `/api/settings/revisions/:n` | historical revision, for opening old plans |
| `PUT` | `/api/settings` | **admin only** once `ADMIN_PASSWORD` is set |
| `POST` | `/api/settings/reset` | **admin only** |
| `GET`/`PUT` | `/api/ctv-publishers` | read: any user; write: **admin only** |
| `POST` | `/api/ctv-publishers/upload-logo` | **admin only**; returns a data URL (see below) |

### Identity and roles

The app is still behind one shared `TEST_USER` / `TEST_PASSWORD`, but each person types a
**display name** at login. That name rides in an HMAC-signed, HTTP-only cookie and is
what gets recorded on plan writes - it is never trusted from a request body.

Supplying `ADMIN_PASSWORD` at login grants the right to edit global settings. Non-admins
get a fully read-only settings drawer.

#### How to sign in

**There is no separate admin account.** Admin is a flag on your session, not a different
identity, so everyone uses the same credentials:

| Field | What to enter |
| --- | --- |
| Your Name | your real name, e.g. `TJ Pascal` - this is stamped on every plan you save |
| Username | the shared `TEST_USER` |
| Password | the shared `TEST_PASSWORD` |
| Administrator Password | `ADMIN_PASSWORD` - only if you need to edit global settings |

The administrator field is hidden until you click **"Sign in as an administrator"** below
the password box. Leave it blank for a normal session.

This is the point of the split: the regular credentials can go to the whole team, while
`ADMIN_PASSWORD` stays with whoever owns the planning configuration.

Notes:

- A wrong administrator password rejects the **entire** login with a 401, rather than
  quietly downgrading you to a normal session. If you see "Invalid administrator
  password", the rest of your credentials were fine.
- Sessions last 30 days from sign-in, admin status included. A Google sign-in re-checks
  `ADMIN_EMAILS` and the people directory each time the app loads.
- Anyone with plans saved in a browser from before this change should **sign in once on
  that machine**. Their local plans import into the shared workspace automatically on
  first sign-in. Until they do, those plans stay stranded in that browser. The original
  localStorage entry is backed up, not deleted.

> If `ADMIN_PASSWORD` is not configured, every signed-in user can still edit settings.
> That is exactly the previous behaviour, so adding sessions cannot brick settings
> editing on first deploy. **Setting `ADMIN_PASSWORD` is what actually locks it down.**

`src/server/session.ts` is a deliberately thin seam: moving to Google Sign-In later means
changing only how a `SessionUser` is produced at login. Every route keeps calling
`getSession()`.

---

## Deployment

> **Status: deployed and verified in production on 2026-09-10.**
> `/api/health` returns `{"ok":true,"storageDriver":"firestore","shared":true,
> "adminPasswordConfigured":true}`, and cross-device plan sharing was confirmed on two
> machines. **The steps below are already done** - they are recorded so the setup can be
> audited, reproduced in another environment, or repaired if something is changed.

### As-deployed configuration

| Item | Value |
| --- | --- |
| GCP project | display name `ai-api-project`, ID `ai-api-project-465519`, number `119508685311` |
| Cloud Run service | `ai-plan-agent`, region `us-east1` |
| Runtime service account | `ai-plan-agent-runner@ai-api-project-465519.iam.gserviceaccount.com` |
| IAM role granted | `roles/datastore.user` (Cloud Datastore User) |
| Firestore database | `(default)`, Standard edition, Native mode, `us-east1`, restrictive rules |
| Secrets set in AI Studio | `STORAGE_DRIVER=firestore`, `ADMIN_PASSWORD`, `SESSION_SECRET` |

Note the project **ID** (`ai-api-project-465519`) differs from the display name
(`ai-api-project`). APIs want the ID.

### Setup steps (already completed)

All of this happens in the `ai-api-project` GCP console. The code needs no further
changes; it picks the Firestore driver up automatically.

### 1. Create the Firestore database

Console → Firestore → Create database:

| Field | Value |
| --- | --- |
| Database ID | `(default)` |
| Edition | Standard |
| Mode | Firestore in Native mode |
| Security rules | Restrictive (deny all) |
| Location | Region, `us-east1` |

Nothing needs seeding: the app writes default settings and publishers on first boot.

> **There is a second, pre-existing database in this project:**
> `ai-studio-24a4bccd-248c-4a62-a2f0-7c8945271de1`, Enterprise edition, created by AI
> Studio on 2026-07-14. **Leave it alone.** It belongs to AI Studio, it is on the
> MongoDB-compatibility tier with different pricing, and AI Studio may re-provision it.
> The app uses `(default)` and needs no configuration to find it.

Restrictive rules are correct, not a compromise. Security Rules only govern the web and
mobile SDKs, and nothing in the browser touches Firestore. The server authenticates as a
service account, which bypasses rules entirely - so "deny all" locks out the public
internet while the API keeps full access.

### 2. Grant the runtime service account access

This service runs as a dedicated (non-default) service account:

```
ai-plan-agent-runner@ai-api-project-465519.iam.gserviceaccount.com
```

Confirm it under Cloud Run → `ai-plan-agent` → YAML → `spec.template.spec.serviceAccountName`
before granting, in case a later redeploy changes it.

IAM → **Grant access** → that principal → role **Cloud Datastore User**
(`roles/datastore.user`) → Save. Allow up to a minute to propagate.

This is the preferred path - it needs no secret. The app fetches tokens from the metadata
server automatically. Because the account is dedicated to this one service, the grant is
genuinely least-privilege rather than opening the whole project.

<details>
<summary>Fallback: if you cannot grant IAM to the runtime service account</summary>

Create a service account with `roles/datastore.user`, download a JSON key, and paste it
into the AI Studio Secrets panel as `GOOGLE_SERVICE_ACCOUNT_KEY` (raw JSON or base64).
The app prefers this key over the metadata server when present.
</details>

### 3. Add secrets in the AI Studio Secrets panel

| Secret | Required | Purpose |
| --- | --- | --- |
| `STORAGE_DRIVER` | recommended | set to `firestore` so a credential problem fails loudly rather than degrading to a disk that does not persist |
| `ADMIN_PASSWORD` | recommended | restricts settings edits to administrators |
| `SESSION_SECRET` | recommended | stable cookie signing key; without it, rotating `TEST_PASSWORD` signs everyone out |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | only if step 2 was not possible | |

### 4. Deploy and verify

The deploy path is: push to `main` on GitHub, pull in AI Studio's GitHub panel, then
Publish to Cloud Run. AI Studio reporting "in sync" only means it matches GitHub - if the
work has not been pushed, there is nothing to pull and publishing ships the old code.

After publishing, check:

```bash
curl -s https://ai-plan-agent.ai.studio/api/health
```

Expected:

```json
{"ok":true,"storageDriver":"firestore","shared":true,"adminPasswordConfigured":true}
```

If `storageDriver` is `local-file`, **plans are not being shared and will be lost on the
next redeploy**. Check the deploy logs - the startup warning names the cause.

---

## Migration of existing plans

On first sign-in, each browser imports any plans it saved under the old model, attributed
to whoever is signed in. The original `localStorage` entry is **copied to a backup key,
never deleted**, and the migration flag is only set when every plan imported cleanly - so
a partial failure retries on the next sign-in instead of losing anything.

Keys involved: `audience_builder_saved_profiles` (untouched original),
`audience_builder_saved_profiles_backup_v1`, `audience_builder_plans_migrated_v1`.

Anyone with plans on a machine they no longer use should sign in there once to pull them
into the shared store.

---

## Known limitations

- **Custom publisher logos are now data URLs**, not files under `/assets/pub-logos/`.
  A file written to the container disk vanishes on redeploy and is invisible to other
  instances, so an uploaded logo would silently disappear for everyone else. Uploads are
  capped at 64KB and travel inside the shared publishers record. If logo volume grows,
  move them to a GCS bucket - the publishers record has a 1MB Firestore document limit.
- **`.media_plan_cache.json` is still per-instance and ephemeral.** This is deliberate:
  it is a parse cache, not a source of truth, and the client caches parsed plans in
  `localStorage` too. A cache miss costs a re-parse, nothing more.
- **The plan list is fetched, not live.** Two people working simultaneously will not see
  each other's saves until they hit Refresh - but a conflicting save is always caught by
  the revision check rather than silently overwriting.
- **Plan payloads must stay under Firestore's 1MB document limit.** Typical plans run
  100-400KB including compressed persona avatars (120px JPEG, roughly 5-10KB each). If
  plans grow substantially, move payloads to GCS and keep only metadata in Firestore.
