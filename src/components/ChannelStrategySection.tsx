import React, { useState } from 'react';
import { Sparkles, Copy, Check, Info, ArrowLeftRight, Layers, HelpCircle, FileText, DollarSign, CalendarDays, Gauge, ShieldCheck, Plus, Minus, ChevronDown, SlidersHorizontal, Trash2, Loader2, Edit3, Lock, Unlock, RotateCcw, Save, X, Undo2, Download, Upload } from 'lucide-react';
import { RowActionsMenu } from './RowActionsMenu';
import { ChannelStrategyData, CtvPublisherRecommendation, ChannelPanelOverride, ChannelOverridesMap } from '../types';
import { EditableDetailCard } from './EditableDetailCard';
import { SectionVisibilityButton } from './SectionVisibilityButton';
import type { AttachedPlanningRecord, CandidateScoreComponents } from '../planning/types';
import type { ProposalChange } from '../assistant/operations';
import {
  allocationBasisPoints,
  applyBasisPointAllocations,
  rebalanceBasisPoints,
  rebalanceEditedAllocation,
  type AllocationBasisPoints,
} from '../planning/manualAllocations';

export { isCtvOrPerformanceTvChannel } from '../planning/ctvChannel';
import { isCtvOrPerformanceTvChannel } from '../planning/ctvChannel';
import { buildAllocationView, type AllocationRow, type ChannelSource } from '../planning/allocationRows';
import { PlanAlignmentPanel } from './PlanAlignmentPanel';
import type { PlanAlignment } from '../planning/planAlignment';
import { BUDGET_STRATEGY_LABELS, modeNeedsAdditionalBudget, normalizeBudgetStrategyMode, type BudgetStrategyMode } from '../planning/budgetStrategy';
import { parseCurrencyInput } from '../planning/settings';
import { BudgetStrategyControl } from './BudgetStrategyControl';

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
  /** Re-plans with a new budget approach; rejects with a message the section shows. */
  onChangeBudgetStrategy?: (mode: BudgetStrategyMode, additionalBudget: number) => Promise<void>;
  /** Opens the upload review for a media plan on this finished plan (src/components/PlanUploadModal.tsx). */
  onUploadMediaPlan?: () => void;
  /** Whether the written content matches the channel plan, and a rewrite in progress or failed. */
  contentStatus?: { outOfDate: boolean; running: boolean; error: string | null };
  onRefreshContent?: () => void;
  /** "How this plan reaches your audience", built by the app from the personas and narrative (planAlignment). */
  alignment?: PlanAlignment | null;
  /** The settings' budget tiers: most media types a budget allows over this plan's flight. */
  mediaTypeCapFor?: (budget: number) => number;
  onManualMediaTypeChange?: (channelId: string, action: 'add' | 'remove') => Promise<void>;
  onSaveAllocations?: (basisPoints: AllocationBasisPoints, lockedChannelIds: string[], newBudget?: number) => Promise<void>;
  onResetAllocations?: () => Promise<void>;
  onUndoPlanChange?: () => void;
  canUndoPlanChange?: boolean;
  onOpenSlideStudio?: () => void;
  readOnly?: boolean;
  onUpdateChannelOverrides?: (overrides: ChannelOverridesMap) => void;
  isInactive?: boolean;
  onToggleActive?: (inactive: boolean) => void;
  /** A ScoutAI proposal being previewed: its channel changes are highlighted on the plan, unsaved. */
  scoutPreview?: ProposalChange[] | null;
}

export interface InternalOnlyVisibility {
  channelAllocationColumn: boolean;
  channelDollarsColumn: boolean;
  channelScoreColumn: boolean;
  channelFitScores?: boolean;
  channelEvidence?: boolean;
  channelRecommendationsNotInPlan?: boolean;
  channelUploadedLineItems?: boolean;
  channelLinePricing?: boolean;
  planAlignment?: boolean;
  channelConfidenceBadge: boolean;
  channelStatusTag: boolean;
  planningAssumptions?: boolean;
  qaAudit?: boolean;
  reachCalculationDetails?: boolean;
}

export const ALL_INTERNAL_VISIBLE: InternalOnlyVisibility = {
  channelAllocationColumn: true,
  channelDollarsColumn: true,
  channelScoreColumn: true,
  channelFitScores: true,
  channelEvidence: true,
  channelRecommendationsNotInPlan: true,
  channelUploadedLineItems: true,
  channelLinePricing: true,
  planAlignment: true,
  channelConfidenceBadge: true,
  channelStatusTag: true,
  planningAssumptions: true,
  qaAudit: true,
  reachCalculationDetails: true,
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

const allocationPercentInputId = (channelId: string) => `allocation-percent-${channelId.replace(/[^a-zA-Z0-9_-]/g, '-')}`;

interface MediaTypeDetailsProps {
  channelId?: string;
  overrides?: ChannelPanelOverride;
  onUpdateOverride?: (channelId: string, override: ChannelPanelOverride) => void;
  readOnly?: boolean;
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
  /** False when ScoutAI did not assess this product; its formula scores and stock text are then withheld. */
  aiAssessed?: boolean;
}

const planningRecordNames = (records: AttachedPlanningRecord[] | undefined, fallback: string) =>
  records?.map((item) => item.displayName).join(', ') || fallback;

export const MediaTypeDetails: React.FC<MediaTypeDetailsProps> = ({
  channelId,
  overrides,
  onUpdateOverride,
  readOnly = false,
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
  aiAssessed = true,
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

  const hiddenPanels = overrides?.hiddenPanels || [];
  const fieldEdits = overrides?.fieldEdits || {};
  const hasAnyOverrides = Boolean(
    (overrides?.hiddenPanels && overrides.hiddenPanels.length > 0) ||
    (overrides?.fieldEdits && Object.keys(overrides.fieldEdits).length > 0)
  );

  const handleTogglePanel = (panelKey: string, inactive: boolean) => {
    if (!onUpdateOverride || !channelId) return;
    const nextHidden = inactive
      ? Array.from(new Set([...hiddenPanels, panelKey]))
      : hiddenPanels.filter((p) => p !== panelKey);
    onUpdateOverride(channelId, {
      ...overrides,
      hiddenPanels: nextHidden,
    });
  };

  const handleSavePanel = (panelKey: string, title: string, content: string) => {
    if (!onUpdateOverride || !channelId) return;
    onUpdateOverride(channelId, {
      ...overrides,
      fieldEdits: {
        ...fieldEdits,
        [panelKey]: { title, content },
      },
    });
  };

  const handleResetPanel = (panelKey: string) => {
    if (!onUpdateOverride || !channelId) return;
    const nextEdits = { ...fieldEdits };
    delete nextEdits[panelKey];
    const nextHidden = hiddenPanels.filter((p) => p !== panelKey);
    onUpdateOverride(channelId, {
      ...overrides,
      fieldEdits: nextEdits,
      hiddenPanels: nextHidden,
    });
  };

  const handleResetAllChannelPanels = () => {
    if (!onUpdateOverride || !channelId) return;
    onUpdateOverride(channelId, {
      ...overrides,
      fieldEdits: {},
      hiddenPanels: [],
    });
  };

  return (
    <div id={detailsId} className="mt-4 border-t border-slate-100 pt-4">
      {isPreview && (
        <div className="mb-3 rounded-xl border border-indigo-100 bg-indigo-50/70 px-3 py-2 text-xs text-indigo-900">
          This is a planning-stack preview. Final allocation dollars and the surrounding media mix are recalculated only after this media type is added.
        </div>
      )}

      {!aiAssessed && (
        <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          Not assessed by ScoutAI{eligibilityFailures.length > 0 ? ` - not eligible: ${eligibilityFailures.join(' ')}` : '.'}
        </div>
      )}

      <div className="grid gap-3 text-xs md:grid-cols-2">
        {aiAssessed && (gapAddressed || fieldEdits['gapAddressed'] || !readOnly) && (
          <EditableDetailCard
            panelKey="gapAddressed"
            defaultTitle="Gap addressed"
            defaultContent={gapAddressed}
            titleOverride={fieldEdits['gapAddressed']?.title}
            contentOverride={fieldEdits['gapAddressed']?.content}
            isInactive={hiddenPanels.includes('gapAddressed')}
            readOnly={readOnly}
            onToggleActive={(inactive) => handleTogglePanel('gapAddressed', inactive)}
            onSave={(title, content) => handleSavePanel('gapAddressed', title, content)}
            onReset={() => handleResetPanel('gapAddressed')}
            hasOverride={Boolean(fieldEdits['gapAddressed'] || hiddenPanels.includes('gapAddressed'))}
          />
        )}

        {aiAssessed && (planningRationale || fieldEdits['planningRationale'] || !readOnly) && (
          <EditableDetailCard
            panelKey="planningRationale"
            defaultTitle="Planning rationale"
            defaultContent={planningRationale}
            titleOverride={fieldEdits['planningRationale']?.title}
            contentOverride={fieldEdits['planningRationale']?.content}
            isInactive={hiddenPanels.includes('planningRationale')}
            readOnly={readOnly}
            onToggleActive={(inactive) => handleTogglePanel('planningRationale', inactive)}
            onSave={(title, content) => handleSavePanel('planningRationale', title, content)}
            onReset={() => handleResetPanel('planningRationale')}
            hasOverride={Boolean(fieldEdits['planningRationale'] || hiddenPanels.includes('planningRationale'))}
          />
        )}

        {aiAssessed && (activationGuidance || fieldEdits['activationGuidance'] || !readOnly) && (
          <EditableDetailCard
            panelKey="activationGuidance"
            defaultTitle="Activation guidance"
            defaultContent={activationGuidance}
            titleOverride={fieldEdits['activationGuidance']?.title}
            contentOverride={fieldEdits['activationGuidance']?.content}
            isInactive={hiddenPanels.includes('activationGuidance')}
            readOnly={readOnly}
            onToggleActive={(inactive) => handleTogglePanel('activationGuidance', inactive)}
            onSave={(title, content) => handleSavePanel('activationGuidance', title, content)}
            onReset={() => handleResetPanel('activationGuidance')}
            hasOverride={Boolean(fieldEdits['activationGuidance'] || hiddenPanels.includes('activationGuidance'))}
          />
        )}

        <EditableDetailCard
          panelKey="targetingTactics"
          defaultTitle="Targeting tactics"
          defaultContent={planningRecordNames(targetingTactics, 'None specified.')}
          titleOverride={fieldEdits['targetingTactics']?.title}
          contentOverride={fieldEdits['targetingTactics']?.content}
          isInactive={hiddenPanels.includes('targetingTactics')}
          readOnly={readOnly}
          onToggleActive={(inactive) => handleTogglePanel('targetingTactics', inactive)}
          onSave={(title, content) => handleSavePanel('targetingTactics', title, content)}
          onReset={() => handleResetPanel('targetingTactics')}
          hasOverride={Boolean(fieldEdits['targetingTactics'] || hiddenPanels.includes('targetingTactics'))}
        />

        <EditableDetailCard
          panelKey="publishers"
          defaultTitle="Publishers"
          defaultContent={publishers && publishers.length > 0 ? publishers.map((p) => p.displayName).join(', ') : 'None specified.'}
          titleOverride={fieldEdits['publishers']?.title}
          contentOverride={fieldEdits['publishers']?.content}
          isInactive={hiddenPanels.includes('publishers')}
          readOnly={readOnly}
          onToggleActive={(inactive) => handleTogglePanel('publishers', inactive)}
          onSave={(title, content) => handleSavePanel('publishers', title, content)}
          onReset={() => handleResetPanel('publishers')}
          hasOverride={Boolean(fieldEdits['publishers'] || hiddenPanels.includes('publishers'))}
          customView={
            publishers && publishers.length > 0 ? (
              publishers.map((item, idx) => (
                <span key={item.id || idx} title={item.rationale || undefined}>
                  {item.displayName}{idx < publishers.length - 1 ? ', ' : ''}
                </span>
              ))
            ) : (
              'None specified.'
            )
          }
        />

        <EditableDetailCard
          panelKey="creativeEnhancements"
          defaultTitle="Creative enhancements"
          defaultContent={planningRecordNames(creativeEnhancements, 'None suggested.')}
          titleOverride={fieldEdits['creativeEnhancements']?.title}
          contentOverride={fieldEdits['creativeEnhancements']?.content}
          isInactive={hiddenPanels.includes('creativeEnhancements')}
          readOnly={readOnly}
          onToggleActive={(inactive) => handleTogglePanel('creativeEnhancements', inactive)}
          onSave={(title, content) => handleSavePanel('creativeEnhancements', title, content)}
          onReset={() => handleResetPanel('creativeEnhancements')}
          hasOverride={Boolean(fieldEdits['creativeEnhancements'] || hiddenPanels.includes('creativeEnhancements'))}
        />

        <EditableDetailCard
          panelKey="inventoryControls"
          defaultTitle="Inventory controls"
          defaultContent={planningRecordNames(inventoryControls, 'None specified.')}
          titleOverride={fieldEdits['inventoryControls']?.title}
          contentOverride={fieldEdits['inventoryControls']?.content}
          isInactive={hiddenPanels.includes('inventoryControls')}
          readOnly={readOnly}
          onToggleActive={(inactive) => handleTogglePanel('inventoryControls', inactive)}
          onSave={(title, content) => handleSavePanel('inventoryControls', title, content)}
          onReset={() => handleResetPanel('inventoryControls')}
          hasOverride={Boolean(fieldEdits['inventoryControls'] || hiddenPanels.includes('inventoryControls'))}
        />

        {aiAssessed && (measurementApproach || fieldEdits['measurementApproach'] || !readOnly) && (
          <EditableDetailCard
            panelKey="measurementApproach"
            defaultTitle="Measurement approach"
            defaultContent={measurementApproach}
            titleOverride={fieldEdits['measurementApproach']?.title}
            contentOverride={fieldEdits['measurementApproach']?.content}
            isInactive={hiddenPanels.includes('measurementApproach')}
            readOnly={readOnly}
            onToggleActive={(inactive) => handleTogglePanel('measurementApproach', inactive)}
            onSave={(title, content) => handleSavePanel('measurementApproach', title, content)}
            onReset={() => handleResetPanel('measurementApproach')}
            hasOverride={Boolean(fieldEdits['measurementApproach'] || hiddenPanels.includes('measurementApproach'))}
          />
        )}

        <EditableDetailCard
          panelKey="measurementCapabilities"
          defaultTitle="Measurement capabilities"
          defaultContent={planningRecordNames(measurementCapabilities, 'None specified.')}
          titleOverride={fieldEdits['measurementCapabilities']?.title}
          contentOverride={fieldEdits['measurementCapabilities']?.content}
          isInactive={hiddenPanels.includes('measurementCapabilities')}
          readOnly={readOnly}
          onToggleActive={(inactive) => handleTogglePanel('measurementCapabilities', inactive)}
          onSave={(title, content) => handleSavePanel('measurementCapabilities', title, content)}
          onReset={() => handleResetPanel('measurementCapabilities')}
          hasOverride={Boolean(fieldEdits['measurementCapabilities'] || hiddenPanels.includes('measurementCapabilities'))}
        />

        <EditableDetailCard
          panelKey="evidence"
          defaultTitle="Evidence"
          defaultContent={evidence.slice(0, 2).map((item) => item.detail).join(' ') || 'No additional evidence was supplied.'}
          titleOverride={fieldEdits['evidence']?.title}
          contentOverride={fieldEdits['evidence']?.content}
          isInactive={hiddenPanels.includes('evidence')}
          readOnly={readOnly}
          onToggleActive={(inactive) => handleTogglePanel('evidence', inactive)}
          onSave={(title, content) => handleSavePanel('evidence', title, content)}
          onReset={() => handleResetPanel('evidence')}
          hasOverride={Boolean(fieldEdits['evidence'] || hiddenPanels.includes('evidence'))}
        />

        {aiAssessed && (decisionRule || fieldEdits['decisionRule'] || !readOnly) && (
          <EditableDetailCard
            panelKey="decisionRule"
            defaultTitle="Decision rule"
            defaultContent={decisionRule}
            titleOverride={fieldEdits['decisionRule']?.title}
            contentOverride={fieldEdits['decisionRule']?.content}
            isInactive={hiddenPanels.includes('decisionRule')}
            readOnly={readOnly}
            fullWidth
            onToggleActive={(inactive) => handleTogglePanel('decisionRule', inactive)}
            onSave={(title, content) => handleSavePanel('decisionRule', title, content)}
            onReset={() => handleResetPanel('decisionRule')}
            hasOverride={Boolean(fieldEdits['decisionRule'] || hiddenPanels.includes('decisionRule'))}
          />
        )}
      </div>

      {!readOnly && hasAnyOverrides && (
        <div className="mt-2.5 flex items-center justify-end">
          <button
            type="button"
            onClick={handleResetAllChannelPanels}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors"
          >
            <RotateCcw className="h-3 w-3" />
            Reset all card edits for this channel
          </button>
        </div>
      )}

      {aiAssessed && scoreComponents && (
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
        <span className="rounded-md border border-slate-200 px-2 py-1">Recommended {Math.ceil(minimumAllocationPercent)}–{Math.floor(maximumAllocationPercent)}%</span>
        <span className="rounded-md border border-slate-200 px-2 py-1">Recommended min spend ${minimumTotalSpend.toLocaleString()}</span>
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
  onChangeBudgetStrategy,
  onUploadMediaPlan,
  contentStatus,
  onRefreshContent,
  alignment,
  mediaTypeCapFor,
  onManualMediaTypeChange,
  onSaveAllocations,
  onResetAllocations,
  onUndoPlanChange,
  canUndoPlanChange = false,
  onOpenSlideStudio,
  readOnly = false,
  onUpdateChannelOverrides,
  isInactive = false,
  onToggleActive,
  scoutPreview = null,
}) => {
  // One badge per row: an allocation or removal says more than a lock on the same channel.
  const previewByChannel = new Map<string, ProposalChange>();
  (scoutPreview || []).forEach((c) => {
    if (c.channelId && c.kind !== 'channel_added' && !previewByChannel.has(c.channelId)) previewByChannel.set(c.channelId, c);
  });
  const previewAdded = (scoutPreview || []).filter((c) => c.kind === 'channel_added');
  const previewBudget = (scoutPreview || []).find((c) => c.kind === 'budget');
  const previewAnchorRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (scoutPreview?.some((c) => c.channelId || c.kind === 'budget')) previewAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [scoutPreview]);
  const handleUpdateChannelOverride = (channelId: string, override: ChannelPanelOverride) => {
    if (!onUpdateChannelOverrides) return;
    const nextOverrides: ChannelOverridesMap = {
      ...(data.channelOverrides || {}),
      [channelId]: override,
    };
    onUpdateChannelOverrides(nextOverrides);
  };
  // The plan's own AI-selected publishers, or none. There is no canned fallback list: a CTV line
  // with no publishers says so rather than showing a generic Hulu/Disney+/Roku/ESPN set.
  const effectiveCtvPublishers = (ctvPublishers && ctvPublishers.length > 0)
    ? ctvPublishers
    : (data?.ctvPublishers ?? []);

  const resolvePublishers = (
    channelId: string,
    channelName: string,
    canonicalId?: string,
    existingPublishers?: AttachedPlanningRecord[]
  ): AttachedPlanningRecord[] => {
    if (isCtvOrPerformanceTvChannel(channelId, channelName, canonicalId) && effectiveCtvPublishers.length > 0) {
      return effectiveCtvPublishers.map((pub) => ({
        id: `publisher.ctv.${pub.publisher.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
        displayName: pub.publisher,
        rationale: pub.why || '',
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
  const [sourceFilter, setSourceFilter] = useState<'all' | ChannelSource>('all');
  // "Edit allocation" from a row's menu opens the editor on that row's percent field.
  const [editorFocusChannelId, setEditorFocusChannelId] = useState<string | null>(null);
  const savedBudgetMode = normalizeBudgetStrategyMode(data?.budgetStrategyMode);
  const savedAdditionalInput = data?.additionalBudget ? Math.round(data.additionalBudget).toLocaleString() : '';
  const [budgetDraftMode, setBudgetDraftMode] = useState<BudgetStrategyMode>(savedBudgetMode);
  const [budgetDraftInput, setBudgetDraftInput] = useState(savedAdditionalInput);
  const [isApplyingBudget, setIsApplyingBudget] = useState(false);
  const [budgetError, setBudgetError] = useState('');

  React.useEffect(() => {
    setExpandedChannels(new Set());
    setManualUpdateError('');
    setIsEditingAllocations(false);
    setDraftBudget(0);
    setDraftBudgetInput('');
    setAllocationEditorError('');
    setBudgetDraftMode(savedBudgetMode);
    setBudgetDraftInput(savedAdditionalInput);
    setBudgetError('');
  }, [data?.generatedAt]);

  if (!data) return null;
  if (readOnly && isInactive) return null;
  const mediaPlan = data.mediaPlan;
  const view = buildAllocationView(data);
  const rowById = new Map([...view.rfpRows, ...view.addedRows, ...view.rfpNotFunded, ...view.recommendedAdditions].map((row) => [row.channelId, row]));
  const rfpNotFundedIds = new Set(view.rfpNotFunded.map((row) => row.channelId));
  const keptRfpIds = new Set(view.rfpRows.filter((row) => row.keptAtRfp).map((row) => row.channelId));
  const manualIncludedIds = new Set(data.manualIncludedChannelIds || []);
  const selectedChannelIds = new Set(mediaPlan?.channels.map((channel) => channel.channelId) || []);
  // RFP media types the plan does not fund get their own group at the top, and ones kept at
  // their RFP dollars are already rows in the allocation, so neither repeats in the groups below.
  const unselectedCandidates = (mediaPlan?.evaluatedCandidates || [])
    .filter((candidate) => !selectedChannelIds.has(candidate.product.id) && !rfpNotFundedIds.has(candidate.product.id) && !keptRfpIds.has(candidate.product.id))
    .sort((a, b) => {
      const rank = (status: string) => status === 'ADD' ? 0 : displayRecommendationStatus(status) === 'TEST' ? 1 : 2;
      return rank(a.status) - rank(b.status) || b.recommendationScore - a.recommendationScore || a.product.displayName.localeCompare(b.product.displayName);
    });
  const rfpNotFundedCandidates = view.rfpNotFunded
    .map((row) => (mediaPlan?.evaluatedCandidates || []).find((candidate) => candidate.product.id === row.channelId))
    .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate));
  const candidateGroups = [
    {
      id: 'rfp-not-funded',
      title: 'From your RFP, not funded',
      description: 'RFP media types this plan does not fund, and why. Add one back to fund it again.',
      candidates: rfpNotFundedCandidates,
    },
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

  React.useEffect(() => {
    if (!isEditingAllocations || !editorFocusChannelId) return;
    const input = document.getElementById(allocationPercentInputId(editorFocusChannelId)) as HTMLInputElement | null;
    input?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    input?.focus({ preventScroll: true });
    setEditorFocusChannelId(null);
  }, [isEditingAllocations, editorFocusChannelId]);

  const editChannelAllocation = (channelId: string) => {
    if (!isEditingAllocations) startAllocationEditor();
    setEditorFocusChannelId(channelId);
  };

  // A lock from the row menu saves straight away with the allocations unchanged, so it reads the
  // same as locking in the editor and saving; inside the editor it toggles the draft lock instead.
  const toggleChannelLock = async (channelId: string, channelName: string) => {
    if (isEditingAllocations) {
      toggleDraftLock(channelId);
      return;
    }
    if (!onSaveAllocations || !mediaPlan || isSavingAllocations) return;
    const locked = (data.lockedAllocationChannelIds || []).includes(channelId);
    const nextLocked = locked
      ? (data.lockedAllocationChannelIds || []).filter((id) => id !== channelId)
      : [...(data.lockedAllocationChannelIds || []), channelId];
    setIsSavingAllocations(true);
    setManualUpdateError('');
    try {
      await onSaveAllocations(allocationBasisPoints(mediaPlan), nextLocked, mediaPlan.workingMediaBudget);
      setManualUpdateMessage(locked
        ? `${channelName} is unlocked and will rebalance with the other media types.`
        : `${channelName} is locked: rebalancing leaves its allocation as it is.`);
    } catch (error) {
      setManualUpdateError(error instanceof Error ? error.message : 'The lock could not be saved.');
    } finally {
      setIsSavingAllocations(false);
    }
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
    // The channels' minimum spends are recommendations; a smaller budget is the planner's call.
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

  const getRecommendationScoreBg = (score: number) => {
    if (score >= 72) return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    if (score >= 55) return 'bg-amber-50 text-amber-700 border-amber-200';
    return 'bg-rose-50 text-rose-700 border-rose-200';
  };

  const money = (value: number) => `$${Math.round(value).toLocaleString()}`;
  const signedMoney = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${money(Math.abs(value))}`;
  const budgetModeLabel = mediaPlan?.planningMode === 'greenfield' || !view.hasRfp ? 'New Plan' : BUDGET_STRATEGY_LABELS[savedBudgetMode];
  const SOURCE_LABELS: Record<ChannelSource, string> = { rfp: 'RFP baseline', scoutai: 'ScoutAI added', planner: 'Added by you' };

  const handleCopyText = () => {
    const rowLine = (row: AllocationRow) => {
      const money$ = row.dollars !== null ? ` ${money(row.dollars)}` : '';
      const pct = row.percentOfTotal !== null ? ` (${row.percentOfTotal.toFixed(0)}%)` : '';
      const rfp = row.rfpDollars !== null ? ` | RFP ${money(row.rfpDollars)}${row.changeDollars ? `, ${signedMoney(row.changeDollars)}` : ''}` : '';
      const scores = row.score !== null ? ` | Score ${row.score}/100, Audience Fit ${row.audienceFit}/100, Goal Match ${row.goalMatch}/100` : '';
      const label = row.outsideCatalog ? 'Uploaded, outside ScoutAI catalog' : row.keptAtRfp ? 'RFP, kept at RFP budget' : view.asIs && row.source === 'rfp' ? 'Uploaded plan' : SOURCE_LABELS[row.source];
      return `- ${row.channelName} [${label}]${money$}${pct}${rfp}${scores}`
        + `${row.evidence ? `\n  Evidence: ${row.evidence}` : ''}${row.why ? `\n  ${row.whyLabel}: ${row.why}` : ''}`;
    };
    const section = (title: string, rows: AllocationRow[]) => rows.length > 0 ? `\n\n${title}\n${rows.map(rowLine).join('\n')}` : '';
    const text = `CHANNEL ALLOCATION — ${budgetModeLabel}, plan total ${money(view.planTotal)}`
      + (view.hasRfp ? section(view.asIs ? 'Your plan' : 'From your RFP', view.rfpRows) + section('Added to your plan', view.addedRows) : section('Media types', view.addedRows))
      + section('From your RFP, not funded', view.rfpNotFunded)
      + section('Recommended additions', view.recommendedAdditions)
      + `\n\nScoutAI Insight:\n${data.executiveInsight || ''}`;

    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const sourceBadge = (row: AllocationRow) => {
    // Used as is, the uploaded plan is the plan: an "RFP" badge on every row would say nothing.
    if (row.outsideCatalog) return readOnly ? null : <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-bold text-slate-600">Outside ScoutAI catalog</span>;
    if (row.source === 'rfp' && view.asIs) return null;
    if (row.source === 'rfp') return <span className="rounded-full border border-slate-800 bg-slate-900 px-2 py-0.5 text-[10px] font-bold text-white">RFP</span>;
    if (row.source === 'planner') return <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-700">Added by you</span>;
    // On a plan without an RFP every media type is ScoutAI's, so the badge would say nothing.
    if (!view.hasRfp) return null;
    return <span className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-gradient-to-r from-indigo-600 to-indigo-700 px-2 py-0.5 text-[10px] font-bold text-white"><Sparkles className="h-3 w-3" />ScoutAI added</span>;
  };

  const fitScores = (row: AllocationRow) => internalOnly.channelFitScores !== false && row.audienceFit !== null && (
    <div className="mt-1.5 flex flex-wrap gap-1.5 text-[10px] font-bold">
      <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-slate-700">Audience fit {row.audienceFit}/100</span>
      <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-slate-700">Goal match {row.goalMatch}/100</span>
    </div>
  );

  // Side by side under the row's header, full width, so each reads as two short lines instead of
  // four stacked ones. Clamped in the list; the full text shows once the row is expanded.
  const rowReasons = (row: AllocationRow, expanded: boolean) => internalOnly.channelEvidence !== false && (row.evidence || row.why) && (
    <dl className="grid gap-x-6 gap-y-2 text-xs leading-5 text-slate-600 md:grid-cols-2">
      {row.evidence && (
        <div className="min-w-0">
          <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Media consumption evidence</dt>
          <dd className={expanded ? '' : 'line-clamp-2'}>{row.evidence}</dd>
        </div>
      )}
      {row.why && (
        <div className={`min-w-0 ${row.evidence ? '' : 'md:col-start-2'}`}>
          <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{row.whyLabel}</dt>
          <dd className={expanded ? '' : 'line-clamp-2'}>{row.why}</dd>
        </div>
      )}
    </dl>
  );

  // As is, an unchanged row's RFP dollars repeat its dollars; only a planner's edit is worth showing.
  const rfpComparison = (row: AllocationRow) => row.rfpDollars !== null && !(view.asIs && !row.changeDollars) && (
    <div className="mt-0.5 whitespace-nowrap text-[10px] font-semibold text-slate-500">
      RFP {money(row.rfpDollars)}
      {row.changeDollars !== null && row.changeDollars !== 0 && (
        <span className={row.changeDollars > 0 ? 'text-emerald-700' : 'text-rose-700'}> · {signedMoney(row.changeDollars)}</span>
      )}
    </div>
  );

  const rowMetrics = (row: AllocationRow, dollarsLabel?: string) => channelColumnCount > 0 && (
    <div className={`grid gap-3 text-right ${channelColumnGridClass}`}>
      {internalOnly.channelAllocationColumn && (
        <div><div className="text-[10px] font-bold uppercase text-slate-400">Allocation</div><div className="font-extrabold text-indigo-700">{row.percentOfTotal !== null ? `${row.percentOfTotal.toFixed(0)}%` : '—'}</div></div>
      )}
      {internalOnly.channelDollarsColumn && (
        <div>
          <div className="text-[10px] font-bold uppercase text-slate-400">Dollars</div>
          <div className="font-extrabold text-slate-900">{row.dollars !== null ? money(row.dollars) : (dollarsLabel || '—')}</div>
          {rfpComparison(row)}
        </div>
      )}
      {internalOnly.channelScoreColumn && (
        <div><div className="text-[10px] font-bold uppercase text-slate-400">Score</div><div className="font-extrabold text-slate-900">{row.score !== null ? `${row.score}/100` : '—'}</div></div>
      )}
    </div>
  );

  const rowsMatchingFilter = (rows: AllocationRow[]) => sourceFilter === 'all' ? rows : rows.filter((row) => row.source === sourceFilter);
  const allocationGroups = (view.hasRfp
    ? [
        // As is, the uploaded plan needs no heading of its own unless a planner has added to it.
        { id: 'rfp', title: view.asIs ? (view.addedRows.length > 0 ? 'From your plan' : '') : 'From your RFP', rows: rowsMatchingFilter(view.rfpRows) },
        { id: 'added', title: 'Added to your plan', rows: rowsMatchingFilter(view.addedRows) },
      ]
    : [{ id: 'all', title: '', rows: rowsMatchingFilter(view.addedRows) }]
  ).filter((group) => group.rows.length > 0);

  const budgetDraftAdditional = parseCurrencyInput(budgetDraftInput);
  const budgetDraftChanged = budgetDraftMode !== savedBudgetMode
    || (modeNeedsAdditionalBudget(budgetDraftMode) && Math.round(budgetDraftAdditional) !== Math.round(data.additionalBudget || 0));
  const applyBudgetStrategy = async () => {
    if (!onChangeBudgetStrategy || isApplyingBudget) return;
    if (modeNeedsAdditionalBudget(budgetDraftMode) && !(budgetDraftAdditional > 0)) {
      setBudgetError('Enter the additional budget first.');
      return;
    }
    setIsApplyingBudget(true);
    setBudgetError('');
    try {
      await onChangeBudgetStrategy(budgetDraftMode, modeNeedsAdditionalBudget(budgetDraftMode) ? budgetDraftAdditional : 0);
    } catch (error) {
      setBudgetError(error instanceof Error ? error.message : 'The plan could not be re-planned with that budget.');
    } finally {
      setIsApplyingBudget(false);
    }
  };

  const renderAllocatedRow = (channel: NonNullable<typeof mediaPlan>['channels'][number], row: AllocationRow) => {
    const evaluatedCandidate = mediaPlan?.evaluatedCandidates.find((candidate) => candidate.product.id === channel.channelId);
    const detailsId = `media-type-details-${channel.channelId.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
    const preview = previewByChannel.get(channel.channelId);
    const locked = isEditingAllocations
      ? draftLockedChannelIds.includes(channel.channelId)
      : (data.lockedAllocationChannelIds || []).includes(channel.channelId);
    return (
    <article key={channel.channelId} className={`p-4 md:p-5 transition-colors ${preview ? (preview.kind === 'channel_removed' ? 'bg-rose-50/60 ring-1 ring-inset ring-rose-200' : 'bg-indigo-50/50 ring-1 ring-inset ring-indigo-200') : ''}`}>
      {preview && (
        <div className={`mb-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ${preview.kind === 'channel_removed' ? 'bg-rose-100 text-rose-800' : 'bg-indigo-100 text-indigo-800'}`}>
          <Sparkles className="h-3 w-3" />
          {preview.kind === 'channel_removed'
            ? 'ScoutAI would remove this media type'
            : preview.kind === 'channel_detail'
              ? `ScoutAI would change: ${(scoutPreview || []).filter((c) => c.channelId === channel.channelId && c.kind === 'channel_detail').map((c) => c.label.split(' – ').slice(1).join(' – ')).join(', ')}`
            : preview.kind === 'lock'
              ? `ScoutAI: ${preview.before} → ${preview.after}`
              : <>ScoutAI: <span className="font-semibold line-through opacity-60">{preview.before}</span> → {preview.after}</>}
        </div>
      )}
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={() => toggleChannelDetails(channel.channelId)}
          aria-expanded={expandedChannels.has(channel.channelId)}
          aria-controls={detailsId}
          className="flex min-w-0 flex-1 flex-col gap-2 rounded-xl p-1 text-left hover:bg-slate-50"
        >
          <div className="flex w-full flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-extrabold text-slate-900">{channel.channelName}</h3>
              {sourceBadge(row)}
              {internalOnly.channelStatusTag && (
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${channel.status === 'ADD' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>{displayRecommendationStatus(channel.status)}</span>
              )}
              {internalOnly.channelConfidenceBadge && (
                <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-bold capitalize text-slate-600">{channel.confidence} confidence</span>
              )}
              {!readOnly && locked && (
                <span className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-700"><Lock className="h-3 w-3" />Locked</span>
              )}
            </div>
            <p className="mt-1 text-sm text-slate-600">{channel.role}</p>
            {fitScores(row)}
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {rowMetrics(row)}
            <ChevronDown className={`h-5 w-5 shrink-0 text-slate-400 transition-transform ${expandedChannels.has(channel.channelId) ? 'rotate-180' : ''}`} />
          </div>
          </div>
          {rowReasons(row, expandedChannels.has(channel.channelId))}
        </button>
        {!readOnly && (
          <div className="mt-2 shrink-0">
            <RowActionsMenu
              label={`Actions for ${channel.channelName}`}
              busy={pendingChannelId === channel.channelId}
              actions={[
                {
                  id: 'lock',
                  label: locked ? 'Unlock allocation' : 'Lock allocation',
                  icon: locked ? <Unlock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />,
                  onSelect: () => { void toggleChannelLock(channel.channelId, channel.channelName); },
                  disabled: !onSaveAllocations || isSavingAllocations,
                },
                {
                  id: 'edit',
                  label: 'Edit allocation',
                  icon: <SlidersHorizontal className="h-3.5 w-3.5" />,
                  onSelect: () => editChannelAllocation(channel.channelId),
                  disabled: !onSaveAllocations,
                },
                {
                  id: 'remove',
                  label: 'Remove from plan',
                  icon: <Trash2 className="h-3.5 w-3.5" />,
                  danger: true,
                  onSelect: () => { void updateManualMediaType(channel.channelId, 'remove'); },
                  disabled: !onManualMediaTypeChange || pendingChannelId !== null || isEditingAllocations,
                  disabledReason: isEditingAllocations ? 'Save or cancel your allocation edits first.' : undefined,
                },
              ]}
            />
          </div>
        )}
      </div>

      {expandedChannels.has(channel.channelId) && uploadedLines(row)}
      {expandedChannels.has(channel.channelId) && (
        <MediaTypeDetails
          channelId={channel.channelId}
          overrides={data.channelOverrides?.[channel.channelId]}
          onUpdateOverride={handleUpdateChannelOverride}
          readOnly={readOnly}
          detailsId={detailsId}
          gapAddressed={channel.gapAddressed}
          planningRationale={channel.allocationRationale}
          activationGuidance={evaluatedCandidate?.activationGuidance || ''}
          measurementApproach={evaluatedCandidate?.measurementApproach || ''}
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
  };

  // "Add on top of RFP": an RFP media type held at its RFP dollars. It sits outside the allocated
  // budget, so it has no editor, lock or remove control; changing the budget approach moves it.
  // The uploaded plan's own lines behind a row, so the client recognises their plan. Pricing and
  // dollars follow their own switches: an upload can be Digital Remedy's proposal with net rates.
  const uploadedLines = (row: AllocationRow) => {
    if (!row.lines?.length || internalOnly.channelUploadedLineItems === false) return null;
    const showPricing = internalOnly.channelLinePricing !== false && row.lines.some((line) => line.pricing);
    const showDollars = internalOnly.channelDollarsColumn;
    const showAudience = row.lines.some((line) => line.audience);
    const showImpressions = row.lines.some((line) => line.impressions > 0);
    return (
      <div className="mx-1 mt-3 overflow-x-auto rounded-xl border border-slate-200">
        <div className="border-b border-slate-200 bg-slate-50 px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-wide text-slate-600">From your media plan</div>
        <table className="w-full min-w-[480px] text-xs">
          <thead>
            <tr className="text-left text-[10px] font-bold uppercase tracking-wide text-slate-500">
              <th className="px-3 py-1.5">Line</th>
              <th className="px-3 py-1.5">Publisher</th>
              {showAudience && <th className="px-3 py-1.5">Audience</th>}
              {showImpressions && <th className="px-3 py-1.5 text-right">Impressions</th>}
              {showPricing && <th className="px-3 py-1.5">Pricing</th>}
              {showDollars && <th className="px-3 py-1.5 text-right">Dollars</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {row.lines.map((line, index) => (
              <tr key={`${line.label}-${index}`}>
                <td className="px-3 py-1.5 font-semibold text-slate-900">{line.label}</td>
                <td className="px-3 py-1.5 text-slate-700">{line.publisher || '–'}</td>
                {showAudience && <td className="px-3 py-1.5 text-slate-700">{line.audience || '–'}</td>}
                {showImpressions && <td className="px-3 py-1.5 text-right tabular-nums text-slate-700">{line.impressions > 0 ? line.impressions.toLocaleString() : '–'}</td>}
                {showPricing && <td className="px-3 py-1.5 text-slate-700">{line.pricing || '–'}</td>}
                {showDollars && <td className="px-3 py-1.5 text-right font-semibold tabular-nums text-slate-900">{money(line.budget)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  // An uploaded line no catalog media type covers: in the plan at its dollars, with no scores or edits.
  const renderOutsideCatalogRow = (row: AllocationRow) => {
    const expanded = expandedChannels.has(row.channelId);
    const canExpand = Boolean(uploadedLines(row));
    return (
      <article key={row.channelId} className="p-4 md:p-5">
        <button
          type="button"
          onClick={() => toggleChannelDetails(row.channelId)}
          aria-expanded={expanded}
          disabled={!canExpand}
          className="flex w-full flex-col gap-3 rounded-xl p-1 text-left hover:bg-slate-50 disabled:cursor-default disabled:hover:bg-transparent md:flex-row md:items-start md:justify-between"
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-extrabold text-slate-900">{row.channelName}</h3>
              {sourceBadge(row)}
            </div>
            {!readOnly && <p className="mt-1 text-xs text-slate-500">Kept at its uploaded dollars. ScoutAI has no research or scores for media outside its catalog.</p>}
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {rowMetrics(row)}
            {canExpand && <ChevronDown className={`h-5 w-5 shrink-0 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />}
          </div>
        </button>
        {expanded && uploadedLines(row)}
      </article>
    );
  };

  const renderKeptRow = (row: AllocationRow) => {
    const candidate = mediaPlan?.evaluatedCandidates.find((item) => item.product.id === row.channelId);
    const detailsId = `media-type-details-${row.channelId.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
    const expanded = expandedChannels.has(row.channelId);
    return (
      <article key={row.channelId} className="bg-slate-50/50 p-4 md:p-5">
        <button
          type="button"
          onClick={() => toggleChannelDetails(row.channelId)}
          aria-expanded={expanded}
          aria-controls={detailsId}
          disabled={!candidate}
          className="flex w-full min-w-0 flex-col gap-2 rounded-xl p-1 text-left hover:bg-slate-50 disabled:cursor-default"
        >
          <div className="flex w-full flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-extrabold text-slate-900">{row.channelName}</h3>
              {sourceBadge(row)}
              <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-bold text-slate-600"><Lock className="h-3 w-3" />Kept at RFP budget</span>
            </div>
            {candidate && <p className="mt-1 text-sm text-slate-600">{candidate.product.funnelRoles.join(' / ')}</p>}
            {fitScores(row)}
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {rowMetrics(row, 'RFP budget')}
            {candidate && <ChevronDown className={`h-5 w-5 shrink-0 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />}
          </div>
          </div>
          {rowReasons(row, expanded)}
        </button>
        {expanded && uploadedLines(row)}
        {expanded && candidate && (
          <MediaTypeDetails
            channelId={candidate.product.id}
            overrides={data.channelOverrides?.[candidate.product.id]}
            onUpdateOverride={handleUpdateChannelOverride}
            readOnly={readOnly}
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
            aiAssessed={candidate.aiAssessed !== false}
            decisionRule={candidate.decisionRule}
            prerequisites={candidate.prerequisites}
            tradeoffs={candidate.tradeoffs}
            minimumAllocationPercent={candidate.product.minimumAllocationPercent}
            maximumAllocationPercent={candidate.product.maximumAllocationPercent}
            minimumTotalSpend={candidate.product.minimumTotalSpend}
            minimumFlightDays={candidate.product.minimumFlightDays}
            typicalCpmLow={candidate.product.typicalCpmLow}
            typicalCpmHigh={candidate.product.typicalCpmHigh}
          />
        )}
      </article>
    );
  };

  return (
    <div
      className={`group relative rounded-2xl border p-6 md:p-8 my-8 font-sans transition-all ${
        isInactive
          ? 'border-dashed border-slate-300 bg-slate-100/70 opacity-40 hover:opacity-70'
          : 'border-slate-200 bg-white shadow-sm'
      }`}
    >
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
          {!readOnly && onToggleActive && (
            <SectionVisibilityButton
              sectionKey="channels"
              isInactive={isInactive}
              onToggle={(_, inactive) => onToggleActive(inactive)}
            />
          )}

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
              { label: 'Budget', value: money(view.planTotal), icon: DollarSign },
              { label: 'Flight', value: mediaPlan.flightDays ? `${mediaPlan.flightDays} days` : 'Not supplied', icon: CalendarDays },
              // The plan total, so "Add on top of RFP" normalizes the RFP dollars too, not just the additional budget.
              { label: '30-day normalized', value: money(mediaPlan.flightDays ? (view.planTotal / mediaPlan.flightDays) * 30 : view.planTotal), icon: Gauge },
              { label: 'Budget approach', value: budgetModeLabel, icon: ArrowLeftRight },
            ].map(({ label, value, icon: Icon }) => (
              <div key={label} className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-500"><Icon className="h-3.5 w-3.5" />{label}</div>
                <div className="mt-1 text-sm font-extrabold text-slate-900">{value}</div>
              </div>
            ))}
          </div>

          {internalOnly.planningAssumptions && mediaPlan.assumptions.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
              <div className="mb-1 flex items-center gap-2 font-bold"><Info className="h-4 w-4" /> Planning assumptions</div>
              <ul className="list-disc space-y-1 pl-5">{mediaPlan.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}</ul>
            </div>
          )}

          {!readOnly && onUploadMediaPlan && (
            <div className="flex flex-col gap-3 rounded-2xl border border-dashed border-indigo-200 bg-indigo-50/40 p-4 sm:flex-row sm:items-center sm:justify-between md:px-5">
              <div>
                <h3 className="text-sm font-extrabold text-slate-900">{view.hasRfp ? 'Replace the uploaded media plan' : 'Have the client\'s media plan?'}</h3>
                <p className="mt-0.5 text-xs text-slate-600">Upload it to use it as is, or as the baseline ScoutAI recommends additions to. You review every change before it is applied.</p>
              </div>
              <button
                type="button"
                onClick={onUploadMediaPlan}
                className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-lg border border-indigo-200 bg-white px-3 py-2 text-xs font-bold text-indigo-700 hover:bg-indigo-50 sm:self-auto"
              >
                <Upload className="h-3.5 w-3.5" /> Upload media plan
              </button>
            </div>
          )}

          {!readOnly && contentStatus && (contentStatus.running || contentStatus.error || contentStatus.outOfDate) && (
            <div
              role="status"
              className={`flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between md:px-5 ${contentStatus.error ? 'border-rose-200 bg-rose-50' : 'border-amber-200 bg-amber-50'}`}
            >
              <div className="flex items-start gap-2 text-xs">
                {contentStatus.running ? <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-amber-700" /> : <Info className={`mt-0.5 h-4 w-4 shrink-0 ${contentStatus.error ? 'text-rose-600' : 'text-amber-700'}`} />}
                <div className={contentStatus.error ? 'text-rose-800' : 'text-amber-900'}>
                  <div className="font-bold">
                    {contentStatus.running ? 'Rewriting the plan for these channels…' : contentStatus.error ? 'The plan\'s content could not be rewritten' : 'The plan\'s content was written for a different channel mix'}
                  </div>
                  <div className="mt-0.5">
                    {contentStatus.running
                      ? 'The narrative, recommendations and publisher insights are being rewritten from the plan\'s research. A QA audit opens when it is done. This takes a minute or two.'
                      : contentStatus.error
                        ? contentStatus.error
                        : 'The narrative, recommendations or publisher insights may mention channels this plan no longer has. Rewrite them before sharing.'}
                  </div>
                </div>
              </div>
              {!contentStatus.running && onRefreshContent && (
                <button
                  type="button"
                  onClick={onRefreshContent}
                  className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-lg bg-amber-600 px-3 py-2 text-xs font-bold text-white shadow-sm hover:bg-amber-700 sm:self-auto"
                >
                  <RotateCcw className="h-3.5 w-3.5" /> {contentStatus.error ? 'Try again' : 'Rewrite plan content'}
                </button>
              )}
            </div>
          )}

          {!readOnly && view.hasRfp && mediaPlan.planningMode !== 'greenfield' && onChangeBudgetStrategy && (
            <div className="rounded-2xl border border-slate-200 bg-white p-4 md:p-5">
              <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h3 className="text-sm font-extrabold text-slate-900">Budget approach</h3>
                  <p className="mt-0.5 text-xs text-slate-600">Starting from the RFP's {money(data.rfpMediaBudget ?? view.planTotal)} media budget. Changing it re-plans the allocation; your added and removed media types carry over.</p>
                </div>
                {budgetDraftChanged && (
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => { setBudgetDraftMode(savedBudgetMode); setBudgetDraftInput(savedAdditionalInput); setBudgetError(''); }}
                      disabled={isApplyingBudget}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      <X className="h-3.5 w-3.5" /> Cancel
                    </button>
                    <button
                      type="button"
                      onClick={applyBudgetStrategy}
                      disabled={isApplyingBudget}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {isApplyingBudget ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />} Re-plan
                    </button>
                  </div>
                )}
              </div>
              <BudgetStrategyControl
                idPrefix="plan-budget"
                mode={budgetDraftMode}
                additionalBudgetInput={budgetDraftInput}
                onModeChange={(mode) => { setBudgetDraftMode(mode); setBudgetError(''); }}
                onAdditionalBudgetChange={(value) => { setBudgetDraftInput(value); setBudgetError(''); }}
                rfpBudget={data.rfpMediaBudget ?? view.planTotal}
                capFor={mediaTypeCapFor}
                disabled={isApplyingBudget}
              />
              {budgetError && <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-800">{budgetError}</div>}
            </div>
          )}

          <div className="overflow-hidden rounded-2xl border-2 border-indigo-500 bg-white shadow-md">
            <div className="flex items-center justify-center gap-2 bg-gradient-to-r from-indigo-700 via-indigo-600 to-indigo-800 px-4 py-2 text-xs font-bold uppercase tracking-widest text-white">
              <ShieldCheck className="h-4 w-4 text-indigo-200" /> Channel Allocation
            </div>
            {view.hasRfp && !(view.asIs && (readOnly || view.addedRows.length === 0)) && (
              <div className="flex flex-wrap items-center gap-2 border-b border-indigo-100 bg-white px-4 py-2.5 md:px-5" role="group" aria-label="Filter media types by source">
                {([
                  { id: 'all', label: `All ${view.rfpRows.length + view.addedRows.length}` },
                  { id: 'rfp', label: `RFP: ${view.summary.rfpFunded} of ${view.summary.rfpCount} in plan` },
                  { id: 'scoutai', label: `ScoutAI added ${view.summary.scoutAdded}` },
                  ...(view.summary.plannerAdded > 0 ? [{ id: 'planner', label: `You added ${view.summary.plannerAdded}` }] : []),
                ] as Array<{ id: 'all' | ChannelSource; label: string }>).map((chip) => (
                  <button
                    key={chip.id}
                    type="button"
                    aria-pressed={sourceFilter === chip.id}
                    onClick={() => setSourceFilter(chip.id)}
                    className={`rounded-full border px-2.5 py-1 text-[11px] font-bold transition-colors ${sourceFilter === chip.id ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
            )}
            {!readOnly && view.unmatchedLines.length > 0 && (
              <div className="border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900 md:px-5">
                <span className="font-bold">{view.unmatchedLines.length} RFP line{view.unmatchedLines.length === 1 ? '' : 's'} ({money(view.unmatchedLines.reduce((sum, line) => sum + line.budget, 0))}) matched no media type</span>
                {' '}and are not compared against this plan: {view.unmatchedLines.map((line) => line.label).join('; ')}.
              </div>
            )}
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
                          <Lock className="h-3.5 w-3.5" /> {savedBudgetMode === 'incremental' && view.hasRfp ? 'Additional budget' : 'Fixed budget'}: ${mediaPlan.workingMediaBudget.toLocaleString()}
                        </span>
                        <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700"><Check className="h-3.5 w-3.5" /> 100% allocated</span>
                      </div>
                    )}
                    {!readOnly && (
                      <p className="mt-1 text-[11px] text-slate-600">
                        Edit budget, dollars, or whole-number percentages. Every change is balanced across unlocked media types.
                        {savedBudgetMode === 'incremental' && view.hasRfp && ' This edits the additional budget only; RFP media types stay at their RFP dollars.'}
                      </p>
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
                        const draftPercent = (draftBasisPoints[channel.channelId] ?? 0) / 100;
                        const outsideRange = draftPercent < effectiveMinimum || draftPercent > effectiveMaximum;
                        return (
                          <div key={channel.channelId} className={`px-3 py-3 transition-colors ${locked ? 'bg-indigo-50/40' : 'bg-white'}`}>
                            <div className="relative grid grid-cols-2 items-center gap-2 sm:grid-cols-[minmax(130px,1fr)_100px_130px_52px]">
                              <div className="col-span-2 row-start-1 min-w-0 pr-12 sm:col-span-1 sm:pr-0">
                                <div className="truncate text-sm font-extrabold text-slate-900">{channel.channelName}</div>
                                <div className="mt-0.5 text-[10px] font-semibold text-slate-500">Recommended {effectiveMinimum}–{effectiveMaximum}%</div>
                                {outsideRange && <div className="mt-0.5 text-[10px] font-semibold text-amber-700">Outside the recommended range</div>}
                              </div>
                              <label className="col-start-1 row-start-2 block sm:col-start-2 sm:row-start-1">
                                <span className="sr-only">{channel.channelName} allocation percentage</span>
                                <span className="mb-1 block text-[10px] font-extrabold uppercase tracking-wide text-slate-400 sm:hidden">Percent (whole)</span>
                                <span className="relative block">
                                  <input
                                    id={allocationPercentInputId(channel.channelId)}
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
                              <RotateCcw className="h-3.5 w-3.5" /> {view.asIs ? 'Reset to uploaded plan' : 'Reset to ScoutAI'}
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
            {scoutPreview && (previewByChannel.size > 0 || previewAdded.length > 0 || previewBudget) && (
              <div ref={previewAnchorRef} className="scroll-mt-28 border-b border-indigo-200 bg-indigo-50/70 px-4 py-3 md:px-5">
                <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-800">
                  <Sparkles className="h-3.5 w-3.5" /> Previewing a ScoutAI change. Nothing is saved until you apply it in the ScoutAI panel.
                </div>
                {(previewBudget || previewAdded.length > 0) && (
                  <ul className="mt-2 space-y-1 text-xs text-indigo-950">
                    {previewBudget && <li>Working media budget: <span className="text-slate-500 line-through">{previewBudget.before}</span> → <span className="font-bold">{previewBudget.after}</span></li>}
                    {previewAdded.map((c) => <li key={c.channelId}><span className="font-bold">+ {c.label}</span> would be added at {c.after}</li>)}
                  </ul>
                )}
              </div>
            )}
            {mediaPlan.channels.length === 0 && view.rfpRows.length === 0 ? (
              <div className="p-5 text-sm text-slate-700">No product cleared every hard constraint. Review the excluded candidate reasons before allocating budget.</div>
            ) : (
              <div>
                {allocationGroups.map((group) => (
                  <section key={group.id} aria-labelledby={group.title ? `allocation-group-${group.id}` : undefined}>
                    {group.title && (
                      <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2 md:px-5">
                        <h4 id={`allocation-group-${group.id}`} className="text-[11px] font-extrabold uppercase tracking-wide text-slate-700">{group.title}</h4>
                        <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-slate-500 ring-1 ring-slate-200">{group.rows.length}</span>
                      </div>
                    )}
                    <div className="divide-y divide-slate-100">
                      {group.rows.map((row) => {
                        if (row.keptAtRfp) return renderKeptRow(row);
                        if (row.outsideCatalog) return renderOutsideCatalogRow(row);
                        const channel = mediaPlan.channels.find((item) => item.channelId === row.channelId);
                        return channel ? renderAllocatedRow(channel, row) : null;
                      })}
                    </div>
                  </section>
                ))}
                {allocationGroups.length === 0 && <div className="px-5 py-6 text-sm text-slate-600">No media types match this filter.</div>}
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
                        const recommendationRow = rowById.get(candidate.product.id);
                        const isRfpNotFunded = rfpNotFundedIds.has(candidate.product.id);
                        const reason = manuallyRequested
                          ? 'Manual inclusion is requested; the plan is being recalculated to fund it.'
                          : isRfpNotFunded && recommendationRow
                            ? recommendationRow.why
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
                                    {isRfpNotFunded && recommendationRow && sourceBadge(recommendationRow)}
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
                                  {recommendationRow && fitScores(recommendationRow)}
                                </div>
                                <div className="flex shrink-0 items-center gap-3">
                                  {candidate.aiAssessed === false ? (
                                    <div className="min-w-[72px] rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-center text-slate-500">
                                      <div className="text-[10px] font-bold uppercase tracking-wider opacity-75">Score</div>
                                      <div className="text-[11px] font-bold leading-tight">Not assessed</div>
                                    </div>
                                  ) : (
                                    <div className={`min-w-[72px] rounded-lg border px-2.5 py-1.5 text-center ${getRecommendationScoreBg(candidate.recommendationScore)}`}>
                                      <div className="text-[10px] font-bold uppercase tracking-wider opacity-75">Score</div>
                                      <div className="font-extrabold leading-tight">{candidate.recommendationScore}<span className="text-[10px] font-semibold opacity-90">/100</span></div>
                                    </div>
                                  )}
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
                                channelId={candidate.product.id}
                                overrides={data.channelOverrides?.[candidate.product.id]}
                                onUpdateOverride={handleUpdateChannelOverride}
                                readOnly={readOnly}
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
                                aiAssessed={candidate.aiAssessed !== false}
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

      {/* What the plan leaves out, for the client: RFP media types it does not fund and the media
          types ScoutAI would add. Planners see the full candidate list above instead. */}
      {/* A client's plan used as is gets the case for it instead of the list below. */}
      {view.asIs && alignment && internalOnly.planAlignment !== false && <PlanAlignmentPanel alignment={alignment} readOnly={readOnly} />}

      {/* Not on a plan used as is: the client's plan is the plan, and this list would second-guess it. */}
      {readOnly && mediaPlan && !view.asIs && internalOnly.channelRecommendationsNotInPlan !== false && (view.rfpNotFunded.length > 0 || view.recommendedAdditions.length > 0) && (
        <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 md:px-5">
            <h3 className="flex items-center gap-1.5 text-sm font-extrabold text-slate-900"><Sparkles className="h-4 w-4 text-indigo-600" /> ScoutAI recommendations not in this plan</h3>
            <p className="mt-1 text-xs text-slate-600">Where ScoutAI moved RFP budget, and media types that would add the most for this audience and goal.</p>
          </div>
          {[
            { id: 'rfp', title: 'From your RFP, not carried forward', rows: view.rfpNotFunded },
            { id: 'add', title: 'Recommended additions', rows: view.recommendedAdditions.slice(0, 5) },
          ].filter((group) => group.rows.length > 0).map((group) => (
            <section key={group.id} aria-labelledby={`share-recs-${group.id}`}>
              <div className="border-b border-slate-200 bg-white px-4 py-2 md:px-5">
                <h4 id={`share-recs-${group.id}`} className="text-[11px] font-extrabold uppercase tracking-wide text-slate-700">{group.title}</h4>
              </div>
              <div className="divide-y divide-slate-100">
                {group.rows.map((row) => (
                  <article key={row.channelId} className="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-start md:justify-between md:px-5 md:py-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h5 className="font-extrabold text-slate-900">{row.channelName}</h5>
                        {row.source === 'rfp' && sourceBadge(row)}
                      </div>
                      {fitScores(row)}
                      <div className="mt-2">{rowReasons(row, true)}</div>
                      {internalOnly.channelDollarsColumn && row.source !== 'rfp' && row.minimumSpend > 0 && (
                        <p className="mt-1.5 text-[11px] font-semibold text-slate-500">Minimum spend to add: {money(row.minimumSpend)}</p>
                      )}
                    </div>
                    {internalOnly.channelScoreColumn && row.score !== null && (
                      <div className={`min-w-[72px] shrink-0 self-start rounded-lg border px-2.5 py-1.5 text-center ${getRecommendationScoreBg(row.score)}`}>
                        <div className="text-[10px] font-bold uppercase tracking-wider opacity-75">Score</div>
                        <div className="font-extrabold leading-tight">{row.score}<span className="text-[10px] font-semibold opacity-90">/100</span></div>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </section>
          ))}
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
