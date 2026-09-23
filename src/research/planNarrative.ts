// The plan narrative, written last. Synthesis drafts it alongside the personas and charts, but at
// that point the charts have not been settled (baselines, realism revisions) and the channel plan
// does not exist. Live runs showed the result: prose quoting "Thursday 105, Friday 118" beside a
// rebuilt chart reading 97 and 103, TV-viewing charts used to time shopping, and recommendations
// naming TikTok and Performance Max in a plan whose channels include neither.
//
// This step rewrites the narrative with everything settled in front of it, so the story is told
// once, by one writer, about the plan that actually ships. The draft is kept if it fails.

export const NARRATIVE_SYSTEM_INSTRUCTION = `You are the senior media planner who owns this plan, writing its final narrative for the client. The audience research, brief of record, personas, charts, CTV publishers and channel plan are settled. Your job is to write the story that ties them together, as one expert planner would.

Rules:
1. ONE STORY. Every section describes the same audience, the same personas and the same channel plan. Refer to personas by name. Every recommendation serves specific personas or core segments and uses channels from the channel plan.
2. NUMBERS. Use a figure only if it appears in the research dossiers (copy it as reported), in a chart (quote the value exactly as listed), or in the plan's own figures. Drop any figure the number check lists as NOT FOUND unless the research supports it. Never invent, round into a new figure, or combine figures into a new one.
3. SCOPE. Say what population a figure describes. An industry or national figure is presented as such ("across U.S. e-commerce, over 36% of orders land between 11 AM and 3 PM"), never as this advertiser's own behaviour.
4. CHARTS. Describe each chart for what it measures. A TV-viewing index says when the audience watches TV, not when it shops or searches. Where a chart is a ScoutAI estimate, one short mention is enough.
5. CHANNELS. Name only channels, tactics and publishers that are in the channel plan or the publisher list. Do not restate budget splits or dollar amounts; the channel plan carries them.
6. VOICE. Confident, specific and concise: a planner recommending a plan, not a lawyer qualifying one. No compliance boilerplate, no stacked caveats ("subject to consent, match rate, platform policy..."), no commentary about the process that produced the plan. One clear caveat where it genuinely changes a decision is fine.
7. THE BRIEF OF RECORD defines who the plan is for. Emphasise the core segments; do not target groups outside it.`;

export const narrativeSchema = {
  type: "object",
  properties: {
    intro: { type: "string", description: "One polished sentence: who the audience is and why they matter for this campaign." },
    executiveSummary: { type: "string", description: "One paragraph, at most 120 words: the audience opportunity, how the channel plan reaches it, and how that serves the KPIs." },
    takeaways: { type: "array", items: { type: "string" }, description: "Exactly 4 planning takeaways, each grounded in the research or charts." },
    recommendations: {
      type: "array",
      description: "Exactly 4 recommendations, each tied to named personas and channels from the channel plan.",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          action: { type: "string", description: "What to do, specifically." },
          why: { type: "string", description: "Why it works for this audience, grounded in the research or charts." },
          channels: { type: "string", description: "Channels from the channel plan, comma-separated." },
        },
        required: ["title", "action", "why", "channels"],
      },
    },
    demographicsOverview: { type: "string", description: "At most 90 words, consistent with the age, gender and income charts." },
    geographyNotes: { type: "string", description: "At most 60 words on regional footprint for the plan's geography." },
    browserOverview: { type: "string", description: "At most 90 words, consistent with the domain affinity chart." },
    deviceOverview: { type: "string", description: "At most 90 words, consistent with the device chart." },
    temporalOverview: { type: "string", description: "At most 90 words, consistent with the day and hour charts and what they measure." },
    activationNotes: { type: "string", description: "At most 70 words of practical timing guidance, consistent with the charts." },
    publisherInsights: { type: "string", description: "50 to 65 words (under 450 characters) on why the CTV publisher mix fits this audience. Never mention tiers." },
  },
  required: [
    "intro", "executiveSummary", "takeaways", "recommendations", "demographicsOverview", "geographyNotes",
    "browserOverview", "deviceOverview", "temporalOverview", "activationNotes", "publisherInsights",
  ],
};

export interface NarrativeContext {
  briefBlock: string;
  campaign: string;
  personas: string;
  charts: string;
  channelPlan: string;
  publishers: string;
  ledger: string;
  research: string;
  draft: unknown;
}

export function buildNarrativeInput(ctx: NarrativeContext): string {
  return [
    ctx.briefBlock,
    ctx.campaign,
    ctx.personas,
    ctx.charts,
    ctx.channelPlan,
    ctx.publishers,
    ctx.ledger,
    "DRAFT NARRATIVE (written before the charts and channel plan were settled; keep what is good, fix what contradicts them):",
    JSON.stringify(ctx.draft, null, 2),
    ctx.research,
    "Write the final narrative.",
  ].filter(Boolean).join("\n\n");
}

/** The narrative fields as they currently stand on the profile, in the schema's shape. */
export function currentNarrative(profile: any) {
  return {
    intro: profile?.intro,
    executiveSummary: profile?.executiveSummary,
    takeaways: profile?.takeaways,
    recommendations: profile?.recommendations,
    demographicsOverview: profile?.demographics?.overview,
    geographyNotes: profile?.demographics?.geographyNotes,
    browserOverview: profile?.browserAndReach?.overview,
    deviceOverview: profile?.deviceTypeIndex?.overview,
    temporalOverview: profile?.temporalPatterns?.overview,
    activationNotes: profile?.temporalPatterns?.activationNotes,
    publisherInsights: profile?.publisherInsights,
  };
}

const nonEmpty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

/**
 * Writes the new narrative onto the profile, field by field. A field the model left empty, or a
 * list that came back the wrong length, keeps the draft: a partial answer must not blank a section.
 * Returns the fields that were replaced.
 */
export function applyNarrative(profile: any, raw: unknown): string[] {
  if (!raw || typeof raw !== "object") return [];
  const n = raw as Record<string, any>;
  const replaced: string[] = [];
  const set = (key: string, value: unknown, write: (v: string) => void) => {
    if (nonEmpty(value)) {
      write(value.trim());
      replaced.push(key);
    }
  };
  set("intro", n.intro, (v) => (profile.intro = v));
  set("executiveSummary", n.executiveSummary, (v) => (profile.executiveSummary = v));
  set("publisherInsights", n.publisherInsights, (v) => (profile.publisherInsights = v));
  const section = (key: string) => (profile[key] && typeof profile[key] === "object" ? profile[key] : (profile[key] = {}));
  set("demographics.overview", n.demographicsOverview, (v) => (section("demographics").overview = v));
  set("demographics.geographyNotes", n.geographyNotes, (v) => (section("demographics").geographyNotes = v));
  set("browserAndReach.overview", n.browserOverview, (v) => (section("browserAndReach").overview = v));
  set("deviceTypeIndex.overview", n.deviceOverview, (v) => (section("deviceTypeIndex").overview = v));
  set("temporalPatterns.overview", n.temporalOverview, (v) => (section("temporalPatterns").overview = v));
  set("temporalPatterns.activationNotes", n.activationNotes, (v) => (section("temporalPatterns").activationNotes = v));

  if (Array.isArray(n.takeaways) && n.takeaways.length === 4 && n.takeaways.every(nonEmpty)) {
    profile.takeaways = n.takeaways.map((t: string) => t.trim());
    replaced.push("takeaways");
  }
  const validRec = (r: any) => r && ["title", "action", "why", "channels"].every((k) => nonEmpty(r[k]));
  if (Array.isArray(n.recommendations) && n.recommendations.length === 4 && n.recommendations.every(validRec)) {
    profile.recommendations = n.recommendations.map((r: any) => ({ title: r.title.trim(), action: r.action.trim(), why: r.why.trim(), channels: r.channels.trim() }));
    replaced.push("recommendations");
  }
  return replaced;
}
