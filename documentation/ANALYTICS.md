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
