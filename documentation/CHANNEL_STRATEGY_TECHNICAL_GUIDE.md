# ScoutAI Channel Strategy — Technical & Architectural Guide

## 1. Overview
The **Channel Strategy Module** in ScoutAI provides automated, data-driven evaluation and recommendation of media channels for advertising campaigns. It evaluates baseline Request for Proposal (RFP) media plan channels against target audience research dossiers, brand context, and budget constraints, while discovering incremental programmatic channel opportunities.

### Key Objectives
* **Baseline Channel Audit**: Evaluate user-uploaded or specified RFP channels on audience fit, campaign goal alignment, and media consumption evidence.
* **Algorithmic Channel Discovery**: Surface high-indexing programmatic channels (e.g., CTV, Audio, Digital OOH, Native, Social, OLV, Display) tailored to the audience's digital touchpoints.
* **Budget Approaches**: Four ways to plan an uploaded RFP's budget — **Optimize RFP budget**, **Add on top of RFP**, **Optimize total increased budget**, and **Use the plan as is** (see section 5).
* **One Allocation Table**: RFP media types and ScoutAI or planner additions share one Channel Allocation table, each labelled by where it came from, and an RFP media type is never silently dropped.
* **Grounding & Transparency**: Every recommendation is backed by real-time web search grounding and verifiable market evidence.

---

## 2. System Architecture & Data Flow

```
[User Input / Uploaded RFP Plan]
         │
         ▼
[1. Pre-Pass Optimization]  ────► /src/utils/planPromptOptimizer.ts
         │                        (Slices & summarizes line items to optimize token usage)
         ▼
[2. Crawler & Brand Context] ───► /server.ts (crawlWebsite)
         │
         ▼
[3. Grounded Research Parallel Calls] (4 Domain Sub-Calls via gemini-2.5-flash)
   ├── Demographics
   ├── Web & Domain Touchpoints
   ├── CTV & Device Usage
   └── Temporal & Purchase Behaviors
         │
         ▼
[4. Synthesis Generation] ───► /api/generate-research (SSE Stream)
         │                     (Synthesizes dossiers into AudienceProfile JSON containing ChannelStrategyData)
         ▼
[5. Channel Plan (engine)] ──────► buildChannelStrategy (server.ts) → /src/planning/engine.ts
         │                        (AI candidate signals score every media type; the engine
         │                         selects and allocates deterministically, and records the
         │                         RFP baseline: dollars per media type + unmatched lines)
         ▼
[6. Rows] ─────────────────────► /src/planning/allocationRows.ts (buildAllocationView)
         │                        (One row model for the page, share link, Copy Summary, Markdown)
         ▼
[7. UI Rendering & Interaction] ─► /src/components/ChannelStrategySection.tsx
                                  (Channel Allocation table, budget approach, not-in-plan list)
```

---

## 3. Data Schema & Type Definitions

The saved strategy is `ChannelStrategyData` in `/src/types.ts`. The fields that drive the page:

```typescript
export interface ChannelStrategyData {
  /** See src/planning/budgetStrategy.ts. "incremental" is the id for "Add on top of RFP". */
  budgetStrategyMode: 'reallocation' | 'incremental' | 'grow';
  additionalBudget?: number;   // the extra budget for the two growth approaches
  rfpMediaBudget?: number;     // the RFP media total the approach started from
  mediaPlan?: MediaRecommendationPlan; // channels, evaluatedCandidates, rfpBaseline (src/planning/types.ts)
  manualIncludedChannelIds?: string[]; // planner-added media types ("Added by you")
  manualExcludedChannelIds?: string[];
  // Kept for saved plans and back-compat; the page no longer renders them:
  rfpChannels: ChannelEvaluation[];
  scoutAiRecommendedChannels: ChannelEvaluation[];
  // ...
}
```

`mediaPlan.rfpBaseline` (absent on plans without an upload and on plans saved before it existed)
holds the RFP's media total, the dollars, impressions and line items per media type, and the
media lines that matched no media type. An RFP line is placed by its most specific field: an
exact catalog match on media type, product type or publisher wins, then the most confident
taxonomy match, so "Video / OTT" is CTV and "Display / DSP" is Display. The taxonomy's 0.5
catch-all does not count, so an unknown label is reported as unmatched, not counted as Display.

Never read `mediaPlan.channels` or `workingMediaBudget` directly for a plan total: in "Add on
top of RFP" the RFP media types sit outside them. Use `buildAllocationView` (rows) or
`combinedPlan` in `/src/planning/planChannels.ts` (totals for the overview, executive brief,
slides, QA and ScoutAI).

---

## 4. Scoring Methodology

Scores are the engine's, **0–100 everywhere** on the page:

* **Score**: the candidate's `recommendationScore`, a weighted blend of its score components.
* **Audience Fit**: the `audienceAndPersonaFit` component.
* **Goal Match**: the `kpiAndFunnelFit` component.
* **Media Consumption Evidence**: the first evidence item from the AI reasoning (stock engine
  lines such as "X is live" come last).
* **Why it earns a spot / Why ScoutAI moved this budget / Why add it**: the candidate's gap
  addressed, or for an RFP media type the plan does not fund, its first eligibility failure,
  prerequisite, or the optimizer's reason. A planner removal reads "Removed from this plan by
  your Digital Remedy planner."

A candidate scored without AI reasoning (`aiAssessed: false`) shows no scores and is never
offered as a recommended addition.

### Score Classification & Visual Indicators
| Score | Engine status | UI Badge Style | Color |
| :--- | :--- | :--- | :--- |
| **72 – 100** | ADD | `bg-emerald-50 text-emerald-700` | Emerald Green |
| **55 – 71** | TEST | `bg-amber-50 text-amber-700` | Amber Yellow |
| **< 55**, or any eligibility failure | DO_NOT_ADD | `bg-rose-50 text-rose-700` | Rose Red |

### Prompt Guidelines (`/server.ts`, candidate signals)
* **Baseline RFP Mapping**: The reasoning model is fed the publishers, ad formats, and media types extracted from uploaded RFP plans.
* **Budget Tier Constraints**: Total RFP budget ($) guides the scale of recommended channels (e.g., high-budget plans receive premium CTV & OOH recommendations; smaller plans focus on high-efficiency Digital Display, Social, and Native).
* **Grounded Evidence**: `mediaConsumptionEvidence` must cite specific data points from the research sub-dossiers.

---

## 5. Budget Approaches

Defined in `/src/planning/budgetStrategy.ts` (labels, descriptions, `resolveStrategyBudget`).
The planner picks one in the brief (under the RFP option selector, once an RFP is uploaded) or
on the finished plan ("Budget approach" above Channel Allocation, which re-plans in place and
keeps added/removed media types). The default is **Optimize RFP budget**.

| Approach | id | Engine allocates | RFP media types |
| :--- | :--- | :--- | :--- |
| **Optimize RFP budget** | `reallocation` | The RFP media budget | Compete with new media types; may be cut or dropped |
| **Add on top of RFP** | `incremental` | Only the additional budget, to new media types | Kept at their RFP dollars, outside the allocation |
| **Optimize total increased budget** | `grow` | RFP budget + additional budget, as one total | Compete with new media types for the combined total |
| **Use the plan as is** | `asIs` | Nothing: the RFP's media types at exactly their RFP dollars | Are the plan; nothing is added, cut or moved |

* The two growth approaches need an additional budget greater than $0; the server refuses
  rather than inventing one (an earlier version silently spent the brief budget again).
* "Add on top of RFP" cannot be expressed as locked rows inside one allocation because the
  allocation editor works in whole percentages ($20,000 of $75,000 is 26.67%). The RFP media
  types are therefore separate kept rows, and the editor edits the additional budget only.
* The budget tiers cap how many media types a budget allows; the control says when the extra
  budget raises that cap ("…up to 8 media types, 2 more than at $50,000").
* Plans saved in the old incremental mode open as "Add on top of RFP", with the budget they
  were given treated as the additional amount.
* **Use the plan as is** is for a client who keeps their own plan while the rest of ours (research,
  personas, narrative) supports it. The engine skips selection, eligibility, budget tiers and
  allocation bounds (`asUploadedPlan` in `engine.ts`) but keeps each media type's scores for the
  planner. The RFP media types are real allocation rows, so the allocation editor still works,
  and a row a planner changes shows its RFP dollars and the difference. RFP lines that matched no
  media type become their own rows at their dollars ("Outside ScoutAI catalog", planner-only label)
  and count toward the plan total (`outsideCatalog` in `combinedPlan`). On a share link there are
  no source badges, no source filter, no group heading unless a planner added media types, and no
  "ScoutAI recommendations not in this plan".

---

## 6. Frontend Component Architecture (`ChannelStrategySection.tsx`)

**Channel Allocation** is the one table. With an RFP it has two groups, **From your RFP** and
**Added to your plan**, and a filter bar ("RFP: 3 of 4 in plan · ScoutAI added 2 · You added 1").
Each row shows:
* a source badge — **RFP**, **ScoutAI added**, or **Added by you** (and **Kept at RFP budget**
  for "Add on top of RFP");
* Allocation (share of the plan total), Dollars with RFP dollars and the change against them,
  and Score;
* Audience fit and Goal match chips, and the media consumption evidence and why, side by side
  (clamped in the list, full text when the row is expanded);
* a ⋯ menu (`RowActionsMenu.tsx`) with Lock, Edit allocation and Remove from plan. Kept RFP rows
  have no editor or remove action; changing the budget approach moves them.

A warning above the rows lists RFP lines that matched no media type.

**Media types not in plan** (planners only) pins **From your RFP, not funded** at the top, with
the reason, ahead of ScoutAI's alternatives, test opportunities and the rest.

**Share link**: planner controls are hidden. **ScoutAI recommendations not in this plan** shows
RFP media types the plan does not fund and the top five qualified additions (ADD/TEST, no
eligibility failures), each with scores, evidence and why — share links are what sales shows
the client, so reasons are written as recommendations.

**Internal-only visibility** (Settings): `channelFitScores`, `channelEvidence` and
`channelRecommendationsNotInPlan` join the existing column switches, all shown by default. RFP
dollars and minimum spends follow `channelDollarsColumn`.

**Copy Summary** and the Markdown export (`/src/utils/markdownExporter.ts`) are built from the
same rows.

---

### Uploading a media plan onto a finished plan

**Upload media plan** above the budget approach (planners only, saved plans only) opens
`PlanUploadModal.tsx`. A new upload replaces the earlier one, and the upload is the truth: its
budget, flight and locations replace the brief's. The planner chooses **Use this plan as is**
(`asIs`) or **Recommend additions to it** (the other three approaches), then reviews:

* **Brief changes**, from → to, and any locations that could not be read (the brief's stay; nothing is guessed).
* **Check the audience**: the upload's stated audiences beside the brief of record's. A warning only;
  the research and personas are not re-run.
* **Media types**: each distinct uploaded line and the media type it landed in, with a picker to
  correct it or keep it outside the catalog. The choice is stored on the line as
  `ExtractedPlacement.channelId` (or `OUTSIDE_CATALOG`), which the engine honours before its own matching.
* **Channel Allocation, before and after**, with totals.

The preview is `/api/analyze-media-plan` with the plan's stored candidate signals, so it costs no
AI call and nothing is saved. The planner's earlier adds and removes do not carry into an upload.
**Approve** writes once: the new channel strategy, the upload (`extractedPlacements`,
`planOptions`, `rfpAnalysis`, `uploadedFileName`) and the brief's budget, flight and geography,
with `checkpointReason: "media_plan"` so History always holds the plan from before
("Before a media plan was uploaded"). The pure pieces (brief changes, geography reading, line
mapping, before/after) are in `src/planning/planUpload.ts`.

**Rewriting the content.** Approving starts `POST /api/plans/:id/refresh-content` in the
background. It leads the CTV publisher list with publishers the uploaded plan names (in the
enabled pool, marked "Part of your media plan.", never dropped to fit the target count;
`withUploadedPublishers` in `src/qa/publisherSelection.ts`), then rewrites the narrative with the
same writer and inputs generation uses, from the plan's saved research. For a plan used as is the
writer gets `AS_IS_PLAN_NOTE` (`src/research/planNarrative.ts`): back the client's plan, explain
each channel's role, never invent evidence for a weak fit, never argue for a different plan. It
saves with a `content_refresh` History checkpoint, then the QA audit opens. The executive brief
is not rewritten; its own out-of-date badge asks for that, and its snapshot carries any
outside-catalog lines.

**Out of date.** `profile.narrativeChannelKey` records the channel mix the narrative was written
for (media types, outside-catalog lines and CTV publishers, not budget splits). When the plan's
mix no longer matches, after an upload, a budget-approach change or adding or removing a media
type, Channel Allocation offers **Rewrite plan content**. Plans written before the key existed are
never flagged.

---

## 7. Troubleshooting & Developer Guidelines

### Common Issues & Solutions

#### 1. Input Token Exceeded (`1,048,576 tokens`)
* **Root Cause**: Unbound file uploads or extremely large media plans (e.g., 500+ line items) injected directly into prompts.
* **Solution**: Ensure inputs are sanitized via `planPromptOptimizer.ts`. Keep sliced limits in `server.ts`:
  ```typescript
  const cleanAudienceDesc = (audienceDescription || "").slice(0, 1500);
  const cleanUrl = (url || "").slice(0, 500);
  const cleanCrawledText = (crawledPageText || "").slice(0, 1000);
  const cleanAdditionalContext = (additionalContext || "").slice(0, 500);
  ```

#### 2. Streaming Stalls or Timeouts
* **Root Cause**: Web search grounding across multiple parallel sub-calls taking extended time.
* **Solution**: Server uses SSE keep-alive pings every 4 seconds (`:\n\n`) and a 4-minute inactive watchdog (`lastEventTime > 240000`). Do NOT lower timeouts below 4 minutes.

#### 3. No RFP Groups on a Plan
* **Root Cause**: The plan was generated without an uploaded media plan, or its RFP lines matched no media type.
* **Behavior**: Without RFP media types the table shows one ungrouped list with no source badges except "Added by you". Unmatched RFP lines are listed in the warning above the rows. Plans saved before `rfpBaseline` existed still show their RFP media types (from `rfpChannels`), without RFP dollars.

#### 4. Model Selection Constraints
* Use `gemini-2.5-flash` for search-grounded research sub-calls and synthesis tasks to balance latency, grounded search output quality, and response stability.

---

## 8. Summary of Maintenance Checklist for Developers
* [ ] When adding new media channels or ad formats, update `/src/utils/mediaTaxonomy.ts`.
* [ ] When tweaking prompt structure, verify JSON output compatibility against `ChannelStrategyData` in `/src/types.ts`.
* [ ] Anything that shows a plan total or a media-type list reads `buildAllocationView` or `combinedPlan`, never `mediaPlan.channels` alone.
* [ ] Always verify build with `compile_applet` and lint with `lint_applet` after modifying `server.ts` or `src/App.tsx`.
