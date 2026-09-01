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

test("overview applies requested metric defaults and renders the media allocation legend", () => {
  const markup = renderToStaticMarkup(
    <OverviewMetricsTab
      extractedPlacements={[]}
      planOptions={[]}
      rfpAnalysis={null}
      profileData={profileWithAllocation}
      metricSettings={DEFAULT_OVERVIEW_METRICS}
    />,
  );
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

test("overview visibility settings can show a previously hidden metric", () => {
  const metricSettings = DEFAULT_OVERVIEW_METRICS.map((metric) => ({ ...metric, show: metric.id === "ecpm" }));
  const markup = renderToStaticMarkup(
    <OverviewMetricsTab
      extractedPlacements={[]}
      planOptions={[]}
      rfpAnalysis={null}
      profileData={profileWithAllocation}
      metricSettings={metricSettings}
    />,
  );
  assert.match(markup, /Estimated ECPM/);
  assert.doesNotMatch(markup, /Planned Budget/);
  assert.match(markup, /Media Type Allocation/);
});
