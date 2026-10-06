// The Publisher Insights panel as structured content: a headline and three or four reasons the
// CTV mix fits the audience, each naming the publishers that deliver it. It replaces the single
// paragraph (publisherInsights), which plans saved before this still show.
//
// The model picks each pillar's icon from a fixed list and may only name publishers in the plan;
// normalizePublisherHighlights enforces both, because the schema converter has no enum keyword.

import type { CtvPublisherRecommendation } from "../types";

export const PILLAR_ICONS = [
  "sports", "news", "entertainment", "family", "kids", "home", "outdoor", "lifestyle",
  "culture", "business", "reach", "premium",
] as const;

export type PillarIcon = (typeof PILLAR_ICONS)[number];

export interface PublisherPillar {
  icon: PillarIcon;
  title: string;
  detail: string;
  /** Publisher names exactly as they appear in the plan's ctvPublishers. */
  publishers: string[];
}

export interface PublisherHighlights {
  headline: string;
  pillars: PublisherPillar[];
}

export const MIN_PILLARS = 3;
export const MAX_PILLARS = 4;

const ICON_HELP = `One of: ${PILLAR_ICONS.join(", ")}. sports = live sports; reach = broad, free or OS-level scale and frequency; premium = brand-safe, full-episode or original programming.`;

/** JSON schema for the field. Lowercase types work for both the synthesis and narrative calls. */
export const publisherHighlightsSchema = {
  type: "object",
  description: "The Publisher Insights panel shown to the client: a headline and 3 to 4 reasons this CTV publisher mix fits the audience. Never mention tiers. No statistics.",
  properties: {
    headline: { type: "string", description: "At most 8 words, naming who the mix is built for (e.g. 'Built for truck and SUV owners'). No trailing period." },
    pillars: {
      type: "array",
      description: "3 to 4 distinct reasons. Together they should cover most of the plan's publishers, and each publisher should appear in at most one pillar.",
      items: {
        type: "object",
        properties: {
          icon: { type: "string", description: ICON_HELP },
          title: { type: "string", description: "At most 5 words, sentence case (e.g. 'Live sports, full attention')." },
          detail: { type: "string", description: "One sentence of at most 16 words on why these publishers reach this audience. No figures." },
          publishers: { type: "array", items: { type: "string" }, description: "1 to 4 publisher names copied exactly from the plan's CTV publisher list." },
        },
        required: ["icon", "title", "detail", "publishers"],
      },
    },
  },
  required: ["headline", "pillars"],
};

const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "");

/**
 * The model's highlights, cleaned against the plan: unknown icons become "premium", publishers
 * not in the plan are dropped and the rest take the plan's spelling, and a pillar with no title
 * or detail is dropped. Returns null when fewer than MIN_PILLARS survive, so the caller keeps
 * what it had rather than showing a thin panel.
 */
export function normalizePublisherHighlights(raw: unknown, planPublishers: CtvPublisherRecommendation[] | undefined): PublisherHighlights | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const headline = text(r.headline, 80).replace(/\.$/, "");
  if (!headline || !Array.isArray(r.pillars)) return null;
  const byName = new Map((planPublishers || []).map((p) => [String(p?.publisher ?? "").trim().toLowerCase(), String(p.publisher).trim()]));
  const pillars: PublisherPillar[] = [];
  for (const item of r.pillars) {
    if (!item || typeof item !== "object") continue;
    const p = item as Record<string, unknown>;
    const title = text(p.title, 60);
    const detail = text(p.detail, 200);
    if (!title || !detail) continue;
    const icon = PILLAR_ICONS.includes(p.icon as PillarIcon) ? (p.icon as PillarIcon) : "premium";
    const names = Array.isArray(p.publishers) ? p.publishers : [];
    const publishers = [...new Set(names.map((n) => byName.get(String(n ?? "").trim().toLowerCase())).filter((n): n is string => Boolean(n)))];
    pillars.push({ icon, title, detail, publishers });
    if (pillars.length === MAX_PILLARS) break;
  }
  return pillars.length >= MIN_PILLARS ? { headline, pillars } : null;
}

/** A pillar's publishers that are still in the plan, so a removed publisher's logo disappears. */
export function pillarPublishersInPlan(pillar: PublisherPillar, planPublishers: CtvPublisherRecommendation[] | undefined): string[] {
  const inPlan = new Set((planPublishers || []).map((p) => String(p?.publisher ?? "").trim().toLowerCase()));
  return (pillar.publishers || []).filter((name) => inPlan.has(String(name).trim().toLowerCase()));
}

export interface PublisherMixStats {
  total: number;
  network: number;
  app: number;
  os: number;
}

/** Counts by category, worked out from the list so the stat row is always right. */
export function publisherMixStats(planPublishers: CtvPublisherRecommendation[] | undefined): PublisherMixStats {
  const list = planPublishers || [];
  const count = (category: string) => list.filter((p) => String(p?.category ?? "").trim().toLowerCase() === category).length;
  return { total: list.length, network: count("network"), app: count("app"), os: count("os") };
}

/** True when the plan has structured highlights to show instead of the legacy paragraph. */
export function hasPublisherHighlights(profile: any): profile is { publisherHighlights: PublisherHighlights } {
  const h = profile?.publisherHighlights;
  return Boolean(h && typeof h.headline === "string" && Array.isArray(h.pillars) && h.pillars.length > 0);
}

/** Every editable string in the highlights, with its path, for the chat assistant and the QA ledger. */
export function publisherHighlightFields(profile: any): Array<{ path: string; text: string }> {
  if (!hasPublisherHighlights(profile)) return [];
  const h = profile.publisherHighlights;
  return [
    { path: "publisherHighlights.headline", text: h.headline },
    ...h.pillars.flatMap((p, i) => [
      { path: `publisherHighlights.pillars[${i}].title`, text: p.title },
      { path: `publisherHighlights.pillars[${i}].detail`, text: p.detail },
    ]),
  ].filter((f) => typeof f.text === "string" && f.text.trim());
}
