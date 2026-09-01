# ScoutAI Media Recommendation and Allocation Implementation Plan

## 1. Purpose

This document defines the agreed product and technical plan for expanding ScoutAI from audience research and persona generation into a complete Digital Remedy media recommendation and allocation system.

The target system will:

- Recommend only products Digital Remedy can execute.
- Normalize campaign budget to a 30-day planning period before determining the maximum number of media types.
- Recommend an evidence-backed portfolio of media types and allocate the actual campaign media budget across them.
- Use the ScoutAI planning workbook as the starting source for channel, targeting, publisher, creative, inventory, measurement, compatibility, and pricing knowledge.
- Enforce hard business rules and allocation arithmetic in code.
- Use AI for research interpretation, evidence synthesis, scoring support, explanation, and controlled handling of incomplete inputs.
- Keep settings browser/user-persisted initially, with a future migration path to shared server-side persistence.

This plan is the implementation source of truth for the initial release. It intentionally separates initial requirements from future enhancements so the first version can be delivered without closing off a more robust long-term architecture.

## 2. Confirmed Product Decisions

### 2.1 Product scope

ScoutAI will recommend only products that meet all of the following conditions:

- Digital Remedy can execute the product.
- The product is currently available for recommendation.
- The product is compatible with the advertiser, vertical, campaign goals, audience, geography, data, creative, budget, and measurement requirements.

The catalog must distinguish between:

- `live`: generally available and eligible for normal recommendation.
- `beta`: limited availability; may appear only as conditional and with a visible availability warning.
- `future`: roadmap only; never pitch as currently available.
- `retired`: retained for history and alias matching, but never recommended.

### 2.2 Budget basis

The maximum media-type count will be based on a normalized 30-day media budget.

The actual allocation dollars will still use the campaign's actual working media budget. Normalization affects portfolio-size eligibility; it does not change the amount of money the advertiser has.

### 2.3 Settings persistence

The first release will save Settings in the user's browser. Shared organizational persistence can be implemented later without changing the setting contract.

### 2.4 Channel count is a cap, not a target

A budget tier defines the maximum number of media types the plan may contain. The recommendation engine may and often should select fewer media types when:

- Additional media types would fragment the budget.
- A candidate cannot clear minimum effective spend.
- The candidate duplicates an existing media type without meaningful incremental value.
- Campaign inputs do not support a confident recommendation.
- Creative, data, operational, or measurement prerequisites are missing.
- The candidate does not improve the plan enough to clear the selection threshold.

## 3. Terminology

- **Media type / channel:** A selectable Digital Remedy media product, such as CTV/OTT, Online Video, Display, Audio, Native, or DOOH.
- **Channel family:** A broader inventory or execution family that can contain distinct products. For example, CTV/OTT can contain general CTV, Sports OTT, Amazon OTT, YouTube TV, and Performance TV products if Digital Remedy supports them distinctly.
- **Targeting tactic:** An audience or delivery method applied through one or more media types, such as ACR targeting, contextual targeting, CRM lookalikes, or sequential retargeting.
- **Enhancement:** A creative format, high-impact unit, inventory control, or other capability that attaches to a selected media type and never stands alone.
- **Measurement capability:** A Digital Remedy measurement product selected according to KPI, channel, vertical, budget, and data readiness.
- **Working media budget:** The amount available for media delivery before separately itemized data, creative, measurement, or platform fees.
- **Normalized 30-day budget:** The campaign's working media budget converted to a 30-day run rate for portfolio-size planning.
- **Plan stack:** A recommended channel together with its allocation, role, targeting, publisher guidance, creative, inventory controls, measurement, evidence, constraints, and assumptions.

## 4. Budget Normalization

### 4.1 Core formula

When the campaign duration is known:

```text
normalized30DayBudget = totalWorkingMediaBudget / campaignFlightDays * 30
```

Implementation requirements:

- `campaignFlightDays` must be at least 1.
- Flight dates should be inclusive and normalized to whole calendar days.
- The normalized result should retain full precision internally and be rounded only for display.
- Allocation dollars must be calculated from `totalWorkingMediaBudget`, not the normalized value.

### 4.2 Unknown campaign duration

If campaign duration cannot be determined:

- Treat the provided budget as a 30-day budget.
- Record a visible assumption: `Campaign length was not supplied; budget was treated as a 30-day budget.`
- Lower confidence in portfolio-size recommendations until duration is confirmed.

### 4.3 Uploaded plans

For an uploaded plan or RFP:

- Use the selected plan option's earliest start date and latest end date when the option represents one contiguous campaign.
- Do not sum mutually exclusive plan scenarios.
- If selected options represent separate flights, normalize each flight independently before combining results.
- Preserve the original plan's total spend and dates for auditability.
- Allow a planner to correct an incorrectly parsed budget or flight period before regeneration.

### 4.4 Short flights

A short campaign can produce a high normalized monthly run rate. This does not override:

- Minimum flight-length requirements.
- Minimum total-spend requirements.
- Creative production lead times.
- Inventory and measurement minimums.

The normalized tier is only one guardrail. Product-level eligibility rules remain authoritative.

## 5. Settings Experience

### 5.1 Navigation

Add a hamburger-menu button in the upper-right application header.

Initial menu:

1. `Settings`

No additional menu items are required for the first release.

### 5.2 Settings presentation

Settings may be presented as a dedicated view, modal, or right-side drawer. It must work on desktop and mobile and must not discard an in-progress brief.

The first settings group will be:

**Budget & Channel Limits**

The interface should explain:

> Budget tiers limit the maximum number of media types ScoutAI may recommend. ScoutAI may recommend fewer media types when additional channels would fragment the budget or fail campaign requirements.

### 5.3 Default budget tiers

| Minimum normalized 30-day budget | Maximum normalized 30-day budget | Maximum media types |
|---:|---:|---:|
| $0 | $4,999.99 | 1 |
| $5,000 | $9,999.99 | 3 |
| $10,000 | $24,999.99 | 4 |
| $25,000 | $49,999.99 | 5 |
| $50,000 | $99,999.99 | 6 |
| $100,000 | $499,999.99 | 8 |
| $500,000 | No maximum | 10 |

### 5.4 Editing behavior

The user must be able to:

- Edit tier minimums and maximums.
- Edit the maximum media-type count.
- Add a tier.
- Delete a tier.
- Reset all tiers to defaults.
- Cancel uncommitted edits.
- Save valid edits.

Validation must prevent:

- Overlapping ranges.
- Gaps between ranges.
- Negative budget values.
- Negative, zero, fractional, or unreasonably large media-type counts.
- A maximum that is lower than its minimum.
- More than one open-ended tier.
- An open-ended tier that is not the final tier.

The saved tier list should be sorted by minimum budget before validation and use half-open numeric boundaries internally to avoid floating-point boundary ambiguity.

### 5.5 Browser persistence

Suggested local-storage contract:

```json
{
  "version": 1,
  "budgetChannelTiers": [
    { "minBudget": 0, "maxBudgetExclusive": 5000, "maxChannels": 1 },
    { "minBudget": 5000, "maxBudgetExclusive": 10000, "maxChannels": 3 },
    { "minBudget": 10000, "maxBudgetExclusive": 25000, "maxChannels": 4 },
    { "minBudget": 25000, "maxBudgetExclusive": 50000, "maxChannels": 5 },
    { "minBudget": 50000, "maxBudgetExclusive": 100000, "maxChannels": 6 },
    { "minBudget": 100000, "maxBudgetExclusive": 500000, "maxChannels": 8 },
    { "minBudget": 500000, "maxBudgetExclusive": null, "maxChannels": 10 }
  ]
}
```

Suggested key:

```text
scoutai_planning_settings
```

Requirements:

- Validate stored data before using it.
- Fall back to defaults if the stored payload is invalid.
- Keep an explicit schema version for future migrations.
- Keep settings separate from saved audience profiles.
- Make clear in the UI that initial settings apply to the current browser.

### 5.6 Plan-level override

Settings define the default maximum. A planner should eventually be able to override the maximum for an individual plan.

An override should:

- Require an explicit user action.
- Display a budget-fragmentation warning when it exceeds the tier maximum.
- Be stored with the saved plan.
- Be included in the recommendation audit trail.
- Never bypass hard product minimums or Digital Remedy availability rules.

The tier override is not required for the first Settings implementation unless it can be added without delaying the core release.

## 6. Campaign Fact Model

The recommendation engine should operate on normalized campaign facts rather than raw form fields or long free-text prompts.

### 6.1 Required facts

- Advertiser name and URL.
- Advertiser vertical and subvertical.
- Campaign KPIs and primary objective.
- Funnel stages.
- Audience descriptions and persona-derived signals.
- Geography and location relevance.
- Total working media budget.
- Campaign start date, end date, and flight days.
- Normalized 30-day budget.
- Existing media types and allocations, if supplied.
- Available creative formats.
- Data and tracking readiness.
- Measurement expectations.
- Brand-safety and compliance constraints.
- Required, preferred, or excluded media types.

### 6.2 Data-readiness facts

At minimum, represent whether the campaign has:

- A working site pixel.
- Defined conversion events.
- Meaningful site traffic for retargeting.
- CRM seed lists.
- CRM suppression lists.
- Lead-status or revenue exports.
- Offline sales or transaction data.
- Product feed or SKU data.
- Store, venue, campus, or competitor locations.
- Permission and operational readiness for first-party and location data.

Unknown values must remain explicit. Missing information is not evidence that a prerequisite is satisfied.

### 6.3 Creative-readiness facts

Represent whether the advertiser has or can create:

- Display assets.
- Online-video assets.
- CTV-quality :15/:30 video.
- Audio assets and companion banners.
- Social-native assets.
- Editorial/native content.
- Product feed and commerce creative.
- DOOH-safe high-glance creative.
- High-impact-unit production budget and lead time.

## 7. Digital Remedy Product Registry

### 7.1 Canonical identity

Every recommendable product requires a stable ID. Display names and aliases may change without changing the ID.

Example hierarchy:

```text
channel_family.ctv_ott
  channel.ctv
  channel.sports_ott
  channel.amazon_ott
  channel.performance_tv
  channel.youtube_tv
```

The hierarchy prevents related products from being counted as unrelated diversification while preserving their different inventory, audience, measurement, and pricing characteristics.

### 7.2 Required channel fields

Each channel record should contain:

- `id`
- `displayName`
- `aliases`
- `familyId`
- `digitalRemedyExecutable`
- `status`
- `recommendationEligible`
- `defaultPriority`
- `funnelRoles`
- `supportedKpis`
- `audienceSignals`
- `verticalRules`
- `geographyRules`
- `creativeRequirements`
- `dataRequirements`
- `measurementCapabilityIds`
- `minimumTotalSpend`
- `minimumNormalized30DaySpend`
- `minimumFlightDays`
- `typicalCpmLow`
- `typicalCpmHigh`
- `minimumAllocationPercent`
- `maximumAllocationPercent`
- `scaleRating`
- `overlapFamilyIds`
- `complementaryChannelIds`
- `publisherIds`
- `sourceMetadata`

### 7.3 Eligibility policy

A channel is normally eligible only when:

```text
digitalRemedyExecutable = true
AND recommendationEligible = true
AND status = live
```

Beta products may become `CONDITIONAL` recommendations only after a future setting or explicit planner action allows them. Future and retired products are never included in current allocations.

## 8. Workbook Normalization

The source workbook contains valuable knowledge but should not be sent to the model as a raw workbook on every plan.

### 8.1 Recommended source-of-truth pattern

1. Maintain a cleaned, business-editable workbook.
2. Convert the workbook into versioned JSON files used by the application.
3. Validate every file against a formal schema at build or application startup.
4. Fail safely when a record is invalid.
5. Generate derived compatibility matrices from relationship records rather than maintaining duplicate hand-edited matrices.

### 8.2 Runtime collections

```text
planningKnowledgeBase
  channels
  targetingTactics
  publishers
  measurementCapabilities
  creativeEnhancements
  inventoryControls
  compatibilityEdges
  triggerRules
  metadata
```

JSON is preferred for the initial runtime because the catalog is modest, versionable, inspectable, and easy to validate. A relational database can replace the persistence layer later without changing the domain model.

Do not use semantic or vector retrieval to enforce compatibility, pricing, minimums, or availability. Those are exact structured rules. Semantic retrieval may be useful later for supporting evidence, long-form examples, or sales-language guidance.

### 8.3 Required shared fields

Each knowledge record should include:

- Stable ID.
- Human-readable name.
- Record type.
- Status and Digital Remedy executability.
- Structured triggers.
- Structured prerequisites.
- Compatible and incompatible relationships.
- Vertical gates.
- Pricing and minimums where applicable.
- Human-readable rationale text.
- Source workbook version.
- Last verified date.
- Business owner.
- Confidence or review status.

### 8.4 Structured triggers

Retain human-readable trigger text for explanation, but pair it with machine-testable rules.

Example:

```json
{
  "id": "rule.ctv_awareness_streaming",
  "all": [
    {
      "field": "campaign.primaryKpi",
      "operator": "in",
      "values": ["awareness", "reach", "incremental_reach"]
    },
    {
      "field": "audience.signals.streamingIndex",
      "operator": "gte",
      "value": 110
    }
  ],
  "requires": [
    {
      "field": "creative.ctvVideoAvailable",
      "operator": "equals",
      "value": true
    }
  ]
}
```

Supported condition groups should include `all`, `any`, and `not`. Supported operators should initially include `equals`, `not_equals`, `exists`, `in`, `contains_any`, `contains_all`, `gte`, `lte`, and `between`.

### 8.5 Compatibility edges

Replace binary `Y/-` relationships with explicit edge records:

```json
{
  "fromId": "tactic.acr_targeting",
  "toId": "channel.ctv",
  "relationship": "compatible",
  "availability": "allowed",
  "conditionRuleIds": [],
  "notes": "Requires supported ACR partner and appropriate creative."
}
```

Availability values:

- `default`
- `allowed`
- `conditional`
- `unsupported`
- `future`

### 8.6 Workbook cleanup before enforcement

The current workbook contains naming differences and incomplete records that must be reconciled before treating it as executable policy. Examples include:

- `CTV Programmatic Pause Ads` versus `CTV Pause Ads`.
- `Online/Order Attribution` versus `Online / Booking / Order Attribution`.
- `Consumer Journey / OPA` versus `Consumer Journey Analytics (OPA)`.
- Master entries without a corresponding detailed entry, including `Genre Targeting` and `Native Article`.
- High-impact-unit records with missing triggers, format types, and vendor specifications.
- Publisher records with an unpopulated tier.
- Compatibility rules labeled as inferred and requiring review.

Normalization must preserve source labels for auditability while mapping them to canonical IDs.

## 9. Recommendation Pipeline

### 9.1 Stage 1: Build campaign facts

Combine:

- User-entered brief fields.
- Uploaded plan or RFP facts.
- Advertiser website research.
- Audience research and personas.
- Existing channel allocations.
- Planner overrides.
- Saved Settings.

The result must be a structured `CampaignFacts` object that is validated before channel selection.

### 9.2 Stage 2: Eligibility filtering

Exclude or conditionally flag candidates based on:

- Digital Remedy execution availability.
- Product status.
- Vertical restrictions.
- Geography restrictions.
- Existing plan aliases and family-level duplication.
- Minimum total spend.
- Minimum normalized 30-day spend.
- Minimum flight length.
- Creative prerequisites.
- Data prerequisites.
- Measurement feasibility.
- Contractual or planner exclusions.

Code must enforce these gates. An AI response cannot reintroduce an ineligible product.

### 9.3 Stage 3: Candidate scoring

Recommended initial scoring dimensions:

| Dimension | Weight |
|---|---:|
| KPI and funnel fit | 30% |
| Audience and persona fit | 25% |
| Incremental gap coverage | 15% |
| Data readiness | 10% |
| Creative readiness | 10% |
| Measurement fit | 10% |

Each dimension should be scored on a consistent scale and returned with evidence. The weighted score should be calculated in code from validated component scores.

Separate adjustments may be applied for:

- Incremental-reach opportunity.
- Useful cross-channel sequencing.
- Competitive whitespace.
- Channel-family overlap.
- Operational complexity.
- Missing-but-solvable prerequisites.
- Weak or generic evidence.

Preference or business-priority multipliers must be displayed separately from evidence-based fit.

### 9.4 Recommendation statuses

Every evaluated channel should receive one of:

- `ADD`: Evidence supports inclusion and the channel is operationally ready.
- `TEST`: Promising but should receive a controlled test allocation and decision rule.
- `CONDITIONAL`: Appropriate only after named prerequisites or approvals are satisfied.
- `DO_NOT_ADD`: Redundant, infeasible, unsupported, low-value, or excluded.

Only `ADD` and approved `TEST` recommendations may receive allocations. A planner must resolve hard conditions before allocating a `CONDITIONAL` channel.

### 9.5 Stage 4: Portfolio selection

Select a portfolio rather than independently picking the highest-scoring items.

The selector must account for:

- Settings-based maximum media-type count.
- Minimum spend per selected media type.
- Funnel coverage.
- Audience and inventory overlap.
- Channel-family overlap.
- Cross-channel sequencing.
- Measurement coverage.
- Creative production burden.
- Operational complexity.
- Confidence and missing information.

The engine should stop adding media types when the next candidate does not improve the portfolio enough to justify fragmentation.

### 9.6 Stage 5: Deterministic allocation

Allocation requirements:

- Use the actual working media budget.
- Allocate only to selected, eligible Digital Remedy products.
- Total allocation percentage must equal exactly 100% after rounding.
- Total allocation dollars must equal the working media budget after rounding.
- Every selected media type must clear its minimum total and normalized spend.
- Enforce channel-level minimum and maximum allocation percentages.
- Enforce user-required and user-excluded media types.
- Prevent one channel family from appearing diversified merely through aliases or closely overlapping children.
- Preserve an audit log of every minimum, maximum, forced inclusion, exclusion, and rebalance.

A practical initial allocation method is:

1. Convert final channel scores into starting weights.
2. Apply strategic role multipliers where explicitly configured.
3. Apply required minimum allocations.
4. Cap channels at their maximum allocations.
5. Iteratively redistribute remaining budget across uncapped eligible channels.
6. Remove any channel that fails minimum effective spend and rerun the portfolio.
7. Apply stable rounding and distribute the final remainder without breaking constraints.

The AI may propose or explain strategic emphasis, but code owns the final arithmetic.

### 9.7 Planning modes

Support the current planning concepts with clear behavior:

- **Greenfield:** Allocate the full working media budget across the recommended portfolio.
- **Reallocation:** Evaluate the uploaded baseline, preserve valid constraints, and show which existing channels fund additions or changes.
- **Incremental:** Keep the existing plan fixed and allocate only explicitly supplied incremental budget.

The mode must affect calculation, not only prompt wording.

### 9.8 Measurement and non-media costs

Track separately:

- Working media.
- Data costs.
- Measurement fees.
- Platform fees.
- Creative or high-impact-unit costs.
- Other technical or added-value items.

Channel allocation percentages should normally sum to 100% of working media. Non-media items should be displayed separately and should not distort channel performance scores.

If the brief supplies only one total budget, the initial version may treat it as working media, but it must display that assumption.

## 10. Complete Plan Stack

For every selected media type, attach the following layers.

### 10.1 Targeting

Select compatible audience tactics using:

- Persona and demographic evidence.
- Advertiser vertical.
- KPI and funnel role.
- Data readiness.
- Channel compatibility.
- Privacy and vertical restrictions.

Examples include:

- Behavioral/demographic.
- Interest/affinity.
- B2B firmographic.
- CRM targeting, suppression, and lookalikes.
- Contextual and semantic targeting.
- Search intent and in-market signals.
- ACR targeting.
- Sequential retargeting.
- Geo-targeting and geo-conquesting.
- Retail-data activation.
- Daypart, device, and weather triggers.

### 10.2 Publishers

Recommend publishers only after selecting their parent channel.

Publisher ranking should eventually use:

- Channel compatibility.
- Tier and availability.
- Audience and genre tags.
- Premium, FAST, cable-replacement, or other environment classification.
- Scale.
- Geography.
- Advanced Performance compatibility.
- Measurement limitations.
- Minimums and pricing.
- Existing plan duplication.

Audio publishers should be bundled when the business rule calls for a combined audio package rather than falsely presented as separate strategic media types.

### 10.3 Creative and high-impact units

Enhancements never stand alone. They may surface only when:

- Their parent channel is selected.
- Their structured trigger fires.
- Required creative and production budget are available.
- The product is live and Digital Remedy-executable.

Display these as optional enhancements or upsells, not as the hero channel recommendation.

### 10.4 Inventory controls

Apply default safeguards to every relevant programmatic plan, including supported supply-path, fraud, and MFA controls.

Conditionally add:

- Allowlists.
- Blocklists.
- Viewability or attention thresholds.
- Content-suitability tiers.
- PMPs.
- Programmatic Guaranteed.

Inventory controls must not be described as audience targeting.

### 10.5 Measurement

Measurement selection should be based on:

- Primary business question.
- KPI and funnel stage.
- Selected media types.
- Vertical eligibility.
- Budget and impression minimums.
- Data readiness.
- Setup lead time.
- What the methodology can and cannot prove.

Every plan should identify:

- Primary measurement approach.
- Supporting delivery metrics.
- Required client data.
- Setup steps.
- Cost.
- Limitations.
- Reporting timing.

Measurement feasibility contributes to channel scoring and should not be appended only after media selection.

## 11. Recommendation Output Contract

The UI and API should return enough detail to support review and audit.

Example:

```json
{
  "normalized30DayBudget": 20000,
  "workingMediaBudget": 120000,
  "flightDays": 180,
  "maxMediaTypes": 4,
  "selectedMediaTypeCount": 3,
  "settingsVersion": 1,
  "channels": [
    {
      "channelId": "channel.ctv",
      "status": "ADD",
      "recommendationScore": 86,
      "confidence": "high",
      "allocationPercent": 45,
      "allocationDollars": 54000,
      "role": "Incremental awareness and household reach",
      "gapAddressed": "The current plan lacks premium streaming reach.",
      "evidence": [],
      "targetingTacticIds": [],
      "publisherIds": [],
      "creativeEnhancementIds": [],
      "inventoryControlIds": [],
      "measurementCapabilityIds": [],
      "prerequisites": [],
      "tradeoffs": [],
      "assumptions": []
    }
  ],
  "nonMediaCosts": [],
  "allocationAudit": []
}
```

### 11.1 Required explanation fields

Every selected media type should answer:

1. What exact gap does it address?
2. Why does this media type address that gap?
3. What campaign evidence supports it?
4. How should it be activated?
5. How will success be measured?
6. What prerequisites and tradeoffs exist?
7. Why did it receive this allocation?
8. What would cause the planner to reduce, scale, or stop it?

### 11.2 Evidence and confidence

Classify evidence as:

- `brief`
- `uploaded_plan`
- `advertiser_research`
- `audience_research`
- `digital_remedy_rule`
- `historical_performance`
- `industry_benchmark`
- `planner_override`
- `assumption`

Confidence should be separate from recommendation score. A high-fit channel with weak campaign-specific evidence should be labeled as a test or conditional recommendation.

## 12. User Experience

### 12.1 Brief inputs

Ensure the following fields influence generation:

- Budget.
- Campaign length or flight dates.
- Advertiser name and URL.
- KPIs.
- Audience.
- Geography.
- Campaign focus.
- Additional context.

The current budget and campaign-length inputs must be passed to the backend and included in saved profiles.

### 12.2 Planning summary

Before showing recommendations, display:

- Actual working media budget.
- Flight length.
- Normalized 30-day budget.
- Applied budget tier.
- Maximum media types.
- Selected media-type count.
- Planning mode.
- Assumptions requiring confirmation.

### 12.3 Allocation display

Show:

- Allocation percentage.
- Allocation dollars.
- Monthly-equivalent spend.
- Media role.
- Score and confidence.
- Minimum and maximum constraints.
- Funding source in reallocation mode.
- Expected primary and secondary KPIs.

### 12.4 Planner controls

Future manual allocation editing should:

- Keep the total at 100%.
- Rebalance other channels predictably.
- Prevent violations of hard minimums and maximums.
- Warn when a channel falls below effective spend.
- Preserve user changes in the audit trail.
- Allow reset to ScoutAI's recommendation.

## 13. Robustness and Safety Requirements

### 13.1 Deterministic enforcement

Code must own:

- Canonical IDs and aliases.
- Digital Remedy executability.
- Product status.
- Eligibility and exclusions.
- Budget tiers.
- Product minimums and maximums.
- Compatibility.
- Channel-count enforcement.
- Allocation arithmetic.
- Rounding.
- Data validation.

AI must not bypass these constraints.

### 13.2 Structured AI responses

AI calls should use structured output schemas. Validate responses before applying them. Invalid or partial responses should produce a safe fallback and a visible warning rather than silently inventing missing data.

### 13.3 Unknown inputs

Unknown prerequisites should be represented as unknown. The engine should:

- Ask for high-impact missing information when practical.
- Return a conditional recommendation when the missing fact is solvable.
- Exclude the product when a hard prerequisite cannot be confirmed.
- Record the assumption if a documented fallback is used.

### 13.4 Auditability

Persist with each saved plan:

- Settings version and applied tiers.
- Catalog version.
- Normalization inputs and output.
- Candidate scores.
- Eligibility failures.
- Selected and rejected media types.
- Allocation adjustments.
- Planner overrides.
- AI-generated evidence and explanations.

## 14. Data Still Needed

The workbook can support the first recommendation framework, but authoritative operational values are still needed.

### 14.1 Channel economics

For every Digital Remedy-executable media type:

- Typical CPM range.
- Minimum viable monthly spend.
- Minimum total campaign spend.
- Minimum flight duration.
- Minimum impressions or reach where applicable.
- Minimum and maximum allocation percentages.
- Scale limitations.
- Production cost and lead time.
- Supported geographies.

### 14.2 Measurement economics

Normalize:

- Included versus add-on pricing.
- CPM upcharge.
- Fixed fee.
- Minimum campaign budget.
- Minimum impressions.
- Minimum records.
- Setup lead time.
- Whether the fee is inside or outside working media.

### 14.3 Publisher metadata

Add:

- Tier.
- Environment classification.
- Audience and genre tags.
- Scale rating.
- Geography.
- Availability.
- Advanced Performance support.
- Measurement limitations.
- Minimums.
- Pricing guidance.
- Deal or package identifier.

### 14.4 Creative enhancements

Complete:

- Trigger.
- Format type.
- Vendor.
- Asset specifications.
- Production lead time.
- Added cost.
- Supported devices.
- Vertical restrictions.
- Status.

### 14.5 Governance

Every business-controlled record should eventually have:

- Business owner.
- Last verified date.
- Effective date.
- Source or approval reference.
- Review status.
- Change history.

## 15. Historical Performance Feedback Loop

The strongest future improvement is to calibrate the planning engine using Digital Remedy campaign performance.

Historical data should be normalized by:

- Media type and family.
- Publisher.
- Advertiser vertical.
- KPI and funnel stage.
- Audience strategy.
- Geography.
- Budget tier.
- Flight duration.
- Creative format.
- Measurement method.
- Seasonality.

Use historical performance as an evidence source and score calibration input, not as an automatic rule. Protect against:

- Small samples.
- Survivor bias.
- Attribution-method differences.
- Changes in pricing or inventory.
- Outdated tactics.
- Vertical and budget mismatches.

The recommendation should show when historical Digital Remedy performance influenced a decision.

## 16. Scenario Planning

After the core allocation engine is reliable, support constrained scenarios such as:

- Recommended balanced plan.
- Performance-weighted plan.
- Reach/awareness-weighted plan.
- Conservative test plan.

All scenarios must use the same eligibility, executability, compatibility, and budget rules. Scenarios change weights and strategic emphasis, not hard constraints.

## 17. Implementation Phases

### Phase 1: Settings and budget plumbing

- Add hamburger menu and Settings entry.
- Add editable budget/channel tiers.
- Persist settings in browser local storage.
- Add validation and reset-to-default behavior.
- Pass budget and campaign duration to the backend.
- Calculate and display normalized 30-day budget.
- Save budget, flight, and applied settings with profiles.

### Phase 2: Canonical Digital Remedy registry

- Reconcile the app's current taxonomy with the workbook.
- Define stable channel families and product IDs.
- Mark Digital Remedy executability and product status.
- Add explicit aliases.
- Prevent non-executable and unavailable recommendations.

### Phase 3: Workbook normalization

- Clean duplicate and inconsistent names.
- Define schemas for all knowledge collections.
- Convert workbook content to versioned JSON.
- Replace duplicate matrices with compatibility edges.
- Add build/startup validation.
- Establish initial governance metadata.

### Phase 4: Eligibility, scoring, and portfolio selection

- Build `CampaignFacts`.
- Apply deterministic eligibility gates.
- Calculate evidence-linked channel scores.
- Apply budget-tier maximum.
- Select a portfolio that avoids fragmentation and overlap.
- Return ADD, TEST, CONDITIONAL, and DO_NOT_ADD decisions.

### Phase 5: Allocation engine

- Add per-channel minimums and maximums.
- Implement deterministic allocation and rebalancing.
- Enforce a 100% total and stable rounding.
- Support greenfield, reallocation, and incremental modes.
- Produce allocation audit details.

### Phase 6: Complete plan stack

- Attach targeting tactics.
- Attach publishers.
- Attach creative enhancements.
- Attach inventory controls.
- Attach measurement capabilities and costs.
- Present prerequisites, limitations, and confidence.

### Phase 7: Planner controls and scenarios

- Add plan-level channel-count override.
- Add manual allocation editing.
- Add scenario comparison.
- Preserve all overrides and validation results.

### Phase 8: Shared persistence and learning

- Replace browser-only Settings with authenticated server-side persistence.
- Add organization and user-level settings.
- Add roles and permissions.
- Ingest historical campaign performance.
- Calibrate recommendations using validated outcome data.

## 18. Testing Strategy

### 18.1 Settings tests

- Defaults load when no saved settings exist.
- Valid edits persist across refresh.
- Invalid stored data falls back safely.
- Tiers cannot overlap or contain gaps.
- Exact boundary values select the correct tier.
- Reset restores all defaults.

### 18.2 Normalization tests

- A $120,000 campaign over 180 days normalizes to $20,000 per 30 days.
- Missing duration treats the budget as 30-day and records an assumption.
- Zero or negative duration is rejected or safely normalized to at least one day.
- Uploaded alternative scenarios are not summed together.

### 18.3 Eligibility tests

- Non-Digital Remedy products are never recommended.
- Future and retired products are never allocated.
- Beta products cannot appear without explicit eligibility.
- Vertical exclusions are enforced.
- Missing hard prerequisites prevent allocation.
- Aliases do not create duplicate media types.

### 18.4 Portfolio tests

- $4,999 normalized budget allows at most one media type.
- $5,000 allows at most three.
- $10,000 allows at most four.
- $25,000 allows at most five.
- $50,000 allows at most six.
- $100,000 allows at most eight.
- $500,000 allows at most ten.
- The engine may select fewer than the maximum.
- Minimum effective spend can reduce the selected count.

### 18.5 Allocation tests

- Percentages equal exactly 100%.
- Dollars equal the working media budget.
- Minimums and maximums are honored.
- Rounding is stable and deterministic.
- Removing an infeasible channel triggers a valid reallocation.
- Reallocation and incremental modes produce materially different, correct results.
- Non-media fees are not scored or counted as media reach channels.

### 18.6 Explanation tests

- Every selected media type names the gap addressed.
- Evidence is traceable to a known source category.
- Missing information appears as an assumption or prerequisite.
- Confidence is present and separate from fit score.
- Rejected channels include a specific reason.

## 19. Initial Acceptance Criteria

The first end-to-end release is complete when:

1. The hamburger menu opens Settings without losing the current brief.
2. Budget tiers are editable, validated, resettable, and browser-persistent.
3. Budget and duration produce the correct normalized 30-day budget.
4. The correct tier controls the maximum media-type count.
5. Only live, recommendation-eligible Digital Remedy products are selected.
6. The engine can select fewer than the tier maximum.
7. Selected channels satisfy required minimum spend and prerequisites.
8. Allocations total exactly 100% and the actual working media budget.
9. Every selected media type contains evidence, activation guidance, measurement, constraints, and allocation rationale.
10. Settings, catalog version, normalization, selection, and allocation decisions are auditable.

## 20. Future Server-Side Settings Migration

The local-settings schema must be designed so it can later move to a backend without changing UI consumers.

Future settings precedence should be:

```text
system defaults
  -> organization settings
  -> user settings
  -> plan-level override
```

The future backend should add:

- Authenticated users.
- Organization membership.
- Roles and administrative permissions.
- Versioned settings records.
- Effective dates.
- Change history.
- Optimistic concurrency or conflict handling.
- Import of existing browser settings where appropriate.

## 21. Environment and Secret Handling

Local development requires:

- `GEMINI_API_KEY`
- `OPEN_AI_KEY`
- `TEST_USER`
- `TEST_PASSWORD`

Secrets must remain in ignored local environment files and must never be committed, logged, included in generated plans, or sent to the browser.

The repository currently initializes server environment variables through `dotenv.config()`, which reads `.env` by default. If local development standardizes on `.env.local`, server startup must explicitly load `.env.local` before `.env`, while preserving production-injected environment variables.

## 22. Summary

ScoutAI should become a constrained Digital Remedy planning system rather than an unconstrained channel-list generator.

The central architecture is:

```text
campaign facts
  -> Digital Remedy product eligibility
  -> evidence-linked scoring
  -> budget-constrained portfolio selection
  -> deterministic allocation
  -> targeting, publisher, creative, inventory, and measurement attachments
  -> auditable explanation and planner controls
```

The 30-day normalized budget and editable tier settings provide the first portfolio guardrail. Product economics, prerequisites, compatibility, and confidence then determine whether the plan should use the maximum number of media types or a more concentrated mix. This preserves planner flexibility while preventing AI-generated plans from becoming over-diversified, operationally infeasible, or disconnected from Digital Remedy's executable capabilities.

