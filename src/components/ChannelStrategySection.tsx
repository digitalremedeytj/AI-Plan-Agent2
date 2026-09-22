import React, { useState } from 'react';
import { Sparkles, Copy, Check, Info, ArrowLeftRight, TrendingUp, Layers, HelpCircle, FileText, DollarSign, CalendarDays, Gauge, ShieldCheck, Plus, Minus, ChevronDown, Loader2, Edit3, Lock, Unlock, RotateCcw, Save, X, Undo2, Download } from 'lucide-react';
import { ChannelStrategyData, CtvPublisherRecommendation } from '../types';
import type { AttachedPlanningRecord, CandidateScoreComponents } from '../planning/types';
import { isNonMediaItem } from '../utils/mediaTaxonomy';
import {
  allocationBasisPoints,
  applyBasisPointAllocations,
  rebalanceBasisPoints,
  rebalanceEditedAllocation,
  type AllocationBasisPoints,
} from '../planning/manualAllocations';

export const DEFAULT_CTV_PUBLISHERS: Array<{ publisher: string; category?: string; why?: string }> = [
  { publisher: 'Hulu', category: 'App', why: 'High penetration among prime-time streaming audiences with premium ad-supported options.' },
  { publisher: 'Disney+', category: 'App', why: 'Co-viewing hub matching family oriented household profiles perfectly.' },
  { publisher: 'The Roku Channel', category: 'OS', why: 'Dominant CTV operating system offering native home screen high-impact display slots.' },
  { publisher: 'ESPN', category: 'Network', why: 'Essential for capturing live sports and highly engaged co-viewing audiences.' },
];

export const isCtvOrPerformanceTvChannel = (
  channelId?: string,
  channelName?: string,
  canonicalId?: string,
): boolean => {
  const id = (channelId || '').toLowerCase().trim();
  const name = (channelName || '').toLowerCase().trim();
  const canonical = (canonicalId || '').toLowerCase().trim();

  return (
    id === 'channel.ctv' ||
    id === 'channel.performance_tv' ||
    id === 'ctv' ||
    id === 'ctv_ott' ||
    id === 'performance_tv' ||
    id === 'performance_ctv' ||
    canonical === 'ctv' ||
    canonical === 'ctv_ott' ||
    canonical === 'performance_tv' ||
    name === 'ctv / ott' ||
    name === 'ctv/ott' ||
    name === 'performance tv' ||
    name === 'performance ctv' ||
    name === 'connected tv' ||
    id.includes('channel.ctv') ||
    id.includes('performance_tv') ||
    id.includes('performancetv') ||
    name.includes('performance tv') ||
    name.includes('performance ctv') ||
    name.includes('ctv / ott') ||
    name.includes('ctv/ott')
  );
};

export interface ChannelStrategySectionProps {
  data: ChannelStrategyData;
  ctvPublishers?: Array<{ publisher: string; category?: string; why?: string }> | CtvPublisherRecommendation[];
  initialExpandedChannels?: string[];
  /**
   * Internal-only visibility from shared settings. These hide detail from the rendered
   * plan without changing it, so a client-facing screen share and an internal review
   * read from the same saved plan.
   */
  internalOnly?: InternalOnlyVisibility;
  onToggleBudgetMode?: (mode: 'reallocation' | 'incremental') => void;
  onManualMediaTypeChange?: (channelId: string, action: 'add' | 'remove') => Promise<void>;
  onSaveAllocations?: (basisPoints: AllocationBasisPoints, lockedChannelIds: string[], newBudget?: number) => Promise<void>;
  onResetAllocations?: () => Promise<void>;
  onUndoPlanChange?: () => void;
  canUndoPlanChange?: boolean;
  onOpenSlideStudio?: () => void;
  readOnly?: boolean;
}

export interface InternalOnlyVisibility {
  channelAllocationColumn: boolean;
  channelDollarsColumn: boolean;
  channelScoreColumn: boolean;
  channelConfidenceBadge: boolean;
  channelStatusTag: boolean;
  planningAssumptions?: boolean;
  qaAudit?: boolean;
}

export const ALL_INTERNAL_VISIBLE: InternalOnlyVisibility = {
  channelAllocationColumn: true,
  channelDollarsColumn: true,
  channelScoreColumn: true,
  channelConfidenceBadge: true,
  channelStatusTag: true,
  planningAssumptions: true,
  qaAudit: true,
};

interface AllocationInputValue {
  percent: string;
  dollars: string;
}

const allocationInputs = (basisPoints: AllocationBasisPoints, totalBudget: number): Record<string, AllocationInputValue> =>
  Object.fromEntries(Object.entries(basisPoints).map(([channelId, value]) => [channelId, {
    percent: String(value / 100),
    dollars: ((totalBudget * value) / 10_000).toFixed(2),
  }]));

const parseAllocationNumber = (value: string): number => Number(value.replace(/[$,%\s,]/g, ''));

const displayRecommendationStatus = (status: string) => status === 'CONDITIONAL' ? 'TEST' : status;

interface MediaTypeDetailsProps {
  detailsId: string;
  gapAddressed: string;
  planningRationale: string;
  activationGuidance: string;
  measurementApproach: string;
  targetingTactics: AttachedPlanningRecord[];
  publishers: AttachedPlanningRecord[];
  creativeEnhancements: AttachedPlanningRecord[];
  inventoryControls: AttachedPlanningRecord[];
  measurementCapabilities: AttachedPlanningRecord[];
  evidence: Array<{ detail: string }>;
  scoreComponents?: CandidateScoreComponents;
  decisionRule: string;
  prerequisites?: string[];
  tradeoffs?: string[];
  eligibilityFailures?: string[];
  minimumAllocationPercent: number;
  maximumAllocationPercent: number;
  minimumTotalSpend: number;
  minimumFlightDays?: number;
  typicalCpmLow: number | null;
  typicalCpmHigh: number | null;
  monthlyEquivalentSpend?: number;
  fundingSource?: string;
  isPreview?: boolean;
}

const planningRecordNames = (records: AttachedPlanningRecord[] | undefined, fallback: string) =>
  records?.map((item) => item.displayName).join(', ') || fallback;

export const MediaTypeDetails: React.FC<MediaTypeDetailsProps> = ({
  detailsId,
  gapAddressed,
  planningRationale,
  activationGuidance,
  measurementApproach,
  targetingTactics,
  publishers,
  creativeEnhancements,
  inventoryControls,
  measurementCapabilities,
  evidence,
  scoreComponents,
  decisionRule,
  prerequisites = [],
  tradeoffs = [],
  eligibilityFailures = [],
  minimumAllocationPercent,
  maximumAllocationPercent,
  minimumTotalSpend,
  minimumFlightDays,
  typicalCpmLow,
  typicalCpmHigh,
  monthlyEquivalentSpend,
  fundingSource,
  isPreview = false,
}) => {
  const warnings = Array.from(new Set([...(eligibilityFailures || []), ...(prerequisites || []), ...(tradeoffs || [])]));
  const scoreLabels: Array<[keyof CandidateScoreComponents, string]> = [
    ['kpiAndFunnelFit', 'KPI & funnel'],
    ['audienceAndPersonaFit', 'Audience'],
    ['incrementalGapCoverage', 'Gap coverage'],
    ['dataReadiness', 'Data readiness'],
    ['creativeReadiness', 'Creative readiness'],
    ['measurementFit', 'Measurement'],
  ];

  return (
    <div id={detailsId} className="mt-4 border-t border-slate-100 pt-4">
      {isPreview && (
        <div className="mb-3 rounded-xl border border-indigo-100 bg-indigo-50/70 px-3 py-2 text-xs text-indigo-900">
          This is a planning-stack preview. Final allocation dollars and the surrounding media mix are recalculated only after this media type is added.
        </div>
      )}

      <div className="grid gap-3 text-xs md:grid-cols-2">
        <div className="rounded-xl bg-slate-50 p-3"><span className="font-bold text-slate-900">Gap addressed: </span><span className="text-slate-700">{gapAddressed}</span></div>
        <div className="rounded-xl bg-slate-50 p-3"><span className="font-bold text-slate-900">Planning rationale: </span><span className="text-slate-700">{planningRationale}</span></div>
        <div className="rounded-xl bg-slate-50 p-3"><span className="font-bold text-slate-900">Activation guidance: </span><span className="text-slate-700">{activationGuidance}</span></div>
        <div className="rounded-xl bg-slate-50 p-3"><span className="font-bold text-slate-900">Targeting tactics: </span><span className="text-slate-700">{planningRecordNames(targetingTactics, 'Use channel-compatible targeting after readiness confirmation.')}</span></div>
        <div className="rounded-xl bg-slate-50 p-3">
          <span className="font-bold text-slate-900">Publishers: </span>
          <span className="text-slate-700">
            {publishers && publishers.length > 0 ? (
              publishers.map((item, idx) => (
                <span key={item.id || idx} title={item.rationale || undefined}>
                  {item.displayName}{idx < publishers.length - 1 ? ', ' : ''}
                </span>
              ))
            ) : (
              'Open inventory; no publisher-specific guidance triggered.'
            )}
          </span>
        </div>
        <div className="rounded-xl bg-slate-50 p-3"><span className="font-bold text-slate-900">Creative enhancements: </span><span className="text-slate-700">{planningRecordNames(creativeEnhancements, 'None suggested.')}</span></div>
        <div className="rounded-xl bg-slate-50 p-3"><span className="font-bold text-slate-900">Inventory controls: </span><span className="text-slate-700">{planningRecordNames(inventoryControls, 'Apply standard platform safeguards.')}</span></div>
        <div className="rounded-xl bg-slate-50 p-3"><span className="font-bold text-slate-900">Measurement approach: </span><span className="text-slate-700">{measurementApproach}</span></div>
        <div className="rounded-xl bg-slate-50 p-3"><span className="font-bold text-slate-900">Measurement capabilities: </span><span className="text-slate-700">{planningRecordNames(measurementCapabilities, 'Confirm an eligible measurement capability.')}</span></div>
        <div className="rounded-xl bg-slate-50 p-3"><span className="font-bold text-slate-900">Evidence: </span><span className="text-slate-700">{evidence.slice(0, 2).map((item) => item.detail).join(' ') || 'No additional evidence was supplied.'}</span></div>
        <div className="rounded-xl bg-slate-50 p-3 md:col-span-2"><span className="font-bold text-slate-900">Decision rule: </span><span className="text-slate-700">{decisionRule}</span></div>
      </div>

      {scoreComponents && (
        <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-500">Score breakdown</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {scoreLabels.map(([key, label]) => (
              <div key={key} className="rounded-lg bg-slate-50 px-2.5 py-2">
                <div className="text-[10px] font-semibold text-slate-500">{label}</div>
                <div className="mt-0.5 font-extrabold text-slate-900">{scoreComponents[key]}/100</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-semibold text-slate-600">
        {monthlyEquivalentSpend !== undefined && <span className="rounded-md border border-slate-200 px-2 py-1">${monthlyEquivalentSpend.toLocaleString()} monthly equivalent</span>}
        {isPreview && <span className="rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1 text-indigo-700">Allocation calculated after add</span>}
        <span className="rounded-md border border-slate-200 px-2 py-1">Min {Math.ceil(minimumAllocationPercent)}% / Max {Math.floor(maximumAllocationPercent)}%</span>
        <span className="rounded-md border border-slate-200 px-2 py-1">Min spend ${minimumTotalSpend.toLocaleString()}</span>
        {minimumFlightDays !== undefined && <span className="rounded-md border border-slate-200 px-2 py-1">Min flight {minimumFlightDays} days</span>}
        <span className="rounded-md border border-slate-200 px-2 py-1">{typicalCpmLow !== null && typicalCpmHigh !== null ? `Est. CPM $${typicalCpmLow}–$${typicalCpmHigh}` : 'CPM varies by buy model'}</span>
        {fundingSource && <span className="rounded-md border border-slate-200 px-2 py-1">{fundingSource}</span>}
      </div>

      {warnings.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-100 bg-amber-50/70 p-3 text-xs text-amber-900">
          {warnings.join(' • ')}
        </div>
      )}
    </div>
  );
};

export const ChannelStrategySection: React.FC<ChannelStrategySectionProps> = ({
  data,
  ctvPublishers,
  initialExpandedChannels,
  internalOnly = ALL_INTERNAL_VISIBLE,
  onToggleBudgetMode,
  onManualMediaTypeChange,
  onSaveAllocations,
  onResetAllocations,
  onUndoPlanChange,
  canUndoPlanChange = false,
  onOpenSlideStudio,
  readOnly = false,
}) => {
  const effectiveCtvPublishers = (ctvPublishers && ctvPublishers.length > 0)
    ? ctvPublishers
    : (data?.ctvPublishers && data.ctvPublishers.length > 0)
    ? data.ctvPublishers
    : DEFAULT_CTV_PUBLISHERS;

  const resolvePublishers = (
    channelId: string,
    channelName: string,
    canonicalId?: string,
    existingPublishers?: AttachedPlanningRecord[]
  ): AttachedPlanningRecord[] => {
    if (isCtvOrPerformanceTvChannel(channelId, channelName, canonicalId)) {
      return effectiveCtvPublishers.map((pub) => ({
        id: `publisher.ctv.${pub.publisher.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
        displayName: pub.publisher,
        rationale: pub.why || `Recommended CTV publisher (${pub.category || 'Targeted'}).`,
      }));
    }
    return existingPublishers || [];
  };

  const [copied, setCopied] = useState(false);
  const [expandedChannels, setExpandedChannels] = useState<Set<string>>(() => new Set(initialExpandedChannels || []));
  const [pendingChannelId, setPendingChannelId] = useState<string | null>(null);
  const [manualUpdateError, setManualUpdateError] = useState('');
  const [manualUpdateMessage, setManualUpdateMessage] = useState('');
  const [isEditingAllocations, setIsEditingAllocations] = useState(false);
  const [draftBudget, setDraftBudget] = useState<number>(0);
  const [draftBudgetInput, setDraftBudgetInput] = useState<string>('');
  const [draftBasisPoints, setDraftBasisPoints] = useState<AllocationBasisPoints>({});
  const [draftInputs, setDraftInputs] = useState<Record<string, AllocationInputValue>>({});

  // Tailwind only ships classes it can see as literals, so the column count maps to a
  // fixed set rather than being interpolated into `grid-cols-${n}`.
  const channelColumnCount = [
    internalOnly.channelAllocationColumn,
    internalOnly.channelDollarsColumn,
    internalOnly.channelScoreColumn,
  ].filter(Boolean).length;
  const channelColumnGridClass = channelColumnCount === 3 ? 'grid-cols-3' : channelColumnCount === 2 ? 'grid-cols-2' : 'grid-cols-1';
  const [draftLockedChannelIds, setDraftLockedChannelIds] = useState<string[]>([]);
  const [allocationEditorError, setAllocationEditorError] = useState('');
  const [isSavingAllocations, setIsSavingAllocations] = useState(false);

  React.useEffect(() => {
    setExpandedChannels(new Set());
    setManualUpdateError('');
    setIsEditingAllocations(false);
    setDraftBudget(0);
    setDraftBudgetInput('');
    setAllocationEditorError('');
  }, [data?.generatedAt]);

  if (!data) return null;
  const mediaPlan = data.mediaPlan;
  const manualIncludedIds = new Set(data.manualIncludedChannelIds || []);
  const selectedChannelIds = new Set(mediaPlan?.channels.map((channel) => channel.channelId) || []);
  const unselectedCandidates = (mediaPlan?.evaluatedCandidates || [])
    .filter((candidate) => !selectedChannelIds.has(candidate.product.id))
    .sort((a, b) => {
      const rank = (status: string) => status === 'ADD' ? 0 : displayRecommendationStatus(status) === 'TEST' ? 1 : 2;
      return rank(a.status) - rank(b.status) || b.recommendationScore - a.recommendationScore || a.product.displayName.localeCompare(b.product.displayName);
    });
  const candidateGroups = [
    {
      id: 'recommended',
      title: 'ScoutAI recommended alternatives',
      description: 'Qualified recommendations that did not fit the highest-value feasible mix.',
      candidates: unselectedCandidates.filter((candidate) => candidate.status === 'ADD'),
    },
    {
      id: 'test',
      title: 'ScoutAI test opportunities',
      description: 'Promising options that need additional validation or readiness before scaling.',
      candidates: unselectedCandidates.filter((candidate) => displayRecommendationStatus(candidate.status) === 'TEST'),
    },
    {
      id: 'not-recommended',
      title: 'Not currently recommended',
      description: 'Media types blocked by eligibility rules or below the current recommendation threshold.',
      candidates: unselectedCandidates.filter((candidate) => !['ADD', 'TEST'].includes(displayRecommendationStatus(candidate.status))),
    },
  ].filter((group) => group.candidates.length > 0);

  const toggleChannelDetails = (channelId: string) => {
    setExpandedChannels((current) => {
      const next = new Set(current);
      if (next.has(channelId)) next.delete(channelId);
      else next.add(channelId);
      return next;
    });
  };

  const updateManualMediaType = async (channelId: string, action: 'add' | 'remove') => {
    if (!onManualMediaTypeChange || pendingChannelId) return;
    setPendingChannelId(channelId);
    setManualUpdateError('');
    setManualUpdateMessage('');
    try {
      await onManualMediaTypeChange(channelId, action);
      const channelName = mediaPlan?.evaluatedCandidates.find((candidate) => candidate.product.id === channelId)?.product.displayName || 'Media type';
      setManualUpdateMessage(action === 'add'
        ? `${channelName} was added and the unlocked allocations were rebalanced. The working-media budget did not change.`
        : `${channelName} was removed and its allocation was redistributed. The working-media budget did not change.`);
    } catch (error) {
      setManualUpdateError(error instanceof Error ? error.message : 'The media plan could not be updated.');
    } finally {
      setPendingChannelId(null);
    }
  };

  const startAllocationEditor = () => {
    if (!mediaPlan) return;
    const current = allocationBasisPoints(mediaPlan);
    setDraftBasisPoints(current);
    setDraftBudget(mediaPlan.workingMediaBudget);
    setDraftBudgetInput(mediaPlan.workingMediaBudget.toLocaleString());
    setDraftInputs(allocationInputs(current, mediaPlan.workingMediaBudget));
    setDraftLockedChannelIds((data.lockedAllocationChannelIds || []).filter((id) => current[id] !== undefined));
    setAllocationEditorError('');
    setIsEditingAllocations(true);
  };

  const cancelAllocationEditor = () => {
    setIsEditingAllocations(false);
    setAllocationEditorError('');
    setDraftBudget(0);
    setDraftBudgetInput('');
  };

  const commitBudgetInput = (rawInput?: string) => {
    if (!mediaPlan) return;
    const input = rawInput ?? draftBudgetInput;
    const parsed = parseAllocationNumber(input);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setAllocationEditorError('Please enter a valid positive budget amount.');
      setDraftBudgetInput((draftBudget > 0 ? draftBudget : mediaPlan.workingMediaBudget).toLocaleString());
      return;
    }
    const cleanBudget = Math.round(parsed);
    const sumMinSpends = mediaPlan.channels.reduce((sum, c) => sum + c.minimumTotalSpend, 0);
    if (cleanBudget < sumMinSpends) {
      setAllocationEditorError(`Budget of $${cleanBudget.toLocaleString()} is too low for the selected media mix. Minimum required is $${sumMinSpends.toLocaleString()} based on channel minimums.`);
      setDraftBudget(cleanBudget);
      setDraftBudgetInput(cleanBudget.toLocaleString());
      setDraftInputs(allocationInputs(draftBasisPoints, cleanBudget));
      return;
    }
    try {
      const next = rebalanceBasisPoints(mediaPlan, draftBasisPoints, cleanBudget);
      setDraftBudget(cleanBudget);
      setDraftBudgetInput(cleanBudget.toLocaleString());
      setDraftBasisPoints(next);
      setDraftInputs(allocationInputs(next, cleanBudget));
      setAllocationEditorError('');
    } catch (error) {
      setDraftBudget(cleanBudget);
      setDraftBudgetInput(cleanBudget.toLocaleString());
      setDraftInputs(allocationInputs(draftBasisPoints, cleanBudget));
      setAllocationEditorError(error instanceof Error ? error.message : 'Allocations could not be balanced for this budget.');
    }
  };

  const commitAllocationInput = (channelId: string, unit: 'percent' | 'dollars', rawInput?: string) => {
    if (!mediaPlan) return;
    const activeBudget = draftBudget > 0 ? draftBudget : mediaPlan.workingMediaBudget;
    const input = rawInput ?? draftInputs[channelId]?.[unit] ?? '';
    const parsed = parseAllocationNumber(input);
    if (!Number.isFinite(parsed)) {
      setAllocationEditorError('Enter a valid allocation amount.');
      setDraftInputs(allocationInputs(draftBasisPoints, activeBudget));
      return;
    }
    const requestedPercent = unit === 'percent'
      ? parsed
      : (parsed / activeBudget) * 100;
    if (Math.abs(requestedPercent - Math.round(requestedPercent)) > 0.000001) {
      const dollarIncrement = activeBudget / 100;
      setAllocationEditorError(unit === 'percent'
        ? 'Allocation percentages must be whole numbers.'
        : `Dollar allocations must equal a whole percentage of the budget (increments of $${dollarIncrement.toLocaleString(undefined, { maximumFractionDigits: 2 })}).`);
      setDraftInputs(allocationInputs(draftBasisPoints, activeBudget));
      return;
    }
    const targetBasisPoints = Math.round(requestedPercent) * 100;
    try {
      const draftPlan = applyBasisPointAllocations(mediaPlan, draftBasisPoints, 'Draft allocation preview.', activeBudget);
      const next = rebalanceEditedAllocation(draftPlan, channelId, targetBasisPoints, draftLockedChannelIds, activeBudget);
      setDraftBasisPoints(next);
      setDraftInputs(allocationInputs(next, activeBudget));
      setAllocationEditorError('');
    } catch (error) {
      setAllocationEditorError(error instanceof Error ? error.message : 'That allocation cannot be balanced.');
      setDraftInputs(allocationInputs(draftBasisPoints, activeBudget));
    }
  };

  const toggleDraftLock = (channelId: string) => {
    setDraftLockedChannelIds((current) => current.includes(channelId)
      ? current.filter((id) => id !== channelId)
      : [...current, channelId]);
  };

  const saveAllocationEditor = async () => {
    if (!onSaveAllocations || isSavingAllocations) return;
    const activeBudget = draftBudget > 0 ? draftBudget : mediaPlan.workingMediaBudget;
    setIsSavingAllocations(true);
    setAllocationEditorError('');
    try {
      await onSaveAllocations(draftBasisPoints, draftLockedChannelIds, activeBudget);
      setManualUpdateMessage(
        activeBudget !== mediaPlan.workingMediaBudget
          ? `Allocation and budget changes ($${activeBudget.toLocaleString()}) were saved.`
          : 'Allocation changes were saved. The total remains 100% of the working-media budget.'
      );
      setIsEditingAllocations(false);
    } catch (error) {
      setAllocationEditorError(error instanceof Error ? error.message : 'The allocation changes could not be saved.');
    } finally {
      setIsSavingAllocations(false);
    }
  };

  const resetAllocations = async () => {
    if (!onResetAllocations || isSavingAllocations) return;
    setIsSavingAllocations(true);
    setAllocationEditorError('');
    try {
      await onResetAllocations();
      setManualUpdateMessage('Allocations were reset to the ScoutAI recommendation for the current media mix.');
      setIsEditingAllocations(false);
    } catch (error) {
      setAllocationEditorError(error instanceof Error ? error.message : 'Allocations could not be reset.');
    } finally {
      setIsSavingAllocations(false);
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 8.0) return 'text-emerald-500 font-bold';
    if (score >= 6.5) return 'text-amber-500 font-bold';
    return 'text-rose-500 font-bold';
  };

  const getScoreBg = (score: number) => {
    if (score >= 8.0) return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    if (score >= 6.5) return 'bg-amber-50 text-amber-700 border-amber-200';
    return 'bg-rose-50 text-rose-700 border-rose-200';
  };

  const getRecommendationScoreBg = (score: number) => {
    if (score >= 72) return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    if (score >= 55) return 'bg-amber-50 text-amber-700 border-amber-200';
    return 'bg-rose-50 text-rose-700 border-rose-200';
  };

  const handleCopyText = () => {
    const allocationText = mediaPlan
      ? `\n\nDETERMINISTIC MEDIA ALLOCATION\n${mediaPlan.channels.map((channel) => `- ${channel.channelName}: ${channel.allocationPercent.toFixed(0)}% / $${channel.allocationDollars.toLocaleString()} (${displayRecommendationStatus(channel.status)}, score ${channel.recommendationScore})`).join('\n')}`
      : '';
    const text = `CHANNEL STRATEGY ANALYSIS${allocationText}\n\nRFP Channels:\n${(data.rfpChannels || [])
      .map(
        c =>
          `- ${c.channelName} (Score: ${c.score.toFixed(1)} | Audience Fit: ${c.audienceFit}/10 | Goal Match: ${c.goalMatch}/10)\n  Evidence: ${c.mediaConsumptionEvidence}\n  Why: ${c.whyItEarnsASpot}`
      )
      .join('\n')}\n\nScoutAI Recommended Channels:\n${(data.scoutAiRecommendedChannels || [])
      .map(
        c =>
          `- ${c.channelName} (Score: ${c.score.toFixed(1)} | Audience Fit: ${c.audienceFit}/10 | Goal Match: ${c.goalMatch}/10)\n  Evidence: ${c.mediaConsumptionEvidence}\n  Why: ${c.whyItEarnsASpot}`
      )
      .join('\n')}\n\nExecutive Insight:\n${data.executiveInsight || ''}`;

    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const rfpChannelNames = (data.rfpChannels || []).map(c => c.channelName).join(', ');

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 md:p-8 my-8 font-sans">
      {/* Header Bar */}
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 pb-6 border-b border-slate-100">
        <div>
          <div className="flex items-center gap-2 text-indigo-600 text-xs font-bold uppercase tracking-wider mb-2">
            <Layers className="w-4 h-4" />
            <span>Channel Strategy & Activation Plan</span>
          </div>
          <div className="flex items-center gap-2">
            <h2 className="font-display font-bold text-2xl md:text-3xl text-slate-900 tracking-tight">
              Channel Strategy
            </h2>
            <span className="text-xs font-semibold bg-indigo-50 text-indigo-700 px-2.5 py-1 rounded-full border border-indigo-100 flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
              ScoutAI Recommended
            </span>
          </div>
          <p className="text-slate-600 text-sm md:text-base mt-1 font-medium">
            Channels scored by audience fit, KPI alignment, and competitive opportunity.
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-3">
          {/* Budget Strategy Mode Toggle */}
          {mediaPlan?.planningMode !== 'greenfield' && <div className="inline-flex rounded-lg p-1 bg-slate-100 border border-slate-200 text-xs font-medium">
            <button
              onClick={() => onToggleBudgetMode && onToggleBudgetMode('reallocation')}
              className={`px-3 py-1.5 rounded-md transition-all cursor-pointer flex items-center gap-1.5 ${
                data.budgetStrategyMode === 'reallocation'
                  ? 'bg-white text-indigo-900 font-bold shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <ArrowLeftRight className="w-3.5 h-3.5 text-indigo-600" />
              Reallocation
            </button>
            <button
              onClick={() => onToggleBudgetMode && onToggleBudgetMode('incremental')}
              className={`px-3 py-1.5 rounded-md transition-all cursor-pointer flex items-center gap-1.5 ${
                data.budgetStrategyMode === 'incremental'
                  ? 'bg-white text-emerald-900 font-bold shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />
              Incremental Spend
            </button>
          </div>}

          {onOpenSlideStudio && (
            <button
              type="button"
              id="btn-open-channel-slide-studio"
              onClick={onOpenSlideStudio}
              className="p-2 text-slate-500 hover:text-slate-900 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg inline-flex items-center justify-center cursor-pointer transition-colors shadow-2xs"
              title="Export Presentation Slide (16:9)"
              aria-label="Export Presentation Slide"
            >
              <Download className="w-4 h-4 text-[#0e8f86]" />
            </button>
          )}

          <button
            onClick={handleCopyText}
            className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg border border-slate-200 transition-colors cursor-pointer"
            title="Copy Strategy Summary"
          >
            {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {mediaPlan && (
        <div className="mt-6 space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: 'Budget', value: `$${mediaPlan.workingMediaBudget.toLocaleString()}`, icon: DollarSign },
              { label: 'Flight', value: mediaPlan.flightDays ? `${mediaPlan.flightDays} days` : 'Not supplied', icon: CalendarDays },
              { label: '30-day normalized', value: `$${mediaPlan.normalized30DayBudget.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, icon: Gauge },
              { label: 'Mode', value: mediaPlan.planningMode === 'greenfield' ? 'New Plan' : mediaPlan.planningMode, icon: ArrowLeftRight },
            ].map(({ label, value, icon: Icon }) => (
              <div key={label} className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-500"><Icon className="h-3.5 w-3.5" />{label}</div>
                <div className="mt-1 text-sm font-extrabold capitalize text-slate-900">{value}</div>
              </div>
            ))}
          </div>

          {internalOnly.planningAssumptions && mediaPlan.assumptions.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
              <div className="mb-1 flex items-center gap-2 font-bold"><Info className="h-4 w-4" /> Planning assumptions</div>
              <ul className="list-disc space-y-1 pl-5">{mediaPlan.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}</ul>
            </div>
          )}

          <div className="overflow-hidden rounded-2xl border-2 border-indigo-500 bg-white shadow-md">
            <div className="flex items-center justify-center gap-2 bg-gradient-to-r from-indigo-700 via-indigo-600 to-indigo-800 px-4 py-2 text-xs font-bold uppercase tracking-widest text-white">
              <ShieldCheck className="h-4 w-4 text-indigo-200" /> Channel Allocation
            </div>
            {mediaPlan.channels.length > 0 && (
              <div className="border-b border-indigo-100 bg-indigo-50/60 px-4 py-3 md:px-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    {isEditingAllocations ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="inline-flex items-center gap-1.5 rounded-full border border-indigo-300 bg-white px-2.5 py-1 text-xs shadow-xs">
                          <label htmlFor="edit-working-media-budget" className="flex items-center gap-1 font-bold text-indigo-900">
                            <DollarSign className="h-3.5 w-3.5 text-indigo-600" />
                            <span>Budget:</span>
                          </label>
                          <div className="relative flex items-center">
                            <span className="pointer-events-none text-xs font-extrabold text-slate-400">$</span>
                            <input
                              id="edit-working-media-budget"
                              type="text"
                              inputMode="decimal"
                              value={draftBudgetInput}
                              onChange={(event) => setDraftBudgetInput(event.target.value)}
                              onBlur={(event) => commitBudgetInput(event.currentTarget.value)}
                              onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
                              className="w-24 border-b border-indigo-300 bg-transparent py-0.5 pl-0.5 pr-1 text-xs font-extrabold text-slate-900 outline-none focus:border-indigo-600 focus:ring-0"
                              placeholder="10,000"
                            />
                          </div>
                        </div>
                        <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700"><Check className="h-3.5 w-3.5" /> 100% allocated</span>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-white px-2.5 py-1 text-xs font-extrabold text-indigo-800">
                          <Lock className="h-3.5 w-3.5" /> Fixed budget: ${mediaPlan.workingMediaBudget.toLocaleString()}
                        </span>
                        <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700"><Check className="h-3.5 w-3.5" /> 100% allocated</span>
                      </div>
                    )}
                    {!readOnly && (
                      <p className="mt-1 text-[11px] text-slate-600">Edit budget, dollars, or whole-number percentages. Every change is balanced across unlocked media types.</p>
                    )}
                  </div>
                  {!readOnly && (
                    <div className="flex flex-wrap items-center gap-2">
                      {canUndoPlanChange && onUndoPlanChange && (
                        <button
                          type="button"
                          onClick={onUndoPlanChange}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
                        >
                          <Undo2 className="h-3.5 w-3.5" /> Undo last change
                        </button>
                      )}
                      {!isEditingAllocations && (
                        <button
                          type="button"
                          onClick={startAllocationEditor}
                          disabled={!onSaveAllocations}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Edit3 className="h-3.5 w-3.5" /> Edit allocations
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {isEditingAllocations && (
                  <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                    <div className="hidden border-b border-slate-200 bg-slate-50 px-3 py-2.5 text-[10px] font-extrabold uppercase tracking-wide text-slate-500 sm:block">
                      <div className="grid grid-cols-[minmax(130px,1fr)_100px_130px_52px] items-center gap-2">
                        <span>Media type</span>
                        <span className="text-right">Percent (whole)</span>
                        <span className="text-right">Dollars</span>
                        <span className="text-center">Lock</span>
                      </div>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {mediaPlan.channels.map((channel) => {
                        const locked = draftLockedChannelIds.includes(channel.channelId);
                        const activeBudget = draftBudget > 0 ? draftBudget : mediaPlan.workingMediaBudget;
                        const effectiveMinimum = Math.ceil(Math.max(
                          channel.minimumAllocationPercent,
                          activeBudget > 0 ? (channel.minimumTotalSpend / activeBudget) * 100 : 100,
                        ));
                        const effectiveMaximum = Math.floor(channel.maximumAllocationPercent);
                        return (
                          <div key={channel.channelId} className={`px-3 py-3 transition-colors ${locked ? 'bg-indigo-50/40' : 'bg-white'}`}>
                            <div className="relative grid grid-cols-2 items-center gap-2 sm:grid-cols-[minmax(130px,1fr)_100px_130px_52px]">
                              <div className="col-span-2 row-start-1 min-w-0 pr-12 sm:col-span-1 sm:pr-0">
                                <div className="truncate text-sm font-extrabold text-slate-900">{channel.channelName}</div>
                                <div className="mt-0.5 text-[10px] font-semibold text-slate-500">{effectiveMinimum}% min · {effectiveMaximum}% max</div>
                              </div>
                              <label className="col-start-1 row-start-2 block sm:col-start-2 sm:row-start-1">
                                <span className="sr-only">{channel.channelName} allocation percentage</span>
                                <span className="mb-1 block text-[10px] font-extrabold uppercase tracking-wide text-slate-400 sm:hidden">Percent (whole)</span>
                                <span className="relative block">
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    pattern="[0-9]*"
                                    value={draftInputs[channel.channelId]?.percent ?? ''}
                                    onChange={(event) => setDraftInputs((current) => ({
                                      ...current,
                                      [channel.channelId]: { ...(current[channel.channelId] || { percent: '', dollars: '' }), percent: event.target.value },
                                    }))}
                                    onBlur={(event) => commitAllocationInput(channel.channelId, 'percent', event.currentTarget.value)}
                                    onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
                                    onFocus={(event) => event.currentTarget.select()}
                                    className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-2.5 pr-6 text-right text-sm font-extrabold text-indigo-700 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                                  />
                                  <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-xs font-bold text-slate-400">%</span>
                                </span>
                              </label>
                              <label className="col-start-2 row-start-2 block sm:col-start-3 sm:row-start-1">
                                <span className="sr-only">{channel.channelName} allocation dollars</span>
                                <span className="mb-1 block text-[10px] font-extrabold uppercase tracking-wide text-slate-400 sm:hidden">Dollars</span>
                                <span className="relative block">
                                  <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-xs font-bold text-slate-400">$</span>
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    value={draftInputs[channel.channelId]?.dollars ?? ''}
                                    onChange={(event) => setDraftInputs((current) => ({
                                      ...current,
                                      [channel.channelId]: { ...(current[channel.channelId] || { percent: '', dollars: '' }), dollars: event.target.value },
                                    }))}
                                    onBlur={(event) => commitAllocationInput(channel.channelId, 'dollars', event.currentTarget.value)}
                                    onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
                                    onFocus={(event) => event.currentTarget.select()}
                                    className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-6 pr-2.5 text-right text-sm font-extrabold text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                                  />
                                </span>
                              </label>
                              <button
                                type="button"
                                onClick={() => toggleDraftLock(channel.channelId)}
                                aria-label={`${locked ? 'Unlock' : 'Lock'} ${channel.channelName} allocation`}
                                title={locked ? 'Allow this allocation to rebalance' : 'Protect this allocation from automatic rebalancing'}
                                className={`absolute right-0 top-0 inline-flex h-9 w-9 items-center justify-center rounded-lg border transition sm:static sm:col-start-4 sm:row-start-1 sm:mx-auto ${locked ? 'border-indigo-200 bg-indigo-100 text-indigo-700' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'}`}
                              >
                                {locked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="border-t border-slate-200 bg-slate-50 px-3 py-3">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <div className="text-xs font-extrabold text-slate-900">
                            Total {((Object.values(draftBasisPoints) as number[]).reduce((sum, value) => sum + value, 0) / 100).toFixed(0)}% · ${(draftBudget > 0 ? draftBudget : mediaPlan.workingMediaBudget).toLocaleString()}
                          </div>
                          <div className="mt-0.5 text-[10px] font-semibold text-emerald-700">Allocations balance proportionally to 100% of the working media budget.</div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {data.hasManualAllocationChanges && onResetAllocations && (
                            <button
                              type="button"
                              onClick={resetAllocations}
                              disabled={isSavingAllocations}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                            >
                              <RotateCcw className="h-3.5 w-3.5" /> Reset to ScoutAI
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={cancelAllocationEditor}
                            disabled={isSavingAllocations}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                          >
                            <X className="h-3.5 w-3.5" /> Cancel
                          </button>
                          <button
                            type="button"
                            onClick={saveAllocationEditor}
                            disabled={!onSaveAllocations || isSavingAllocations || Boolean(allocationEditorError)}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {isSavingAllocations ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save allocations
                          </button>
                        </div>
                      </div>
                      {allocationEditorError && <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-800">{allocationEditorError}</div>}
                    </div>
                  </div>
                )}
              </div>
            )}
            {mediaPlan.channels.length === 0 ? (
              <div className="p-5 text-sm text-slate-700">No product cleared every hard constraint. Review the excluded candidate reasons before allocating budget.</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {mediaPlan.channels.map((channel) => {
                  const evaluatedCandidate = mediaPlan.evaluatedCandidates.find((candidate) => candidate.product.id === channel.channelId);
                  const detailsId = `media-type-details-${channel.channelId.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
                  return (
                  <article key={channel.channelId} className="p-4 md:p-5">
                    <div className="flex items-start gap-2">
                      <button
                        type="button"
                        onClick={() => toggleChannelDetails(channel.channelId)}
                        aria-expanded={expandedChannels.has(channel.channelId)}
                        aria-controls={detailsId}
                        className="flex min-w-0 flex-1 flex-col gap-3 rounded-xl p-1 text-left hover:bg-slate-50 md:flex-row md:items-start md:justify-between"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-base font-extrabold text-slate-900">{channel.channelName}</h3>
                            {internalOnly.channelStatusTag && (
                              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${channel.status === 'ADD' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>{displayRecommendationStatus(channel.status)}</span>
                            )}
                            {internalOnly.channelConfidenceBadge && (
                              <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-bold capitalize text-slate-600">{channel.confidence} confidence</span>
                            )}
                            {manualIncludedIds.has(channel.channelId) && <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-700">Manual</span>}
                          </div>
                          <p className="mt-1 text-sm text-slate-600">{channel.role}</p>
                        </div>
                        <div className="flex items-center gap-3">
                          {channelColumnCount > 0 && (
                            <div className={`grid gap-3 text-right ${channelColumnGridClass}`}>
                              {internalOnly.channelAllocationColumn && (
                                <div><div className="text-[10px] font-bold uppercase text-slate-400">Allocation</div><div className="font-extrabold text-indigo-700">{channel.allocationPercent.toFixed(0)}%</div></div>
                              )}
                              {internalOnly.channelDollarsColumn && (
                                <div><div className="text-[10px] font-bold uppercase text-slate-400">Dollars</div><div className="font-extrabold text-slate-900">${channel.allocationDollars.toLocaleString()}</div></div>
                              )}
                              {internalOnly.channelScoreColumn && (
                                <div><div className="text-[10px] font-bold uppercase text-slate-400">Score</div><div className="font-extrabold text-slate-900">{channel.recommendationScore}/100</div></div>
                              )}
                            </div>
                          )}
                          <ChevronDown className={`h-5 w-5 shrink-0 text-slate-400 transition-transform ${expandedChannels.has(channel.channelId) ? 'rotate-180' : ''}`} />
                        </div>
                      </button>
                      {!readOnly && (
                        <button
                          type="button"
                          onClick={() => updateManualMediaType(channel.channelId, 'remove')}
                          disabled={!onManualMediaTypeChange || pendingChannelId !== null}
                          className="mt-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-rose-200 bg-white text-rose-600 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40"
                          aria-label={`Remove ${channel.channelName} from plan`}
                          title="Remove media type from this plan"
                        >
                          {pendingChannelId === channel.channelId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Minus className="h-4 w-4" />}
                        </button>
                      )}
                    </div>

                    {expandedChannels.has(channel.channelId) && (
                      <MediaTypeDetails
                        detailsId={detailsId}
                        gapAddressed={channel.gapAddressed}
                        planningRationale={channel.allocationRationale}
                        activationGuidance={evaluatedCandidate?.activationGuidance || `Activate ${channel.channelName} with channel-compatible targeting and creative.`}
                        measurementApproach={evaluatedCandidate?.measurementApproach || 'Use the best eligible measurement capability for the primary KPI.'}
                        targetingTactics={channel.targetingTactics}
                        publishers={resolvePublishers(channel.channelId, channel.channelName, evaluatedCandidate?.product.legacyCanonicalId, channel.publishers)}
                        creativeEnhancements={channel.creativeEnhancements}
                        inventoryControls={channel.inventoryControls}
                        measurementCapabilities={channel.measurementCapabilities}
                        evidence={channel.evidence}
                        scoreComponents={evaluatedCandidate?.components}
                        decisionRule={channel.decisionRule}
                        prerequisites={channel.prerequisites}
                        tradeoffs={channel.tradeoffs}
                        minimumAllocationPercent={channel.minimumAllocationPercent}
                        maximumAllocationPercent={channel.maximumAllocationPercent}
                        minimumTotalSpend={channel.minimumTotalSpend}
                        minimumFlightDays={evaluatedCandidate?.product.minimumFlightDays}
                        typicalCpmLow={channel.typicalCpmLow}
                        typicalCpmHigh={channel.typicalCpmHigh}
                        monthlyEquivalentSpend={channel.monthlyEquivalentSpend}
                        fundingSource={channel.fundingSource}
                      />
                    )}
                  </article>
                  );
                })}
              </div>
            )}
          </div>

          {manualUpdateError && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800">{manualUpdateError}</div>
          )}
          {manualUpdateMessage && (
            <div className="flex flex-col gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-900 sm:flex-row sm:items-center sm:justify-between">
              <span className="inline-flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0" />{manualUpdateMessage}</span>
              {canUndoPlanChange && onUndoPlanChange && (
                <button type="button" onClick={onUndoPlanChange} className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-lg border border-emerald-300 bg-white px-2.5 py-1.5 text-xs font-bold text-emerald-800 hover:bg-emerald-100 sm:self-auto">
                  <Undo2 className="h-3.5 w-3.5" /> Undo
                </button>
              )}
            </div>
          )}

          {!readOnly && (
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 md:px-5">
                <h3 className="text-sm font-extrabold text-slate-900">Media types not in plan</h3>
                <p className="mt-1 text-xs text-slate-600">Expand any media type to preview its full planning stack. “Add &amp; rebalance” preserves the selected portfolio and fixed working-media budget while proportionally adjusting unlocked allocations. Catalog availability is still enforced; budget, flight, and readiness minimums are waived for manual additions and shown as warnings.</p>
              </div>
              <div>
                {candidateGroups.map((group) => (
                  <section key={group.id} aria-labelledby={`candidate-group-${group.id}`}>
                    <div className="border-b border-slate-200 bg-white px-4 py-2.5 md:px-5">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 id={`candidate-group-${group.id}`} className="text-[11px] font-extrabold uppercase tracking-wide text-slate-700">{group.title}</h4>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">{group.candidates.length}</span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-slate-500">{group.description}</p>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {group.candidates.map((candidate) => {
                        const manuallyRequested = manualIncludedIds.has(candidate.product.id);
                        // Planner overrides win: any live, executable product can be added regardless of
                        // budget, flight, or readiness minimums. Those stay visible as warnings below.
                        const canAdd = candidate.product.digitalRemedyExecutable && candidate.product.recommendationEligible && candidate.product.status === 'live';
                        const displayedStatus = displayRecommendationStatus(candidate.status);
                        const detailsId = `media-type-details-${candidate.product.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
                        const constraintReason = [...candidate.eligibilityFailures, ...candidate.prerequisites].join(' • ');
                        const reason = manuallyRequested
                          ? 'Manual inclusion is requested; the plan is being recalculated to fund it.'
                          : constraintReason
                              ? constraintReason
                              : displayedStatus === 'ADD'
                                ? 'Qualified recommendation omitted because the optimizer favored a higher-value feasible mix within the current portfolio constraints.'
                                : displayedStatus === 'TEST'
                                  ? 'Promising test opportunity omitted from the automatic portfolio pending stronger fit or readiness.'
                                  : 'The score did not clear the current recommendation threshold.';
                        return (
                          <article key={candidate.product.id} className="px-4 py-3 md:px-5 md:py-4">
                            <div className="flex items-start gap-2">
                              <button
                                type="button"
                                onClick={() => toggleChannelDetails(candidate.product.id)}
                                aria-expanded={expandedChannels.has(candidate.product.id)}
                                aria-controls={detailsId}
                                className="flex min-w-0 flex-1 flex-col gap-3 rounded-xl p-1 text-left hover:bg-slate-50 md:flex-row md:items-start md:justify-between"
                              >
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <h5 className="font-extrabold text-slate-900">{candidate.product.displayName}</h5>
                                    {internalOnly.channelStatusTag && (
                                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${displayedStatus === 'ADD' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : displayedStatus === 'TEST' ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>{displayedStatus}</span>
                                    )}
                                    {displayedStatus === 'ADD' && candidate.eligibilityFailures.length === 0 && (
                                      <span className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-700"><Sparkles className="h-3 w-3" />ScoutAI Recommended Alternative</span>
                                    )}
                                    {displayedStatus === 'TEST' && (
                                      <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-800"><Sparkles className="h-3 w-3" />ScoutAI Test Opportunity</span>
                                    )}
                                    {internalOnly.channelConfidenceBadge && (
                                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-bold capitalize text-slate-600">{candidate.confidence} confidence</span>
                                    )}
                                    {manuallyRequested && <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-700">Manual request pending</span>}
                                  </div>
                                  <p className="mt-1 text-xs font-semibold text-slate-500">Role: {candidate.product.funnelRoles.join(' / ')}</p>
                                  <p className="mt-1 text-xs leading-5 text-slate-600">{reason}</p>
                                </div>
                                <div className="flex shrink-0 items-center gap-3">
                                  <div className={`min-w-[72px] rounded-lg border px-2.5 py-1.5 text-center ${getRecommendationScoreBg(candidate.recommendationScore)}`}>
                                    <div className="text-[10px] font-bold uppercase tracking-wider opacity-75">Score</div>
                                    <div className="font-extrabold leading-tight">{candidate.recommendationScore}<span className="text-[10px] font-semibold opacity-90">/100</span></div>
                                  </div>
                                  <ChevronDown className={`h-5 w-5 text-slate-400 transition-transform ${expandedChannels.has(candidate.product.id) ? 'rotate-180' : ''}`} />
                                </div>
                              </button>
                              <button
                                type="button"
                                onClick={() => updateManualMediaType(candidate.product.id, manuallyRequested ? 'remove' : 'add')}
                                disabled={!onManualMediaTypeChange || pendingChannelId !== null || (!manuallyRequested && !canAdd)}
                                className={`mt-1 inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border px-2.5 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-35 ${manuallyRequested ? 'border-rose-200 text-rose-600 hover:bg-rose-50' : 'border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100'}`}
                                aria-label={`${manuallyRequested ? 'Remove' : 'Add'} ${candidate.product.displayName} ${manuallyRequested ? 'from' : 'to'} plan`}
                                title={manuallyRequested ? 'Cancel this manual inclusion' : canAdd ? 'Add this media type and rebalance the fixed budget' : 'This product is not currently executable and cannot be added'}
                              >
                                {pendingChannelId === candidate.product.id ? <Loader2 className="h-4 w-4 animate-spin" /> : manuallyRequested ? <><Minus className="h-4 w-4" /><span>Cancel</span></> : <><Plus className="h-4 w-4" /><span className="hidden sm:inline">Add &amp; rebalance</span></>}
                              </button>
                            </div>

                            {expandedChannels.has(candidate.product.id) && (
                              <MediaTypeDetails
                                detailsId={detailsId}
                                gapAddressed={candidate.gapAddressed}
                                planningRationale={candidate.allocationRationale}
                                activationGuidance={candidate.activationGuidance}
                                measurementApproach={candidate.measurementApproach}
                                targetingTactics={candidate.targetingTactics || []}
                                publishers={resolvePublishers(candidate.product.id, candidate.product.displayName, candidate.product.legacyCanonicalId, candidate.publishers)}
                                creativeEnhancements={candidate.creativeEnhancements || []}
                                inventoryControls={candidate.inventoryControls || []}
                                measurementCapabilities={candidate.measurementCapabilities || []}
                                evidence={candidate.evidence}
                                scoreComponents={candidate.components}
                                decisionRule={candidate.decisionRule}
                                prerequisites={candidate.prerequisites}
                                tradeoffs={candidate.tradeoffs}
                                eligibilityFailures={candidate.eligibilityFailures}
                                minimumAllocationPercent={candidate.product.minimumAllocationPercent}
                                maximumAllocationPercent={candidate.product.maximumAllocationPercent}
                                minimumTotalSpend={candidate.product.minimumTotalSpend}
                                minimumFlightDays={candidate.product.minimumFlightDays}
                                typicalCpmLow={candidate.product.typicalCpmLow}
                                typicalCpmHigh={candidate.product.typicalCpmHigh}
                                isPreview
                              />
                            )}
                          </article>
                        );
                      })}
                    </div>
                  </section>
                ))}
                {candidateGroups.length === 0 && <div className="px-5 py-6 text-sm text-slate-600">Every evaluated media type is already represented in the plan.</div>}
              </div>
            </div>
          )}

          {mediaPlan.nonMediaCosts.length > 0 && (
            <details className="rounded-xl border border-slate-200 bg-white">
              <summary className="cursor-pointer px-4 py-3 text-sm font-bold text-slate-800">Non-media costs kept outside channel allocation</summary>
              <div className="border-t border-slate-100 p-4 text-xs">
                {mediaPlan.nonMediaCosts.map((cost) => <div key={cost.id} className="flex justify-between border-b border-slate-100 py-2"><span>{cost.displayName}</span><span className="font-bold">${cost.amount.toLocaleString()}</span></div>)}
              </div>
            </details>
          )}
        </div>
      )}

      {/* Intro Context Callout (Shown when RFP channels exist) */}
      {data.rfpChannels && data.rfpChannels.length > 0 && (
        <div className="mt-6 text-slate-700 text-sm md:text-base font-medium leading-relaxed bg-slate-50/80 p-4 rounded-xl border border-slate-200/60">
          Your brief includes <span className="font-semibold text-slate-900">{rfpChannelNames || 'existing RFP channels'}</span>.{' '}
          <span className="text-indigo-700 font-bold">ScoutAI</span> identified{' '}
          <span className="font-semibold text-slate-900">{data.scoutAiRecommendedChannels?.length || 0} additional programmatic channel(s)</span>{' '}
          that complement your plan based on total budget tier (${data.totalRfpBudget?.toLocaleString() || 0}).
        </div>
      )}

      {/* SECTION 1: RFP CHANNELS CARD */}
      {data.rfpChannels && data.rfpChannels.length > 0 && (
        <div className="mt-8 relative border-2 border-slate-800 rounded-2xl overflow-hidden bg-white shadow-sm">
          {/* RFP Badge Header */}
          <div className="bg-slate-900 text-white text-xs font-bold font-mono tracking-widest uppercase py-1.5 px-4 text-center flex items-center justify-center gap-2">
            <span className="bg-slate-800 px-2 py-0.5 rounded border border-slate-700">RFP</span>
            <span>Baseline RFP Channels</span>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs md:text-sm border-collapse">
              <thead>
                <tr className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200">
                  <th className="py-3 px-4 w-[18%]">Channel</th>
                  <th className="py-3 px-3 w-[10%] text-center">Score</th>
                  <th className="py-3 px-3 w-[10%] text-center">Audience Fit</th>
                  <th className="py-3 px-3 w-[10%] text-center">Goal Match</th>
                  <th className="py-3 px-4 w-[28%]">Media Consumption Evidence</th>
                  <th className="py-3 px-4 w-[24%]">Why It Earns A Spot</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-sans">
                {data.rfpChannels.map((item, idx) => {
                  const nonMedia = isNonMediaItem(item.canonicalId) || isNonMediaItem(item.channelName) || item.score === 0;
                  return (
                    <tr key={idx} className="hover:bg-slate-50/60 transition-colors">
                      <td className="py-3.5 px-4 font-semibold text-slate-900">
                        <div>{item.channelName}</div>
                        {nonMedia && (
                          <div className="inline-block text-[10px] font-semibold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200 mt-1">
                            Added Value / Non-Media
                          </div>
                        )}
                      </td>
                      <td className="py-3.5 px-3 text-center">
                        {nonMedia ? (
                          <span className="inline-block text-xs font-semibold text-slate-600 bg-slate-100 px-2 py-1 rounded border border-slate-200">
                            N/A
                          </span>
                        ) : (
                          <span className={`text-base font-extrabold ${getScoreColor(item.score)}`}>
                            {item.score.toFixed(1)}
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-3 text-center text-slate-600 font-medium">
                        {nonMedia ? <span className="text-slate-400 font-normal">N/A</span> : `${item.audienceFit}/10`}
                      </td>
                      <td className="py-3.5 px-3 text-center text-slate-600 font-medium">
                        {nonMedia ? <span className="text-slate-400 font-normal">N/A</span> : `${item.goalMatch}/10`}
                      </td>
                      <td className="py-3.5 px-4 text-slate-700 leading-normal text-xs md:text-sm">
                        {item.mediaConsumptionEvidence}
                      </td>
                      <td className="py-3.5 px-4 text-slate-700 leading-normal text-xs md:text-sm">
                        {item.whyItEarnsASpot}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SECTION 2: SCOUTAI RECOMMENDED CHANNELS CARD (Shown when RFP channels baseline exists) */}
      {data.rfpChannels && data.rfpChannels.length > 0 && data.scoutAiRecommendedChannels && data.scoutAiRecommendedChannels.length > 0 && (
        <div className="mt-8 relative border-2 border-indigo-500 rounded-2xl overflow-hidden bg-white shadow-md">
          {/* ScoutAI Badge Header */}
          <div className="bg-gradient-to-r from-indigo-700 via-indigo-600 to-indigo-800 text-white text-xs font-bold font-mono tracking-widest uppercase py-1.5 px-4 text-center flex items-center justify-center gap-2">
            <Sparkles className="w-4 h-4 text-indigo-200" />
            <span>ScoutAI Recommended Additional Channels</span>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs md:text-sm border-collapse">
              <thead>
                <tr className="bg-indigo-50/60 text-indigo-950 font-semibold border-b border-indigo-100">
                  <th className="py-3 px-4 w-[18%]">Channel</th>
                  <th className="py-3 px-3 w-[10%] text-center">Score</th>
                  <th className="py-3 px-3 w-[10%] text-center">Audience Fit</th>
                  <th className="py-3 px-3 w-[10%] text-center">Goal Match</th>
                  <th className="py-3 px-4 w-[28%]">Media Consumption Evidence</th>
                  <th className="py-3 px-4 w-[24%]">Why It Earns A Spot</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-indigo-50 font-sans">
                {data.scoutAiRecommendedChannels.map((item, idx) => (
                  <tr key={idx} className="hover:bg-indigo-50/30 transition-colors">
                    <td className="py-3.5 px-4">
                      <div className="font-bold text-slate-900 text-sm">{item.channelName}</div>
                      <div className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200 mt-1">
                        + Recommended
                      </div>
                    </td>
                    <td className="py-3.5 px-3 text-center">
                      <span className={`text-base font-extrabold ${getScoreColor(item.score)}`}>
                        {item.score.toFixed(1)}
                      </span>
                    </td>
                    <td className="py-3.5 px-3 text-center text-slate-600 font-medium">
                      {item.audienceFit}/10
                    </td>
                    <td className="py-3.5 px-3 text-center text-slate-600 font-medium">
                      {item.goalMatch}/10
                    </td>
                    <td className="py-3.5 px-4 text-slate-700 leading-normal text-xs md:text-sm">
                      {item.mediaConsumptionEvidence}
                    </td>
                    <td className="py-3.5 px-4 text-slate-700 leading-normal text-xs md:text-sm">
                      {item.whyItEarnsASpot}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* BOTTOM EXECUTIVE INSIGHT BANNER */}
      <div className="mt-6 bg-gradient-to-r from-slate-900 to-indigo-950 text-white p-4 md:p-5 rounded-xl shadow-sm flex items-start gap-3 border border-indigo-500/30">
        <div className="p-2 bg-indigo-500/20 rounded-lg text-indigo-300 shrink-0 mt-0.5">
          <Sparkles className="w-5 h-5" />
        </div>
        <div className="text-xs md:text-sm leading-relaxed">
          <span className="font-bold text-indigo-300 mr-2">ScoutAI Insight:</span>
          {data.executiveInsight}
        </div>
      </div>
    </div>
  );
};
