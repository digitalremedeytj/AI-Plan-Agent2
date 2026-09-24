import test from "node:test";
import assert from "node:assert/strict";
import {
  briefFingerprint,
  buildBriefPrompt,
  buildBriefResponseSchema,
  buildBriefSnapshot,
  normalizeBrief,
  parseEditText,
  sanitizeBriefSnapshot,
  sectionToEditText,
  unsupportedMention,
} from "./executiveBrief";

const record = (displayName: string, rationale = "") => ({ id: displayName.toLowerCase().replace(/\W+/g, "_"), displayName, rationale });

function profile(overrides: Record<string, any> = {}): any {
  return {
    intro: "Busy suburban parents.",
    briefOfRecord: {
      advertiser: "Acme Pets", whatTheySell: "Premium pet food", businessModel: "DTC and retail", primaryAudience: "Dog owners",
      coreSegments: ["Premium dog owners"], includedSegments: [], excludedSegments: [], campaignObjective: "Drive online sales",
      funnelEmphasis: "full-funnel", priceTier: "premium", audienceType: "B2C", geography: "US", uncertainties: [], basis: "brief only",
    },
    personas: [{ name: "Dana", age: "35-44", gender: "Female", income: "$100K+", narrative: "Buys premium.", avatarUrl: "data:image/png;base64,AAAA" }],
    segmentRecommendations: [{ id: "s1", name: "Premium Pet Food Buyers", dimension: "In-Market / Intent", justification: "Buys premium food.", dataSignal: "Transaction & Purchase Data", tier: "Core", personaIndices: [0], source: "ScoutAI" }],
    takeaways: ["Evenings matter."],
    recommendations: [],
    channelStrategy: {
      channelOverrides: {},
      mediaPlan: {
        workingMediaBudget: 100000,
        flightDays: 90,
        planningMode: "greenfield",
        nonMediaCosts: [],
        channels: [
          {
            channelId: "ctv", channelName: "CTV", status: "ADD", allocationPercent: 60, role: "Reach", gapAddressed: "No TV reach",
            allocationRationale: "Scale", targetingTactics: [record("ACR Retargeting")], publishers: [record("Hulu")],
            measurementCapabilities: [record("Incrementality", "Proves lift")],
          },
          {
            channelId: "search", channelName: "Google Search", status: "ADD", allocationPercent: 40, role: "Capture intent", gapAddressed: "",
            allocationRationale: "", targetingTactics: [], publishers: [], measurementCapabilities: [],
          },
        ],
        evaluatedCandidates: [
          { product: { id: "ctv", displayName: "CTV" }, activationGuidance: "Evenings", measurementApproach: "Lift study" },
          { product: { id: "search", displayName: "Google Search" } },
          { product: { id: "dooh", displayName: "Digital Out-of-Home" } },
        ],
      },
    },
    ...overrides,
  };
}

const inputs = { advertiserName: "Acme Pets", kpis: ["Online sales"], geography: "US" };

test("the snapshot is the plan as the planner sees it: channel edits apply and hidden content is left out", () => {
  const p = profile({ hiddenSections: ["personas"] });
  p.channelStrategy.channelOverrides = {
    ctv: { fieldEdits: { gapAddressed: { content: "Edited gap" }, targetingTactics: { content: "Tactic A, Tactic B" } }, hiddenPanels: ["publishers"] },
  };
  const snapshot = buildBriefSnapshot(p, inputs);
  const ctv = snapshot.channels.find((c) => c.channelId === "ctv")!;
  assert.equal(ctv.gapAddressed, "Edited gap");
  assert.deepEqual(ctv.targeting, ["Tactic A", "Tactic B"]);
  assert.deepEqual(ctv.publishers, [], "a panel hidden from the share link is not summarised");
  assert.equal(ctv.activation, "Evenings");
  assert.deepEqual(snapshot.personas, [], "a hidden section is not summarised");
  assert.deepEqual(snapshot.segments[0].personas, [], "nor are persona names through the segments");
  assert.deepEqual(snapshot.notInPlanChannels, ["Digital Out-of-Home"]);
  assert.equal(snapshot.measurement.length, 1);
  assert.equal(snapshot.measurement[0].advanced, true);
  assert.deepEqual(snapshot.measurement[0].channels, ["CTV"]);
});

test("measurement line items from an uploaded plan count as measurement", () => {
  const p = profile();
  p.channelStrategy.mediaPlan.channels[0].measurementCapabilities = [];
  p.channelStrategy.mediaPlan.nonMediaCosts = [{ id: "n1", displayName: "Halo Effect Study", amount: 5000, pricing: "Flat" }, { id: "n2", displayName: "Ad serving", amount: 100, pricing: "CPM" }];
  const snapshot = buildBriefSnapshot(p, inputs);
  assert.deepEqual(snapshot.measurement.map((m) => [m.name, m.advanced]), [["Halo Effect Study", true]]);
});

test("the fingerprint follows plan edits but not headshots or the form inputs", () => {
  const base = briefFingerprint(buildBriefSnapshot(profile(), inputs));
  const newAvatar = profile();
  newAvatar.personas[0].avatarUrl = "data:image/png;base64,BBBB";
  assert.equal(briefFingerprint(buildBriefSnapshot(newAvatar, inputs)), base);
  assert.equal(briefFingerprint(buildBriefSnapshot(profile(), { ...inputs, kpis: ["Other"] })), base);

  const edited = profile();
  edited.channelStrategy.channelOverrides = { ctv: { fieldEdits: { planningRationale: { content: "New reason" } } } };
  assert.notEqual(briefFingerprint(buildBriefSnapshot(edited, inputs)), base);
  const reallocated = profile();
  reallocated.channelStrategy.mediaPlan.channels[0].allocationPercent = 55;
  assert.notEqual(briefFingerprint(buildBriefSnapshot(reallocated, inputs)), base);
});

test("the server's sanitized snapshot fingerprints the same as the client's", () => {
  const snapshot = buildBriefSnapshot(profile(), inputs);
  assert.equal(briefFingerprint(sanitizeBriefSnapshot(JSON.parse(JSON.stringify(snapshot)))), briefFingerprint(snapshot));
});

const section = (headline: string, bullets: Array<[string, string]>) => ({ headline, bullets: bullets.map(([lead, text]) => ({ lead, text })) });

test("plan facts come from the plan, and lines about things the plan lacks are removed with a note", () => {
  const snapshot = buildBriefSnapshot(profile(), inputs);
  const brief = normalizeBrief({
    understanding: section("Acme needs online sales.", [["Premium buyers", "Dog owners who pay for quality."], ["Billboards", "Digital Out-of-Home builds local fame."]]),
    strategicPov: section("Evenings win.", [["Brand lift", "A brand lift study will prove recall."], ["Evening reach", "CTV reaches Dana at night."]]),
    audience: {
      ...section("Reach premium owners.", [["Purchase data", "Transaction data finds real buyers."]]),
      audienceMatches: [
        { audience: "Premium dog owners", reachedWith: ["premium pet food buyers", "Made-up Segment"], why: "Purchase data proves intent." },
        { audience: "Cat people", reachedWith: ["Nothing real"], why: "No." },
      ],
    },
    media: {
      ...section("Two channels, one story.", [["Together", "CTV builds demand that Google Search captures."]]),
      channels: [{ channelId: "search", funnelRole: "Conversion", role: "Captures demand." }, { channelId: "tiktok", funnelRole: "Awareness", role: "Invented." }],
    },
    measurement: { ...section("Prove it.", [["Lift", "Incrementality proves net-new sales."]]), items: [{ capability: "incrementality", proves: "Net-new sales from CTV.", kpi: "Online sales" }] },
    plannerNotes: [],
  }, snapshot, { instructions: "Highlight measurement" });

  const understanding = brief.sections.find((s) => s.key === "understanding")!;
  assert.equal(understanding.bullets.length, 1, "the out-of-plan channel line is removed");
  assert.equal(brief.sections.find((s) => s.key === "strategicPov")!.bullets.length, 1, "the study the plan lacks is removed");
  assert.ok(brief.plannerNotes.some((n) => n.includes("Digital Out-of-Home is not in this plan")));
  assert.ok(brief.plannerNotes.some((n) => n.includes("Brand lift measurement is not in this plan")));

  const media = brief.sections.find((s) => s.key === "media")!;
  assert.deepEqual(media.channels!.map((c) => [c.channelId, c.allocationPercent, c.funnelRole]), [["ctv", 60, "Full funnel"], ["search", 40, "Conversion"]],
    "every plan channel, in allocation order, with the plan's numbers; the invented one is dropped");
  assert.equal(media.channels![0].role, "Reach", "a channel the model skipped falls back to its plan role");

  const audience = brief.sections.find((s) => s.key === "audience")!;
  assert.deepEqual(audience.audienceMatches, [{ audience: "Premium dog owners", reachedWith: ["Premium Pet Food Buyers"], why: "Purchase data proves intent." }]);

  const measurement = brief.sections.find((s) => s.key === "measurement")!;
  assert.deepEqual(measurement.measurement, [{ capability: "Incrementality", advanced: true, proves: "Net-new sales from CTV.", kpi: "Online sales" }]);
  assert.equal(brief.instructions, "Highlight measurement");
  assert.equal(brief.inputFingerprint, briefFingerprint(snapshot));
});

test("with no measurement in the plan the section is left out, and the schema does not ask for it", () => {
  const p = profile();
  p.channelStrategy.mediaPlan.channels[0].measurementCapabilities = [];
  const snapshot = buildBriefSnapshot(p, inputs);
  assert.equal((buildBriefResponseSchema(snapshot).properties as any).measurement, undefined);
  assert.match(buildBriefPrompt(snapshot).input, /Omit the measurement section/);
  const brief = normalizeBrief({
    understanding: section("A", [["x", "y"]]),
    strategicPov: section("B", [["x", "y"]]),
    measurement: section("C", [["x", "y"]]),
  }, snapshot);
  assert.equal(brief.sections.some((s) => s.key === "measurement"), false);
});

test("an included name is not mistaken for an excluded one that it contains", () => {
  const snapshot = buildBriefSnapshot(profile(), inputs);
  snapshot.channels[0].name = "CTV Sports";
  snapshot.notInPlanChannels = ["CTV"];
  assert.equal(unsupportedMention("CTV Sports reaches fans.", snapshot), null);
  assert.match(unsupportedMention("Add CTV for reach.", snapshot) || "", /CTV is not in this plan/);
});

test("figures that are not in the plan are flagged, not silently kept", () => {
  const snapshot = buildBriefSnapshot(profile(), inputs);
  const brief = normalizeBrief({
    understanding: section("A", [["Reach", "60% of budget reaches 73% of owners."]]),
    strategicPov: section("B", [["x", "y"]]),
  }, snapshot);
  assert.ok(brief.plannerNotes.some((n) => n.includes('"73%"')));
  assert.ok(!brief.plannerNotes.some((n) => n.includes('"60%"')));
});

test("a nearly empty answer is refused rather than saved", () => {
  assert.throws(() => normalizeBrief({}, buildBriefSnapshot(profile(), inputs)), /no usable executive summary/);
});

test("hand edits round-trip through the edit text", () => {
  const text = sectionToEditText({
    key: "media", headline: "Two channels.", bullets: [{ lead: "Together", text: "They work." }],
    channels: [{ channelId: "ctv", channelName: "CTV", allocationPercent: 60, funnelRole: "Awareness", role: "Reach." }],
  }, { ctv: 55 });
  assert.equal(text, "Two channels.\n- Together: They work.\n- CTV (55%, Awareness): Reach.");
  assert.deepEqual(parseEditText(text), {
    headline: "Two channels.",
    bullets: [{ lead: "Together", text: "They work." }, { lead: "CTV (55%, Awareness)", text: "Reach." }],
  });
  assert.deepEqual(parseEditText("- A sentence without a lead"), { headline: "", bullets: [{ lead: "", text: "A sentence without a lead" }] });
});

test("a general phrase is not mistaken for a measurement product the plan lacks", () => {
  const snapshot = buildBriefSnapshot(profile(), inputs);
  snapshot.measurement = [];
  assert.equal(unsupportedMention("LeadMatch follows the full consumer journey to a sale.", snapshot), null);
  assert.match(unsupportedMention("Consumer Journey Analytics will prove it.", snapshot) || "", /not in this plan/);
});

test("instructions asking for measurement the plan lacks always get a planner note", () => {
  const p = profile();
  p.channelStrategy.mediaPlan.channels[0].measurementCapabilities = [record("LeadMatch", "Exposure -> lead -> sale; lead quality")];
  const snapshot = buildBriefSnapshot(p, inputs);
  const brief = normalizeBrief({
    understanding: section("A", [["x", "y"]]),
    strategicPov: section("B", [["x", "y"]]),
    measurement: { ...section("C", [["x", "y"]]), items: [] },
  }, snapshot, { instructions: "Really highlight our advanced attribution" });
  assert.ok(brief.plannerNotes.some((n) => n.includes("no incrementality, halo or consumer-journey study")));
  assert.equal(brief.sections.find((s) => s.key === "measurement")!.measurement![0].proves, "Exposure → lead → sale", "the catalog shorthand is tidied when the model skips a capability");
});
