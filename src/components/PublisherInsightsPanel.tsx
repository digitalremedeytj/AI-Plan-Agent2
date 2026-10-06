import React from "react";
import {
  Baby, Briefcase, Clapperboard, Gem, Heart, Home, Mountain, Newspaper, Palette, Radio, TrendingUp, Trophy, Users,
  type LucideIcon,
} from "lucide-react";
import type { CtvPublisherRecommendation } from "../types";
import { type CtvPublisherSetting, resolvePublisherLogo } from "../planning/knowledge/ctvPublishers";
import {
  hasPublisherHighlights, pillarPublishersInPlan, publisherMixStats,
  type PillarIcon, type PublisherHighlights, type PublisherMixStats,
} from "../planning/publisherHighlights";
import { PlanText } from "./PlanText";

export const PILLAR_ICON_COMPONENTS: Record<PillarIcon, LucideIcon> = {
  sports: Trophy,
  news: Newspaper,
  entertainment: Clapperboard,
  family: Users,
  kids: Baby,
  home: Home,
  outdoor: Mountain,
  lifestyle: Heart,
  culture: Palette,
  business: Briefcase,
  reach: Radio,
  premium: Gem,
};

/** The stat row's tiles, skipping categories the plan has none of. */
export function mixStatTiles(stats: PublisherMixStats): Array<{ value: number; label: string }> {
  return [
    { value: stats.total, label: stats.total === 1 ? "Publisher" : "Publishers" },
    { value: stats.network, label: stats.network === 1 ? "Network" : "Networks" },
    { value: stats.app, label: stats.app === 1 ? "App" : "Apps" },
    { value: stats.os, label: "OS" },
  ].filter((tile, i) => i === 0 || tile.value > 0);
}

interface Props {
  profile: { ctvPublishers?: CtvPublisherRecommendation[]; publisherInsights?: string; publisherHighlights?: PublisherHighlights };
  customPublishers?: CtvPublisherSetting[];
}

export function PublisherInsightsPanel({ profile, customPublishers }: Props) {
  const publishers = profile.ctvPublishers ?? [];
  const label = (
    <div className="flex items-center gap-2 text-indigo-600 text-xs font-bold uppercase tracking-wider mb-2">
      <TrendingUp className="w-4 h-4" />
      <span>Publisher Insights</span>
    </div>
  );

  // Plans generated before the panel was structured keep their paragraph.
  if (!hasPublisherHighlights(profile)) {
    return (
      <div>
        {label}
        <h3 className="text-base font-display font-bold text-slate-800 mb-3">Publisher Alignment</h3>
        {profile.publisherInsights
          ? <PlanText text={profile.publisherInsights} className="text-xs text-slate-600 leading-relaxed mb-4" />
          : <p className="text-xs italic text-slate-400 leading-relaxed mb-4">Publisher insights were not generated for this plan.</p>}
      </div>
    );
  }

  const { headline, pillars } = profile.publisherHighlights;
  const tiles = publishers.length > 0 ? mixStatTiles(publisherMixStats(publishers)) : [];

  return (
    <div>
      {label}
      <h3 className="text-base font-display font-bold text-slate-800 mb-4">{headline}</h3>

      {tiles.length > 0 && (
        <div className="grid gap-2 mb-4" style={{ gridTemplateColumns: `repeat(${tiles.length}, minmax(0, 1fr))` }}>
          {tiles.map((tile) => (
            <div key={tile.label} className="rounded-xl bg-slate-50 px-3 py-2">
              <div className="text-lg font-display font-bold text-slate-800 leading-tight">{tile.value}</div>
              <div className="text-[11px] font-medium text-slate-500">{tile.label}</div>
            </div>
          ))}
        </div>
      )}

      <ul className="divide-y divide-slate-100">
        {pillars.map((pillar, i) => {
          const Icon = PILLAR_ICON_COMPONENTS[pillar.icon] ?? Gem;
          const names = pillarPublishersInPlan(pillar, publishers);
          return (
            <li key={i} className="flex gap-3 py-3 first:pt-0 last:pb-0">
              <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                <Icon className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-slate-800 leading-snug">{pillar.title}</p>
                <p className="text-xs text-slate-600 leading-relaxed mt-0.5">{pillar.detail}</p>
                {names.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 mt-2">
                    {names.map((name) => (
                      <span key={name} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white pl-0.5 pr-2 py-0.5">
                        <img
                          src={resolvePublisherLogo(name, customPublishers)}
                          alt=""
                          className="w-5 h-5 rounded-full object-contain"
                          onError={(e) => { (e.target as HTMLImageElement).src = "/assets/pub-logos/placeholder_80x80.png"; }}
                        />
                        <span className="text-[11px] font-semibold text-slate-600">{name}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
