import type { ExecutiveBrief } from "./research/executiveBrief";
import type { PlanningSettings } from "./planning/settings";
import type { MediaRecommendationPlan, RecommendationStatus, ConfidenceLevel } from "./planning/types";
export type { CtvPublisherSetting } from "./planning/knowledge/ctvPublishers";
import type { PublisherHighlights } from "./planning/publisherHighlights";
import type { CampaignRecap } from "./performance/recap";
export type { PublisherHighlights, PublisherPillar } from "./planning/publisherHighlights";

export interface PersonaAvatarVersion {
  id: string;
  url: string;
  prompt?: string;
  createdAt: string;
}

export type SlideAspectRatio = "21:9" | "2:1" | "16:9" | "3:2" | "4:3" | "1:1" | "3:4" | "2:3" | "9:16";

export interface SlideExportVersion {
  id: string;
  section: "personas" | "channels" | "segments";
  mode: "portfolio" | "spotlight" | "overview";
  personaIndex?: number;
  personaName?: string;
  channelIndex?: number;
  channelName?: string;
  imageUrl: string;
  thumbnailUrl?: string;
  style: "corporate_light" | "modern_dark" | "minimal_slate";
  aspectRatio: SlideAspectRatio;
  dimensions?: { width: number; height: number };
  customNotes?: string;
  createdAt: string;
}

export interface Persona {
  name: string;
  gender: string;
  income: string;
  age: string;
  watch: string;
  browse: string;
  buy: string;
  narrative: string;
  avatarUrl?: string;
  avatarHistory?: PersonaAvatarVersion[];
  sourceType?: 'RFP' | 'ScoutAI' | 'User';
  isExpansion?: boolean;
  /** Hidden casting brief for the headshot, written by synthesis. Plans made before it have none. */
  portrait?: PersonaPortrait;
}

export interface PersonaPortrait {
  apparentAge: number;
  gender: string;
  ethnicity: string;
  /** The dossier figure the casting follows, or "market population". Never shown. */
  ethnicityBasis: string;
  appearance: string;
  wardrobe: string;
  setting: string;
  expression: string;
}

export type SegmentDimension = "Demographics" | "In-Market / Intent" | "Interest & Affinity" | "Behavioral";
export type SegmentDataSignal =
  | "Transaction & Purchase Data"
  | "ACR TV Viewership"
  | "Household & Life-Stage Records"
  | "High-Intent Digital Behavior";
export type SegmentTier = "Core" | "Expansion" | "Experimental";

export interface SegmentRecommendation {
  id: string;
  name: string;
  dimension: SegmentDimension;
  justification: string;
  taxonomyPath?: string;
  dataSignal?: SegmentDataSignal;
  tier?: SegmentTier;
  /** Positions in `AudienceProfile.personas` this segment serves. */
  personaIndices: number[];
  /** 'RFP' marks a segment translated from an audience named in the uploaded media plan. */
  source: 'ScoutAI' | 'RFP' | 'User';
}

export interface Recommendation {
  title: string;
  action: string;
  why: string;
  channels: string;
}

export interface DomainMetric {
  domain: string;
  value: number;
  metricType: string;
  isModeled: boolean;
  source: string;
}

export interface BrowserAndReach {
  overview: string;
  chartData: DomainMetric[];
  chartSource: string;
}

export interface DeviceMetric {
  device: string;
  value: number;
  isModeled: boolean;
  source: string;
}

export interface DeviceTypeIndex {
  overview: string;
  chartData: DeviceMetric[];
  chartSource: string;
}

export interface AgeMetric {
  range: string;
  value: number;
  isModeled: boolean;
  source: string;
}

export interface GenderMetric {
  gender: string;
  value: number;
  isModeled: boolean;
  source: string;
}

export interface IncomeMetric {
  bracket: string;
  value: number;
  isModeled: boolean;
  source: string;
}

export interface Demographics {
  overview: string;
  ageChartData: AgeMetric[];
  genderChartData: GenderMetric[];
  incomeChartData: IncomeMetric[];
  geographyNotes: string;
}

export interface TemporalMetric {
  day?: string;
  hour?: string;
  index: number;
  isModeled: boolean;
  source: string;
}

export interface TemporalPatterns {
  overview: string;
  dayOfWeekChartData: TemporalMetric[];
  hourOfDayChartData: TemporalMetric[];
  activationNotes: string;
}

export interface Source {
  name: string;
  url: string;
  supportedClaims: string;
  tier: string;
  usageType: string;
}

export interface AuditScorecard {
  category: string;
  score: number;
  notes: string;
}

export interface AutoFix {
  issue: string;
  resolution: string;
}

export interface AuditResult {
  executiveSummary: string;
  scorecard: AuditScorecard[];
  originalScore: number;
  finalScore: number;
  criticalRedFlags: string[];
  strategicHighlights: string[];
  autoFixes: AutoFix[];
  /** True when at least one auto-fix was applied after scoring. The profile is not re-scored,
   *  so finalScore still reflects the pre-remediation audit. */
  remediationApplied?: boolean;
  /** True when the QA scoring agent was unavailable and the profile went out unverified. */
  qaBypassed?: boolean;
  /** True when the plan was generated in Quick mode, which skips the audit on purpose. */
  quickMode?: boolean;
  /** True when the plan was re-scored after fixes, so finalScore describes the shipped plan. */
  verified?: boolean;
  /** Structured audit findings, with their status after verification. Absent on older plans. */
  findings?: AuditFindingRecord[];
  /** e.g. "gpt-6-sol (high)". */
  auditModel?: string;
  /** Present when this audit was run by hand on the saved plan rather than during generation. */
  manualAudit?: { at: string; by: string; proposed: number; applied: number };
}

export interface AuditFindingRecord {
  id: string;
  severity: "critical" | "major" | "minor";
  category: string;
  /** Who can fix it: the text fixer (narrative, personas, publisherRationale) or a person. */
  owner: "narrative" | "personas" | "publisherRationale" | "channelRationale" | "chart" | "channelStrategy" | "planner";
  paths: string[];
  issue: string;
  evidence: string;
  fix: string;
  status?: "resolved" | "partially_resolved" | "unresolved";
  verifyNote?: string;
}

export interface CtvPublisherRecommendation {
  publisher: string;
  category: string;
  why: string;
  isUserAdded?: boolean;
}

/**
 * Checks if a CTV publisher is user-added rather than an AI-generated recommendation.
 * User-added publishers display cleanly without targeting rationale text notes.
 */
export function isUserAddedPublisher(pub: CtvPublisherRecommendation): boolean {
  if (pub.isUserAdded) return true;
  if (!pub.why || !pub.why.trim()) return true;
  const lower = pub.why.trim().toLowerCase();
  if (
    lower.startsWith('include as often') ||
    lower.startsWith('include often') ||
    lower.startsWith('include for') ||
    lower.startsWith('include of') ||
    lower.startsWith('premium, include') ||
    lower.startsWith('custom targeted ctv') ||
    lower.startsWith('targeted ctv')
  ) {
    return true;
  }
  return false;
}

export interface ExtractedPlacement {
  advPerformance?: string;
  mediaType?: string;
  productType?: string;
  placementName?: string;
  publisher?: string;
  audience?: string;
  startDate?: string;
  endDate?: string;
  locationType?: string;
  locationDetails?: string;
  pricingStructureType?: string;
  pricingStructureDetails?: string;
  budget?: number;
  impressions?: number;
  adSizes?: string;
  notes?: string;
  planName?: string;
  /**
   * The planner's own mapping from the upload review: a catalog media type id, or
   * OUTSIDE_CATALOG to keep the line out of every media type. Wins over the engine's matching.
   */
  channelId?: string;
}

/** ExtractedPlacement.channelId for a line the planner keeps outside the catalog. */
export const OUTSIDE_CATALOG = "outside_catalog";

export interface RfpCapabilityMatch {
  rfpAsk: string;
  digitalRemedySolution: string;
  capabilityDetails: string;
  isSupported: boolean;
}

export interface RfpAnalysis {
  isRfpDocument: boolean;
  rfpSummary: string;
  rfpAsksAndQuestions: string[];
  digitalRemedyCapabilityMatches: RfpCapabilityMatch[];
  extractedMetadata?: {
    advertiserName?: string;
    websiteUrl?: string;
    budget?: number;
    kpis?: string[];
    flightDates?: string;
    targetAudiences?: string[];
    geographies?: string[];
    submissionDueDate?: string;
    paymentTerms?: string;
    reportingRequirements?: string[];
  };
  hasExplicitPlacements?: boolean;
  additionalNotes?: string;
}

/**
 * Something in the plan that failed, was not found in the research, or needs a reader's
 * attention. Carried on the profile (and saved with it) instead of being papered over with
 * placeholder content.
 */
export interface GenerationAlert {
  /** Profile section the alert belongs to, e.g. "demographics", "channelStrategy", "qa". */
  section: string;
  severity: "failed" | "not_found" | "flagged";
  message: string;
}

/** The settled audience definition every generation step reads. See src/research/briefOfRecord.ts. */
export interface BriefOfRecord {
  advertiser: string;
  whatTheySell: string;
  productCategories: string[];
  /**
   * What the advertiser's own website (or, without one, a grounded search) states about its
   * products, offers, prices, retailers and fulfilment. The only advertiser specifics the plan
   * may present as fact. Optional because briefs saved before it do not carry it.
   */
  advertiserFacts?: string[];
  businessModel: string;
  priceTier: "value" | "mid-market" | "premium" | "luxury" | "mixed" | "unknown";
  audienceType: "B2C" | "B2B" | "B2B2C";
  primaryAudience: string;
  /** Every group the advertiser serves. Anything here is on-target. */
  includedSegments: string[];
  /**
   * The few groups that drive the business and this campaign; personas are built around them.
   * Optional because briefs saved before the split do not carry it.
   */
  coreSegments?: string[];
  excludedSegments: string[];
  campaignObjective: string;
  funnelEmphasis: "awareness" | "consideration" | "conversion" | "full-funnel";
  geography: string;
  uncertainties: string[];
  /** What the brief was built from, so a reader knows how far to trust it. */
  basis: "brief + website" | "brief + web search" | "brief only";
}

/**
 * The research text a plan was generated from, kept so its figures can be checked against
 * the research later (the audit runs after the dossiers are gone from memory).
 */
export interface ResearchSnapshot {
  capturedAt: string;
  dossiers: Array<{ label: string; failed: boolean; text: string }>;
  crawl?: { url: string; ok: boolean; chars: number };
}

/**
 * The live-console steps a plan was generated through (status lines and research results), kept
 * with the plan so a planner can review how it was built after the run's console is gone.
 */
export interface GenerationLogEntry {
  /** ISO time the server sent the step. */
  at: string;
  type: "status" | "research_result";
  message?: string;
  label?: string;
  sources?: Array<{ title: string; uri: string }>;
  blurb?: string;
  failed?: boolean;
}

/**
 * Narrows the household universe to the campaign's target audience. Set by a planner, never
 * by the AI: the shares come from Settings > Reach & Frequency or are typed in directly.
 */
export interface AudienceNarrowing {
  /** Ids from the audience share reference in Settings. */
  filterIds: string[];
  /** The planner's own share of households (0.1-100). Wins over filters when set. */
  overridePercent: number | null;
}

export interface AudienceProfile {
  intro: string;
  briefOfRecord?: BriefOfRecord;
  researchSnapshot?: ResearchSnapshot;
  audienceAnalysis?: string;
  personas: Persona[];
  segmentRecommendations?: SegmentRecommendation[];
  expansionReachPercent?: number;
  takeaways: string[];
  recommendations: Recommendation[];
  browserAndReach: BrowserAndReach;
  deviceTypeIndex: DeviceTypeIndex;
  demographics: Demographics;
  temporalPatterns: TemporalPatterns;
  /**
   * Legacy one-paragraph summary. Plans saved before the executive brief show it until upgraded;
   * new plans do not carry it (synthesis drafts it for the channel engine, and the server drops
   * it before delivery).
   */
  executiveSummary?: string;
  /** The structured executive summary, written after the plan is delivered. See src/research/executiveBrief.ts. */
  executiveBrief?: ExecutiveBrief;
  sources: Source[];
  ctvPublishers: CtvPublisherRecommendation[];
  /** Legacy one-paragraph insight. Shown only when the plan has no publisherHighlights. */
  publisherInsights: string;
  /** The Publisher Insights panel: headline and pillars. See src/planning/publisherHighlights.ts. */
  publisherHighlights?: PublisherHighlights;
  auditResult?: AuditResult;
  channelStrategy?: ChannelStrategyData;
  additionalRfpRequirements?: RfpAnalysis;
  generationAlerts?: GenerationAlert[];
  /**
   * The channel mix the narrative was last written for (narrativeChannelKey in
   * src/research/planNarrative.ts). When the plan's mix no longer matches, the planner is offered a
   * rewrite. Absent on plans written before it existed, which are never flagged.
   */
  narrativeChannelKey?: string;
  generationLog?: GenerationLogEntry[];
  geoInsights?: string;
  geoTargeting?: GeoTargeting;
  /** Planner's choice of who reach is measured against within the geography. See src/planning/reach/audienceShare.ts. */
  audienceNarrowing?: AudienceNarrowing;
  /**
   * Opt-in: show the "How reach is calculated" panel on the share link. Absent means hidden,
   * since it exposes planning assumptions; this is why it is not one of the hiddenSections,
   * which are shown until hidden.
   */
  shareReachDetails?: boolean;
  hiddenSections?: string[];
  /** "Built on your campaign history": learnings from the client's past campaigns, added through ScoutAI. */
  performanceLearnings?: Array<{ campaignId: string; campaignName: string; findingId: string; learning: string; action: string }>;
  /** Past campaigns from the advertiser's library that the plan was generated with. */
  /** The client-facing Campaign Recap. See src/performance/recap.ts. */
  campaignRecap?: CampaignRecap;
  pastCampaignsUsed?: Array<{ id: string; name: string; own: boolean }>;
  slideExports?: SlideExportVersion[];
  /** Set when a planner edits the Brief of Record after the plan was built from it; a regenerate then keeps their brief. */
  briefOfRecordEdited?: { at: string; fields: string[] };
}

export interface GenerateProfileResponse {
  profile: AudienceProfile;
  groundingSources?: Array<{ title: string; uri: string }>;
  channelStrategy?: ChannelStrategyData;
}

export type GeoScope = "national" | "state" | "dma";

export interface GeoEntry {
  id: string;
  name: string;
  rank?: number;
  tvHouseholds?: number;
  usSharePct?: number;
  states?: string[];
}

export interface GeoUnresolvedToken {
  token: string;
  reason: "ambiguous" | "over_limit" | "unknown";
  candidates?: string[];
}

export interface GeoTargeting {
  scope: GeoScope;
  entries: GeoEntry[];
  unresolved: GeoUnresolvedToken[];
  inputMethod: "select" | "paste" | "upload";
  sourceFileName?: string;
}

export type GeographyType = 'National' | 'State' | 'DMA';

export interface GeographyTargetConfig {
  type: GeographyType;
  targets: string[];
  rawInput?: string;
}

export interface SavedProfile {
  id: string;
  savedAt: string;
  title: string;
  advertiserName?: string;
  kpis?: string[];
  audienceDescription: string;
  url: string;
  geography: string;
  geographyConfig?: GeographyTargetConfig;
  campaignFocus: string;
  /** Media types picked in the brief before generation (product ids). See src/planning/briefMediaTypes. */
  briefMediaTypes?: string[];
  /** "Use only these media types": the plan holds exactly briefMediaTypes. */
  briefMediaTypesOnly?: boolean;
  additionalContext: string;
  targetPersonas?: string[];
  budget?: string;
  campaignLength?: string;
  planningSettings?: PlanningSettings;
  profile: AudienceProfile;
  groundingSources?: Array<{ title: string; uri: string }>;
  selectedPlanOptions?: ParsedPlanOption[];
  taxonomyMappings?: TaxonomyMapping[];
  /** The uploaded media plan: its lines, its options (with the planner's selection) and the RFP read. */
  extractedPlacements?: ExtractedPlacement[];
  planOptions?: ParsedPlanOption[];
  rfpAnalysis?: RfpAnalysis | null;
  uploadedFileName?: string;
}

// --- CANONICAL MEDIA TAXONOMY ---
export type CanonicalMediaType =
  | 'ctv'
  | 'youtube_tv'
  | 'sports_ott'
  | 'digital_video_blend'
  | 'digital_audio'
  | 'geofence_video'
  | 'social_advertising'
  | 'amazon_ott'
  | 'programmatic_display'
  | 'programmatic_video'
  | 'youtube'
  | 'email_marketing'
  | 'linear_tv'
  | 'google_search'
  | 'geofence_display'
  | 'digital_out_of_home'
  | 'native'
  | 'display_retargeting'
  | 'advanced_measurement'
  | 'ad_serving';

export interface MediaTaxonomyItem {
  id: CanonicalMediaType;
  displayName: string;
  category: 'Video/TV' | 'Audio' | 'Display/Native' | 'Search' | 'Social' | 'Out of Home' | 'Other';
  aliases: string[];
  description: string;
}

// --- PARSED MEDIA PLAN SELECTION ---
export interface ParsedPlanOption {
  id: string;
  name: string;
  selected: boolean;
  budget: number;
  flightDates?: { start: string; end: string };
  rawChannels: string[];
  geosSummary?: string;
  kpis?: string[];
  lineItemsCount: number;
  placements: ExtractedPlacement[];
}

export interface TaxonomyMapping {
  rawLabel: string;
  canonicalId: CanonicalMediaType;
  confidence: number;
  isUserVerified: boolean;
}

// --- CHANNEL STRATEGY ANALYSIS ---
export interface ChannelEvaluation {
  channelName: string;
  canonicalId: CanonicalMediaType;
  isRecommended: boolean;
  score: number; // (audienceFit * 0.5) + (goalMatch * 0.5)
  audienceFit: number; // 1-10 integer
  goalMatch: number; // 1-10 integer
  mediaConsumptionEvidence: string;
  whyItEarnsASpot: string;
  suggestedAllocationPercent?: number;
  channelId?: string;
  recommendationStatus?: RecommendationStatus;
  confidence?: ConfidenceLevel;
  allocationDollars?: number;
}

export interface ChannelPanelOverride {
  hiddenPanels?: string[];
  fieldEdits?: Record<string, { title?: string; content?: string }>;
  scoreEdits?: Record<string, { label?: string; score?: number }>;
  overallScore?: number;
}

export type ChannelOverridesMap = Record<string, ChannelPanelOverride>;

export interface ChannelStrategyData {
  rfpChannels: ChannelEvaluation[];
  scoutAiRecommendedChannels: ChannelEvaluation[];
  executiveInsight: string;
  /** See src/planning/budgetStrategy.ts for what each mode allocates. */
  budgetStrategyMode: 'reallocation' | 'incremental' | 'grow' | 'asIs';
  /** The additional budget for "Add on top of RFP" and "Optimize total increased budget". */
  additionalBudget?: number;
  /** The RFP's media budget the choice started from. Absent on plans saved before budget choices. */
  rfpMediaBudget?: number;
  totalRfpBudget: number;
  analyzedPlanNames: string[];
  generatedAt: string;
  manualIncludedChannelIds?: string[];
  manualExcludedChannelIds?: string[];
  allocationBaselineBasisPoints?: Record<string, number>;
  lockedAllocationChannelIds?: string[];
  hasManualAllocationChanges?: boolean;
  mediaPlan?: MediaRecommendationPlan;
  ctvPublishers?: CtvPublisherRecommendation[];
  channelOverrides?: ChannelOverridesMap;
}
