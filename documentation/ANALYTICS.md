# Analytics and usage reporting

Two sources, with different jobs:

| | Google Analytics 4 (`G-NKNVTM30FW`) | Server usage log |
| --- | --- | --- |
| Answers | How the app is used: screens, funnels, trends, devices, client share-link traffic | Who used it: per-person and per-advertiser counts |
| Identity | Pseudonymous `user_id` (keyed hash of the display name). Never a name: GA's terms forbid personal data | Display name from the signed session |
| Where | GA console, Looker Studio | Settings → **Usage** (admins only), CSV export |
| Code | `src/analytics.ts` | `logUsage` in `server.ts`, `src/usage/usageSummary.ts`, `usage_events` collection |
| Blocked by ad blockers | Sometimes | Never |

Use the usage log for "who" and for headline counts leadership will quote; use GA for
behaviour, trends and anything it already slices well.

## Rules the code depends on

- **GA never sees a real URL.** A share link's token is the only thing guarding the plan, and
  gtag's default `page_location` would send it to Google. Every hit carries a synthetic
  location (`https://<host>/<screen>`), and referrers are reduced to their origin.
  `src/analytics.test.ts` protects this.
- **Only the production host reports** (`plan-agent.digitalremedylabs.com`). To test from
  anywhere else, run `localStorage.setItem("apa_analytics_debug", "1")` in the console and
  reload; hits are sent with `debug_mode` and show in GA → Admin → DebugView. Remove the key
  afterwards.
- No advertising features: Google signals and ad personalisation are off.

## One-time GA property setup

1. **Admin → Data streams → (web stream) → Enhanced measurement → Page views → Show advanced
   settings → turn off "Page changes based on browser history events".** The app sends its
   own page view per screen; leaving this on double-counts them.
2. **Admin → Custom definitions → Create custom dimension** for each parameter below. GA
   ignores event parameters until they are registered, and does not backfill.

   | Dimension name | Scope | Parameter |
   | --- | --- | --- |
   | Advertiser | Event | `advertiser_name` |
   | Export format | Event | `format` |
   | Generation mode | Event | `mode` |
   | Failure reason | Event | `reason` |
   | User type | User | `user_type` (`staff` / `client_share`) |
   | Is admin | User | `is_admin` |

   And a custom metric: **Generation time** — Event — `duration_sec` — unit Seconds.
3. **Admin → Events → mark as key event:** `plan_generate_complete`, `share_link_create`,
   `share_view`, `export`.
4. **Admin → Data retention → 14 months**, so year-over-year comparisons are possible.

## Events

Screens (`page_view`, page path): `/login`, `/brief`, `/saved`, `/plan`, `/scout`, `/share`.

| Event | Parameters | Sent when |
| --- | --- | --- |
| `login`, `logout` | `method` | Sign-in / sign-out |
| `plan_generate_start` | `advertiser_name`, `mode`, `quick_mode` | A run starts |
| `plan_generate_complete` | same + `duration_sec` | A run delivers a plan |
| `plan_generate_fail` | same + `duration_sec`, `reason` | A run fails or times out |
| `plan_open`, `plan_save` | `plan_id`, `advertiser_name` | Opening / explicitly saving a plan |
| `export` | `format`, `plan_id`, `advertiser_name` | PDF, Markdown, TXT, copies, segment CSV, CTV slide, recap |
| `share_link_create`, `share_link_copy`, `share_link_revoke` | `plan_id` | Share dialog |
| `share_view` | `plan_id`, `advertiser_name` | A share link loads |
| `settings_open` | `is_admin` | Settings drawer opened |

## Server usage log

One `usage_events/{id}` document per action (one JSON line per day under
`data/store/usage/` in development). The server records generation, plan creation and
deletion, share create/revoke/view, QA audits, ScoutAI questions, executive briefs,
segments, slides, campaign recaps, performance uploads, settings saves and sign-ins at the
route that performs them. The browser reports only what the server cannot see (`export`,
`plan_open`, `plan_save`) through `POST /api/usage/events`, which accepts nothing else.

A share-link view by a signed-in planner is recorded with `detail: "staff_preview"`;
an unauthenticated view is attributed to `(client share link)`.

`export` and `slide_generate` carry the format or slide in `detail`. ScoutAI events carry more,
never the question's text:

| Event | Fields |
| --- | --- |
| `scout_chat` | `detail`: library prompt id, `typed`, or `recap` (asked from a Campaign Recap recommendation); `label`: the prompt's title at the time; `kind`: `plan`, `past` or `live`; `count`: changes proposed (0 = answer only) |
| `scout_apply` | Apply or Undo in the ScoutAI panel only (the plan view's recap buttons share the route but are not logged). `detail`: the prompt the proposal came from; `kind`: `applied` or `reverted`; `count`: changes saved |
| `scout_review_ask` | An admin's question on the ScoutAI review page's Ask tab. `count`: questions in scope |

ScoutAI questions recorded before these fields existed have no `detail`.

## ScoutAI conversation log

Every ScoutAI question and its answer, kept so answer quality and what planners ask can be
reviewed. Unlike the usage log it holds the words, so reading it is admin-only
(`GET /api/scout-logs?days=30&limit=200`, newest first) and every record expires after a year.
The browser's own chat history stays in `sessionStorage` as before; this is the server's copy.

One record per question (`scout_logs/{id}`; `data/store/scout-logs/{day}/` in development),
built by `src/assistant/scoutLog.ts`:

- who, when, plan, advertiser, the plan revision answered against
- the question and the answer (with the server's notes about left-out changes and unverified figures)
- the proposal as the planner saw it: each recommendation's title, reasoning, evidence and before → after, not the raw operations
- prompt, type of question, summary or full campaign data, model, thinking level, time taken, and the error on failure
- `conversationId` and `turn`, so a whole chat reads back in order (a new id after Clear chat)
- `outcome`: set when the planner applies or undoes that answer's proposal
- `feedback`: the asking planner's thumbs up or down, with an optional note on a thumbs-down
  (`POST /api/scout-logs/{id}/feedback`, only the person who asked)
- `topic`: what the question is about, one of a fixed list (`src/assistant/scoutTopics.ts`), tagged
  by Gemini (low thinking) right after the record is saved. Older or failed tags are filled in
  by the review page's "Tag topics" button (`POST /api/scout-logs/tag-topics`, admin-only)
- `review`: an admin's own thumbs up or down with notes, from the review page
  (`POST /api/scout-logs/{id}/review`, admin-only). It never touches `feedback`, so the
  planner's rating and the reviewer's are always separate.

**Review page** (`/scout-review`, `src/scoutReview/`; in the app menu for admins). The list
filters by date range, person, prompt, type, the planner's thumbs, outcome (failed, proposed,
applied, undone) and whether it has been reviewed, with search over the question and
advertiser; the summary above it (questions, thumbs up/down among rated answers, failure
rate, top prompts) follows the filters. Picking a question shows the whole conversation, every
turn in order. It loads the newest 1,000 questions in the range; the filters work on those.
Export CSV downloads the filtered questions.

**Ask** (the page's second tab, `POST /api/scout-logs/ask`, admin-only) answers an admin's
questions about the questions the dates and filters select, which the server reloads and
filters itself. `src/scoutReview/scoutAsk.ts` counts everything (by topic, prompt, person, type,
day or week, thumbs, reviews, outcome, error, advertiser) and gives the model those datasets plus
the newest 300 questions word for word. Answers are blocks: prose, tables and charts that name
a dataset (the server fills in the rows, so the model cannot miscount), word-only tables,
example questions, and library-prompt drafts that open in Settings → ScoutAI Prompts, unsaved.
Figures in the prose that the data does not contain are flagged. The chat stays in the browser
tab; only that it happened is logged (`scout_review_ask`, `count`: questions in scope).

**Size.** Texts are capped (question 4,000 characters, answer 20,000, the proposal 40,000 in
all, shortened to fit), so a record is a few KB and never more than about 75 KB.

**Retention: one year.** Each record carries `expireAt` (a Firestore timestamp, a year after
`at`). Firestore deletes expired records itself once a TTL policy exists. **One-time setup**,
run once per project (or Console → Firestore → Time-to-live → Create policy: collection group
`scout_logs`, timestamp field `expireAt`):

```bash
gcloud firestore fields ttls update expireAt --collection-group=scout_logs --enable-ttl --project=ai-api-project-465519
```

Until the policy exists, nothing is deleted; records past `expireAt` simply stay. TTL deletion
usually runs within a day of expiry. In development, the local driver removes expired days on
the next write.

## AI Plan Agent Dashboard (`/dashboard`)

Headline numbers and charts for executives, computed from the usage log
(`src/usage/dashboard.ts`, page in `src/dashboard/`).

**Access.** Any signed-in planner opens `/dashboard` directly (it is in the app menu). Anyone
else needs a view-only link, which any planner can create in Settings → Dashboard:
`/dashboard#key=dash_…`. The key sits after `#`, so browsers never send it to the server in
the address (it travels in the `x-dashboard-key` header) and it stays out of Cloud Run request
logs and referrers. The page removes it from the address bar once read. Links are named,
never expire, and are turned off one at a time by their creator or an admin
(`dashboard_links/{token}` in Firestore). Hours per plan and excluded names are admin-only. Add
`&range=7d` (or `30d`, `90d`, `qtd`, `ytd`) to open on a given range; "Copy weekly summary"
does this automatically.

**Definitions.**

| Number | Meaning |
| --- | --- |
| Plans generated | Successful generation runs, regenerations included |
| Media budget planned | Working media budget of each brief, counted once: the same person re-running the same advertiser at the same budget within 24 hours adds no budget |
| Media budget by channel | The counted briefs' allocations, by media type name |
| Active users / total users | Distinct people active in the period / ever, up to the period's end |
| Time saved | Plans generated × hours per plan (default 1; admins' edits are saved for everyone, link viewers' edits are theirs alone) |
| Client views | Unauthenticated opens of share links (a planner previewing their own link is not counted), credited to whoever created the link |
| Funnel | Plans generated in the period → of those, shared → of those, opened by a client, whenever that happened |
| Change % | Against the period of the same length immediately before |
| Feature adoption | People and uses per feature. Exports (downloads, copies and AI slides) expands by type. ScoutAI expands by prompt, by type of question, outcome (answered, failed, answers proposing changes, proposals applied, undone; applies are counted when they happen) and median answer time |

Charts are bucketed by day up to 35 days, by week beyond, in the viewer's timezone.

**Excluded names.** Test accounts listed in Settings → Dashboard are dropped from every dashboard
number (`dashboard_config/current`). The Usage tab itself still shows them.

**History.** "Import history from saved plans" (Settings → Dashboard) turns every saved plan into
a backfilled generation, dated and attributed as the plan was, and every plan with a share
token into a share-link event dated by the plan's last update. Client views cannot be
backfilled; they were not recorded before this feature. Running it again adds nothing.
