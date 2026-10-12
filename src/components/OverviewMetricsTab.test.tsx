import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AudienceProfile } from "../types";
import { DEFAULT_OVERVIEW_METRICS } from "../planning/settings";
import { OverviewMetricsTab } from "./OverviewMetricsTab";

const profileWithAllocation = {
  channelStrategy: {
    totalRfpBudget: 100_000,
    mediaPlan: {
      channels: [
        { channelId: "ctv", channelName: "CTV / OTT", allocationPercent: 60, allocationDollars: 60_000 },
        { channelId: "audio", channelName: "Digital Audio", allocationPercent: 40, allocationDollars: 40_000 },
      ],
    },
  },
} as unknown as AudienceProfile;

const uploadedPlan = [{
  id: "p1", name: "Uploaded plan", selected: true, budget: 100_000, rawChannels: ["CTV"], lineItemsCount: 1,
  placements: [{ mediaType: "CTV", budget: 100_000, impressions: 5_000_000 }],
}] as any;

test("with a plan uploaded, overview applies requested metric defaults and renders the media allocation legend", () => {
  const markup = renderToStaticMarkup(
    <OverviewMetricsTab
      extractedPlacements={[]}
      planOptions={uploadedPlan}
      rfpAnalysis={null}
      profileData={profileWithAllocation}
      metricSettings={DEFAULT_OVERVIEW_METRICS}
    />,
  );
  assert.match(markup, /Plan vs\. AI Scout/);
  assert.match(markup, /Planned Budget/);
  assert.match(markup, /Estimated Impressions/);
  assert.match(markup, /Completed Views/);
  assert.match(markup, /Est\. Monthly Reach/);
  assert.doesNotMatch(markup, /Estimated ECPM/);
  assert.doesNotMatch(markup, /Cost Per View/);
  assert.doesNotMatch(markup, /Avg Monthly Frequency/);
  assert.match(markup, /Media Type Allocation/);
  assert.match(markup, /CTV \/ OTT/);
  assert.match(markup, /60\.0%/);
  assert.match(markup, /Digital Audio/);
  assert.match(markup, /40\.0%/);
});

test("with nothing uploaded, overview respects metric visibility settings and displays enabled campaign metrics without plan comparison", () => {
  const markup = renderToStaticMarkup(
    <OverviewMetricsTab
      extractedPlacements={[]}
      planOptions={[]}
      rfpAnalysis={null}
      profileData={profileWithAllocation}
      metricSettings={DEFAULT_OVERVIEW_METRICS}
    />,
  );
  assert.match(markup, /Campaign Overview/);
  assert.doesNotMatch(markup, /Plan vs\. AI Scout/);
  assert.doesNotMatch(markup, /Planned:\s*</);
  assert.match(markup, /Working Media Budget/);
  assert.match(markup, /\$100,000/);
  assert.match(markup, /Estimated Impressions/);
  assert.match(markup, /Completed Views/);
  assert.match(markup, /Est\. Monthly Reach/);
  assert.doesNotMatch(markup, /Estimated ECPM/);
  assert.doesNotMatch(markup, /Cost Per View/);
  assert.doesNotMatch(markup, /Avg Monthly Frequency/);
  assert.match(markup, /Media Type Allocation/);
});

test("with nothing uploaded and only budget enabled in settings, overview displays only budget", () => {
  const onlyBudgetSettings = DEFAULT_OVERVIEW_METRICS.map((m) => ({ ...m, show: m.id === "budget" }));
  const markup = renderToStaticMarkup(
    <OverviewMetricsTab
      extractedPlacements={[]}
      planOptions={[]}
      rfpAnalysis={null}
      profileData={profileWithAllocation}
      metricSettings={onlyBudgetSettings}
    />,
  );
  assert.match(markup, /Working Media Budget/);
  assert.match(markup, /\$100,000/);
  assert.doesNotMatch(markup, /Estimated Impressions/);
  assert.doesNotMatch(markup, /Completed Views/);
  assert.doesNotMatch(markup, /Est\. Monthly Reach/);
  assert.match(markup, /Media Type Allocation/);
});

test("overview visibility settings can show a previously hidden metric", () => {
  const metricSettings = DEFAULT_OVERVIEW_METRICS.map((metric) => ({ ...metric, show: metric.id === "ecpm" }));
  const markup = renderToStaticMarkup(
    <OverviewMetricsTab
      extractedPlacements={[]}
      planOptions={uploadedPlan}
      rfpAnalysis={null}
      profileData={profileWithAllocation}
      metricSettings={metricSettings}
    />,
  );
  assert.match(markup, /Estimated ECPM/);
  assert.doesNotMatch(markup, /Planned Budget/);
  assert.match(markup, /Media Type Allocation/);
});

test("hideHeader prop suppresses the internal Campaign Overview header badge", () => {
  const markup = renderToStaticMarkup(
    <OverviewMetricsTab
      extractedPlacements={[]}
      planOptions={[]}
      rfpAnalysis={null}
      profileData={profileWithAllocation}
      metricSettings={DEFAULT_OVERVIEW_METRICS}
      hideHeader={true}
    />,
  );
  assert.doesNotMatch(markup, /Campaign Overview/);
  assert.match(markup, /Working Media Budget/);
});

const dcOnlyAnnualPlan = {
  geoTargeting: { scope: "dma", entries: [{ id: "511", name: "Washington, DC" }], unresolved: [], inputMethod: "select" },
  channelStrategy: {
    totalRfpBudget: 1_500_000,
    mediaPlan: {
      flightDays: 365,
      channels: [
        { channelId: "ctv", canonicalId: "ctv", channelName: "CTV / OTT", allocationPercent: 100, allocationDollars: 1_500_000, typicalCpmLow: 14, typicalCpmHigh: 18 },
      ],
    },
  },
} as unknown as AudienceProfile;

test("a single-DMA annual plan reports monthly reach within that DMA's households", () => {
  const markup = renderToStaticMarkup(
    <OverviewMetricsTab extractedPlacements={[]} planOptions={[]} rfpAnalysis={null} profileData={dcOnlyAnnualPlan} metricSettings={DEFAULT_OVERVIEW_METRICS} />,
  );
  // The DMA holds 2.48M TV households; the old impressions / 5.45 showed 17.3M.
  const reach = markup.match(/Est\. Monthly Reach<\/span><span[^>]*>([\d.]+)([MK]) HH/);
  assert.ok(reach, "reach card rendered");
  const households = Number(reach[1]) * (reach[2] === "M" ? 1e6 : 1e3);
  assert.ok(households < 2_476_680, `reach ${households} exceeds the DMA`);
  assert.match(markup, /% of Washington, Dc \(Hagrstwn\) DMA TV HH/);
});

test("the reach breakdown appears only when its internal-only setting allows it", () => {
  const render = (showReachDetails: boolean) => renderToStaticMarkup(
    <OverviewMetricsTab extractedPlacements={[]} planOptions={[]} rfpAnalysis={null} profileData={dcOnlyAnnualPlan} metricSettings={DEFAULT_OVERVIEW_METRICS} showReachDetails={showReachDetails} />,
  );
  assert.match(render(true), /How reach is calculated/);
  assert.doesNotMatch(render(false), /How reach is calculated/);
});

test("a narrowed audience is reported against target households, not the whole DMA", () => {
  const narrowed = { ...dcOnlyAnnualPlan, audienceNarrowing: { filterIds: [], overridePercent: 25 } } as AudienceProfile;
  const markup = renderToStaticMarkup(
    <OverviewMetricsTab extractedPlacements={[]} planOptions={[]} rfpAnalysis={null} profileData={narrowed} metricSettings={DEFAULT_OVERVIEW_METRICS} />,
  );
  assert.match(markup, /% of 619K target HH in Washington, Dc \(Hagrstwn\) DMA/);
});

test("the reach panel is hidden from the share link until a planner turns its eye on", () => {
  const render = (props: Partial<React.ComponentProps<typeof OverviewMetricsTab>>) => renderToStaticMarkup(
    <OverviewMetricsTab extractedPlacements={[]} planOptions={[]} rfpAnalysis={null} profileData={dcOnlyAnnualPlan}
      metricSettings={DEFAULT_OVERVIEW_METRICS} showReachDetails {...props} />,
  );
  const byDefault = render({ onShareReachDetailsChange: () => {} });
  assert.match(byDefault, /aria-label="Show in share view"/, "defaults to hidden, offering to show");
  assert.match(byDefault, /border-dashed/);
  const shared = render({ onShareReachDetailsChange: () => {}, shareReachDetails: true });
  assert.match(shared, /aria-label="Hide from share view"/);
  const shareLink = render({ shareReachDetails: true });
  assert.doesNotMatch(shareLink, /share view"/, "no eye on the share link itself");
});
