import assert from "node:assert/strict";
import test from "node:test";
import type { Persona } from "../types";
import { planAlignment } from "./planAlignment";
import { RFP_OPTIONS, rfpStrategy } from "./testing/rfpPlans";

const persona = (name: string, watch = ""): Persona => ({ name, gender: "", income: "", age: "", watch, browse: "", buy: "", narrative: "" });

function profile(overrides: Record<string, any> = {}) {
  return {
    personas: [persona("The Weekend Streamer", "Hulu, Roku and live sports"), persona("The Commuter")],
    recommendations: [
      { title: "Own the living room", action: "Reach Weekend Streamer households on CTV.", why: "They stream most on weekends.", channels: "CTV / OTT" },
      { title: "Be on the route home", action: "Put DOOH on The Commuter's daily route.", why: "", channels: "Digital Out-of-Home, Search" },
    ],
    ctvPublishers: [{ publisher: "Hulu" }, { publisher: "Peacock" }],
    channelStrategy: rfpStrategy("asIs"),
    ...overrides,
  };
}

test("each persona is matched to the plan's channels the recommendations name for them, and to publishers they watch", () => {
  const { personas } = planAlignment(profile());
  assert.deepEqual(personas.map((p) => [p.name, p.channels, p.publishers, p.because]), [
    ["The Weekend Streamer", ["CTV / OTT"], ["Hulu"], ["Own the living room"]],
    // "Digital Out-of-Home" is the plan's "Digital Out-of-Home (DOOH)"; Search is not in this plan.
    ["The Commuter", ["Digital Out-of-Home (DOOH)"], [], ["Be on the route home"]],
  ]);
});

test("the funnel lists the plan's channels at each stage, and the planner is told about any stage it leaves uncovered", () => {
  const alignment = planAlignment(profile());
  const awareness = alignment.funnel.find((stage) => stage.stage === "awareness")!;
  assert.deepEqual([...awareness.channels].sort(), ["CTV / OTT", "Digital Out-of-Home (DOOH)"]);
  for (const stage of alignment.funnel.filter((s) => s.channels.length === 0)) {
    assert.ok(alignment.cautions.some((caution) => caution.includes(stage.label.toLowerCase())), stage.label);
  }
});

test("the planner is told which channels the research rates weakly, which personas nothing reaches, and what is outside the catalog", () => {
  const strategy = rfpStrategy("asIs", 0, [{ ...RFP_OPTIONS[0], placements: [...RFP_OPTIONS[0].placements, { mediaType: "Print", productType: "Newspaper insert", budget: 5_000 }] }]);
  const dooh = strategy.mediaPlan!.evaluatedCandidates.find((c) => c.product.id === "channel.dooh")!;
  dooh.components = { ...dooh.components, audienceAndPersonaFit: 40 };
  const { cautions } = planAlignment(profile({ channelStrategy: strategy, recommendations: [] }));
  assert.ok(cautions.some((c) => c.startsWith("Digital Out-of-Home (DOOH): the research rates its audience fit 40/100")));
  assert.ok(cautions.some((c) => c.startsWith("The Commuter: no recommendation or publisher")));
  assert.ok(!cautions.some((c) => c.startsWith("The Weekend Streamer")), "Hulu in the plan still reaches them");
  assert.ok(cautions.some((c) => c.startsWith("Print · Newspaper insert: outside ScoutAI's catalog")));
});

test("a media type the plan gives $0 does not count as reaching anyone or covering a stage", () => {
  const strategy = rfpStrategy("asIs", 0, [{ ...RFP_OPTIONS[0], placements: [...RFP_OPTIONS[0].placements, { mediaType: "Display", productType: "Retargeting", budget: 0 }] }]);
  assert.ok(strategy.mediaPlan!.channels.some((c) => c.allocationDollars === 0), "sanity: the $0 line is in the plan");
  const alignment = planAlignment(profile({ channelStrategy: strategy }));
  const zero = strategy.mediaPlan!.channels.find((c) => c.allocationDollars === 0)!.channelName;
  assert.ok(alignment.funnel.every((stage) => !stage.channels.includes(zero)));
});
