# ScoutAI Channel Strategy — Technical & Architectural Guide

## 1. Overview
The **Channel Strategy Module** in ScoutAI provides automated, data-driven evaluation and recommendation of media channels for advertising campaigns. It evaluates baseline Request for Proposal (RFP) media plan channels against target audience research dossiers, brand context, and budget constraints, while discovering incremental programmatic channel opportunities.

### Key Objectives
* **Baseline Channel Audit**: Evaluate user-uploaded or specified RFP channels on audience fit, campaign goal alignment, and media consumption evidence.
* **Algorithmic Channel Discovery**: Surface high-indexing programmatic channels (e.g., CTV, Audio, Digital OOH, Native, Social, OLV, Display) tailored to the audience's digital touchpoints.
* **Budget Strategy Optimization**: Support both **Reallocation** (shifting budget from lower-performing baseline channels) and **Incremental Spend** (adding budget for expansion).
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
[5. UI Rendering & Interaction] ─► /src/components/ChannelStrategySection.tsx
                                  (Renders RFP vs ScoutAI Cards, Score Badges, Budget Toggles)
```

---

## 3. Data Schema & Type Definitions

The Channel Strategy schema is defined in `/src/types.ts`:

```typescript
export interface ChannelEvaluation {
  channelName: string;
  score: number; // 0.0 - 10.0 scale
  audienceFit: number; // 0 - 10 rating
  goalMatch: number; // 0 - 10 rating
  mediaConsumptionEvidence: string; // Grounded evidence sentence with stats
  whyItEarnsASpot: string; // Strategic rationale
}

export interface ChannelStrategyData {
  rfpChannels: ChannelEvaluation[];
  scoutAiRecommendedChannels: ChannelEvaluation[];
  budgetStrategyMode?: 'reallocation' | 'incremental';
  totalRfpBudget?: number;
  executiveInsight: string;
}
```

---

## 4. Synthesis Prompting & Scoring Methodology

During the final synthesis step in `server.ts` (`/api/generate-research`), the system prompts Gemini to construct the `channelStrategy` object within the output JSON.

### Evaluation Criteria
1. **Audience Fit (0 - 10)**: Alignment between channel audience demographics/behavior and target profile research dossiers.
2. **Goal Match (0 - 10)**: Alignment with campaign objectives (e.g., Awareness, Lead Gen, Direct Response, Engagement).
3. **Composite Score (0.0 - 10.0)**: Calculated score combining Audience Fit, Goal Match, and Media Consumption evidence strength.

### Score Classification & Visual Indicators
| Score Range | Classification | UI Badge Style | Color |
| :--- | :--- | :--- | :--- |
| **8.0 – 10.0** | High Recommendation | `bg-emerald-50 text-emerald-700` | Emerald Green |
| **6.5 – 7.9** | Conditional / Moderate | `bg-amber-50 text-amber-700` | Amber Yellow |
| **< 6.5** | Low Alignment / Friction | `bg-rose-50 text-rose-700` | Rose Red |

### Prompt Engineering Guidelines (`/server.ts`)
* **Baseline RFP Mapping**: The synthesis model is fed the exact publishers, ad formats, and channels extracted from uploaded RFP plans.
* **Budget Tier Constraints**: Total RFP budget ($) guides the scale of recommended channels (e.g., high-budget plans receive premium CTV & OOH recommendations; smaller plans focus on high-efficiency Digital Display, Social, and Native).
* **Grounded Evidence**: `mediaConsumptionEvidence` must cite specific data points from the research sub-dossiers.

---

## 5. Budget Strategy Modes

The user can toggle between two budget optimization modes in `ChannelStrategySection.tsx`:

### A. Reallocation Mode (`reallocation`)
* **Concept**: Zero net spend increase.
* **Mechanism**: Reallocates budget away from baseline RFP channels with low composite scores (<7.0) or poor audience fit into top-scoring ScoutAI recommended channels.
* **Use Case**: Fixed-budget RFPs requiring performance enhancement without requesting additional funds.

### B. Incremental Spend Mode (`incremental`)
* **Concept**: Expanded campaign scope.
* **Mechanism**: Maintains baseline RFP commitments while adding budget allocations to ScoutAI recommended channels to capture incremental reach and frequency.
* **Use Case**: Growth-oriented campaigns with available flex budget or unallocated brand test budgets.

---

## 6. Frontend Component Architecture (`ChannelStrategySection.tsx`)

The component renders two primary comparison cards:
1. **Baseline RFP Channels Card**: Dark themed header (`bg-slate-900`), displaying user-provided channels with score metrics, audience fit, goal match, research evidence, and justification.
2. **ScoutAI Recommended Channels Card**: Indigo/gradient themed header (`bg-indigo-900`), highlighting AI-discovered opportunity channels.

### Key Features:
* **Interactive Budget Mode Toggle**: Seamless switching between Reallocation and Incremental Spend modes.
* **Copy Executive Summary**: One-click formatting of channel analysis text to clipboard for RFP inclusion or client presentations.
* **Responsive Layout**: Overflow-scrollable tables for dense desktop metric views and stacked cards for mobile viewports.

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

#### 3. Empty RFP Channels Array
* **Root Cause**: Request generated without uploading a media plan.
* **Behavior**: `data.rfpChannels` will be empty or populated with generalized baseline channels. The UI handles this gracefully by defaulting display text to `"existing RFP channels"`.

#### 4. Model Selection Constraints
* Use `gemini-2.5-flash` for search-grounded research sub-calls and synthesis tasks to balance latency, grounded search output quality, and response stability.

---

## 8. Summary of Maintenance Checklist for Developers
* [ ] When adding new media channels or ad formats, update `/src/utils/mediaTaxonomy.ts`.
* [ ] When tweaking prompt structure, verify JSON output compatibility against `ChannelStrategyData` in `/src/types.ts`.
* [ ] Always verify build with `compile_applet` and lint with `lint_applet` after modifying `server.ts` or `src/App.tsx`.
