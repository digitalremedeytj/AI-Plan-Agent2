import type { CanonicalMediaType, CtvPublisherRecommendation, ExtractedPlacement, ParsedPlanOption } from "../types";
import type { BudgetChannelTier, PlanningSettings } from "./settings";

export type TriState = true | false | "unknown";
export type ProductStatus = "live" | "beta" | "future" | "retired";
export type RecommendationStatus = "ADD" | "TEST" | "DO_NOT_ADD";
export type PlanningMode = "greenfield" | "reallocation" | "incremental";
export type ConfidenceLevel = "high" | "medium" | "low";

export interface DataReadinessFacts {
  sitePixel: TriState;
  conversionEvents: TriState;
  meaningfulSiteTraffic: TriState;
  crmSeedList: TriState;
  crmSuppressionList: TriState;
  leadOrRevenueExports: TriState;
  offlineSalesData: TriState;
  productFeed: TriState;
  locationData: TriState;
  firstPartyDataPermission: TriState;
}

export interface CreativeReadinessFacts {
  displayAssets: TriState;
  onlineVideoAssets: TriState;
  ctvVideoAssets: TriState;
  audioAssets: TriState;
  socialAssets: TriState;
  nativeContent: TriState;
  productFeedCreative: TriState;
  doohAssets: TriState;
  highImpactBudgetAndLeadTime: TriState;
}

export type CampaignAudienceType = "B2C" | "B2B" | "B2B2C";

export interface CampaignFacts {
  advertiserName: string;
  advertiserUrl: string;
  vertical: string;
  subvertical: string;
  /** Who buys. B2B-only tactics attach only when the buyer is a business. */
  audienceType: CampaignAudienceType;
  primaryKpi: string;
  kpis: string[];
  funnelStages: string[];
  audienceDescriptions: string[];
  audienceSignals: string[];
  geography: string;
  totalWorkingMediaBudget: number;
  campaignStartDate: string | null;
  campaignEndDate: string | null;
  campaignFlightDays: number | null;
  normalized30DayBudget: number;
  planningMode: PlanningMode;
  existingPlacements: ExtractedPlacement[];
  existingChannelIds: string[];
  requiredChannelIds: string[];
  preferredChannelIds: string[];
  excludedChannelIds: string[];
  dataReadiness: DataReadinessFacts;
  creativeReadiness: CreativeReadinessFacts;
  measurementExpectations: string[];
  brandSafetyConstraints: string[];
  assumptions: string[];
  settings: PlanningSettings;
  appliedBudgetTier: BudgetChannelTier;
  ctvPublishers?: CtvPublisherRecommendation[];
}

export interface SourceMetadata {
  sourceWorkbookVersion: string;
  sourceLabels: string[];
  lastVerifiedDate: string;
  businessOwner: string;
  reviewStatus: "verified" | "provisional" | "incomplete";
}

export interface MediaProductRecord {
  id: string;
  displayName: string;
  aliases: string[];
  familyId: string;
  legacyCanonicalId: CanonicalMediaType;
  digitalRemedyExecutable: boolean;
  status: ProductStatus;
  recommendationEligible: boolean;
  defaultPriority: "core" | "triggered" | "deprioritized";
  funnelRoles: string[];
  supportedKpis: string[];
  audienceSignals: string[];
  verticalExclusions: string[];
  supportedGeographies: string[];
  creativeRequirements: Array<keyof CreativeReadinessFacts>;
  dataRequirements: Array<keyof DataReadinessFacts>;
  minimumTotalSpend: number;
  minimumNormalized30DaySpend: number;
  minimumFlightDays: number;
  typicalCpmLow: number | null;
  typicalCpmHigh: number | null;
  minimumAllocationPercent: number;
  maximumAllocationPercent: number;
  scaleRating: number;
  complementaryChannelIds: string[];
  sourceMetadata: SourceMetadata;
}

export interface EvidenceItem {
  sourceType:
    | "brief"
    | "uploaded_plan"
    | "advertiser_research"
    | "audience_research"
    | "digital_remedy_rule"
    | "historical_performance"
    | "industry_benchmark"
    | "planner_override"
    | "assumption";
  detail: string;
  sourceId?: string;
}

export interface CandidateScoreComponents {
  kpiAndFunnelFit: number;
  audienceAndPersonaFit: number;
  incrementalGapCoverage: number;
  dataReadiness: number;
  creativeReadiness: number;
  measurementFit: number;
}

export interface AiCandidateSignal {
  channelId: string;
  components?: Partial<CandidateScoreComponents>;
  gapAddressed?: string;
  evidence?: EvidenceItem[];
  activationGuidance?: string;
  measurementApproach?: string;
  tradeoffs?: string[];
  allocationRationale?: string;
  decisionRule?: string;
}

export interface EvaluatedMediaCandidate {
  /**
   * True when the scores and rationale came from the AI reasoning layer. False means the
   * engine's formula defaults filled them in; the server refuses to build a plan that way for
   * any eligible product, so false only appears on ineligible products, and the UI must not
   * present their numbers or text as analysis.
   */
  aiAssessed: boolean;
  product: MediaProductRecord;
  status: RecommendationStatus;
  recommendationScore: number;
  confidence: ConfidenceLevel;
  components: CandidateScoreComponents;
  evidence: EvidenceItem[];
  eligibilityFailures: string[];
  prerequisites: string[];
  gapAddressed: string;
  activationGuidance: string;
  measurementApproach: string;
  tradeoffs: string[];
  allocationRationale: string;
  decisionRule: string;
  targetingTactics: AttachedPlanningRecord[];
  publishers: AttachedPlanningRecord[];
  creativeEnhancements: AttachedPlanningRecord[];
  inventoryControls: AttachedPlanningRecord[];
  measurementCapabilities: AttachedPlanningRecord[];
}

export interface AttachedPlanningRecord {
  id: string;
  displayName: string;
  rationale: string;
  pricing?: string;
  limitation?: string;
}

export interface ChannelPlanRecommendation {
  channelId: string;
  canonicalId: CanonicalMediaType;
  channelName: string;
  familyId: string;
  status: "ADD" | "TEST";
  recommendationScore: number;
  confidence: ConfidenceLevel;
  allocationPercent: number;
  allocationDollars: number;
  monthlyEquivalentSpend: number;
  role: string;
  gapAddressed: string;
  evidence: EvidenceItem[];
  targetingTactics: AttachedPlanningRecord[];
  publishers: AttachedPlanningRecord[];
  creativeEnhancements: AttachedPlanningRecord[];
  inventoryControls: AttachedPlanningRecord[];
  measurementCapabilities: AttachedPlanningRecord[];
  prerequisites: string[];
  tradeoffs: string[];
  assumptions: string[];
  allocationRationale: string;
  decisionRule: string;
  minimumAllocationPercent: number;
  maximumAllocationPercent: number;
  minimumTotalSpend: number;
  typicalCpmLow: number | null;
  typicalCpmHigh: number | null;
  fundingSource?: string;
  /**
   * Set when a planner manually forced this media type into the plan. Forced channels are
   * exempt from their product allocation minimum so a manual add always succeeds, regardless
   * of budget. The product minimums remain on the record for display and execution warnings.
   */
  manuallyForced?: boolean;
}

export interface AllocationAuditEntry {
  type: "minimum" | "maximum" | "selection" | "exclusion" | "rebalance" | "rounding" | "mode";
  channelId?: string;
  detail: string;
}

export interface MediaRecommendationPlan {
  catalogVersion: string;
  settingsVersion: number;
  appliedBudgetTier: BudgetChannelTier;
  normalized30DayBudget: number;
  workingMediaBudget: number;
  flightDays: number | null;
  maxMediaTypes: number;
  selectedMediaTypeCount: number;
  planningMode: PlanningMode;
  assumptions: string[];
  channels: ChannelPlanRecommendation[];
  evaluatedCandidates: EvaluatedMediaCandidate[];
  nonMediaCosts: Array<{ id: string; displayName: string; amount: number; pricing: string }>;
  allocationAudit: AllocationAuditEntry[];
}

export interface CampaignFactsInput {
  advertiserName?: string;
  advertiserUrl?: string;
  vertical?: string;
  subvertical?: string;
  /** From the Brief of Record. Inferred from the brief text when absent. */
  audienceType?: CampaignAudienceType;
  kpis?: string[];
  campaignFocus?: string;
  audienceDescriptions?: string[];
  audienceSignals?: string[];
  geography?: string;
  workingMediaBudget: number;
  campaignFlightDays?: number | null;
  campaignStartDate?: string | null;
  campaignEndDate?: string | null;
  planningMode?: PlanningMode;
  selectedPlanOptions?: ParsedPlanOption[];
  requiredChannelIds?: string[];
  preferredChannelIds?: string[];
  excludedChannelIds?: string[];
  dataReadiness?: Partial<DataReadinessFacts>;
  creativeReadiness?: Partial<CreativeReadinessFacts>;
  measurementExpectations?: string[];
  brandSafetyConstraints?: string[];
  planningSettings: PlanningSettings;
  ctvPublishers?: CtvPublisherRecommendation[];
}
