import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CtvPublisherCard } from "./CtvPublisherCard";
import type { CtvPublisherRecommendation } from "../types";

const aiPublisher: CtvPublisherRecommendation = {
  publisher: "Hulu",
  category: "App",
  why: "Dominant premium streaming penetration with ad-supported inventory.",
  isUserAdded: false,
};

const userAddedPublisher: CtvPublisherRecommendation = {
  publisher: "ABC",
  category: "Network",
  why: "",
  isUserAdded: true,
};

test("CtvPublisherCard renders collapsed by default without type tag", () => {
  const markup = renderToStaticMarkup(
    <CtvPublisherCard
      pub={aiPublisher}
      logoSrc="/assets/pub-logos/hulu_80x80.png"
    />
  );

  // Shows publisher name
  assert.match(markup, /Hulu/);

  // Does NOT show type tag
  assert.doesNotMatch(markup, />App</);
  assert.doesNotMatch(markup, />Network</);
  assert.doesNotMatch(markup, />OS</);

  // Shows expand caret button
  assert.match(markup, /Expand Hulu details/);

  // Rationale text is collapsed and hidden by default
  assert.doesNotMatch(markup, /Dominant premium streaming penetration/);
});

test("CtvPublisherCard for user-added publisher shows only logo and name without caret or type tag", () => {
  const markup = renderToStaticMarkup(
    <CtvPublisherCard
      pub={userAddedPublisher}
      logoSrc="/assets/pub-logos/abc_80x80.png"
    />
  );

  // Shows name
  assert.match(markup, /ABC/);

  // Does not show type tag
  assert.doesNotMatch(markup, />Network</);

  // No expand caret because there is no rationale text
  assert.doesNotMatch(markup, /Expand ABC details/);
});
