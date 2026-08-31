# Media Type Selection and Recommendation Reference

## Purpose

This document describes the media types available in Plan Helper, how the current application chooses them, and how another application should analyze an existing media plan and recommend additional media types with defensible justifications.

The most important implementation recommendation is to use one canonical media-type registry. The current code has three overlapping taxonomies—the 19 choices in the media-type editor, 19 preference/rate-card entries with a few different names, and 16 channels in the AI scoring prompt. A new application should normalize incoming plan labels to canonical IDs before scoring, checking plan coverage, or generating recommendations.

## Executive summary: how Plan Helper picks media types today

Plan Helper's initial plan is primarily selected by an AI prompt, not by a deterministic ranking function:

1. It builds context from the advertiser profile, audience analysis, recommended audience segments, search terms, ad copy, website, estimated revenue, and calculated monthly budget.
2. The prompt asks the model to score 16 media labels from 1–10 on `goalFit`, `audienceMatch`, `efficiency`, and `creative`, and to explain each score in `notes` and `aiAnalysis`.
3. The same prompt asks the model to put only the best channels in the final `allocations` array, with an allocation percentage, budget, justification, primary KPI, and secondary KPI.
4. User-configured minimum allocations and forced inclusions are injected as hard constraints. The server then post-processes the AI response to add missing forced channels and raise allocations that are below their minimums.
5. A default smart rule adds Display Retargeting at 10% when a video/TV channel is present. Other unconstrained channels are reduced to make room.
6. Final validation normalizes allocations to 100% and rechecks constraints.
7. In the editor, users can add or remove media types subject to a budget-based channel limit. Forced types cannot be removed, and at least one type must remain.

The current default configuration force-includes CTV with a 40% minimum allocation and a 1.2 preference multiplier. Separately, manually adding CTV in the allocation editor initially assigns it 60% and redistributes the other 40%. Developers should treat those as product-specific business rules, not universal media-planning guidance.

## Current decision inputs and constraints

### AI scoring dimensions

| Dimension | Intended meaning | Default weight in settings |
|---|---|---:|
| Goal fit | How directly the channel supports the campaign objective and funnel stage | 40% |
| Audience match | Ability to reach the intended audience with useful precision and scale | 30% |
| Efficiency | Expected cost efficiency and ability to produce sufficient delivery | 20% |
| Creative fit | Suitability of the advertiser's message and available assets for the format | 10% |

These weights exist in settings, but the current allocation generation path does not pass them into the AI prompt or calculate a weighted total in code. Likewise, `forceExclude`, `maxAllocation`, and the general allocation settings (minimum/maximum per channel, concentration strategy, and risk tolerance) are configurable but are not consistently applied by the initial generation pipeline. The new application should enforce them explicitly and deterministically.

### Budget-based channel limits

The media-type editor uses the following default limits:

| Monthly budget | Maximum media types |
|---:|---:|
| $0–$4,999 | 1 |
| $5,000–$9,999 | 3 |
| $10,000–$49,999 | 5 |
| $50,000+ | 7 |

If budget thresholds are disabled, the editor permits 6 types. These are portfolio-complexity guardrails: each additional channel needs enough budget to clear minimum effective spend, produce measurable results, and cover creative/operational costs. The initial AI allocation prompt does not itself receive or enforce these channel-count tiers, so a new application should apply capacity checks before presenting a recommendation.

### Hard and derived rules

- A positive `minAllocation` becomes a hard minimum even if the type is not force-included.
- A force-included type without an explicit minimum receives a 5% fallback minimum.
- The sum of all hard minimums must not exceed 100%.
- Forced types are restored if the AI omits them and cannot be removed in the editor.
- The default video rule is: if any CTV, TV, OTT, YouTube, or video type is present, include Display Retargeting at 10%.
- Matching currently relies partly on case-insensitive substring/keyword checks. This makes aliases convenient but can also collapse distinct products—for example, CTV, Connected TV, streaming TV, and some OTT labels. Use explicit aliases and product-family relationships in the new application instead.

## Canonical catalog: all 19 selectable media types

The exact selectable labels below come from `MEDIA_TYPE_OPTIONS` in the media-type editor. “Recommend when” describes positive evidence the new application can cite; it is not an automatic inclusion rule.

| Canonical media type | Role and inventory | Recommend when | Useful KPIs | Important caveats / natural complements |
|---|---|---|---|---|
| **YouTube TV** | Ads in the YouTube TV live television service; a streaming/CTV product distinct from standard YouTube video inventory | The audience watches live TV/streaming, broad or local reach is needed, and TV-quality creative is available | Reach, frequency, completed-view rate, incremental reach, site visits/conversions where measurable | Premium CPMs and potential overlap with CTV/Linear TV. Pair with Search or Display Retargeting to capture response |
| **Sports OTT** | Live or on-demand sports inventory delivered through streaming services | Sports affinity, event timing, broad awareness, sponsorship alignment, or hard-to-reach live audiences are material to the plan | Reach, frequency, completed-view rate, brand lift, event-level delivery | Often expensive, seasonal, and supply-constrained. Validate league/event relevance and avoid treating sports fandom as proof of purchase intent |
| **Performance TV** | Streaming/TV inventory packaged and optimized toward attributable actions rather than reach alone | The advertiser has conversion volume, reliable site/app tracking, a broad enough target, and wants TV reach with performance optimization | Cost per acquisition, attributed conversions, incremental conversions, site visits, completed views | Attribution methodology and view-through windows can overstate impact. Distinguish it from general CTV and require conversion tracking |
| **Digital Video Blend** | A managed mix of video inventory, commonly combining streaming, web, app, and/or publisher video | The plan needs scalable video reach but does not require a single platform; flexible supply can improve delivery or cost | Reach, completed-view rate, cost per completed view, frequency, brand lift | The label hides inventory composition. Require publisher/device/environment reporting and control duplication with other video lines |
| **Digital Audio** | Streaming music, digital radio, and podcast audio advertising | The audience is reachable during commute, work, fitness, or screen-free moments; audio assets exist; incremental reach is valuable | Reach, frequency, listen-through/completion rate, site visits, brand lift | Limited visual storytelling and often weaker direct-response attribution. Pair with Search, Social, or retargeting |
| **Geofence Video** | Mobile or cross-device video served to people based on presence in defined physical areas | Store visitation, event conquesting, competitor-location targeting, or tight service-area reach is central and video assets are available | Qualified reach, completed-view rate, cost per visit, footfall lift, post-view actions | Location-data quality, privacy, minimum audience scale, and visit-lift methodology must be validated. Pair with Geofence Display or Search |
| **Social Advertising** | Paid placements across social networks; a rollup that may include Facebook, Instagram, LinkedIn, TikTok, and others | Strong platform audience fit, rapid creative testing, engagement, lead generation, commerce, or retargeting is needed | CPA, ROAS, leads, CTR, engagement, video views, reach | Platform choice matters greatly. Break out platform, objective, placement, and audience in execution; control overlap with other retargeting |
| **Amazon OTT** | Streaming TV/OTT inventory activated through Amazon's advertising ecosystem and audience data | Amazon behavioral/commerce signals are relevant, streaming reach is needed, or retail outcomes can be measured | Reach, completed-view rate, branded search lift, detail-page views, purchases/ROAS where eligible | Do not recommend solely because a business sells products. Confirm inventory/data access and manage overlap with CTV |
| **Programmatic Display** | Auction-based banner/rich-media inventory across sites and apps, generally for prospecting or broad targeting | Scalable reach, contextual/audience targeting, message testing, and cost-efficient impressions fill a clear plan gap | Reach, viewable impressions, CTR, CPA, viewability, invalid-traffic rate | Cheap impressions are not automatically effective. Require inventory quality, frequency, brand-safety, and viewability controls |
| **Programmatic Video** | Auction-based video across web, app, and other non-single-platform inventory | The plan needs video scale beyond YouTube/CTV, audience or contextual targeting is strong, and video creative exists | Completed-view rate, cost per completed view, viewability, reach, CPA | Inventory quality and placement type vary. Separate in-stream/out-stream, require fraud/viewability controls, and check overlap with the video blend |
| **YouTube** | Video placements on YouTube, excluding the distinct YouTube TV live-TV product | Search/interest signals, demonstration, education, consideration, or scalable video reach align with the objective | Completed views, view rate, earned actions, reach, conversions, brand lift | Needs platform-appropriate video and deliberate format selection. Pair with Search and remarketing; do not classify all YouTube as CTV |
| **Email Marketing** | Messages to permissioned first-party email audiences; primarily owned/CRM media rather than bought impressions | A compliant, sufficiently large list exists and retention, nurture, repeat purchase, lead progression, or reactivation is a gap | Delivery, click rate, conversion rate, revenue per recipient, unsubscribe rate | Cannot create net-new reach without list acquisition. Verify consent, deliverability, segmentation, and lifecycle strategy before recommending |
| **CTV** | Streaming television ads delivered to connected-TV devices and apps, usually premium long-form viewing inventory | Broad or incremental reach, awareness/consideration, household targeting, local TV replacement, or high-impact storytelling is needed | Unique reach, frequency, completed-view rate, incremental reach, brand/search lift, attributed visits | Often higher CPM and requires TV-quality creative. Manage household/device measurement and overlap with YouTube TV, Amazon OTT, Sports OTT, and Performance TV |
| **Linear TV** | Traditional scheduled broadcast or cable television inventory | Mass/local reach, live programming, older/broad demographics, cultural impact, or a need to complement digital-only delivery is supported by the audience data | Rating points, reach, frequency, cost per point, brand lift, search/site lift | Less addressable and slower to optimize than digital channels. Production and minimum-spend needs can be high; quantify duplication with CTV |
| **Google Search** | Paid search advertising on Google, capturing expressed keyword intent | Relevant search demand exists, users actively seek the product/service, conversion paths are measurable, and the plan undercovers demand capture | Conversions, CPA, ROAS, conversion rate, impression share | Search harvests existing intent and is constrained by query volume. It should not be justified as a stand-alone awareness solution; assess SEO and branded-query cannibalization |
| **Geofence Display** | Display ads delivered using visits to or presence within defined physical boundaries | Local/store traffic, events, competitor conquesting, dealer areas, or service-area precision create a location-based opportunity | Qualified reach, CTR, cost per visit, footfall lift, post-exposure actions | Same privacy, data-quality, scale, and visit-attribution cautions as Geofence Video. Creative must make the local relevance clear |
| **Digital Out Of Home** | Digitally served ads on place-based screens such as roadside, transit, retail, office, gym, or venue displays | Geographic presence, commuter/venue reach, high-frequency awareness, store proximity, or a public visual statement fills a plan gap | Estimated reach/frequency, impressions, lift studies, mobile retargeting response, footfall/search lift | Usually not person-level clickable media. Screen context, dwell time, creative legibility, proof-of-play, and geographic relevance matter more than raw impression count |
| **Native** | Paid units styled to match publisher content or recommendation feeds; settings and rate cards also call this “Native Display” | The advertiser has useful editorial/storytelling content and needs less interruptive consideration traffic beyond standard banners | Engaged visits, time on site, scroll depth, CTR, conversions, content completion | Clearly disclose sponsorship, validate publisher quality, and avoid clickbait. Requires content/landing-page depth, not just a resized display ad |
| **Display Retargeting** | Display ads aimed at prior site visitors, customers, or other known warm audiences | The plan creates meaningful site traffic but lacks a follow-up mechanism; conversion cycles are longer; audience pools clear privacy/platform minimums | CPA, conversion rate, return visits, reach/frequency, incremental conversions | Audience size is finite and high frequency can waste spend. Use exclusions, recency windows, suppression, and incrementality tests. This is the current automatic complement to video |

## Taxonomy mapping and known gaps

The AI prompt's 16 scored labels do not equal the 19 selectable labels. Normalize them as follows before comparing an uploaded plan with the catalog:

| AI scoring label | Canonical selectable type | Treatment |
|---|---|---|
| Search - Google | Google Search | Direct alias |
| Search - Bing | No exact selectable type | Map to a broader `paid_search` family, but retain Bing/Microsoft Ads as the platform. Do not silently relabel it Google Search |
| Display | Programmatic Display | Likely alias, subject to inventory details |
| Display Retargeting | Display Retargeting | Direct |
| Social - Facebook | Social Advertising | Child platform |
| Social - Instagram | Social Advertising | Child platform |
| Social - LinkedIn | Social Advertising | Child platform |
| YouTube | YouTube | Direct |
| CTV | CTV | Direct |
| Connected TV | CTV | Alias; should not be counted as an additional channel beside CTV |
| Audio | Digital Audio | Alias |
| Native | Native | Direct; `Native Display` is another current alias |
| Email Marketing | Email Marketing | Direct |
| Programmatic Video | Programmatic Video | Direct |
| DOOH | Digital Out Of Home | Alias; rate cards also use `Digital Out Of Home (DOOH)` |
| Affiliate Marketing | No selectable type | Score-only channel today. Either add it to the canonical catalog or exclude it from add-channel recommendations |

The scored list omits dedicated evaluations for YouTube TV, Sports OTT, Performance TV, Digital Video Blend, Geofence Video, Amazon OTT, Linear TV, and Geofence Display. These should receive their own scores in the new app if they remain recommendable products.

Two scored channels are not selectable today:

- **Microsoft/Bing Search** is paid search inventory on Microsoft's search network. It can add incremental query coverage, often with a different demographic and auction environment from Google, but search volume, audience fit, import quality, and marginal performance should be verified. If the new app can recommend platforms as well as media types, retain it as a child of a canonical `paid_search` family; otherwise report it as an execution suggestion under Google Search rather than pretending it is the same product.
- **Affiliate Marketing** is performance-based distribution through publishers, creators, comparison sites, or other partners, commonly paid on an action or revenue-share basis. It can be appropriate when conversion tracking, partner economics, margin, fraud controls, and program operations are ready. It is not currently addable in Plan Helper, so the new app must either add it deliberately to the product catalog or mark it unsupported rather than recommend an action the user cannot take.

## Recommended architecture for the media-plan analysis app

### 1. Normalize first

Give every type a stable ID such as `ctv`, `youtube_tv`, or `display_retargeting`. Store display names, aliases, parent family, platform, inventory environment, buying method, funnel roles, prerequisites, typical KPIs, and incompatibilities separately. Preserve the source plan's original label for auditability.

Do not use substring matching as the primary identity method. `YouTube` and `YouTube TV`, or `CTV` and `Performance TV`, are related but not identical. Model these as products within a family so the app can measure both exact presence and family-level overlap.

### 2. Build a structured plan profile

At minimum, extract:

- Campaign goals, funnel stages, target audiences, geography, timing/seasonality, and total budget.
- Current media types, platforms, allocations, estimated spend, flight dates, buying methods, audiences, and creative formats.
- KPI and measurement setup, conversion volume, first-party audience availability, pixels/SDKs, CRM/list readiness, and attribution method.
- Available creative by format and the operational ability to produce missing assets.
- Known constraints: must-use/must-not-use types, minimum/maximum allocations, contracts, privacy/legal limits, brand safety, and market-level inventory minimums.
- Performance evidence where available: marginal CPA/ROAS, reach/frequency, saturation, impression share, audience overlap, and confidence/sample size.

Represent unknown inputs explicitly. A missing field is not evidence that a channel is suitable.

### 3. Apply eligibility gates before ranking

A candidate should not be recommended when it is already present under an alias, force-excluded, unlawful/unavailable, unable to meet meaningful minimum spend, missing a non-negotiable prerequisite, or so overlapping that it adds no distinct value. Where a prerequisite can reasonably be created—such as producing audio creative—return a conditional recommendation and name the prerequisite.

Budget capacity should consider more than a count limit:

`incremental budget >= channel minimum effective spend + incremental creative/technology cost`

Also verify that funding the addition will not push current high-value channels below their effective minimums.

### 4. Score marginal value, not generic channel quality

A practical starting score for each eligible missing type is:

`baseFit = 0.40 × goalFit + 0.30 × audienceMatch + 0.20 × efficiency + 0.10 × creativeFit`

Then adjust it using explicit, reviewable factors:

`recommendationScore = baseFit × preferenceMultiplier + gapCoverage + synergy + incrementalReach - overlapPenalty - readinessPenalty - measurementPenalty`

Keep every component on a documented scale and return it with the result. Key distinctions:

- **Gap coverage:** Does the candidate add a missing funnel role, geography, audience moment, or format?
- **Incremental reach:** Does it reach people the current mix misses, rather than merely adding another vendor in the same family?
- **Synergy:** Does it create a useful sequence, such as CTV → Search/retargeting, DOOH → mobile/local Search, or prospecting → Email nurture?
- **Overlap:** How much audience, inventory, intent, and function duplicate current lines?
- **Readiness:** Are creative, landing pages, feeds, audience lists, tracking, and operators ready?
- **Measurement:** Can the app define success and distinguish incremental impact from view-through correlation?
- **Confidence:** How much of the conclusion is supported by plan data versus assumptions or generic benchmarks?

Use the model to interpret evidence and write explanations, but use code to enforce taxonomy, eligibility, arithmetic, exclusions, capacity, and hard constraints.

### 5. Rank as a portfolio decision

Evaluate the best addition together with what must be reduced to fund it. A candidate can score well in isolation and still harm the portfolio if it fragments a small budget or duplicates an existing channel. Return:

- `ADD`: evidence supports incremental value and the plan can fund/operate it.
- `TEST`: promising but uncertain; recommend a capped experiment with a decision rule.
- `CONDITIONAL`: appropriate only after named prerequisites are met.
- `DO_NOT_ADD`: redundant, infeasible, or unsupported, with the specific reason.

Recommendations should be few and prioritized. Filling every unused channel slot is not a strategy.

## Justification requirements

Every suggested addition should answer six questions:

1. **What is missing?** Identify the exact audience, funnel, reach, geography, timing, or measurement gap in the current plan.
2. **Why this type?** Tie the channel's mechanics to that gap and to specific facts extracted from the plan.
3. **Why now?** State the budget, seasonality, saturation, inventory, or performance signal that makes the addition timely.
4. **How should it be used?** Name the audience, format, geography, flighting, role, and interaction with existing media.
5. **How will success be judged?** Give primary/secondary KPIs, a test window, and a scale/stop rule.
6. **What is the tradeoff?** State the funding source, overlap risk, prerequisites, and confidence/assumptions.

Avoid unsupported language such as “this channel has high ROI,” “your audience is active here,” or “diversification will improve performance” unless the plan or an identified external benchmark supplies that evidence.

### Suggested output contract

```json
{
  "canonicalMediaTypeId": "display_retargeting",
  "displayName": "Display Retargeting",
  "status": "ADD",
  "recommendationScore": 8.2,
  "confidence": "high",
  "gapAddressed": "The plan invests in video prospecting but has no paid follow-up for site visitors.",
  "evidence": [
    { "source": "plan", "fact": "35% of spend is assigned to CTV and YouTube" },
    { "source": "plan", "fact": "Display Retargeting is absent" },
    { "source": "tracking", "fact": "A site pixel and conversion event are active" }
  ],
  "activation": {
    "testAllocationPercent": 8,
    "fundingSource": "Reduce overlapping broad display and reserve incremental budget",
    "audience": "Recent qualified site visitors, excluding converters",
    "prerequisites": ["Confirm audience pool meets platform minimums", "Set a frequency cap"]
  },
  "measurement": {
    "primaryKpi": "Incremental conversions",
    "secondaryKpis": ["CPA", "return-visit rate", "frequency"],
    "decisionRule": "Scale only if the holdout-adjusted CPA meets the campaign target after the test window"
  },
  "tradeoffs": ["Finite audience scale", "Potential overlap with social retargeting"],
  "assumptions": []
}
```

## Implementation issues to avoid carrying forward

- Do not maintain separate hard-coded catalogs in UI, settings, rate cards, prompts, and APIs. Generate them from one registry.
- Do not count aliases or platform children as independent diversification. CTV plus Connected TV is one type; Facebook plus Instagram may be one social family even when they are separate execution lines.
- Do not let an AI response bypass forced exclusions, maximum allocations, minimum effective spend, or a 100% total.
- Do not use a preference multiplier as proof of effectiveness. It is a business/user preference and should be shown separately from evidence-based fit.
- Do not automatically recommend a type merely because a budget tier allows another slot.
- Do not conflate channel selection with allocation. First decide whether a type adds incremental value; then solve the constrained allocation problem.
- Do not hide uncertainty. A conditional test with named evidence needs is more useful than a confident generic recommendation.
- Validate recommendation arithmetic after rounding, keep an audit trail of every rule/adjustment, and return the normalized source labels used in matching.

## Relevant source files

- `src/components/media-types-edit-modal.tsx` — the 19 selectable media types and budget-limit behavior.
- `src/contexts/settings-context.tsx` — rate cards, budget tiers, scoring weights, preferences, campaign-goal presets, and the default video-to-retargeting smart rule.
- `src/lib/research-steps/allocations.ts` — AI prompt, 16-channel score taxonomy, constraint extraction/enforcement, smart-rule processing, normalization, and media-label matching.
- `src/lib/types/research-types.ts` — score and allocation response shapes.
- `src/components/editable-media-allocations.tsx` — manual add/remove behavior, preference multiplier use, and special 60% CTV handling.
- `src/app/api/ai-budget-analysis/route.ts` — AI explanation shown after a budget change and the budget-tier expansion opportunity logic.
- `src/app/api/research/media-analysis/route.ts` and `src/app/api/research/media-analysis-parallel/route.ts` — per-channel narrative analysis generation.
