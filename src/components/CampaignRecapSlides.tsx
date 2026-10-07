import React from "react";
import { ArrowDownRight, ArrowUpRight, BarChart3, Check, ClipboardCheck, Equal, History, Lightbulb, Minus, Plus, Target, ThumbsDown, ThumbsUp, type LucideIcon } from "lucide-react";
import { fundingSummary, projectChannel, projectPlan, type CampaignRecap, type RecapCampaign, type RecapChangeLine, type RecapRecommendation } from "../performance/recap";
import type { FindingKind } from "../performance/review";
import { AREA_ICONS, decisionLines, evidenceValue, lineShift, lineValue, recommendationProjection, type PlanChannel } from "./CampaignRecapSection";
import { QuadrantChart, quadrantPoints, RANKING_TITLES, rankingFootnote, rankingGeometry, slideRanking, rankingSubtitle, rankingValue, TrendChart, trendCaption } from "./CampaignRecapCharts";
import { ctvNote, supportingTiles, TAKEAWAY_STYLES, takeawayIcon, targetBarGeometry, tileDisplay } from "./CampaignRecapInsights";
import type { RecapRanking } from "../performance/recapKpi";
import {
  KIND_LABELS, PROJECTION_FOOTNOTE, STRENGTH_LABELS, projectsCtv, approxRange, fundingText, campaignSubtitle, compactMoney, cpaText, kpiBeatText, kpiCaption, kpiEffect, kpiName,
  kpiSentence, kpiTargetText, kpiValueText, percentText, recommendationsIntro, roasText, shareText, shiftText, singular, splitStat, tileText,
} from "./recapFormat";

// The Campaign Recap as 16:9 slides (1920x1080), drawn off-screen and captured to PNG or PDF.
// Inline styles throughout: the capture reads computed styles, and these must not depend on the
// page's Tailwind build. Per campaign: the KPI hero, the key takeaways, where results came from
// and the detail blocks two to a slide (recaps built before the KPI keep the earlier glance and
// findings slides); then the recommendations, four to a slide, and the plan they changed. A block
// the planner hid from the client is not exported.

type Slide = { title: string; render: () => React.ReactNode };

const INK = "#0f172a";
const BODY = "#475569";
const MUTED = "#64748b";
const ACCENT = "#4f46e5";
const KIND: Record<FindingKind, { icon: LucideIcon; color: string; bg: string; border: string }> = {
  worked: { icon: ThumbsUp, color: "#047857", bg: "#ecfdf5", border: "#d1fae5" },
  didnt: { icon: ThumbsDown, color: "#be123c", bg: "#fff1f2", border: "#ffe4e6" },
  watch: { icon: Lightbulb, color: "#b45309", bg: "#fffbeb", border: "#fef3c7" },
};

const PER_SLIDE = 4;

export function recapSlides(recap: CampaignRecap, planChannels: PlanChannel[]): Slide[] {
  const several = recap.campaigns.length > 1;
  const slides: Slide[] = [];
  for (const c of recap.campaigns) {
    const suffix = several ? ` – ${c.name}` : "";
    if (c.kpiValues) {
      const hidden = new Set(c.hiddenBlocks ?? []);
      slides.push({ title: `How the campaign performed${suffix}`, render: () => <KpiSlide campaign={c} /> });
      if (c.cards.length > 0) slides.push({ title: `Key takeaways${suffix}`, render: () => <TakeawaysSlide campaign={c} /> });
      if (!hidden.has("mix") && quadrantPoints(c)) slides.push({ title: `Where results came from${suffix}`, render: () => <QuadrantSlide campaign={c} /> });
      const panels: Panel[] = [
        ...(c.trend && !hidden.has("trend") ? [{ key: "trend", title: "Performance over the flight" }] : []),
        ...(c.rankings ?? []).filter((r) => !hidden.has(r.key)).map((r) => ({ key: r.key, title: RANKING_TITLES[r.key], ranking: r })),
      ];
      for (let i = 0; i < panels.length; i += 2) {
        const pair = panels.slice(i, i + 2);
        slides.push({ title: `${pair.map((p) => p.title).join(" and ")}${suffix}`, render: () => <DetailSlide campaign={c} panels={pair} /> });
      }
    } else {
      slides.push({ title: `Results at a glance${suffix}`, render: () => <GlanceSlide campaign={c} /> });
      if (c.cards.length > 0) slides.push({ title: `What worked and what didn't${suffix}`, render: () => <FindingsSlide campaign={c} /> });
    }
  }
  const recs = recap.recommendations;
  const pages = Math.ceil(recs.length / PER_SLIDE);
  for (let i = 0; i < pages; i++) {
    const page = recs.slice(i * PER_SLIDE, (i + 1) * PER_SLIDE);
    slides.push({ title: `Our recommendations${pages > 1 ? ` (${i + 1} of ${pages})` : ""}`, render: () => <RecommendationsSlide recap={recap} recs={page} planChannels={planChannels} /> });
  }
  if (recs.some((r) => r.appliedAt && (r.changes?.length ?? 0) > 0) && planChannels.length) {
    slides.push({ title: "How the recap changed this plan", render: () => <PlanChangeSlide recap={recap} planChannels={planChannels} /> });
  }
  return slides;
}

function Frame({ kicker, title, subtitle, children }: { kicker: string; title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div style={{ width: "1920px", height: "1080px", background: "#ffffff", padding: "72px 88px", boxSizing: "border-box", fontFamily: "Inter, system-ui, -apple-system, sans-serif", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "12px", color: ACCENT, fontSize: "18px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
        <History style={{ width: "24px", height: "24px" }} /> {kicker}
      </div>
      <div style={{ fontSize: "48px", fontWeight: 800, color: INK, letterSpacing: "-0.02em", marginTop: "14px", lineHeight: 1.15 }}>{title}</div>
      {subtitle && <div style={{ fontSize: "22px", color: MUTED, marginTop: "10px" }}>{subtitle}</div>}
      <div style={{ flex: 1, marginTop: "44px", minHeight: 0 }}>{children}</div>
    </div>
  );
}

function GlanceSlide({ campaign }: { campaign: RecapCampaign }) {
  const rows = campaign.mix?.rows ?? [];
  const max = Math.max(0.01, ...rows.flatMap((r) => [r.spendShare, r.conversionShare]));
  return (
    <Frame kicker="Campaign Recap" title="Results at a glance" subtitle={campaignSubtitle(campaign)}>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.max(1, campaign.tiles.length)}, minmax(0, 1fr))`, gap: "20px" }}>
        {campaign.tiles.map((tile) => {
          const { value, label } = tileText(tile, campaign);
          return (
            <div key={tile.metric} style={{ background: "#f1f5f9", borderRadius: "20px", padding: "24px 26px" }}>
              <div style={{ fontSize: "44px", fontWeight: 800, color: INK, lineHeight: 1.1 }}>{value}</div>
              <div style={{ fontSize: "18px", fontWeight: 600, color: MUTED, marginTop: "6px" }}>{label}</div>
            </div>
          );
        })}
      </div>
      {campaign.mix && (
        <div style={{ marginTop: "48px" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: "28px" }}>
            <div style={{ fontSize: "26px", fontWeight: 700, color: INK }}>Share of spend vs share of {campaign.conversionLabel.toLowerCase()} by {campaign.mix.dimension}</div>
            <Legend label={campaign.conversionLabel} />
          </div>
          <div style={{ marginTop: "22px", display: "flex", flexDirection: "column", gap: "18px" }}>
            {rows.map((row) => (
              <div key={row.name} style={{ display: "grid", gridTemplateColumns: "300px 1fr 150px", gap: "28px", alignItems: "center" }}>
                <div style={{ fontSize: "21px", fontWeight: 600, color: INK, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{row.name}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <SlideBar share={row.spendShare} max={max} color="#cbd5e1" />
                  <SlideBar share={row.conversionShare} max={max} color={ACCENT} />
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: "22px", fontWeight: 700, color: INK }}>{cpaText(row.cpa)}</div>
                  <div style={{ fontSize: "14px", color: row.lowSample ? "#b45309" : MUTED }}>{row.lowSample ? "small sample" : "CPA"}</div>
                </div>
              </div>
            ))}
          </div>
          {campaign.mixNote && <div style={{ fontSize: "17px", color: MUTED, marginTop: "22px" }}>{campaign.mixNote}</div>}
        </div>
      )}
    </Frame>
  );
}

function Legend({ label }: { label: string }) {
  const swatch = (color: string) => <span style={{ display: "inline-block", width: "16px", height: "16px", borderRadius: "4px", background: color }} />;
  return (
    <div style={{ display: "flex", gap: "22px", fontSize: "17px", color: MUTED, alignItems: "center" }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>{swatch("#cbd5e1")} Spend</span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>{swatch(ACCENT)} {label}</span>
    </div>
  );
}

function SlideBar({ share, max, color }: { share: number; max: number; color: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
      <div style={{ flex: 1, height: "16px", borderRadius: "9999px", background: "#f1f5f9", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${Math.max(1, (share / max) * 100)}%`, background: color, borderRadius: "9999px" }} />
      </div>
      <span style={{ width: "58px", textAlign: "right", fontSize: "18px", fontWeight: 600, color: MUTED }}>{shareText(share)}</span>
    </div>
  );
}

function FindingsSlide({ campaign }: { campaign: RecapCampaign }) {
  const kinds = (["worked", "didnt", "watch"] as FindingKind[]).filter((k) => campaign.cards.some((c) => c.kind === k));
  // Four or more cards in one column would run off the slide at full size.
  const dense = Math.max(...kinds.map((k) => campaign.cards.filter((c) => c.kind === k).length)) > 3;
  return (
    <Frame kicker="Campaign Recap" title="What worked and what didn't" subtitle={campaign.summary ? `${campaign.summary}.` : undefined}>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${kinds.length}, minmax(0, 1fr))`, gap: "32px", height: "100%" }}>
        {kinds.map((kind) => {
          const style = KIND[kind];
          const Icon = style.icon;
          return (
            <div key={kind}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "20px", fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: style.color }}>
                <Icon style={{ width: "26px", height: "26px" }} /> {KIND_LABELS[kind]}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: dense ? "12px" : "16px", marginTop: "20px" }}>
                {campaign.cards.filter((c) => c.kind === kind).map((card) => (
                  <div key={card.id} style={{ background: style.bg, border: `2px solid ${style.border}`, borderRadius: "18px", padding: dense ? "16px 22px" : "24px 26px" }}>
                    <div style={{ fontSize: dense ? "22px" : "26px", fontWeight: 700, color: INK, lineHeight: 1.3 }}>{card.headline}</div>
                    <div style={{ fontSize: dense ? "18px" : "20px", color: BODY, marginTop: "6px", lineHeight: 1.4 }}>{card.stat}</div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </Frame>
  );
}

const STRENGTH_COLORS = {
  strong: { color: "#047857", bg: "#ecfdf5", border: "#d1fae5" },
  directional: { color: "#4338ca", bg: "#eef2ff", border: "#e0e7ff" },
  test: { color: "#92400e", bg: "#fffbeb", border: "#fef3c7" },
} as const;

function Pill({ text, color, bg, border }: { text: string; color: string; bg: string; border: string }) {
  return <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: bg, border: `1.5px solid ${border}`, color, borderRadius: "9999px", padding: "3px 12px", fontSize: "15px", fontWeight: 700, whiteSpace: "nowrap" }}>{text}</span>;
}

function SlideChangeLine({ line, applied, planChannels }: { line: RecapChangeLine; applied: boolean; planChannels: PlanChannel[] }) {
  const shift = lineShift(line, applied, planChannels);
  const up = line.kind === "channel_added" || line.kind === "publisher_added" || (line.kind === "allocation" && line.direction === "up");
  const Icon = line.kind === "allocation" ? (line.direction === "up" ? ArrowUpRight : ArrowDownRight) : up ? Plus : Minus;
  const name = "channelName" in line ? line.channelName : line.name;
  const move = shift
    ? `${shift.from ? `${percentText(shift.from.percent)} → ` : line.kind === "channel_added" ? "New · " : ""}${percentText(shift.to.percent)} of budget`
    : up ? "Added" : "Removed";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "18px" }}>
      <Icon style={{ width: "20px", height: "20px", color: up ? "#059669" : "#94a3b8", flexShrink: 0 }} />
      <span style={{ flex: 1, color: INK, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</span>
      <span style={{ fontWeight: 700, color: INK, whiteSpace: "nowrap" }}>{move}</span>
      {shift && shift.delta !== 0 && <span style={{ fontWeight: 700, color: shift.delta > 0 ? "#047857" : MUTED, whiteSpace: "nowrap", minWidth: "64px", textAlign: "right" }}>{shiftText(shift.delta)}</span>}
    </div>
  );
}

function RecommendationsSlide({ recap, recs, planChannels }: { recap: CampaignRecap; recs: RecapRecommendation[]; planChannels: PlanChannel[] }) {
  const label = recap.benchmarks?.conversionLabel ?? recap.campaigns[0]?.conversionLabel ?? "conversions";
  const projected = recs.map((r) => recommendationProjection(r, recap.benchmarks, planChannels)).filter(Boolean) as Array<{ channelName: string }>;
  const kpi = recap.campaigns[0]?.kpi;
  const kpiLed = Boolean(recap.campaigns[0]?.kpiValues);
  return (
    <Frame kicker="Campaign Recap" title="Our recommendations" subtitle={kpiLed ? recommendationsIntro(kpi, label) : "What the next campaign should do, and the evidence behind each"}>
      <div style={{ display: "grid", gridTemplateColumns: recs.length > 1 ? "repeat(2, minmax(0, 1fr))" : "1fr", gap: "18px" }}>
        {recs.map((rec) => {
          const Icon = AREA_ICONS[rec.area] ?? Target;
          const applied = Boolean(rec.appliedAt);
          const kind = rec.kind ?? "change";
          const projection = recommendationProjection(rec, recap.benchmarks, planChannels);
          const strength = rec.strength ? STRENGTH_COLORS[rec.strength] : null;
          const bars = rec.evidence?.bars ?? [];
          const max = Math.max(...bars.map((b) => b.cpa), 0.01);
          const effect = kpiLed ? kpiEffect(rec, kpi, label) : null;
          const number = kpiLed ? recap.recommendations.indexOf(rec) + 1 : null;
          return (
            <div key={rec.id} style={{ background: "#f8fafc", border: `2px solid ${applied ? "#a7f3d0" : "#eef2f7"}`, borderRadius: "20px", padding: "18px 24px", display: "flex", flexDirection: "column", gap: "10px" }}>
              <div style={{ display: "flex", gap: "16px", alignItems: "flex-start" }}>
                <div style={{ width: "48px", height: "48px", borderRadius: "14px", background: number ? ACCENT : "#eef2ff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: "#ffffff", fontSize: "24px", fontWeight: 800 }}>
                  {number ?? <Icon style={{ width: "24px", height: "24px", color: ACCENT }} />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "23px", fontWeight: 700, color: INK, lineHeight: 1.25 }}>{rec.title}</div>
                  <div style={{ fontSize: "16px", color: BODY, marginTop: "3px", lineHeight: 1.35 }}>{rec.detail}.</div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px", alignItems: "flex-end" }}>
                  {strength && rec.strength && <Pill text={STRENGTH_LABELS[rec.strength]} {...strength} />}
                  {effect && <Pill text={effect} color="#4338ca" bg="#eef2ff" border="#e0e7ff" />}
                  {applied && <Pill text="In this plan" color="#047857" bg="#ecfdf5" border="#d1fae5" />}
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: bars.length || rec.evidence?.note ? "1fr 1fr" : "1fr", gap: "16px" }}>
                {(bars.length > 0 || rec.evidence?.note) && <div style={{ background: "#ffffff", borderRadius: "14px", padding: "14px 16px" }}>
                  <div style={{ fontSize: "13px", fontWeight: 700, letterSpacing: "0.08em", color: MUTED, textTransform: "uppercase", marginBottom: "8px" }}>The evidence</div>
                  {bars.map((bar) => (
                    <div key={bar.name} style={{ display: "grid", gridTemplateColumns: "150px 1fr 76px", gap: "10px", alignItems: "center", marginBottom: "6px" }}>
                      <span style={{ fontSize: "15px", color: bar.isAverage ? MUTED : INK, fontWeight: bar.isAverage ? 400 : 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{bar.name}</span>
                      <div style={{ height: "10px", borderRadius: "9999px", background: "#e2e8f0", overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${Math.max(2, (bar.cpa / max) * 100)}%`, background: bar.isAverage ? "#94a3b8" : ACCENT, borderRadius: "9999px" }} />
                      </div>
                      <span style={{ fontSize: "15px", fontWeight: 700, color: INK, textAlign: "right" }}>{rec.evidence ? evidenceValue(rec.evidence, bar.cpa, kpi?.roasStyle) : compactMoney(bar.cpa)}</span>
                    </div>
                  ))}
                  {rec.evidence?.note && <div style={{ fontSize: "14px", color: MUTED, lineHeight: 1.35 }}>{rec.evidence.note}</div>}
                </div>}
                <div style={{ background: "#ffffff", borderRadius: "14px", padding: "14px 16px" }}>
                  <div style={{ fontSize: "13px", fontWeight: 700, letterSpacing: "0.08em", color: MUTED, textTransform: "uppercase", marginBottom: "8px" }}>
                    {applied || kind === "keep" ? "In this plan" : kind === "execution" ? "How we'll run it" : "The change"}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    {decisionLines(rec).slice(0, 3).map((line, i) => <SlideChangeLine key={i} line={line} applied={applied} planChannels={planChannels} />)}
                    {(() => { const f = fundingSummary(rec.changes); return f ? <div style={{ fontSize: "15px", color: MUTED }}>{fundingText(f)}</div> : null; })()}
                    {!decisionLines(rec).length && (
                      <div style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "18px", color: BODY }}>
                        {kind === "keep" ? <Equal style={{ width: "20px", height: "20px" }} /> : <ClipboardCheck style={{ width: "20px", height: "20px" }} />}
                        {kind === "keep" ? "Kept as it is, on purpose" : kind === "execution" ? "Part of how we run the campaign" : "Worked into the plan with your team"}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              {(projection || rec.measure) && (
                <div style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "16px", color: BODY }}>
                  {projection && <div style={{ display: "flex", gap: "8px", alignItems: "center" }}><BarChart3 style={{ width: "18px", height: "18px", color: ACCENT }} /><span><b style={{ color: INK }}>{approxRange(projection.low, projection.high)} {label.toLowerCase()}</b> from {projection.channelName} at last campaign's costs ({compactMoney(Math.min(projection.cpa, projection.averageCpa))}–{compactMoney(Math.max(projection.cpa, projection.averageCpa))} per {singular(label)})</span></div>}
                  {rec.measure && <div style={{ display: "flex", gap: "8px", alignItems: "center", color: MUTED }}><Target style={{ width: "18px", height: "18px" }} /><span>We'll measure: {rec.measure}</span></div>}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {projected.length > 0 && <div style={{ fontSize: "14px", color: "#94a3b8", marginTop: "16px" }}>{PROJECTION_FOOTNOTE(label, projectsCtv(projected.map((p) => p.channelName)))}</div>}
    </Frame>
  );
}

function PlanChangeSlide({ recap, planChannels }: { recap: CampaignRecap; planChannels: PlanChannel[] }) {
  const moved = new Map<string, "up" | "down" | "added">();
  const publishers: Array<{ name: string; added: boolean }> = [];
  for (const rec of recap.recommendations.filter((r) => r.appliedAt)) {
    for (const line of decisionLines(rec)) {
      if (line.kind === "allocation") moved.set(line.channelId, line.direction);
      if (line.kind === "channel_added") moved.set(line.channelId, "added");
      if (line.kind === "publisher_added" || line.kind === "publisher_removed") publishers.push({ name: line.name, added: line.kind === "publisher_added" });
    }
  }
  const label = recap.benchmarks?.conversionLabel ?? recap.campaigns[0]?.conversionLabel ?? "conversions";
  const plan = projectPlan(recap.benchmarks, planChannels);
  const max = Math.max(...planChannels.map((c) => c.allocationPercent), 1);
  const channels = [...planChannels].sort((a, z) => z.allocationPercent - a.allocationPercent);
  return (
    <Frame kicker="Campaign Recap" title="How the recap changed this plan" subtitle="The media mix after our recommendations">
      <div style={{ display: "flex", gap: "56px", height: "100%" }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "16px" }}>
          {channels.map((c) => {
            const direction = moved.get(c.channelId);
            const projection = projectChannel(recap.benchmarks, c.channelId, c.allocationDollars);
            const color = direction === "up" || direction === "added" ? "#10b981" : direction === "down" ? "#fda4af" : "#cbd5e1";
            const Icon = direction === "up" ? ArrowUpRight : direction === "down" ? ArrowDownRight : direction === "added" ? Plus : null;
            return (
              <div key={c.channelId} style={{ display: "grid", gridTemplateColumns: "320px 1fr 200px 170px", gap: "24px", alignItems: "center" }}>
                <span style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "21px", fontWeight: direction ? 700 : 500, color: direction ? INK : BODY, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {Icon && <Icon style={{ width: "22px", height: "22px", color: direction === "down" ? "#f43f5e" : "#059669", flexShrink: 0 }} />}{c.channelName}
                </span>
                <div style={{ height: "18px", borderRadius: "9999px", background: "#f1f5f9", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${(c.allocationPercent / max) * 100}%`, background: color, borderRadius: "9999px" }} />
                </div>
                <span style={{ fontSize: "20px", fontWeight: 700, color: INK, textAlign: "right" }}>{percentText(c.allocationPercent)} · {compactMoney(c.allocationDollars)}</span>
                <span style={{ fontSize: "18px", color: MUTED, textAlign: "right" }}>{projection ? approxRange(projection.low, projection.high) : "–"}</span>
              </div>
            );
          })}
          {publishers.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", marginTop: "8px" }}>
              {publishers.map((p) => <Pill key={p.name} text={`${p.added ? "+" : "–"} ${p.name}`} color={p.added ? "#047857" : "#be123c"} bg={p.added ? "#ecfdf5" : "#fff1f2"} border={p.added ? "#d1fae5" : "#ffe4e6"} />)}
            </div>
          )}
        </div>
        {plan && (
          <div style={{ width: "380px", flexShrink: 0, background: "#eef2ff", borderRadius: "24px", padding: "36px 34px", alignSelf: "flex-start" }}>
            <div style={{ fontSize: "15px", fontWeight: 700, letterSpacing: "0.08em", color: ACCENT, textTransform: "uppercase" }}>Projected at last campaign's costs</div>
            <div style={{ fontSize: "52px", fontWeight: 800, color: INK, marginTop: "14px", lineHeight: 1.05 }}>{approxRange(plan.low, plan.high)}</div>
            <div style={{ fontSize: "20px", color: BODY, marginTop: "6px" }}>{label.toLowerCase()}</div>
            <div style={{ fontSize: "15px", color: MUTED, marginTop: "18px", lineHeight: 1.45 }}>Covers {shareText(plan.coveredShare)} of the budget. {PROJECTION_FOOTNOTE(label, projectsCtv(planChannels.filter((c) => plan.channels.some((p) => p.channelId === c.channelId)).map((c) => c.channelName)))}</div>
          </div>
        )}
      </div>
    </Frame>
  );
}

// ---- KPI-led slides ----

type Panel = { key: string; title: string; ranking?: RecapRanking };

function KpiSlide({ campaign }: { campaign: RecapCampaign }) {
  const kpi = campaign.kpi;
  const label = campaign.conversionLabel;
  const tiles = supportingTiles(campaign);
  const bar = targetBarGeometry(campaign);
  const beat = kpi ? kpiBeatText(kpi) : null;
  const sentence = kpiSentence(campaign);
  return (
    <Frame kicker="Campaign Recap" title="How the campaign performed" subtitle={campaignSubtitle(campaign)}>
      <div style={{ background: "linear-gradient(135deg, #4338ca, #312e81)", borderRadius: "32px", padding: "56px 64px", color: "#ffffff", display: "flex", gap: "56px", alignItems: "center", height: "100%", boxSizing: "border-box" }}>
        <div style={{ flex: 1.3, minWidth: 0 }}>
          {kpi && (
            <>
              <div style={{ display: "inline-flex", alignItems: "center", gap: "10px", background: "rgba(255,255,255,0.15)", borderRadius: "9999px", padding: "8px 18px", fontSize: "18px", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                <Target style={{ width: "22px", height: "22px" }} /> {kpi.source === "data" ? "Headline result" : `Campaign KPI · ${kpiName(kpi.metric, label)}`}
              </div>
              {kpi.target && kpi.target.metric === kpi.metric && <div style={{ fontSize: "20px", color: "#c7d2fe", marginTop: "14px" }}>Target from your brief: {kpi.target.text}</div>}
              <div style={{ display: "flex", alignItems: "flex-end", gap: "28px", marginTop: "18px" }}>
                <div style={{ fontSize: "150px", fontWeight: 800, lineHeight: 0.95, letterSpacing: "-0.03em" }}>{kpiValueText(kpi.metric, kpi.value, kpi.roasStyle)}</div>
                <div style={{ paddingBottom: "14px" }}>
                  {beat && <div style={{ display: "inline-block", background: "rgba(52,211,153,0.2)", color: "#a7f3d0", borderRadius: "9999px", padding: "6px 16px", fontSize: "22px", fontWeight: 700 }}>{beat}</div>}
                  <div style={{ fontSize: "24px", color: "#e0e7ff", marginTop: "8px" }}>{kpiCaption(kpi.metric, label)}</div>
                </div>
              </div>
              {bar && (
                <div style={{ marginTop: "34px", maxWidth: "720px" }}>
                  <div style={{ position: "relative", height: "22px", borderRadius: "9999px", background: "rgba(255,255,255,0.15)" }}>
                    <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${bar.fill * 100}%`, borderRadius: "9999px", background: bar.good ? "#6ee7b7" : "#a5b4fc" }} />
                    <div style={{ position: "absolute", top: "-10px", bottom: "-10px", width: "4px", background: "#ffffff", left: `${bar.mark * 100}%` }} />
                  </div>
                  <div style={{ position: "relative", height: "30px", fontSize: "17px", color: "#ffffff", fontWeight: 700 }}>
                    <span style={{ position: "absolute", top: "12px", left: `${bar.mark * 100}%`, transform: "translateX(-50%)", whiteSpace: "nowrap" }}>Target {kpiTargetText(kpi)}</span>
                  </div>
                </div>
              )}
            </>
          )}
          {sentence && <div style={{ fontSize: "26px", fontWeight: 600, marginTop: "34px", lineHeight: 1.4 }}>{sentence}</div>}
          {campaign.summary && <div style={{ fontSize: "22px", color: "#e0e7ff", marginTop: "12px", lineHeight: 1.45 }}>{campaign.summary}.</div>}
        </div>
        {tiles.length > 0 && (
          <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "22px" }}>
            {tiles.map((tile) => {
              const { value, label: caption } = tileDisplay(tile, campaign);
              return (
                <div key={tile.metric} style={{ background: "rgba(255,255,255,0.1)", borderRadius: "24px", padding: "30px 30px" }}>
                  <div style={{ fontSize: "54px", fontWeight: 800, lineHeight: 1.05 }}>{value}</div>
                  <div style={{ fontSize: "19px", color: "#c7d2fe", marginTop: "8px" }}>{caption}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Frame>
  );
}

const TAKEAWAY_COLORS = {
  worked: { color: "#047857", bg: "#ecfdf5", border: "#d1fae5", box: "#d1fae5" },
  didnt: { color: "#4338ca", bg: "#eef2ff", border: "#e0e7ff", box: "#e0e7ff" },
  watch: { color: "#b45309", bg: "#fffbeb", border: "#fef3c7", box: "#fef3c7" },
} as const;

function TakeawaysSlide({ campaign }: { campaign: RecapCampaign }) {
  const order: Record<FindingKind, number> = { worked: 0, didnt: 1, watch: 2 };
  const cards = [...campaign.cards].sort((a, z) => order[a.kind] - order[z.kind]);
  return (
    <Frame kicker="Campaign Recap" title="Key takeaways" subtitle={campaignSubtitle(campaign)}>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${cards.length >= 4 ? 2 : cards.length}, minmax(0, 1fr))`, gap: "28px", height: "100%" }}>
        {cards.map((card) => {
          const c = TAKEAWAY_COLORS[card.kind];
          const Icon = takeawayIcon(card.kind, card.area);
          const split = splitStat(card.stat);
          return (
            <div key={card.id} style={{ background: c.bg, border: `2px solid ${c.border}`, borderRadius: "28px", padding: cards.length >= 4 ? "32px 36px" : "56px 44px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                <div style={{ width: "64px", height: "64px", borderRadius: "18px", background: c.box, color: c.color, display: "flex", alignItems: "center", justifyContent: "center" }}><Icon style={{ width: "32px", height: "32px" }} /></div>
                {card.kind !== "worked" && <span style={{ fontSize: "18px", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: c.color }}>{TAKEAWAY_STYLES[card.kind].label}</span>}
              </div>
              <div style={{ fontSize: "32px", fontWeight: 700, color: INK, marginTop: "24px", lineHeight: 1.25 }}>{card.headline}</div>
              {split ? (
                <>
                  <div style={{ fontSize: "64px", fontWeight: 800, color: c.color, marginTop: "14px", lineHeight: 1.1 }}>
                    {split.figure}{split.label && <span style={{ fontSize: "26px", fontWeight: 600, color: BODY }}> {split.label}</span>}
                  </div>
                  {split.rest && <div style={{ fontSize: "22px", color: BODY, marginTop: "6px" }}>{split.rest}</div>}
                </>
              ) : (
                <div style={{ fontSize: "24px", color: BODY, marginTop: "12px" }}>{card.stat}</div>
              )}
            </div>
          );
        })}
      </div>
    </Frame>
  );
}

function QuadrantSlide({ campaign }: { campaign: RecapCampaign }) {
  const data = quadrantPoints(campaign)!;
  const note = ctvNote(campaign);
  return (
    <Frame kicker="Campaign Recap" title="Where results came from" subtitle={`Each ${campaign.mix?.dimension ?? "media type"}'s result against its share of the budget`}>
      <div style={{ display: "flex", gap: "56px", height: "100%" }}>
        <div style={{ flex: 1.5, minWidth: 0 }}><QuadrantChart campaign={campaign} conversionLabel={campaign.conversionLabel} /></div>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "24px" }}>
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 110px 140px 130px", gap: "12px", fontSize: "15px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: MUTED, paddingBottom: "10px" }}>
              <span>{campaign.mix?.dimension}</span><span style={{ textAlign: "right" }}>Spend</span><span style={{ textAlign: "right" }}>{campaign.conversionLabel}</span><span style={{ textAlign: "right" }}>{data.metric === "roas" ? "ROAS" : "CPA"}</span>
            </div>
            {data.points.map((p) => (
              <div key={p.name} style={{ display: "grid", gridTemplateColumns: "1fr 110px 140px 130px", gap: "12px", fontSize: "20px", borderTop: "1px solid #f1f5f9", padding: "12px 0", alignItems: "center" }}>
                <span style={{ fontWeight: 600, color: INK, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</span>
                <span style={{ textAlign: "right", color: BODY }}>{shareText(p.spendShare)}</span>
                <span style={{ textAlign: "right", color: BODY }}>{shareText(p.conversionShare)}</span>
                <span style={{ textAlign: "right", fontWeight: 800, color: INK }}>{p.value === null ? "–" : data.metric === "roas" ? roasText(p.value, campaign.kpi?.roasStyle) : cpaText(p.value)}</span>
              </div>
            ))}
          </div>
          {note && <div style={{ fontSize: "19px", color: BODY, lineHeight: 1.45, background: "#f8fafc", borderLeft: "5px solid #c7d2fe", borderRadius: "0 14px 14px 0", padding: "16px 20px" }}><b style={{ color: INK }}>How to read CTV:</b> {note}</div>}
        </div>
      </div>
    </Frame>
  );
}

function SlideRanking({ ranking, campaign }: { ranking: RecapRanking; campaign: RecapCampaign }) {
  const g = rankingGeometry(slideRanking(ranking));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      {g.rows.map((r, i) => (
        <div key={`${r.name}-${i}`} style={{ display: "grid", gridTemplateColumns: "300px 1fr 120px", gap: "18px", alignItems: "center" }}>
          <span style={{ fontSize: "19px", fontWeight: r.better ? 700 : 500, color: r.better ? INK : BODY, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {r.format && <span style={{ fontSize: "12px", fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", borderRadius: "6px", padding: "2px 7px", marginRight: "8px", background: r.format === "Video" ? "#f5f3ff" : "#f0f9ff", color: r.format === "Video" ? "#6d28d9" : "#0369a1" }}>{r.format}</span>}
            {r.name}
          </span>
          <div style={{ position: "relative", height: "16px", borderRadius: "9999px", background: "#f1f5f9" }}>
            <div style={{ height: "100%", width: `${r.width * 100}%`, borderRadius: "9999px", background: r.thin ? "#fffbeb" : r.better ? "#10b981" : "#a5b4fc", border: r.thin ? "2px dashed #d97706" : undefined, boxSizing: "border-box" }} />
            <div style={{ position: "absolute", top: "-6px", bottom: "-6px", width: "3px", background: "#94a3b8", left: `${g.averageAt * 100}%` }} />
          </div>
          <span style={{ fontSize: "19px", fontWeight: 800, textAlign: "right", color: r.better ? "#047857" : INK }}>{rankingValue(ranking, r.value, campaign.kpi)}{r.capped ? "+" : ""}</span>
        </div>
      ))}
    </div>
  );
}

function DetailSlide({ campaign, panels }: { campaign: RecapCampaign; panels: Panel[] }) {
  const label = campaign.conversionLabel;
  return (
    <Frame kicker="Campaign Recap" title={panels.map((p) => p.title).join(" and ")} subtitle={campaignSubtitle(campaign)}>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${panels.length}, minmax(0, 1fr))`, gap: "40px", height: "100%" }}>
        {panels.map((panel) => (
          <div key={panel.key} style={{ border: "2px solid #f1f5f9", borderRadius: "28px", padding: "32px 36px", minWidth: 0 }}>
            <div style={{ fontSize: "16px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: ACCENT }}>{panel.title}</div>
            <div style={{ fontSize: "26px", fontWeight: 700, color: INK, marginTop: "6px", marginBottom: "24px" }}>
              {panel.ranking ? rankingSubtitle(panel.ranking, label, campaign.kpi) : `Cost per ${singular(label)} by week`}
            </div>
            {panel.ranking && rankingFootnote(panel.ranking, slideRanking(panel.ranking).rows.length) && <div style={{ fontSize: "16px", color: MUTED, marginTop: "-10px", marginBottom: "18px" }}>{rankingFootnote(panel.ranking, slideRanking(panel.ranking).rows.length)}</div>}
            {panel.ranking ? <SlideRanking ranking={panel.ranking} campaign={campaign} /> : campaign.trend && (
              <>
                <TrendChart trend={campaign.trend} conversionLabel={label} />
                {trendCaption(campaign.trend, label) && <div style={{ fontSize: "20px", color: BODY, marginTop: "18px", lineHeight: 1.45 }}>{trendCaption(campaign.trend, label)}</div>}
              </>
            )}
          </div>
        ))}
      </div>
    </Frame>
  );
}

/** Every slide, stacked off-screen; `slideRefs` receives each slide's element for capture. */
export function CampaignRecapSlides({ recap, planChannels, slideRefs }: { recap: CampaignRecap; planChannels: PlanChannel[]; slideRefs: React.MutableRefObject<Array<HTMLDivElement | null>> }) {
  const slides = recapSlides(recap, planChannels);
  slideRefs.current.length = slides.length;
  return (
    <div style={{ position: "fixed", left: "-99999px", top: 0, width: "1920px", pointerEvents: "none", zIndex: -9999 }} aria-hidden="true">
      {slides.map((slide, i) => (
        <div key={i} ref={(el) => { slideRefs.current[i] = el; }} style={{ width: "1920px", height: "1080px", overflow: "hidden" }}>
          {slide.render()}
        </div>
      ))}
    </div>
  );
}
