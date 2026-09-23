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
  assert.match(markup, /Estimated Reach/);
  assert.doesNotMatch(markup, /Estimated ECPM/);
  assert.doesNotMatch(markup, /Cost Per View/);
  assert.doesNotMatch(markup, /Avg Frequency/);
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
  assert.match(markup, /Estimated Reach/);
  assert.doesNotMatch(markup, /Estimated ECPM/);
  assert.doesNotMatch(markup, /Cost Per View/);
  assert.doesNotMatch(markup, /Avg Frequency/);
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
  assert.doesNotMatch(markup, /Estimated Reach/);
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
