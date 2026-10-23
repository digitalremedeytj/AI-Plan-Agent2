import type { ChannelStrategyData, Persona } from "../types";
import { combinedPlan } from "./planChannels";

/**
 * "How this plan reaches your audience": the client's plan (usually one used as is) read against
 * the research. Worked out from what the plan already says, with no AI: which channels the narrative's
 * recommendations put in front of each persona, which CTV publishers the plan buys that each persona
 * watches, and which funnel stages the plan's channels cover. The client sees what is covered; the
 * planner also sees the gaps and the channels the research rates weakly, to decide what to say.
 */

export type FunnelStage = "awareness" | "consideration" | "conversion";

export const FUNNEL_STAGES: Array<{ id: FunnelStage; label: string }> = [
  { id: "awareness", label: "Awareness" },
  { id: "consideration", label: "Consideration" },
  { id: "conversion", label: "Conversion" },
];

// The catalog's funnel roles are finer than the three stages a client reads.
const ROLE_STAGE: Record<string, FunnelStage> = {
  awareness: "awareness",
  reach: "awareness",
  frequency: "awareness",
  physical_presence: "awareness",
  consideration: "consideration",
  trust: "consideration",
  intent: "conversion",
  conversion: "conversion",
};

/** Below this audience fit (0-100) the research is thin for a channel; the planner is told. */
export const WEAK_AUDIENCE_FIT = 55;

export interface PersonaReach {
  name: string;
  /** Plan channels the narrative's recommendations name for this persona. */
  channels: string[];
  /** CTV publishers in the plan that this persona's viewing mentions. */
  publishers: string[];
  /** The recommendation titles that tie them together, for the "why". */
  because: string[];
}

export interface StageCoverage {
  stage: FunnelStage;
  label: string;
  channels: string[];
}

export interface PlanAlignment {
  personas: PersonaReach[];
  funnel: StageCoverage[];
  /** For the planner only: what the client view leaves out. */
  cautions: string[];
}

const norm = (text: unknown) => String(text || "").toLowerCase().replace(/[^a-z0-9+]+/g, " ").trim();

/** "The Proactive Canine Wellness Devotee" is also written "Proactive Canine Wellness Devotee". */
function mentionsPersona(text: string, name: string): boolean {
  const target = norm(name).replace(/^the /, "");
  return target.length > 0 && ` ${norm(text)} `.includes(` ${target} `);
}

export function planAlignment(profile: { personas?: Persona[]; recommendations?: any[]; ctvPublishers?: any[]; channelStrategy?: ChannelStrategyData | null } | null | undefined): PlanAlignment {
  const strategy = profile?.channelStrategy;
  const plan = combinedPlan(strategy);
  const candidates = new Map((strategy?.mediaPlan?.evaluatedCandidates || []).map((candidate) => [candidate.product.id, candidate]));
  // A $0 line (added value, a placeholder) is in the plan but reaches nobody, so it is no evidence of coverage.
  const channels = plan.channels
    .filter((channel) => (channel.allocationDollars || 0) > 0)
    .map((channel) => ({ id: channel.channelId, name: channel.channelName, candidate: candidates.get(channel.channelId) }));
  const channelNamed = (text: string) => channels.find((channel) => norm(channel.name) === norm(text))
    // Recommendations sometimes shorten a name ("CTV" for "CTV / OTT").
    || channels.find((channel) => norm(text).length >= 3 && (norm(channel.name).includes(norm(text)) || norm(text).includes(norm(channel.name))));

  const recommendations = Array.isArray(profile?.recommendations) ? profile!.recommendations : [];
  const publishers: string[] = (Array.isArray(profile?.ctvPublishers) ? profile!.ctvPublishers : [])
    .map((pub: any) => String(pub?.publisher || "").trim()).filter(Boolean);

  const personas: PersonaReach[] = (Array.isArray(profile?.personas) ? profile!.personas : []).map((persona) => {
    const because: string[] = [];
    const reached = new Set<string>();
    for (const rec of recommendations) {
      if (!mentionsPersona(`${rec?.title || ""} ${rec?.action || ""} ${rec?.why || ""}`, persona.name)) continue;
      const named = String(rec?.channels || "").split(",").map((part) => channelNamed(part)).filter(Boolean);
      if (named.length === 0) continue;
      named.forEach((channel) => reached.add(channel!.name));
      if (rec?.title) because.push(String(rec.title));
    }
    const watches = norm(persona.watch);
    return {
      name: persona.name,
      channels: channels.map((channel) => channel.name).filter((name) => reached.has(name)),
      publishers: publishers.filter((publisher) => watches && ` ${watches} `.includes(` ${norm(publisher)} `)),
      because,
    };
  });

  const funnel: StageCoverage[] = FUNNEL_STAGES.map(({ id, label }) => ({
    stage: id,
    label,
    channels: channels
      .filter((channel) => (channel.candidate?.product.funnelRoles || []).some((role) => ROLE_STAGE[role] === id))
      .map((channel) => channel.name),
  }));

  const cautions: string[] = [];
  for (const channel of channels) {
    const candidate = channel.candidate;
    if (!candidate || candidate.aiAssessed === false) continue;
    const fit = Math.round(candidate.components.audienceAndPersonaFit);
    if (fit < WEAK_AUDIENCE_FIT) cautions.push(`${channel.name}: the research rates its audience fit ${fit}/100, so describe its role in the plan rather than claim it reaches this audience best.`);
  }
  for (const stage of funnel) {
    if (stage.channels.length === 0) cautions.push(`No channel in this plan covers ${stage.label.toLowerCase()}.`);
  }
  for (const persona of personas) {
    if (persona.channels.length === 0 && persona.publishers.length === 0) cautions.push(`${persona.name}: no recommendation or publisher in this plan is tied to them. Rewrite the plan content, or say how the plan reaches them.`);
  }
  if (plan.outsideCatalog.length > 0) {
    cautions.push(`${plan.outsideCatalog.map((line) => line.name).join(", ")}: outside ScoutAI's catalog, so there is no research on how ${plan.outsideCatalog.length === 1 ? "it reaches" : "they reach"} this audience.`);
  }
  return { personas, funnel, cautions };
}
