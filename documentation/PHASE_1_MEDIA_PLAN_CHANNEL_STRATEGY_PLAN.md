# Phase 1 Implementation Plan: Media Plan Selection & Channel Strategy Analysis

## 1. Executive Summary & Scope

This document details the complete technical architecture, data model, prompt design, and component specification for **Phase 1** of expanding ScoutAI from an Audience Profile generator into an end-to-end Media Plan recommendation platform.

### Phase 1 Core Objectives
1. **Multi-Plan Selection Workflow**: When an RFP / Media Plan document (Excel/CSV/PDF) is uploaded and parsed, allow users to inspect and select **one, multiple, or all** extracted plan options/variations.
2. **Mandatory Advertiser URL + Live Web Search**: Require the advertiser URL whenever a media plan is uploaded. ScoutAI performs live web grounding on the URL to establish deep brand and product context.
3. **Primary CTA Update**: Rename "Generate Audience Profile" to **"Run Analysis"** when a media plan is loaded. The execution path will generate both the Audience Profile and the new Media Plan analysis in a unified 2-stage pipeline.
4. **Canonical Media Taxonomy Normalization**: Standardize raw RFP channel names into ScoutAI's 19 canonical media types, with an **Interactive Taxonomy Review / Verification Badge** for user overrides/confirmation.
5. **Channel Strategy Visual Analysis Section**: Present a dual-card UI comparing **RFP Channels** vs. **ScoutAI Recommended Channels**, complete with 50/50 scores `(Audience Fit * 0.5) + (Goal Match * 0.5)`, evidence, justifications, and executive insights.
6. **Budget-Based Channel Recommendation Engine**: Recommend additional channels based on total plan budget tiers, ensuring **Display Retargeting** is always included at 10% of budget. Support both **Reallocation** and **Incremental Spend** modes.
7. **Sequential 2-Stage Pipeline + Unified Validation**:
   - **Stage 1**: Run Web Search Grounding -> Generate Advertiser Context & Audience Profile.
   - **Stage 2**: Feed Stage 1's rich profile & target audience + selected RFP plan options into Media Plan Analyzer -> Generate Channel Strategy.
   - **Stage 3 (Unified Validation)**: Quality Audit & Sanity Validator checks the entire combined artifact (Audience Profile + Channel Strategy) for cross-consistency, math accuracy, and zero hallucinations.
8. **Token Guard & Payload Truncation**: Intelligently compress large location targeting datasets (e.g., hundreds of ZIP codes) before sending payloads to the LLM.
9. **Full State Persistence**: Persist selected plans, taxonomy mappings, and Channel Strategy analysis inside application state so results survive browser refreshes and export actions.

---

## 2. Key Business Rules & Architectural Requirements

### 2.1 Advertiser URL & Live Web Search
- **Strict Requirement**: When a media plan file is uploaded, the Advertiser Website URL input field is mandatory.
- **Web Grounding**: During analysis execution, ScoutAI executes a live web search using Google GenAI grounding on the Advertiser URL to extract real-time advertiser context, value propositions, target audience signals, and vertical positioning.

### 2.2 Plan Selection Model
- Parsed media plans frequently contain multiple scenarios, flight options, or publisher packages (e.g., "Option 1: CTV heavy", "Option 2: Digital Audio").
- Users can check/uncheck checkboxes for extracted plans to analyze **Single Plan**, **Selected Subset**, or **All Plans Combined**.
- When multiple plans are selected, budget metrics, flights, and channel sets are aggregated into a unified baseline for analysis.

### 2.3 Channel Scoring Formula
- Each channel (both RFP existing channels and ScoutAI recommended channels) receives an overall **Score** on a scale of 1.0 to 10.0.
- **Formula**: `Score = (Audience Fit * 0.5) + (Goal Match * 0.5)`
  - *Audience Fit* (1–10 integer scale)
  - *Goal Match* (1–10 integer scale)
  - Efficiency and Creative Fit are excluded from the main score formula per project spec.
- Score colors:
  - **8.0 – 10.0**: High fit (Emerald green `#10b981`)
  - **6.5 – 7.9**: Medium-high fit (Amber/Yellow `#f59e0b`)
  - **< 6.5**: Moderate/Low fit (Orange/Coral `#ef4444`)

### 2.4 Budget-Based Recommendation Engine Rules
- **Display Retargeting Rule**: Display Retargeting **MUST ALWAYS** be included in the final recommended mix at exactly **10% of total budget**.
  - If RFP already has Display Retargeting, optimize its role and score.
  - If RFP lacks Display Retargeting, ScoutAI automatically adds it as a recommended channel.
- **Tier-Based Channel Additions**:
  | Total Monthly Spend Tier | Recommended Channel Additions |
  | :--- | :--- |
  | **< $15,000** | Add Display Retargeting only (if not present) |
  | **$15,000 – $29,999** | Up to **3 additional** media types |
  | **$30,000 – $49,999** | Up to **4 additional** media types |
  | **$50,000 – $99,999** | Up to **5 additional** media types |
  | **$100,000+** | Up to **6 additional** media types |
- **Budget Modes**:
  - **Reallocation Mode**: Reallocates the existing RFP total budget by shaving percentages from low-scoring RFP channels to fund high-scoring recommended channels.
  - **Incremental Spend Mode**: Preserves 100% of the RFP budget and calculates recommended additional budget required for new channel additions.

### 2.5 Sequential Pipeline & Unified Validation Architecture
1. **Stage 1 (Audience Profile & Context)**: Runs live website crawl/search, grounds the brand, generates personas, demographics, temporal patterns, and publisher affinities.
2. **Stage 2 (Media Plan Channel Strategy)**: Receives the Audience Profile output from Stage 1 as context + selected RFP plan options + budget rules. Generates RFP Channel Evaluations & ScoutAI Recommended Channels.
3. **Stage 3 (Unified Validation)**: A single audit pass evaluates both Audience Profile and Channel Strategy together. It verifies that target channels in the strategy match target personas/demographics, checks that budget allocations sum to 100%, enforces the 50/50 score math, and auto-corrects any discrepancies.

---

## 3. Data Models & TypeScript Types (`/src/types.ts`)

```typescript
export type CanonicalMediaType =
  | 'ctv'
  | 'youtube_tv'
  | 'sports_ott'
  | 'performance_tv'
  | 'digital_video_blend'
  | 'digital_audio'
  | 'geofence_video'
  | 'social_advertising'
  | 'amazon_ott'
  | 'programmatic_display'
  | 'programmatic_video'
  | 'youtube'
  | 'email_marketing'
  | 'linear_tv'
  | 'google_search'
  | 'geofence_display'
  | 'digital_out_of_home'
  | 'native'
  | 'display_retargeting';

export interface MediaTaxonomyItem {
  id: CanonicalMediaType;
  displayName: string;
  category: 'Video/TV' | 'Audio' | 'Display/Native' | 'Search' | 'Social' | 'Out of Home' | 'Other';
  aliases: string[];
  description: string;
}

export interface ParsedPlanOption {
  id: string;
  name: string;
  selected: boolean;
  budget: number;
  flightDates?: { start: string; end: string };
  rawChannels: string[];
  geosSummary?: string;
  kpis?: string[];
  lineItemsCount: number;
  placements: ExtractedPlacement[];
}

export interface TaxonomyMapping {
  rawLabel: string;
  canonicalId: CanonicalMediaType;
  confidence: number;
  isUserVerified: boolean;
}

export interface ChannelEvaluation {
  channelName: string;
  canonicalId: CanonicalMediaType;
  isRecommended: boolean;
  score: number; // (audienceFit * 0.5) + (goalMatch * 0.5)
  audienceFit: number; // 1-10 integer
  goalMatch: number; // 1-10 integer
  mediaConsumptionEvidence: string;
  whyItEarnsASpot: string;
  suggestedAllocationPercent?: number;
}

export interface ChannelStrategyData {
  rfpChannels: ChannelEvaluation[];
  scoutAiRecommendedChannels: ChannelEvaluation[];
  executiveInsight: string;
  budgetStrategyMode: 'reallocation' | 'incremental';
  totalRfpBudget: number;
  analyzedPlanNames: string[];
  generatedAt: string;
}
```

---

## 4. Components & Server Architecture

1. `/src/utils/mediaTaxonomy.ts`: 19 canonical media types catalog & `normalizeRawChannel` helper.
2. `/src/utils/planPromptOptimizer.ts`: Geo truncator, line-item aggregator & token guard.
3. `/src/components/MediaPlanSelector.tsx`: Checkbox multi-select list for parsed media plan options.
4. `/src/components/TaxonomyVerificationBadge.tsx`: Interactive verification modal for canonical media taxonomy mappings.
5. `/src/components/ChannelStrategySection.tsx`: Dual-card UI comparing RFP vs ScoutAI channels with reallocation/incremental spend toggles and executive insight.
6. `/server.ts`: Endpoint `/api/analyze-media-plan` running Stage 2 media plan evaluation with Stage 1 context, budget tier rules, and unified validation audit.
7. `/src/App.tsx`: Main integration, CTA "Run Analysis", URL validation, and persistent application state.

---
*End of Phase 1 Implementation Plan.*
