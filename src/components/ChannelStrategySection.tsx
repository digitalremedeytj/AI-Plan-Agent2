import React, { useState } from 'react';
import { Sparkles, Copy, Check, Info, ArrowLeftRight, TrendingUp, Layers, HelpCircle, FileText } from 'lucide-react';
import { ChannelStrategyData, ChannelEvaluation } from '../types';
import { isNonMediaItem } from '../utils/mediaTaxonomy';

interface ChannelStrategySectionProps {
  data: ChannelStrategyData;
  onToggleBudgetMode?: (mode: 'reallocation' | 'incremental') => void;
}

export const ChannelStrategySection: React.FC<ChannelStrategySectionProps> = ({
  data,
  onToggleBudgetMode,
}) => {
  const [copied, setCopied] = useState(false);

  if (!data) return null;

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

  const handleCopyText = () => {
    const text = `CHANNEL STRATEGY ANALYSIS\n\nRFP Channels:\n${data.rfpChannels
      .map(
        c =>
          `- ${c.channelName} (Score: ${c.score.toFixed(1)} | Audience Fit: ${c.audienceFit}/10 | Goal Match: ${c.goalMatch}/10)\n  Evidence: ${c.mediaConsumptionEvidence}\n  Why: ${c.whyItEarnsASpot}`
      )
      .join('\n')}\n\nScoutAI Recommended Channels:\n${data.scoutAiRecommendedChannels
      .map(
        c =>
          `- ${c.channelName} (Score: ${c.score.toFixed(1)} | Audience Fit: ${c.audienceFit}/10 | Goal Match: ${c.goalMatch}/10)\n  Evidence: ${c.mediaConsumptionEvidence}\n  Why: ${c.whyItEarnsASpot}`
      )
      .join('\n')}\n\nExecutive Insight:\n${data.executiveInsight}`;

    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const rfpChannelNames = data.rfpChannels.map(c => c.channelName).join(', ');

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 md:p-8 my-8 font-sans">
      {/* Header Bar */}
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 pb-6 border-b border-slate-100">
        <div>
          <div className="flex items-center gap-2 text-indigo-600 text-xs font-bold uppercase tracking-wider mb-2">
            <Layers className="w-4 h-4" />
            <span>10. Channel Strategy & Activation Plan</span>
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
          <div className="inline-flex rounded-lg p-1 bg-slate-100 border border-slate-200 text-xs font-medium">
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
          </div>

          <button
            onClick={handleCopyText}
            className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg border border-slate-200 transition-colors cursor-pointer"
            title="Copy Strategy Summary"
          >
            {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Intro Context Callout */}
      <div className="mt-6 text-slate-700 text-sm md:text-base font-medium leading-relaxed bg-slate-50/80 p-4 rounded-xl border border-slate-200/60">
        Your brief includes <span className="font-semibold text-slate-900">{rfpChannelNames || 'existing RFP channels'}</span>.{' '}
        <span className="text-indigo-700 font-bold">ScoutAI</span> identified{' '}
        <span className="font-semibold text-slate-900">{data.scoutAiRecommendedChannels.length} additional programmatic channel(s)</span>{' '}
        that complement your plan based on total budget tier (${data.totalRfpBudget?.toLocaleString() || 0}).
      </div>

      {/* SECTION 1: RFP CHANNELS CARD */}
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

      {/* SECTION 2: SCOUTAI RECOMMENDED CHANNELS CARD */}
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
