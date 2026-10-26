import assert from "node:assert/strict";
import test from "node:test";
import type { GeoPlanFacts } from "../planning/geoFootprint";
import { geoClaimAlerts } from "./geoClaims";

const boston: GeoPlanFacts = { scope: "dma", unitCount: 1, households: 2_424_240, usSharePct: 2.1, places: ["Boston (Manchester), MA"], precision: [] };

const plan = (overrides: Record<string, unknown> = {}, tactics: Array<{ id: string; displayName: string }> = []) => ({
  intro: "A streaming-first plan for new movers.",
  takeaways: [],
  recommendations: [],
  personas: [{ narrative: "Shops national brands and streams nationwide sports." }],
  channelStrategy: { mediaPlan: { channels: [{ channelName: "Display", allocationDollars: 20_000, targetingTactics: tactics }] } },
  ...overrides,
});

test("a local plan whose narrative calls it national is flagged with the line quoted", () => {
  const alerts = geoClaimAlerts(plan({ takeaways: ["Nationwide CTV reach builds awareness fast."] }), boston);
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].message, /targets Boston DMA · 2\.4M TV households, but a line calls it national: "Nationwide CTV reach/);
});

test("a national plan may say national, and personas are never checked", () => {
  assert.deepEqual(geoClaimAlerts(plan({ takeaways: ["Nationwide CTV reach."] }), undefined), []);
  assert.deepEqual(geoClaimAlerts(plan(), boston), []);
});

test("radius promises are flagged unless a funded media type carries Geo-Fencing", () => {
  const promised = { recommendations: [{ title: "Fence the venue", action: "Geofence a 2-mile radius around the stadium.", why: "" }] };
  const alerts = geoClaimAlerts(plan(promised), { ...boston, precision: ["radius"] });
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].message, /No media type in the plan carries Geo-Fencing.*The brief asks for a radius/);
  assert.deepEqual(geoClaimAlerts(plan(promised, [{ id: "tactic.geo_fencing", displayName: "Geo-Fencing" }]), boston), []);
});
