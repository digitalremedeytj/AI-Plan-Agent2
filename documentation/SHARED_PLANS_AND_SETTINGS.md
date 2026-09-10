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
| `settings/current` | the live planning settings and their revision number |
| `settings_revisions/{n}` | immutable settings history, referenced by each plan |
| `publishers/current` | the live CTV publisher list |

Payloads are stored as a **JSON string**, not a Firestore map. That sidesteps Firestore's
no-nested-arrays rule (chart data hits it) and keeps the storage layer independent of the
app's evolving schema. Listing uses a field mask that excludes `payloadJson`, so the plan
sidebar never downloads payloads.

### Concurrency

Every plan write is compare-and-swap. Clients send the revision they last read as
`If-Match`; the Firestore driver additionally pins the document's `updateTime`. A save
against a stale revision returns **409** with the current revision, and the UI tells the
user to reload rather than overwriting a colleague's work.

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

> If `ADMIN_PASSWORD` is not configured, every signed-in user can still edit settings.
> That is exactly the previous behaviour, so adding sessions cannot brick settings
> editing on first deploy. **Setting `ADMIN_PASSWORD` is what actually locks it down.**

`src/server/session.ts` is a deliberately thin seam: moving to Google Sign-In later means
changing only how a `SessionUser` is produced at login. Every route keeps calling
`getSession()`.

---

## Deployment steps

Everything below happens in the `ai-api-project` GCP console (display name
`ai-api-project`, project ID `ai-api-project-465519`, project number `119508685311` -
the ID is what APIs want). The code needs no further
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

Pull master into AI Studio and publish to Cloud Run as usual, then check:

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
