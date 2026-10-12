# Estimated Reach & Frequency: Implementation Plan

Status: Phases 1 and 2 implemented 2026-10-12 (uncommitted) · Owner of assumptions: Media Planning · Code area: `src/planning/reach/`, `OverviewMetricsTab`, Settings

## 1. Problem

The Overview's **Estimated Reach** is `impressions / 5.45` (planned side: `/ 6.00`), in
`src/components/OverviewMetricsTab.tsx`. It ignores geography, flight length and media mix, so:

- A $1.5M / 365-day plan targeting only the Washington DC DMA shows **17.3M HH**, while the DMA
  has **2,476,680** TV households.
- Reach grows linearly with budget forever; there are no diminishing returns.
- In Plan vs. AI Scout mode the reach delta is fixed by constants (always about +32.6%).
- Frequency is an input, not a result, and "lower is better" is hard-coded into its delta colour.

## 2. Goals

1. Reach can never exceed the targeted household universe, at National, State or DMA level,
   with ZIP added later without reworking the model.
2. Reach comes from a saturating curve per media type, combined across channels. Frequency is
   derived from it: `impressions / reach`.
3. Reach and frequency are shown **per month**, since planning flights campaigns monthly.
4. Every assumption lives in Settings, where planners can see and edit it, and every plan can show
   the numbers behind its own estimate.
5. Phase 2 (immediately after): narrow the universe to the target audience.

Out of scope: the eCPM "SPO efficiency" multiplier (×0.83) and the VCR constants. They are flagged
in §9 as follow-ups.

---

## Phase 1: Geo-aware reach curve

### 1.1 Household universe data

| Geo | Source | Status |
|---|---|---|
| National | Sum of the state table (see the note below) | Ready |
| DMA | `assets/dma-to-state.csv` → `dmaMarkets.json` (already built and used by `geoCoverage`) | Ready |
| State | `assets/state-tv-hh.csv` (new) | Ready. DC added at 2,672,000 (2.09%), as supplied by Media Planning |
| ZIP | Future CSV | See §1.8 |

- Add `src/planning/knowledge/buildStateHouseholds.ts`, following the `buildDmaMarkets.ts` pattern.
  - It reads the CSV and matches the `State` name against `US_STATES` (name or alias).
  - It writes `stateHouseholds.json` keyed by USPS code, with a `sourceLabel` and `totalTvHouseholds`.
  - It **fails the build** if any of the 51 codes is missing or a name doesn't match.
  - The JSON is committed and never parsed at runtime, the same as the DMA data.
- Add a test asserting the state JSON and `US_STATES` stay in step (like `dmaMarkets.test.ts`).
- **The two files don't agree on the national total.** The DMA total is 114.7M; the state total is
  119.9M. They are probably from different years. Rules:
  - National uses the state total.
  - DMA uses DMA counts.
  - Each source label is shown in Settings so planners can see where each number comes from.
  - Refreshing the DMA CSV to the same year is a data task, not a code task.

### 1.2 Universe resolver

New module `src/planning/reach/universe.ts`:

```ts
interface HouseholdUniverse {
  households: number;
  scope: "national" | "state" | "dma" | "zip";
  unitCount: number;          // states / markets / zips selected
  sourceLabel: string;
  unresolved: string[];       // entries we could not size
}
resolveHouseholdUniverse(geo: GeoTargeting | undefined): HouseholdUniverse
```

- **National** (or no geo, or empty entries): the national total.
- **State:** sum the selected states from `stateHouseholds.json`. States don't overlap, so there's
  no double counting. This is why we need the state file instead of rolling DMAs up to states.
- **DMA:** sum the selected markets. This is the same figure `geoCoverage` reports today; reuse it.
- **Unknown entries:** recorded in `unresolved`, and surfaced in the calculation details.

**As built (fix):** the brief's geography lives in the picker (`geographyConfig`: display
names from `src/utils/geoReference.ts`), not in `profile.geoTargeting`, which nothing sets.
`src/planning/reach/briefGeography.ts` converts the picker's selection: DMAs by name, plus a
checked table for 18 abbreviated names, because 23 of the picker's own codes point at other
markets. A test asserts all 206 picker DMAs resolve.

The resolver is the only place the geo scope is considered. The reach model only sees a household count.

### 1.3 Reach model

New pure module `src/planning/reach/reachModel.ts` (no React, fully unit-tested).

**Per channel, per month:**

```
monthlyImpressions_i = channelImpressions_i × 30 / flightDays     (flight ≤ 30 days → as-is)
U_i     = universe × maxReachPct_i
reach_i = U_i × (1 − e^(−monthlyImpressions_i / (U_i × s_i)))
```

- `maxReachPct`: the share of households that channel can reach (its penetration ceiling).
- `s` (duplication factor): roughly how many impressions it takes to add a new household when
  volume is low. A higher `s` means reach builds more slowly.

**Across channels** (Sainsbury method; assumes channels overlap at random):

```
reach_total = universe × (1 − Π (1 − reach_i / universe))
frequency   = Σ monthlyImpressions_i (counted channels) / reach_total
```

**Where channel impressions come from:**
- ScoutAI plan: `channel.allocationDollars / CPM × 1000`, where CPM is the midpoint of that
  channel's CPM range. Each channel uses its own CPM, not the blended one used today. Channel
  impressions must add up to the Estimated Impressions card.
- Uploaded plan: placements grouped by canonical media type, using the parser's existing mapping.
  - A placement's own impressions are used when present; otherwise budget ÷ CPM.
  - Placements that can't be mapped use the "Unmapped" row in Settings.
- Custom products inherit the reach parameters of their `canonicalId`.

**Flight length:** use `mediaPlan.flightDays`, which already backs the 30-day budget normalisation.
If it's missing, treat the flight as 30 days and say so in the calculation details.

**Worked example (the DC test):** $1.5M over 365 days, 94.36M impressions, all CTV
(80% maximum reach, s = 3.5):
- Monthly impressions: 7.76M.
- Universe: 2,476,680 × 80% = 1.98M households.
- **Monthly reach: about 1.33M HH (54% of the DMA). Monthly frequency: about 5.8.**
- The same plan nationally gives about 2.19M HH a month at a frequency of about 3.5.

### 1.4 Overview display

- **Cards:**
  - "Estimated Reach" becomes **"Est. Monthly Reach"**, formatted as today (`1.3M HH`), with a
    sub-line showing the universe share: "54% of Washington DC DMA HH".
  - "Avg Frequency" becomes **"Avg Monthly Frequency"**.
- **Plan vs. AI Scout:** both sides run through the same model. The reach delta then comes only
  from real differences in impressions and channel mix, not from constants.
- **Frequency delta:** drop "lower is better". The colour shows whether the value is inside the
  planner-set **target monthly frequency band** (§1.5); otherwise it's neutral.
- **Calculation details:** an info popover on the reach card shows:
  - the universe and its source;
  - a per-channel table (monthly impressions, maximum %, s, reach);
  - which channels were excluded and why;
  - the combined reach and frequency;
  - any assumptions (for example, "flight length unknown, assumed 30 days").

  It's hidden behind a new Internal-Only setting, **"Reach calculation details"**, default on for
  internal use and off for screen-sharing with clients.

  **As built:** the panel also has a share-link eye, **hidden by default**. A planner turns it on
  per plan (`AudienceProfile.shareReachDetails`, autosaved). It isn't one of the
  `hiddenSections`, because those are shown until a planner hides them. On the share link the
  panel is read-only: there's no audience editor and no pointer to Settings.

### 1.5 Settings: new "Reach & Frequency" tab

Add this tab to `SettingsDrawer` after "Budget & Media-Type Limits". Settings version 5 → 6, with
a migration in `migrateStoredSettings` that fills in defaults.

Reach settings live inside `PlanningSettings`, so they're versioned with every settings revision
like everything else. A saved plan should compute reach from **the settings revision it was
generated against**, so a planner changing a default doesn't move the numbers on existing plans.
Confirm that `OverviewMetricsTab` is given the plan's pinned revision, not the current one. Global
writes stay admin-gated (`requireAdmin`).

**A. Household universe (read-only reference)**
- National total, number of states and DMAs, and each file's source label.
- A searchable list of state and DMA household counts.
- The data is changed by replacing the CSV and running the build script. It isn't editable in the
  UI because it's reference data, not a planning assumption. The tab says this.

**B. Reach parameters by media type (editable)**

One row per canonical media type, plus an "Unmapped" row:

| Field | Meaning |
|---|---|
| Counts toward reach | Include in household reach (off for intent and non-delivery types) |
| Max reachable % of HH | The channel's penetration ceiling in any geography |
| Duplication factor (s) | How quickly reach saturates |
| Unit | Households, or people (DOOH), with a people-per-household divisor |
| Rationale | Free text, so planners can record where the number came from |

Starting defaults, **for Media Planning to review before launch**:

| Media type | Counts | Max % | s | Note |
|---|---|---|---|---|
| CTV | ✓ | 80 | 3.5 | |
| YouTube TV | ✓ | 8 | 3 | About 9M subscriber households |
| Sports OTT | ✓ | 35 | 3 | |
| Amazon OTT | ✓ | 55 | 3 | |
| Linear TV | ✓ | 60 | 3 | Pay TV plus over-the-air |
| Programmatic video / Digital video blend / YouTube | ✓ | 85 | 4 | |
| Programmatic display | ✓ | 90 | 6 | |
| Native | ✓ | 80 | 5 | |
| Digital audio | ✓ | 60 | 4 | |
| Social | ✓ | 75 | 5 | |
| Geofence video / display | ✓ | 10 | 6 | Fenced audience is small; override per campaign later |
| DOOH | ✗ | 50 | 4 | Measured in people; ÷ 2.5 people per household if turned on |
| Google Search, Email, Display retargeting | ✗ | n/a | n/a | Intent, list or site-visitor audiences; not incremental reach |
| Advanced measurement, Ad serving | ✗ | n/a | n/a | Don't deliver ads |
| Unmapped | ✓ | 80 | 4 | |

**C. Frequency**
- Target monthly frequency band. Default 3–8; drives the frequency delta colour.

**D. Method (read-only)**
- The formulas from §1.3, written out in plain language, so planners can see the logic.

### 1.6 Files touched

| File | Change |
|---|---|
| `assets/state-tv-hh.csv` | Add DC row (data) |
| `src/planning/knowledge/buildStateHouseholds.ts` + `stateHouseholds.json` + `stateHouseholds.ts` | New |
| `src/planning/reach/universe.ts`, `reachModel.ts` (+ tests) | New |
| `src/planning/settings.ts` | `ReachSettings` type, defaults, v6 migration, validation, new internal-only toggle |
| `src/components/SettingsDrawer.tsx` | "Reach & Frequency" tab |
| `src/components/OverviewMetricsTab.tsx` | Take `geoTargeting`, `flightDays` and `reachSettings`; replace constants with `reachModel`; monthly labels; details popover |
| `src/App.tsx` (~5860) | Pass `profileData.geoTargeting` and reach settings into `OverviewMetricsTab` |
| `documentation/` | Short planner-facing explainer of the method |

### 1.7 Tests

- Universe:
  - national total;
  - the DC DMA equals 2,476,680;
  - several DMAs add up;
  - states add up with no DMA double counting;
  - unknown entries are reported.
- Model:
  - reach is never above the universe and rises with impressions;
  - near-linear at low volume (reach ≈ I/s);
  - Sainsbury result is at least the largest single channel and at most the universe;
  - excluded channels add nothing;
  - a flight of 30 days or less isn't scaled.
- Regression: the DC test case shows a reach no higher than 2.48M HH, and a monthly frequency.
- Settings: v5 → v6 migration keeps existing values and fills reach defaults.
- Overview: monthly labels render; the details popover respects its Internal-Only toggle.

### 1.8 Designing for ZIP later

- ZIP becomes one more case in `resolveHouseholdUniverse`: sum the selected ZIPs from a
  `zipHouseholds.json` built by the same script pattern.
  - Nothing in `reachModel` changes.
  - `GeographyType` / `GeoScope` gain `zip`.
  - A ZIP list may run to thousands of entries, so `MAX_GEO_ENTRIES` (250) needs a ZIP-specific
    limit.
- **Small-universe effect:** with a few ZIPs, the curve saturates fast and monthly frequency gets
  very high. That's correct, and it's why the frequency band (§1.5C) should flag it rather than
  hide it.
- **Channel minimum universe:** some channels can't target below a certain geography size
  (linear TV can't target a ZIP). Add a planner-editable "Minimum targetable universe (HH)" per
  media type now, so the ZIP phase can mark a channel as "not deliverable at this geo" without
  another settings migration.

---

## Flight reach and the NBD curve (added 2026-10-12)

- **Reach card headline:** unique reach over the whole flight, with monthly reach and frequency as
  the sub-line. This matches the flight-total budget and impressions on the other cards. Flight
  reach is the curve applied to the whole flight's impressions, never monthly reach × months.
  Flights of 30 days or less show a single figure.
- **Curve:** the per-media-type curve is now the NBD (negative binomial) reach model,
  `reach = ceiling × (1 − (1 + x/k)^−k)` with `x = impressions / (ceiling × s)`. k ("audience
  concentration", editable in Settings) lets reach keep building slowly over long flights as
  light viewers are found.
  - Defaults: TV-like media 2, online video and audio 1.5, display, native and social 1.
  - Large k reproduces the earlier exponential curve.
- **Known behaviour:** for budgets that are small relative to the universe (for example a modest
  national plan), flight reach comes out close to monthly reach × months. Coverage is too thin
  for the curve to bend, so the model treats each month as reaching mostly new households.

## Phase 2: Audience-share narrowing

> **As built (2026-10-12):** override and Settings filters are implemented, along with the
> floor and the per-media-type "Applies audience targeting" switch. The planner edits the
> audience in the overview's "How reach is calculated" panel, and it autosaves onto the plan
> (`AudienceProfile.audienceNarrowing`).
> **Segment sizing (source 2) is deferred:** no source of real segment sizes exists yet, and
> letting the AI estimate them would break the "AI never sets the share" rule.
> **Combining media:** audience-targeted media types are combined within the target first,
> then with untargeted media across the whole geography, so their shared pool isn't treated
> as independent. Code: `src/planning/reach/audienceShare.ts` and `reachModel.ts`.

Reach should be measured against the households the campaign is **targeting**, not every household
in the geography.

### 2.1 Model change

```
targetUniverse = geoUniverse × audienceSharePct
```

`targetUniverse` replaces `universe` in §1.3.

**Exception:** channels that can't target by audience (DOOH, broad-reach linear) keep the geo
universe. That's a per-media-type toggle, **"Applies audience targeting"**, default on.

### 2.2 Where audience share comes from (in priority order)

1. **Planner override.** Typed on the plan, for example "Audience = 18% of HH". It's recorded and
   always wins.
2. **Segment sizing.** If the chosen segments carry household or audience sizes (third-party
   segment counts), use their combined share. The `SegmentRecommendation` type has no size field
   today, so adding one is part of this phase.
3. **Demographic lookup.** Map the Brief of Record's structured targeting (age, HHI, presence of
   children, and so on) to shares in a planner-editable **Audience Share Reference** table in
   Settings. For example: HHI $150K+ ≈ 20%, HH with kids < 18 ≈ 27%. Multiply independent filters;
   use the most restrictive one for overlapping filters.
4. **Fallback.** 100% (geo universe only), shown as "Audience narrowing not applied".

The AI must not invent the share. The research layer can *suggest* filters, but the percentages
come from the reference table or the planner. This matches how `geoSummaryForPrompt` states
code-computed facts.

### 2.3 Settings additions

- **Audience Share Reference** table: filter, share %, source, notes.
- **Floor:** minimum audience share (default 2%), so a stack of filters can't shrink the universe
  to almost nothing.
- Per media type: **"Applies audience targeting"**.

### 2.4 Display

- The reach sub-line becomes: "54% of the 640K target HH in Washington DC DMA (26% of 2.48M)".
- The details popover lists each filter and its share.

### 2.5 Tests

- Override beats segments, which beat the lookup, which beats the fallback.
- The floor applies.
- Channels that don't apply audience targeting use the geo universe.
- Combined reach stays within the geo universe.

---

## 3. Open questions for Media Planning

1. **DC TV households** for `state-tv-hh.csv`.
2. **Which year and source** each CSV is from, and whether the DMA file should be refreshed to
   match the state file.
3. **Sign-off on the §1.5B defaults** (maximum % and s per media type).
4. **Target monthly frequency band.** Default 3–8. One band, or one per media type?
5. **Should geofence** count toward reach by default, or only once a fenced-audience size is given?

## 4. Follow-ups (not part of this plan)

- Replace the fixed eCPM ×0.83 "SPO gain" with a real per-channel comparison.
- Replace the hard-coded completion rates (0.92 / 0.98) with completion rates per media type in Settings.
- Use a vendor reach forecast (The Trade Desk, DV360, Nielsen or Comscore) as a reach source that
  overrides the curve when available.
- Flight-long unique reach. This needs an assumption about how many households carry over from
  month to month; monthly is the agreed display for now.
