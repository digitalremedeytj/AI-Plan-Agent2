import assert from "node:assert/strict";
import test from "node:test";
import { platformReports } from "./__fixtures__/load";
import { analyzeReportFiles } from "./index";
import { assembleRecap, clientRecap, normalizeRecapCopy, recapFigures } from "./recap";
import { creativeName, ctvAssist, kpiVsTarget, recapRankings, recapTrend, resolveRecapKpi, trendHighlights } from "./recapKpi";
import type { LinkedCampaign } from "../assistant/performanceContext";
import type { ReviewFinding } from "./review";
import { applyRecapOps } from "../assistant/recapOps";
import { parseOps } from "../assistant/operations";
import { kpiBeatText, kpiEffect, recommendationsIntro, splitStat } from "../components/recapFormat";

const analysis = analyzeReportFiles(platformReports());

const finding = (id: string, kind: ReviewFinding["kind"], area = "media type"): ReviewFinding => ({
  id, kind, headline: `Finding ${id}`, detail: "Detail.", evidence: "Evidence.", confidence: "high", area, unverified: [], causalClaim: null, confidenceNote: null,
});

const linked = (campaignGoal: string | null = null): LinkedCampaign => ({
  campaign: { id: "c1", name: "Q1 Always On", advertiserName: "Acme Auto Accessories", campaignGoal, flightEnd: "2026-03-10", kind: "past" },
  analysis,
  review: { generatedAt: "", generatedBy: "", fingerprint: "fp", summary: "Strong quarter.", findings: [finding("f1", "worked", "audience"), finding("f2", "didnt")] },
  reviewStale: false,
});

test("a KPI with a target in the brief wins, and its target is read the way the brief writes it", () => {
  const { kpi } = resolveRecapKpi(analysis, { briefKpis: ["Drive online sales", "ROAS > 120%"], campaignGoal: "cpa" });
  assert.equal(kpi?.metric, "roas");
  assert.equal(kpi?.source, "brief");
  assert.equal(kpi?.target?.value, 1.2);
  assert.equal(kpi?.roasStyle, "percent");
  assert.ok(Math.abs((kpiVsTarget(kpi!) ?? 0) - (3.7338 / 1.2 - 1)) < 0.001);
  assert.equal(kpiBeatText(kpi!), "211% above target");
});

test("a generic brief KPI ('Checkouts') judges the campaign on its conversions, with no target", () => {
  const { kpi } = resolveRecapKpi(analysis, { briefKpis: ["Checkouts"] });
  assert.equal(kpi?.metric, "conversions");
  assert.equal(kpi?.value, 9840);
  assert.equal(kpi?.target, null);
});

test("without a brief KPI the upload goal decides; without either, the data does and it needs confirming", () => {
  assert.equal(resolveRecapKpi(analysis, { campaignGoal: "cpa" }).kpi?.source, "goal");
  assert.equal(resolveRecapKpi(analysis, { campaignGoal: "cpa" }).kpi?.metric, "cpa");
  const inferred = resolveRecapKpi(analysis, {}).kpi!;
  assert.equal(inferred.metric, "roas", "revenue in the files means ROAS");
  assert.equal(inferred.source, "data");
});

test("a brief KPI the files cannot measure falls through to the next source", () => {
  const noRevenue = { ...analysis, totals: { ...analysis.totals!, revenue: 0, roas: null } };
  const { kpi } = resolveRecapKpi(noRevenue, { briefKpis: ["ROAS 3x"], campaignGoal: "cpa" });
  assert.equal(kpi?.metric, "cpa");
});

test("the flight trend names its best full week and never counts the partial last one", () => {
  const trend = recapTrend(analysis)!;
  assert.equal(trend.weeks.length, 5);
  assert.equal(trend.weeks[4].days < 7, true);
  const h = trendHighlights(trend)!;
  assert.equal(h.best, 1);
  assert.ok(Math.abs(h.bestCpa - 15.6) < 0.01);
  assert.equal(h.full, 4);
});

test("publisher rankings leave out media type rows, and rank on ROAS when the KPI is ROAS", () => {
  const { kpi } = resolveRecapKpi(analysis, { briefKpis: ["ROAS"] });
  const rankings = recapRankings(analysis, kpi);
  const publishers = rankings.find((r) => r.key === "publisher")!;
  assert.equal(publishers.metric, "roas");
  assert.ok(!publishers.rows.some((r) => r.name === "Pre-Roll/Mid-Roll" || r.name === "Display Retargeting"));
  const firm = publishers.rows.filter((r) => !r.thin);
  for (let i = 1; i < firm.length; i++) assert.ok(firm[i - 1].value >= firm[i].value, "best first");
  const thinAt = publishers.rows.findIndex((r) => r.thin);
  if (thinAt >= 0) assert.ok(publishers.rows.slice(thinAt).every((r) => r.thin), "thin rows sit at the end");
  assert.ok(!rankings.some((r) => /ad\s*group/i.test(r.key)));
  assert.equal(recapRankings(analysis, resolveRecapKpi(analysis, { campaignGoal: "cpa" }).kpi).find((r) => r.key === "audience")?.metric, "cpa");
});

test("conversions from retargeting CTV viewers are counted once, from one cut", () => {
  assert.equal(ctvAssist(analysis)?.conversions, 2099);
});

test("creative names drop the file type, trafficking codes and advertiser, and keep the size", () => {
  assert.equal(creativeName("Acme - Video Theme A - 3840x2160.mp4", "Acme Auto Accessories"), "Video Theme A · 3840x2160");
  assert.equal(creativeName("husky-cleans-faster-320x50.jpg", "Husky Liners"), "Cleans Faster · 320x50");
  assert.equal(creativeName("24RTK23663-15-Husky-Challenger-200-CleansFaster-WebMix-URL-D06-R03-3840x2160-H264.mp4", "Husky Liners"), "Challenger Cleans Faster · 3840x2160");
  assert.equal(creativeName("24RTK23663-15-Husky-Challenger-400-30PercentLess-WebMix-URL-D06-R03-3840x2160-H264.mp4", "Husky Liners"), "Challenger 30 Percent Less · 3840x2160");
  assert.equal(creativeName("husky-made-in-usa-300x250.jpg", "Husky Liners"), "Made in USA · 300x250");
  assert.equal(creativeName("Husky Liners - Factory mats - 300x250", "Husky Liners"), "Factory Mats · 300x250");
  assert.equal(creativeName("Spring Hero 30s"), "Spring Hero 30s");
});

test("rankings show up to the top 30 rows by spend, each creative size its own row", () => {
  const rankings = recapRankings(analysis, resolveRecapKpi(analysis, { briefKpis: ["ROAS"] }).kpi);
  const creative = rankings.find((r) => r.key === "creative")!;
  assert.equal(creative.rows.length, 30);
  assert.ok((creative.omitted ?? 0) > 0);
  assert.equal(new Set(creative.rows.map((r) => r.name)).size, 30);
  assert.equal(creative.rows.find((r) => r.name === "Video Theme A · 3840x2160")?.format, "Video");
  assert.ok(creative.rows.some((r) => r.name === "Display Theme H · 320x50" && r.format === "Display"));
  assert.ok(rankings.every((r) => r.rows.length <= 30));
});

test("recommendations are introduced toward the KPI and never as a verdict", () => {
  const { kpi } = resolveRecapKpi(analysis, { briefKpis: ["ROAS > 500%"] });
  assert.match(recommendationsIntro(kpi, "Checkouts"), /^To drive better performance towards the campaign's ROAS goal/);
  assert.equal(kpiBeatText(kpi!), null, "a missed target gets no badge at all");
  assert.match(recommendationsIntro(resolveRecapKpi(analysis, { briefKpis: ["ROAS > 120%"] }).kpi, "Checkouts"), /^To drive even stronger ROAS/);
  assert.equal(kpiEffect({ id: "r", title: "t", detail: "d", area: "channel", appliedAt: null, kind: "change", strength: "strong" }, resolveRecapKpi(analysis, { campaignGoal: "cpa" }).kpi, "Checkouts"), "Lowers cost per checkout");
});

test("blunt wording in client copy is left out", () => {
  const copy = normalizeRecapCopy({
    campaigns: [{ campaignId: "c1", summary: "The campaign missed its goal.", cards: [{ findingId: "f2", headline: "CTV underperformed on cost", stat: "33% of checkouts" }] }],
    recommendations: [],
  }, [linked()], () => "id");
  assert.equal(copy.campaigns.get("c1")!.summary, "");
  assert.equal(copy.campaigns.get("c1")!.cards.length, 0);
  assert.ok(copy.dropped.every((d) => /blunt wording/.test(d)));
});

test("on a ROAS KPI the evidence bars show ROAS against the campaign's", () => {
  const copy = normalizeRecapCopy({ campaigns: [], recommendations: [{ kind: "keep", title: "Keep pre-roll in the mix", detail: "Pre-roll beat the campaign average", area: "channel", findings: [{ campaignId: "c1", findingId: "f1" }], evidenceRows: ["Pre-Roll/Mid-Roll"], measure: "ROAS on pre-roll" }] }, [linked()], () => "id", { briefKpis: ["ROAS"] });
  const evidence = copy.recommendations[0].evidence!;
  assert.equal(evidence.metric, "roas");
  assert.ok(Math.abs(evidence.bars[0].cpa - 4.53) < 0.01);
  assert.ok(Math.abs(evidence.bars[1].cpa - 3.73) < 0.01);
});

test("the planner's KPI choice and hidden blocks survive a rebuild", () => {
  const recap = assembleRecap([linked()], { campaigns: new Map(), recommendations: [], dropped: [] }, null, { actor: "TJ", briefKpis: ["ROAS"] });
  const profile: any = { campaignRecap: recap };
  const out = applyRecapOps(profile, parseOps([
    { type: "set_recap_kpi", campaignId: "c1", metric: "cpa" },
    { type: "set_recap_block", campaignId: "c1", block: "trend", hidden: true },
    { type: "set_recap_kpi", campaignId: "c1", metric: "nonsense" },
  ]).ops);
  assert.equal(out.rejected.length, 1);
  assert.equal(profile.campaignRecap.campaigns[0].kpi.metric, "cpa");
  assert.equal(profile.campaignRecap.campaigns[0].kpi.source, "planner");
  assert.deepEqual(profile.campaignRecap.campaigns[0].hiddenBlocks, ["trend"]);
  const rebuilt = assembleRecap([linked()], { campaigns: new Map(), recommendations: [], dropped: [] }, profile.campaignRecap, { actor: "TJ", briefKpis: ["ROAS"] });
  assert.equal(rebuilt.campaigns[0].kpi?.metric, "cpa");
  assert.deepEqual(rebuilt.campaigns[0].hiddenBlocks, ["trend"]);
  applyRecapOps(profile, parseOps(out.revertOps, { allowRestore: true }).ops);
  assert.equal(profile.campaignRecap.campaigns[0].kpi.metric, "roas", "undo restores the KPI");
});

test("the recap freezes every figure the KPI layout draws", () => {
  const figures = recapFigures(linked(), { briefKpis: ["ROAS > 120%"] });
  assert.equal(figures.kpi?.metric, "roas");
  assert.ok(figures.kpiValues?.cpa && figures.kpiValues?.conversions);
  assert.ok(figures.trend && figures.rankings?.length);
  assert.equal(figures.ctvAssist?.conversions, 2099);
  assert.ok(figures.mix?.rows.every((r) => typeof r.roas === "number"));
  assert.ok(figures.tiles.some((t) => t.metric === "vcr"));
});

test("a detail block the planner hid never reaches the share link", () => {
  const recap = assembleRecap([linked()], { campaigns: new Map(), recommendations: [], dropped: [] }, null, { actor: "TJ", briefKpis: ["ROAS"] });
  assert.equal(clientRecap(recap), recap, "nothing hidden, nothing changed");
  recap.campaigns[0].hiddenBlocks = ["trend", "audience", "mix"];
  const shared = clientRecap(recap).campaigns[0];
  assert.equal(shared.trend, null);
  assert.equal(shared.mix, null);
  assert.equal(shared.ctvAssist, null);
  assert.ok(!shared.rankings?.some((r) => r.key === "audience"));
  assert.ok(shared.rankings?.some((r) => r.key === "publisher"));
  assert.ok(recap.campaigns[0].trend, "the planner's copy is untouched");
});

test("a recommended change reads as a move: share before and after, and the dollars that shift", async () => {
  const { changeLines } = await import("./recap");
  const { lineShift } = await import("../components/CampaignRecapSection");
  const plan = (olv: [number, number], ctv: [number, number]) => ({ channelStrategy: { mediaPlan: { channels: [
    { channelId: "olv", channelName: "Online Video", allocationPercent: olv[0], allocationDollars: olv[1] },
    { channelId: "ctv", channelName: "CTV", allocationPercent: ctv[0], allocationDollars: ctv[1] },
  ] } } });
  const lines = changeLines(plan([10, 10000], [20, 20000]), plan([14, 14000], [15, 15000]), ["olv"]);
  const olv = lineShift(lines.find((l) => "channelId" in l && l.channelId === "olv")!, false, [])!;
  assert.deepEqual(olv, { from: { percent: 10, budget: 10000 }, to: { percent: 14, budget: 14000 }, delta: 4000 });
  const ctv = lineShift(lines.find((l) => "channelId" in l && l.channelId === "ctv")!, false, [])!;
  assert.equal(ctv.delta, -5000);
  // Lines saved before the "from" values existed work them out from the dollar change.
  const legacy = lineShift({ kind: "allocation", channelId: "olv", channelName: "Online Video", percent: 14, budget: 14000, direction: "up", delta: 4000 }, false, [])!;
  assert.deepEqual(legacy.from, { percent: 10, budget: 10000 });
});
