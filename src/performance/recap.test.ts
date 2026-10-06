import assert from "node:assert/strict";
import test from "node:test";
import { platformReports } from "./__fixtures__/load";
import { analyzeReportFiles } from "./index";
import { assembleRecap, changeLines, channelBenchmarks, fundingSummary, normalizeRecapCopy, projectChannel, projectPlan, recapFigures, recapMix, recapTiles, refreshRecapProposals } from "./recap";
import type { LinkedCampaign } from "../assistant/performanceContext";
import type { ReviewFinding } from "./review";
import { applyRecapOps } from "../assistant/recapOps";
import { parseOps } from "../assistant/operations";

const finding = (id: string, kind: ReviewFinding["kind"], extra: Partial<ReviewFinding> = {}): ReviewFinding => ({
  id, kind, headline: `Finding ${id}`, detail: "Detail.", evidence: "Evidence.", confidence: "high", area: "media type", unverified: [], causalClaim: null, confidenceNote: null, ...extra,
});

const linked = (findings: ReviewFinding[] = [finding("f1", "worked"), finding("f2", "didnt"), finding("f3", "watch", { unverified: ["$99"] })]): LinkedCampaign => ({
  campaign: { id: "c1", name: "Q1 Always On", advertiserName: "Acme Auto Accessories", campaignGoal: "cpa", flightEnd: "2026-03-10", kind: "past" },
  analysis: analyzeReportFiles(platformReports()),
  review: { generatedAt: "", generatedBy: "", fingerprint: "fp", summary: "Strong quarter on cost per checkout.", findings },
  reviewStale: false,
});

let n = 0;
const id = () => `id${++n}`;

test("the scoreboard holds only the metrics the files contain, from the reconciled totals", () => {
  const { tiles, frequency } = recapTiles(linked().analysis);
  const value = (m: string) => tiles.find((t) => t.metric === m)?.value;
  assert.equal(value("conversions"), 9840);
  assert.ok(Math.abs((value("spend") ?? 0) - 233434.01) < 1);
  assert.equal(value("reach"), 4424086);
  assert.ok(frequency && Math.abs(frequency - 5.44) < 0.01);
});

test("the mix chart comes from the media type report, with shares of spend and of conversions", () => {
  const mix = recapMix(linked().analysis)!;
  assert.equal(mix.dimension, "media type");
  const ott = mix.rows.find((r) => r.name === "OTT")!;
  assert.ok(ott.isCtv);
  assert.ok(Math.abs(ott.spendShare - 0.746) < 0.001);
  assert.ok(Math.abs(ott.conversionShare - 0.329) < 0.001);
  const share = mix.rows.reduce((s, r) => s + r.spendShare, 0);
  assert.ok(Math.abs(share - 1) < 0.001);
});

test("CTV on last-touch data gets the note that its share of conversions is understated", () => {
  assert.match(recapFigures(linked()).mixNote ?? "", /understates/);
});

test("a long breakdown is folded into its biggest rows plus one row for the rest", () => {
  const a = linked().analysis;
  const mediaTypes = a.breakdowns.filter((b) => /media/i.test(b.dimension)).map((b) => b.dimension);
  const mix = recapMix({ ...a, breakdowns: a.breakdowns.filter((b) => !mediaTypes.includes(b.dimension) && /publisher/i.test(b.dimension)) })!;
  assert.equal(mix.rows.length, 6);
  assert.match(mix.rows[5].name, /others$/);
});

test("cards keep the review's kind and only findings the client may see", () => {
  const copy = normalizeRecapCopy({
    campaigns: [{ campaignId: "c1", summary: "Cost per checkout came in at $23.72.", cards: [
      { findingId: "f1", headline: "Retargeting CTV viewers drove checkouts", stat: "42% of checkouts from 9% of spend" },
      { findingId: "f2", headline: "Niche audiences cost more", stat: "Over $500 per checkout" },
      { findingId: "f3", headline: "Pacing ran behind", stat: "Behind plan" },
    ] }],
    recommendations: [],
  }, [linked([finding("f1", "didnt"), finding("f2", "didnt"), finding("f3", "watch", { unverified: ["$99"] })])], id);
  const cards = copy.campaigns.get("c1")!.cards;
  assert.deepEqual(cards.map((c) => c.findingId), ["f1"]);
  assert.equal(cards[0].kind, "didnt", "the model cannot relabel a finding");
  assert.equal(copy.campaigns.get("c1")!.summary, "Cost per checkout came in at $23.72");
  assert.ok(copy.dropped.some((d) => /figure not in the data/.test(d)));
  assert.ok(copy.dropped.some((d) => /not a usable finding/.test(d)));
});

test("client text never uses internal terms, claims a cause, or puts figures in a recommendation", () => {
  const copy = normalizeRecapCopy({
    campaigns: [{ campaignId: "c1", summary: "Display had the best PM of the campaign.", cards: [{ findingId: "f1", headline: "Checkouts rose due to retargeting", stat: "42% of checkouts" }] }],
    recommendations: [
      { title: "Shift 20% of budget to retargeting", detail: "Retargeting converted best.", area: "budget", findings: [{ campaignId: "c1", findingId: "f1" }] },
      { title: "Pair CTV with retargeting from launch", detail: "Retarget CTV-exposed households so the audience CTV builds converts.", area: "rocket", findings: [{ campaignId: "c1", findingId: "f1" }] },
    ],
  }, [linked()], id);
  assert.equal(copy.campaigns.get("c1")!.summary, "");
  assert.equal(copy.campaigns.get("c1")!.cards.length, 0);
  assert.deepEqual(copy.recommendations.map((r) => r.title), ["Pair CTV with retargeting from launch"]);
  assert.equal(copy.recommendations[0].area, "channel");
});

test("rebuilding keeps recommendations the planner already applied", () => {
  const previous = { builtAt: "", builtBy: "", campaigns: [], recommendations: [
    { id: "old1", title: "Pair CTV with retargeting from launch", detail: "d", area: "channel" as const, appliedAt: "2026-10-01T00:00:00Z" },
    { id: "old2", title: "Drop niche interest audiences", detail: "d", area: "audience" as const, appliedAt: null },
  ] };
  const copy = { campaigns: new Map(), dropped: [], recommendations: [
    { id: "new1", title: "Pair CTV with retargeting from launch", detail: "again", area: "channel" as const, appliedAt: null },
    { id: "new2", title: "Expand competitor conquesting", detail: "d", area: "audience" as const, appliedAt: null },
  ] };
  const recap = assembleRecap([linked()], copy, previous, { actor: "TJ" });
  assert.deepEqual(recap.recommendations.map((r) => r.id), ["old1", "new2"]);
});

test("marking a recommendation applied rides along without blocking the change, and undoes cleanly", () => {
  const profile: any = { campaignRecap: { builtAt: "", builtBy: "", campaigns: [{ cards: [{ id: "k1", headline: "H" }] }], recommendations: [{ id: "r1", title: "T", detail: "d", area: "channel", appliedAt: null }] } };
  const { ops } = parseOps([{ type: "mark_recap_recommendation", id: "r1" }, { type: "mark_recap_recommendation", id: "gone" }]);
  const out = applyRecapOps(profile, ops);
  assert.ok(profile.campaignRecap.recommendations[0].appliedAt);
  assert.equal(out.rejected.length, 0);
  assert.equal(out.applied.length, 1);
  const revert = parseOps(out.revertOps, { allowRestore: true }).ops;
  applyRecapOps(profile, revert);
  assert.equal(profile.campaignRecap.recommendations[0].appliedAt, null);
});

test("the planner can remove a card or a recommendation; a missing one is refused", () => {
  const profile: any = { campaignRecap: { builtAt: "", builtBy: "", campaigns: [{ cards: [{ id: "k1", headline: "H" }] }], recommendations: [{ id: "r1", title: "T", detail: "d", area: "channel", appliedAt: null }] } };
  const out = applyRecapOps(profile, parseOps([{ type: "remove_recap_item", kind: "card", id: "k1" }, { type: "remove_recap_item", kind: "recommendation", id: "nope" }]).ops);
  assert.equal(profile.campaignRecap.campaigns[0].cards.length, 0);
  assert.equal(out.rejected.length, 1);
});

const rec = (extra: any = {}) => ({ kind: "change", title: "Expand pre-roll and online video", detail: "Pre-roll beat the campaign average", area: "channel", findings: [{ campaignId: "c1", findingId: "f1" }], measure: "Cost per checkout on online video", ...extra });

test("a recommendation with no finding behind it is not shown", () => {
  const copy = normalizeRecapCopy({ campaigns: [], recommendations: [rec({ findings: [] }), rec({ findings: [{ campaignId: "c1", findingId: "f3" }] })] }, [linked()], id);
  assert.equal(copy.recommendations.length, 0);
  assert.ok(copy.dropped.every((d) => /no finding behind it/.test(d)));
});

test("evidence bars come from the cited rows and the campaign average, in code", () => {
  const copy = normalizeRecapCopy({ campaigns: [], recommendations: [rec({ evidenceRows: ["Pre-Roll/Mid-Roll", "Not a row"] })] }, [linked()], id);
  const evidence = copy.recommendations[0].evidence!;
  assert.deepEqual(evidence.bars.map((b) => b.name), ["Pre-Roll/Mid-Roll", "Campaign average"]);
  assert.ok(Math.abs(evidence.bars[1].cpa - 23.72) < 0.01);
  assert.equal(evidence.metricLabel, "Cost per checkout");
  assert.match(evidence.note, /^1,669 checkouts · 17% of checkouts from \d+% of spend$/);
});

test("strength follows the weakest finding, and a thin cited row makes it a test", () => {
  const findings = [finding("f1", "worked", { confidence: "high" }), finding("f2", "didnt", { confidence: "medium" })];
  const both = normalizeRecapCopy({ campaigns: [], recommendations: [rec({ findings: [{ campaignId: "c1", findingId: "f1" }, { campaignId: "c1", findingId: "f2" }] })] }, [linked(findings)], id);
  assert.equal(both.recommendations[0].strength, "directional");
  const a = linked(findings).analysis;
  const thin = a.breakdowns.flatMap((b) => b.rows).find((r) => r.flags.includes("low-sample") && r.cpa !== null)!;
  const test1 = normalizeRecapCopy({ campaigns: [], recommendations: [rec({ evidenceRows: [thin.name] })] }, [linked(findings)], id);
  assert.equal(test1.recommendations[0].strength, "test");
});

test("only buy changes are kept as operations, and keep or execution carries none", () => {
  const copy = normalizeRecapCopy({ campaigns: [], recommendations: [
    rec({ ops: [{ type: "set_allocation", channelId: "olv", percent: 16.4 }, { type: "edit_text", path: "intro", value: "x" }, { type: "remove_ctv_publisher", publisher: "Tubi" }] }),
    rec({ kind: "keep", title: "Keep CTV at full weight", ops: [{ type: "remove_channel", channelId: "ctv" }] }),
  ] }, [linked()], id);
  assert.deepEqual(copy.recommendations[0].ops, [{ type: "set_allocation", channelId: "olv", percent: 16 }, { type: "remove_ctv_publisher", publisher: "Tubi" }]);
  assert.deepEqual(copy.recommendations[1].ops, []);
});

test("the exact change reads the plan after the dry run, never the old value", () => {
  const before = { channelStrategy: { mediaPlan: { channels: [
    { channelId: "olv", channelName: "Online Video", allocationPercent: 14, allocationDollars: 14000 },
    { channelId: "display", channelName: "Programmatic Display", allocationPercent: 12, allocationDollars: 12000 },
  ] } }, ctvPublishers: [{ publisher: "ESPN" }] };
  const after = { channelStrategy: { mediaPlan: { channels: [
    { channelId: "olv", channelName: "Online Video", allocationPercent: 16, allocationDollars: 16000 },
    { channelId: "display", channelName: "Programmatic Display", allocationPercent: 10, allocationDollars: 10000 },
  ] } }, ctvPublishers: [{ publisher: "ESPN" }, { publisher: "Tubi" }] };
  assert.deepEqual(changeLines(before, after), [
    { kind: "publisher_added", name: "Tubi" },
    { kind: "allocation", channelId: "olv", channelName: "Online Video", percent: 16, budget: 16000, direction: "up", role: "decision", delta: 2000 },
    { kind: "allocation", channelId: "display", channelName: "Programmatic Display", percent: 10, budget: 10000, direction: "down", role: "decision", delta: -2000 },
  ]);
  // With the recommendation's own media types named, the rest is the automatic rebalance.
  assert.equal((changeLines(before, after, ["olv"]).find((l: any) => l.channelId === "display") as any)?.role, "funding");
});

test("projections are a range from the channel's own cost to the campaign average, and outliers are left out", () => {
  const channels = [
    { id: "olv", name: "Online Video (OLV)", aliases: ["pre-roll", "preroll"] },
    { id: "ctv", name: "CTV / OTT", aliases: ["ott", "ctv"] },
    { id: "rt", name: "Display Retargeting", aliases: ["retargeting"] },
  ];
  const b = channelBenchmarks(linked(), channels)!;
  const olv = b.channels.find((c) => c.channelId === "olv")!;
  assert.deepEqual(olv.reportRows, ["Pre-Roll/Mid-Roll"]);
  assert.equal(b.channels.find((c) => c.channelId === "rt")?.excluded, "retargeting");
  const p = projectChannel(b, "olv", 16000)!;
  assert.ok(Math.abs(p.high - 16000 / Math.min(olv.cpa, b.averageCpa!)) < 1e-9);
  assert.ok(Math.abs(p.low - 16000 / Math.max(olv.cpa, b.averageCpa!)) < 1e-9);
  assert.equal(projectChannel(b, "rt", 10000), null);
  // A channel whose past cost is a third of the average or less says more about credit than cost.
  const cheap = { ...b, channels: [...b.channels, { ...olv, channelId: "display", cpa: b.averageCpa! / 3.5 }] };
  assert.equal(projectChannel(cheap, "display", 10000), null);
  const plan = projectPlan(b, [{ channelId: "olv", allocationDollars: 16000 }, { channelId: "rt", allocationDollars: 10000 }, { channelId: "search", allocationDollars: 4000 }])!;
  assert.ok(Math.abs(plan.coveredShare - 16000 / 30000) < 1e-9);
  assert.ok(plan.low < plan.high);
});

const planOf = (alloc: Record<string, number>) => ({ profile: { channelStrategy: { mediaPlan: { channels: Object.entries(alloc).map(([channelId, pct]) => ({ channelId, channelName: channelId.toUpperCase(), allocationPercent: pct, allocationDollars: pct * 1000 })) } }, campaignRecap: null as any } });

// A stand-in for the engine: set targets, spread the difference evenly over everything else.
function fakeDryRun(payload: any) {
  return (ops: any[]) => {
    const channels = payload.profile.channelStrategy.mediaPlan.channels.map((c: any) => ({ ...c }));
    const targets = new Map(ops.filter((o) => o.type === "set_allocation").map((o) => [o.channelId, o.percent]));
    if ([...targets.keys()].some((id) => !channels.some((c: any) => c.channelId === id))) return { payload, changes: [], rejected: [{ reason: "not in the plan" }] };
    const moved = [...targets.entries()].reduce((s, [id, pct]) => s + (pct - channels.find((c: any) => c.channelId === id).allocationPercent), 0);
    const rest = channels.filter((c: any) => !targets.has(c.channelId));
    for (const c of channels) {
      if (targets.has(c.channelId)) c.allocationPercent = targets.get(c.channelId);
      else c.allocationPercent -= moved / rest.length;
      c.allocationDollars = c.allocationPercent * 1000;
    }
    const changed = channels.some((c: any, i: number) => c.allocationPercent !== payload.profile.channelStrategy.mediaPlan.channels[i].allocationPercent);
    return { payload: { profile: { ...payload.profile, channelStrategy: { mediaPlan: { channels } } } }, changes: changed ? [{}] : [], rejected: [] };
  };
}

const recapWith = (recommendations: any[]) => ({ builtAt: "", builtBy: "", campaigns: [], recommendations });

test("the rebalance is one funding line, and a protected media type is held still", () => {
  const payload = planOf({ olv: 12, ctv: 17, search: 12, display: 12, meta: 12, yt: 12, yttv: 16, rt: 7 });
  payload.profile.campaignRecap = recapWith([
    { id: "r1", kind: "change", title: "Expand online video", detail: "", area: "channel", appliedAt: null, baseOps: [{ type: "set_allocation", channelId: "olv", percent: 18 }] },
    { id: "r2", kind: "keep", title: "Keep CTV", detail: "", area: "channel", appliedAt: null, keepChannelIds: ["ctv"] },
  ]);
  refreshRecapProposals(payload, fakeDryRun(payload));
  const r1 = payload.profile.campaignRecap.recommendations[0];
  assert.ok(!r1.changes.some((l: any) => l.channelId === "ctv"), "CTV is held by the keep recommendation");
  assert.deepEqual(r1.changes.filter((l: any) => l.role === "decision").map((l: any) => l.channelId), ["olv"]);
  const f = fundingSummary(r1.changes)!;
  assert.equal(f.count, 6);
  assert.ok(f.from && Math.abs((f.each ?? 0) - 1000) < 1);
});

test("a change the plan already has becomes In this plan, and one that no longer fits is flagged", () => {
  const payload = planOf({ olv: 18, ctv: 17, search: 11 });
  payload.profile.campaignRecap = recapWith([
    { id: "r1", kind: "change", title: "Expand online video", detail: "", area: "channel", appliedAt: null, baseOps: [{ type: "set_allocation", channelId: "olv", percent: 18 }] },
    { id: "r2", kind: "change", title: "Grow YouTube TV", detail: "", area: "channel", appliedAt: null, baseOps: [{ type: "set_allocation", channelId: "yttv", percent: 20 }] },
  ]);
  assert.equal(refreshRecapProposals(payload, fakeDryRun(payload), "2026-10-03T00:00:00Z"), true);
  const [r1, r2] = payload.profile.campaignRecap.recommendations;
  assert.equal(r1.appliedAt, "2026-10-03T00:00:00Z");
  assert.equal(r2.needsReview, true);
  assert.deepEqual(r2.changes, []);
  assert.equal(refreshRecapProposals(payload, fakeDryRun(payload)), false, "a second pass changes nothing");
});
