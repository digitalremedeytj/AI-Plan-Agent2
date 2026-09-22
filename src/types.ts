import type { PlanningSettings } from "./planning/settings";
import type { MediaRecommendationPlan, RecommendationStatus, ConfidenceLevel } from "./planning/types";
export type { CtvPublisherSetting } from "./planning/knowledge/ctvPublishers";

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
  sourceType?: 'RFP' | 'ScoutAI' | 'User';
  isExpansion?: boolean;
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
}

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

export interface AudienceProfile {
  intro: string;
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
  executiveSummary: string;
  sources: Source[];
  ctvPublishers: CtvPublisherRecommendation[];
  publisherInsights: string;
  auditResult?: AuditResult;
  channelStrategy?: ChannelStrategyData;
  additionalRfpRequirements?: RfpAnalysis;
  generationAlerts?: GenerationAlert[];
}

export interface GenerateProfileResponse {
  profile: AudienceProfile;
  groundingSources?: Array<{ title: string; uri: string }>;
  channelStrategy?: ChannelStrategyData;
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
  additionalContext: string;
  targetPersonas?: string[];
  budget?: string;
  campaignLength?: string;
  planningSettings?: PlanningSettings;
  profile: AudienceProfile;
  groundingSources?: Array<{ title: string; uri: string }>;
  selectedPlanOptions?: ParsedPlanOption[];
  taxonomyMappings?: TaxonomyMapping[];
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

export interface ChannelStrategyData {
  rfpChannels: ChannelEvaluation[];
  scoutAiRecommendedChannels: ChannelEvaluation[];
  executiveInsight: string;
  budgetStrategyMode: 'reallocation' | 'incremental';
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
}
