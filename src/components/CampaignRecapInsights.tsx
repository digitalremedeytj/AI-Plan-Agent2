import React from "react";
import {
  BadgeDollarSign, CalendarClock, Eye, EyeOff, Image, LayoutGrid, Lightbulb, LineChart, MapPin, MousePointerClick, PlayCircle, Ruler, ShoppingCart,
  Sparkles, Target, TrendingUp, Tv, Users, X, type LucideIcon,
} from "lucide-react";
import type { RecapBlock, RecapCampaign, RecapMetric, RecapRecommendation } from "../performance/recap";
import { activeTarget, kpiHigherIsBetter, KPI_METRICS, type KpiMetric, type RecapRanking } from "../performance/recapKpi";
import type { FindingKind } from "../performance/review";
import { QuadrantChart, quadrantPoints, RANKING_TITLES, rankingFootnote, rankingGeometry, rankingSubtitle, rankingValue, TrendChart, trendCaption } from "./CampaignRecapCharts";
import {
  compactMoney, compactNumber, cpaText, kpiBeatText, kpiCaption, kpiName, kpiSentence, kpiTargetText, kpiValueText, roasText, shareText, singular, splitStat, tileText,
} from "./recapFormat";

// The KPI-led recap of one campaign: the KPI hero and key takeaways the client reads first, then
// the detail behind them (media types, the flight, publishers, audiences, creative). Every figure
// is from the recap frozen into the plan; blocks with nothing to show are left out, and a block
// the planner hides is dimmed for them and gone from the share link.

export interface InsightControls {
  onSetKpi: (campaignId: string, metric: KpiMetric) => void;
  onSetBlock: (campaignId: string, block: RecapBlock, hidden: boolean) => void;
  onRemoveCard: (id: string) => void;
}

const findingKey = (campaignId: string, findingId: string) => `${campaignId}:${findingId}`;

const TILE_ICONS: Partial<Record<RecapMetric, LucideIcon>> = {
  conversions: ShoppingCart, cpa: BadgeDollarSign, roas: TrendingUp, reach: Users, vcr: PlayCircle,
};

/** The hero's supporting tiles: everything but the KPI itself and the spend its sentence states. */
export function supportingTiles(campaign: RecapCampaign) {
  const order: RecapMetric[] = ["conversions", "cpa", "roas", "reach", "vcr"];
  return order
    .filter((m) => m !== campaign.kpi?.metric && !(m === "conversions" && campaign.kpi?.metric === "conversions"))
    .map((m) => campaign.tiles.find((t) => t.metric === m))
    .filter((t): t is NonNullable<typeof t> => Boolean(t))
    .slice(0, 4);
}

export function tileDisplay(tile: RecapCampaign["tiles"][number], campaign: RecapCampaign) {
  if (tile.metric === "roas") return { value: roasText(tile.value, campaign.kpi?.roasStyle), label: "return on ad spend" };
  const { value, label } = tileText(tile, campaign);
  return { value, label: tile.metric === "reach" ? `households reached${campaign.frequency ? ` · ${campaign.frequency.toFixed(1)}x avg frequency` : ""}` : /^[A-Z][a-z]/.test(label) ? label.charAt(0).toLowerCase() + label.slice(1) : label };
}

export function KpiHero({ campaign, controls }: { campaign: RecapCampaign; controls?: InsightControls }) {
  const kpi = campaign.kpi;
  const tiles = supportingTiles(campaign);
  const label = campaign.conversionLabel;
  const target = kpi ? activeTarget(kpi) : null;
  const beat = kpi ? kpiBeatText(kpi) : null;
  const sentence = kpiSentence(campaign);
  // A KPI read from the data is shown as the headline result until the planner confirms it.
  const confirmed = kpi && kpi.source !== "data";
  return (
    <div className="rounded-2xl bg-gradient-to-br from-indigo-700 to-indigo-900 text-white p-5 md:p-7">
      <div className={`grid gap-6 items-center ${tiles.length ? "lg:grid-cols-[1.25fr_1fr]" : ""}`}>
        <div className="min-w-0">
          {kpi ? (
            <>
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider">
                  <Target className="w-3.5 h-3.5" /> {confirmed ? `Campaign KPI · ${kpiName(kpi.metric, label)}` : "Headline result"}
                </span>
                {target && <span className="text-[11px] text-indigo-200">Target from your brief: {target.text}</span>}
                {controls && <KpiChooser campaign={campaign} controls={controls} />}
              </div>
              <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
                <div className="font-display text-5xl md:text-6xl font-bold leading-none tabular-nums">{kpiValueText(kpi.metric, kpi.value, kpi.roasStyle)}</div>
                <div className="pb-1">
                  {beat && <div className="inline-flex items-center gap-1 rounded-full bg-emerald-400/20 text-emerald-200 px-2 py-0.5 text-xs font-bold"><TrendingUp className="w-3.5 h-3.5" /> {beat}</div>}
                  <div className="text-sm text-indigo-100 mt-1">{kpiCaption(kpi.metric, label)}</div>
                </div>
              </div>
              {target && <TargetBar campaign={campaign} />}
            </>
          ) : (
            <div className="text-sm text-indigo-100">Results at a glance</div>
          )}
          {sentence && <p className="text-sm text-white font-medium mt-4 max-w-xl leading-relaxed">{sentence}</p>}
          {campaign.summary && <p className="text-sm text-indigo-100 mt-1.5 max-w-xl leading-relaxed">{campaign.summary}.</p>}
        </div>
        {tiles.length > 0 && (
          <div className="grid grid-cols-2 gap-3">
            {tiles.map((tile) => {
              const Icon = TILE_ICONS[tile.metric] ?? TrendingUp;
              const { value, label: caption } = tileDisplay(tile, campaign);
              return (
                <div key={tile.metric} className="rounded-xl bg-white/10 p-3.5 md:p-4">
                  <Icon className="w-4 h-4 text-indigo-200" />
                  <div className="font-display text-xl md:text-2xl font-bold mt-1 tabular-nums">{value}</div>
                  <div className="text-[11px] text-indigo-200 leading-snug">{caption}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/** Where the KPI sits against its target: the fill is the result, the white line the target. */
export function targetBarGeometry(campaign: RecapCampaign) {
  const kpi = campaign.kpi;
  const target = kpi ? activeTarget(kpi) : null;
  if (!kpi || !target) return null;
  const max = Math.max(kpi.value, target.value) * 1.33;
  return { fill: kpi.value / max, mark: target.value / max, max, good: kpiHigherIsBetter(kpi.metric) ? kpi.value >= target.value : kpi.value <= target.value };
}

function TargetBar({ campaign }: { campaign: RecapCampaign }) {
  const g = targetBarGeometry(campaign);
  const kpi = campaign.kpi!;
  if (!g) return null;
  return (
    <div className="mt-5 max-w-md">
      <div className="relative h-3 rounded-full bg-white/15">
        <div className={`absolute inset-y-0 left-0 rounded-full ${g.good ? "bg-emerald-300" : "bg-indigo-300"}`} style={{ width: `${g.fill * 100}%` }} />
        <div className="absolute -top-1.5 -bottom-1.5 w-0.5 bg-white" style={{ left: `${g.mark * 100}%` }} />
      </div>
      <div className="relative h-5 text-[10px] text-indigo-200 tabular-nums">
        <span className="absolute left-0 top-1">0</span>
        <span className="absolute top-1 -translate-x-1/2 font-bold text-white whitespace-nowrap" style={{ left: `${g.mark * 100}%` }}>Target {kpiTargetText(kpi)}</span>
      </div>
    </div>
  );
}

function KpiChooser({ campaign, controls }: { campaign: RecapCampaign; controls: InsightControls }) {
  const kpi = campaign.kpi!;
  const options = KPI_METRICS.filter((m) => campaign.kpiValues?.[m] !== undefined);
  const source = kpi.source === "brief" ? "from the brief" : kpi.source === "goal" ? "from the campaign goal" : kpi.source === "planner" ? "set by you" : "assumed from the data";
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-300 text-amber-950 pl-2 pr-1 py-0.5 text-[10px] font-bold" title="Only you can see this">
      Only you see: KPI {source}
      {kpi.source === "data" && (
        <button type="button" onClick={() => controls.onSetKpi(campaign.campaignId, kpi.metric)} className="rounded-full bg-amber-950/10 hover:bg-amber-950/20 px-1.5 py-0.5 cursor-pointer">Confirm</button>
      )}
      <select
        value={kpi.metric}
        onChange={(e) => controls.onSetKpi(campaign.campaignId, e.target.value as KpiMetric)}
        aria-label="Campaign KPI"
        className="rounded-full bg-amber-950/10 hover:bg-amber-950/20 px-1 py-0.5 cursor-pointer border-0 text-[10px] font-bold"
      >
        {options.map((m) => <option key={m} value={m}>{kpiName(m, campaign.conversionLabel)}</option>)}
      </select>
    </span>
  );
}

// ---- Key takeaways ----

const AREA_ICON: Array<[RegExp, LucideIcon]> = [
  [/audience|segment/i, Users],
  [/creative/i, Image],
  [/publisher|media|channel|ctv|video/i, Tv],
  [/timing|pacing|flight|day|week/i, CalendarClock],
  [/geo|dma|state|region/i, MapPin],
  [/measure|attribution/i, Ruler],
  [/click|engage/i, MousePointerClick],
];

export const TAKEAWAY_STYLES: Record<FindingKind, { label: string; icon: LucideIcon; tile: string; iconBox: string; figure: string }> = {
  worked: { label: "What worked", icon: TrendingUp, tile: "border-emerald-100 bg-emerald-50/60", iconBox: "bg-emerald-100 text-emerald-700", figure: "text-emerald-700" },
  didnt: { label: "Opportunity", icon: Sparkles, tile: "border-indigo-100 bg-indigo-50/60", iconBox: "bg-indigo-100 text-indigo-700", figure: "text-indigo-700" },
  watch: { label: "Worth knowing", icon: Lightbulb, tile: "border-amber-100 bg-amber-50/60", iconBox: "bg-amber-100 text-amber-700", figure: "text-amber-700" },
};

export const takeawayIcon = (kind: FindingKind, area?: string) => (kind === "didnt" ? Sparkles : AREA_ICON.find(([re]) => area && re.test(area))?.[1] ?? TAKEAWAY_STYLES[kind].icon);

export function Takeaways({ campaign, linked, onHover, recommendations, controls }: {
  campaign: RecapCampaign;
  linked: string[];
  onHover: (keys: string[]) => void;
  recommendations: RecapRecommendation[];
  controls?: InsightControls;
}) {
  if (!campaign.cards.length) return null;
  // Wins first, then opportunities, then caveats, each in the model's order of importance.
  const order: Record<FindingKind, number> = { worked: 0, didnt: 1, watch: 2 };
  const cards = [...campaign.cards].sort((a, z) => order[a.kind] - order[z.kind]);
  return (
    <div>
      <div className="text-indigo-600 text-[11px] font-bold uppercase tracking-wider mb-2">Key takeaways</div>
      <div className={`grid gap-3 ${cards.length >= 4 ? "md:grid-cols-2 xl:grid-cols-4" : cards.length === 3 ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
        {cards.map((card) => {
          const style = TAKEAWAY_STYLES[card.kind];
          const Icon = takeawayIcon(card.kind, card.area);
          const split = splitStat(card.stat);
          const key = findingKey(campaign.campaignId, card.findingId);
          const backs = recommendations.filter((r) => r.findings?.some((f) => findingKey(f.campaignId, f.findingId) === key)).length;
          return (
            <div
              key={card.id}
              onMouseEnter={() => onHover([key])}
              onMouseLeave={() => onHover([])}
              className={`group/card relative rounded-xl border p-4 transition-shadow ${style.tile} ${linked.includes(key) ? "ring-2 ring-indigo-400 shadow-sm" : ""}`}
            >
              <div className="flex items-center gap-2 mb-2">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${style.iconBox}`}><Icon className="w-4 h-4" /></div>
                {card.kind !== "worked" && <span className={`text-[10px] font-bold uppercase tracking-wider ${style.figure}`}>{style.label}</span>}
              </div>
              <p className="text-sm font-bold text-slate-800 leading-snug pr-4">{card.headline}</p>
              {split ? (
                <>
                  <p className={`font-display text-2xl font-bold mt-1 tabular-nums ${style.figure}`}>
                    {split.figure}{split.label && <span className="text-sm font-sans font-semibold text-slate-600"> {split.label}</span>}
                  </p>
                  {split.rest && <p className="text-xs text-slate-600">{split.rest}</p>}
                </>
              ) : (
                <p className="text-xs text-slate-600 mt-1">{card.stat}</p>
              )}
              {backs > 0 && <p className="text-[10px] font-semibold text-indigo-600 mt-1.5">Behind {backs} recommendation{backs === 1 ? "" : "s"}</p>}
              {controls && (
                <button type="button" onClick={() => controls.onRemoveCard(card.id)} title="Remove this takeaway" aria-label="Remove this takeaway"
                  className="absolute top-2 right-2 w-5 h-5 rounded-md flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-white opacity-0 group-hover/card:opacity-100 transition-opacity cursor-pointer">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- The detail ----

function Block({ campaign, block, icon: Icon, kicker, title, controls, children }: {
  campaign: RecapCampaign;
  block: RecapBlock;
  icon: LucideIcon;
  kicker: string;
  title: string;
  controls?: InsightControls;
  children: React.ReactNode;
}) {
  const hidden = (campaign.hiddenBlocks ?? []).includes(block);
  if (hidden && !controls) return null;
  return (
    <div className={`rounded-xl border p-4 md:p-5 min-w-0 ${hidden ? "border-dashed border-slate-300 bg-slate-50 opacity-60" : "border-slate-100 bg-white"}`}>
      <div className="flex items-start gap-3 mb-3">
        <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0"><Icon className="w-4 h-4" /></div>
        <div className="min-w-0 flex-1">
          <div className="text-indigo-600 text-[11px] font-bold uppercase tracking-wider">{kicker}</div>
          <p className="text-sm font-bold text-slate-800">{title}</p>
          {hidden && <p className="text-[11px] text-slate-500">Hidden from the client</p>}
        </div>
        {controls && (
          <button type="button" onClick={() => controls.onSetBlock(campaign.campaignId, block, !hidden)} title={hidden ? "Show to the client" : "Hide from the client"}
            className="w-7 h-7 rounded-lg border border-slate-200 bg-white text-slate-500 hover:text-slate-800 flex items-center justify-center cursor-pointer shrink-0">
            {hidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

function MixTable({ campaign }: { campaign: RecapCampaign }) {
  const data = quadrantPoints(campaign);
  if (!data) return null;
  const label = campaign.conversionLabel;
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-[10px] uppercase tracking-wider text-slate-400 text-left">
          <th className="py-1 font-bold capitalize">{campaign.mix?.dimension}</th>
          <th className="font-bold text-right">Spend</th>
          <th className="font-bold text-right">{label}</th>
          <th className="font-bold text-right">{data.metric === "roas" ? "ROAS" : "CPA"}</th>
        </tr>
      </thead>
      <tbody className="tabular-nums">
        {data.points.map((p) => {
          const above = p.index !== null && p.index >= 1 && !p.thin;
          return (
            <tr key={p.name} className="border-t border-slate-100">
              <td className="py-1.5 font-semibold text-slate-700 truncate max-w-[10rem]" title={p.name}>
                <span className={`inline-block w-2 h-2 rounded-full mr-1.5 ${p.thin ? "border border-dashed border-amber-500" : above ? "bg-emerald-600" : "bg-indigo-300"}`} />{p.name}
              </td>
              <td className="text-right">{shareText(p.spendShare)}</td>
              <td className="text-right">{shareText(p.conversionShare)}</td>
              <td className="text-right font-bold text-slate-800">
                {p.value === null ? "–" : data.metric === "roas" ? roasText(p.value, campaign.kpi?.roasStyle) : cpaText(p.value)}
                {p.thin && <div className="text-[10px] font-normal text-amber-700">small sample</div>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** The CTV caveat, with the conversions that came from retargeting CTV viewers when the data names them. */
export function ctvNote(campaign: RecapCampaign): string | null {
  if (!campaign.mixNote) return null;
  const assist = campaign.ctvAssist;
  if (!assist) return campaign.mixNote;
  return `CTV builds the audience that retargeting later converts. ${compactNumber(assist.conversions)} ${campaign.conversionLabel.toLowerCase()} came from viewers retargeted after seeing a CTV ad, so last-touch reporting understates CTV's role.`;
}

function RankingList({ ranking, campaign }: { ranking: RecapRanking; campaign: RecapCampaign }) {
  const g = rankingGeometry(ranking);
  return (
    <div>
      {/* Up to 30 rows: the list scrolls past 300px so the block stays the size of its neighbours. */}
      <div className="space-y-2 tabular-nums max-h-[300px] overflow-y-auto pr-3 py-1">
        {g.rows.map((r, i) => (
          <div key={`${r.name}-${i}`} className="grid grid-cols-[minmax(0,12.5rem)_1fr_4.25rem] gap-2 items-center">
            <span className={`text-xs truncate flex items-center gap-1.5 ${r.better ? "font-semibold text-slate-800" : "text-slate-600"}`} title={r.name}>
              {r.format && <span className={`shrink-0 rounded px-1 py-px text-[9px] font-bold uppercase tracking-wide ${r.format === "Video" ? "bg-violet-50 text-violet-700" : "bg-sky-50 text-sky-700"}`}>{r.format}</span>}
              <span className="truncate">{r.name}</span>
            </span>
            <div className="relative h-2.5 rounded-full bg-slate-100">
              <div className={`h-full rounded-full ${r.thin ? "border border-dashed border-amber-500 bg-amber-50" : r.better ? "bg-emerald-500" : "bg-indigo-300"}`} style={{ width: `${r.width * 100}%` }} />
              <div className="absolute -top-1 -bottom-1 w-0.5 bg-slate-400" style={{ left: `${g.averageAt * 100}%` }} />
            </div>
            <span className={`text-xs font-bold text-right ${r.better ? "text-emerald-700" : "text-slate-700"}`}>{rankingValue(ranking, r.value, campaign.kpi)}{r.capped ? "+" : ""}</span>
          </div>
        ))}
      </div>
      {rankingFootnote(ranking) && <p className="text-[11px] text-slate-500 mt-3">{rankingFootnote(ranking)}</p>}
      <p className="text-[11px] text-slate-500 mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block w-3 h-0.5 bg-slate-400" /> Average</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-500" /> Better than average</span>
        {g.rows.some((r) => r.thin) && <span className="inline-flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-sm border border-dashed border-amber-500" /> Under 30 {campaign.conversionLabel.toLowerCase()}</span>}
      </p>
    </div>
  );
}

const RANKING_ICONS: Record<RecapRanking["key"], LucideIcon> = { publisher: Tv, audience: Users, creative: Image };

export function DetailBlocks({ campaign, controls }: { campaign: RecapCampaign; controls?: InsightControls }) {
  const label = campaign.conversionLabel;
  const hasMix = Boolean(quadrantPoints(campaign));
  const note = ctvNote(campaign);
  let n = hasMix ? 1 : 0;
  const grid: React.ReactNode[] = [];
  const visible = (block: RecapBlock) => controls || !(campaign.hiddenBlocks ?? []).includes(block);
  if (campaign.trend && visible("trend")) {
    const caption = trendCaption(campaign.trend, label);
    grid.push(
      <Block key="trend" campaign={campaign} block="trend" icon={LineChart} kicker={`${++n} · Performance over the flight`} title={`Cost per ${singular(label)} by week`} controls={controls}>
        <TrendChart trend={campaign.trend} conversionLabel={label} />
        {caption && <p className="text-xs text-slate-600 mt-2 leading-relaxed">{caption}</p>}
      </Block>,
    );
  }
  for (const ranking of campaign.rankings ?? []) {
    if (!visible(ranking.key)) continue;
    grid.push(
      <Block key={ranking.key} campaign={campaign} block={ranking.key} icon={RANKING_ICONS[ranking.key]} kicker={`${++n} · ${RANKING_TITLES[ranking.key]}`} title={rankingSubtitle(ranking, label, campaign.kpi)} controls={controls}>
        <RankingList ranking={ranking} campaign={campaign} />
      </Block>,
    );
  }
  if (!(hasMix && visible("mix")) && grid.length === 0) return null;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-slate-200" />
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">The detail</span>
        <div className="h-px flex-1 bg-slate-200" />
      </div>
      {hasMix && visible("mix") && (
        <Block campaign={campaign} block="mix" icon={LayoutGrid} kicker="1 · Where results came from" title={`Each ${campaign.mix?.dimension ?? "media type"}'s result against its share of the budget`} controls={controls}>
          <div className="grid lg:grid-cols-[1.35fr_1fr] gap-5 items-center">
            <QuadrantChart campaign={campaign} conversionLabel={label} />
            <div className="space-y-3 min-w-0">
              <MixTable campaign={campaign} />
              {note && <p className="text-[11px] text-slate-600 leading-relaxed bg-slate-50 rounded-r-lg border-l-[3px] border-indigo-200 px-3 py-2"><b className="text-slate-800">How to read CTV:</b> {note}</p>}
            </div>
          </div>
        </Block>
      )}
      {grid.length > 0 && <div className="grid lg:grid-cols-2 gap-4">{grid}</div>}
    </div>
  );
}
