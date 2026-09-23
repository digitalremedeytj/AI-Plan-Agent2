# Segment Recommendations and Regression Test Set: Plan

Two pieces of work left over from the QA audit rework (branch `audit-phase-1`, commits
`a93048c`…`347a27f`). Written to be picked up from a fresh session with no chat history.

**Status: on hold (2026-09-23).** Waiting for Digital Remedy's own audience segment list to be
finalized. The segment work is designed around that list; don't build it against a stand-in.
The regression test set does not depend on the list and can be built first when work resumes.

**Priority: quality over speed**, within the run budget (see §0).

---

## 0. Read first

1. `CLAUDE.md`: storage, auth, deployment, dependency and testing rules, and the generation
   order. They all apply.
2. How a plan is generated and audited now, in order:

   | Step | Where |
   | --- | --- |
   | Crawl (retries the www / non-www host) | `src/research/crawl.ts` |
   | Brief of Record: the audience every step is built for (core vs also-served groups) | `src/research/briefOfRecord.ts` |
   | Four research dossiers, synthesis, channel plan (engine), chart estimates | `server.ts` `/api/generate-profile` |
   | Narrative written last against the settled plan | `src/research/planNarrative.ts` |
   | Number check: every figure in the prose traced to research / chart / plan | `src/qa/claimLedger.ts` |
   | Audit (`gpt-6-sol`, high), targeted Gemini patches, verify (`gpt-6-sol`, medium) | `src/qa/auditRunner.ts`, `planAudit.ts`, `planRemediation.ts` |
   | Draft auto-save before the plan is sent | `server.ts`, end of `/api/generate-profile` |
   | Manual "Run QA Audit" on a saved plan, fixes applied only on approval | `/api/plans/:id/audit`, `/audit/apply`, `src/components/PlanAuditModal.tsx` |

3. **Time budget.** A full run is about 6-7 minutes. The server's `RUN_BUDGET_MS` is 870s
   (Cloud Run's request timeout is 900s); the client gives up at 15 minutes. Late stages check
   the remaining budget and step aside with an alert. Anything added to the pipeline must fit.
4. **Measured model behaviour** (saved PetSmart plan, 2026-09-23, two runs each): the audit on
   `gpt-6-sol` high took 92-123s; the same plan scored 71-74 across repeats, so treat score
   differences of about ±3 as noise.

---

## Part A - Segment recommendations

### A1. How it works today

- The browser calls `POST /api/generate-segments` after the plan renders
  (`requestSegments` in `src/App.tsx`). Gemini (`high`, `medium` fallback) returns 8-14
  segments; `normalizeSegments` in `src/research/segmentRecommendations.ts` enforces counts,
  names, dimensions and the sensitive-attribute ban.
- The prompt (`SEGMENT_SYSTEM_INSTRUCTION`) is sound: four data signals (Transaction &
  Purchase, ACR TV Viewership, Household & Life-Stage, High-Intent Digital), a 100k-household
  scale floor, no stacked micro-niches, privacy bans, objective-adaptive Core / Expansion /
  Experimental tiering, an IAB taxonomy path per segment.
- Segments are saved onto an already-saved plan by the segment auto-save queue in `App.tsx`.

### A2. Gaps

1. **Built from a partial picture.** The request carries the personas and the intro,
   executive summary, takeaways and recommendation titles. It never sees the Brief of Record,
   the charts, the research, or the channel plan. An older PetSmart plan produced "Affluent
   Mature Homeowners" and "Farm Supply Store Buyers" for a mass-market retailer.
2. **Never audited.** Segments are generated after QA and after the draft is saved.
3. **No link to execution.** A segment's data signal says how it is collected, but nothing
   checks the channel plan has a tactic that can use it (an ACR TV Viewership segment needs
   CTV with ACR targeting; a transaction-data segment needs the Purchase / Transaction tactic).
4. **Unverified taxonomy.** `taxonomyPath` is written from the model's memory.
5. **Not tied to anything Digital Remedy can buy.** Segments are described as syndicated
   cohorts in general, not as entries in a catalog the team activates.

### A3. Design

**A3.1 The segment catalog (the decision this work is waiting on).**
Digital Remedy's own segment list becomes the source of truth, loaded like the product
workbook: bundled data plus an admin-managed layer in settings, never a new npm dependency.
Proposed record shape (confirm against the finalized list):

| Field | Purpose |
| --- | --- |
| `segmentId` | Stable id the plan stores |
| `name` | Catalog name as the DSP shows it |
| `provider` | Data provider (e.g. Experian, Circana) |
| `dataSignal` | One of the four signals above, so activation can be checked |
| `dimension` | Demographics / In-Market / Interest & Affinity / Behavioral |
| `scaleHouseholds` | Reported reach, replacing the prompt's 100k guess |
| `taxonomyPath` | Where it sits, if the list carries one |
| `channels` | Where it can be activated (DSP, CTV, social...), if known |
| `cpmUplift` | Data cost, if the list carries it |
| `enabled`, `notes` | Admin controls, like CTV publishers |

With a catalog, the model **selects** segments from it (as it does CTV publishers today)
instead of naming them freely; the IAB-taxonomy check becomes unnecessary. Any "suggested
segment not in the catalog" is shown separately as an idea, never as a buyable line.

**A3.2 Generate inside the pipeline.** Move the initial segment call into
`/api/generate-profile`, run in parallel with the narrative step (both read the settled plan;
neither depends on the other), so it adds little or no time. Segments are then in the draft and
in the audit. Keep `/api/generate-segments` for the browser's "Suggest more" top-up and for
older plans.

**A3.3 Give it the settled plan.** Brief of Record block (`formatBriefOfRecord`: build around
core segments; also-served groups are on target), personas, `describeCharts`,
`describeChannelPlan`, KPIs, and the catalog candidates.

**A3.4 Code checks after generation** (a new `src/qa/segmentChecks.ts`, with tests):
- **Activation path.** Attach a computed "runs on" list per segment from its data signal and
  the plan's channels and tactics. Proposed map (confirm with the team):

  | Data signal | Activates through |
  | --- | --- |
  | Transaction & Purchase Data | `tactic.purchase_transaction_data`, retail-data tactics |
  | ACR TV Viewership | `tactic.acr_targeting` on CTV / OTT |
  | Household & Life-Stage Records | `tactic.behavioral_demographic` |
  | High-Intent Digital Behavior | `tactic.in_market_shopping_intent`, `tactic.search_intent_retargeting` |

  A segment with no path in this plan is flagged, not silently kept.
- **Brief fit.** Nothing aimed at the brief's excluded groups; core segments covered; every
  persona served by at least 2 segments (the prompt asks, code enforces).
- **Catalog membership and scale** from `scaleHouseholds` once the catalog exists.

**A3.5 Audit.** Add segments to `planForAudit` and a `"segments"` owner in `planAudit.ts`.
Cohesion covers segments against personas, charts and channels. The fixer
(`planRemediation.ts` `ALLOWED_PATHS`) may rewrite a segment's justification only; adding,
removing or replacing a segment is a planner decision, the same rule as personas. The manual
audit picks this up automatically through `auditRunner.ts`.

### A4. Open questions for when the list is final

1. The list's actual fields (map them onto A3.1).
2. Where segments activate per channel (DSP only, or social and CTV too).
3. Whether data cost should appear in the plan or stay internal.
4. Who maintains the list, and whether admins edit it in Settings like CTV publishers.

---

## Part B - Regression test set

### B1. Goal

Know whether a change makes plans better or worse, and catch regressions of the kind already
seen: cat personas dropped for a brand that sells cat food, B2B targeting on consumer plans,
research figures deleted as "unsupported", fixes reported that never shipped.

### B2. Design

- **Runner:** `npm run eval` (e.g. `scripts/eval/run.ts`), deliberately separate from
  `npm test`: it costs money and results vary by run. It calls the running local server,
  signing its own session with the local session secret, so the pipeline needs no refactor.
  Run 2-3 briefs at a time.
- **Output:** `eval-results/<date>/` (gitignored) holding each run's full plan, audit and
  timings, plus a short report comparing against a committed baseline
  (`eval/baselines/latest.json`, updated deliberately, not automatically).

### B3. Briefs (`eval/briefs/*.json`, each with its expectations)

| Brief | Expectations (examples) |
| --- | --- |
| PetSmart, `https://www.petsmart.com/` | Crawl succeeds; core segments dog and cat owners |
| PetSmart, bare `petsmart.com` | Crawl falls back to the www host |
| Jinx, `thinkjinx.com` | Brief of record includes cat owners; no persona excludes them |
| Razer gamers | README Query A |
| Visit California luxury travel | README Query B |
| Target new parents | README Query C |
| B2B (e.g. IT decision-makers for a SaaS product) | Audience type B2B; B2B targeting allowed |
| DMA-targeted brief (2-3 DMAs) | Geography respected throughout |
| Planner-named personas | Names kept in slots 1-n |
| Uploaded plan / RFP | Plan audiences represented; RFP asks answered |

Use real client briefs where the team can share them; otherwise realistic stand-ins.

### B4. Checks

**Pass / fail (code):**
- Each brief's expectations above.
- No B2B tactic on a B2C plan; no LeadMatch / MatchBack / CrossView without their condition
  (`tacticFitsCampaign`, `measurementFitsCampaign` in `src/planning/engine.ts`).
- CTV publishers in the enabled pool, no duplicates.
- Every `autoFixes` entry corresponds to a changed field.
- Run finishes inside `RUN_BUDGET_MS`; the draft is saved.

**Tracked, not pass / fail:**
- Audit score before and after fixes; open findings by owner.
- Number check: share of figures found in the research vs not found.
- Per-stage timing and OpenAI token usage (already logged by `src/server/openaiJson.ts`).

### B5. Seeded-error test (measures the auditor itself)

Take a good plan from an eval run, plant known defects, run **only the audit** (cheap) twice,
and score how many it catches with the right owner:
- A high-income persona with a channel rationale about reaching low-income households.
- A statistic not in the research.
- A narrative "Sunday peak" the day-of-week chart does not show.
- A recommendation naming a platform not in the channel plan (e.g. TikTok).
- An audience outside the brief of record.

### B6. Cost and time (estimate; confirm from the token logs on the first run)

Roughly $2-3 per plan, so about $20-30 for the brief set plus ~$3 for the seeded-error audits.
About 20-25 minutes of wall time at 2-3 concurrent runs. Suggested cadence: before merging any
change to prompts, the engine or QA.

---

## Order when this resumes

1. **Part B first**, then run it on the current code to record a baseline. The segment work is
   then measured instead of judged by eye.
2. **Part A** once the segment list is final: A3.1 catalog -> A3.3 context -> A3.2 in-pipeline
   -> A3.4 checks -> A3.5 audit.
3. **Re-run Part B** and compare with the baseline before merging.

## Related findings to keep in mind

- **Workbook gaps** (not code): Search's only compatible tactic is Search Intent Retargeting;
  YouTube, Linear TV, YouTube TV, Native Article and Email have no Master_Compatibility column,
  so they get no tactics; the "Cross-Channel Sequential Messaging" compatibility row has no
  tactic record. These limit what segments can activate through (A3.4).
- **Share links** carry the full plan payload, including `researchSnapshot` and `auditResult`
  (hidden in the UI). Decide whether segments' data-cost fields belong there.
