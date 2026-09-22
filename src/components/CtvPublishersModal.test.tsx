import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CtvPublishersModal } from "./CtvPublishersModal";
import type { CtvPublisherRecommendation } from "../types";
import { DEFAULT_CTV_PUBLISHERS } from "../planning/knowledge/ctvPublishers";

const sampleSelected: CtvPublisherRecommendation[] = [
  {
    publisher: "Hulu",
    category: "App",
    why: "Massive reach across ad-supported premium streaming.",
  },
  {
    publisher: "ESPN",
    category: "Network",
    why: "Top sports live streaming inventory.",
  },
];

test("CtvPublishersModal renders two-column layout with available and selected publishers", () => {
  const markup = renderToStaticMarkup(
    <CtvPublishersModal
      isOpen={true}
      onClose={() => {}}
      selectedPublishers={sampleSelected}
      onUpdatePublishers={() => {}}
      onResetToDefault={() => {}}
      catalogPublishers={DEFAULT_CTV_PUBLISHERS}
    />
  );

  // Modal header & title
  assert.match(markup, /Edit CTV Publishers to Target/);
  assert.match(markup, /2 Selected/);

  // Column 1: Available
  assert.match(markup, /Available Publishers/);
  assert.match(markup, /Search publishers by name or topic/);

  // Column 2: Selected with green indicators
  assert.match(markup, /Selected for Plan/);
  assert.match(markup, /2 Targeted/);
  assert.match(markup, /Hulu/);
  assert.match(markup, /ESPN/);
  assert.match(markup, /Massive reach across ad-supported premium streaming/);

  // Green border and check styling classes
  assert.match(markup, /border-emerald-500/);

  // Reset button
  assert.match(markup, /Reset to ScoutAI Recommendations/);

  // Real-time indicator
  assert.match(markup, /Changes applied in real time/);
});

test("CtvPublishersModal does not render when isOpen is false", () => {
  const markup = renderToStaticMarkup(
    <CtvPublishersModal
      isOpen={false}
      onClose={() => {}}
      selectedPublishers={sampleSelected}
      onUpdatePublishers={() => {}}
    />
  );

  assert.equal(markup, "");
});

test("CtvPublishersModal renders empty state when no publishers are selected", () => {
  const markup = renderToStaticMarkup(
    <CtvPublishersModal
      isOpen={true}
      onClose={() => {}}
      selectedPublishers={[]}
      onUpdatePublishers={() => {}}
      onResetToDefault={() => {}}
    />
  );

  assert.match(markup, /No CTV publishers selected/);
  assert.match(markup, /0 Targeted/);
});
