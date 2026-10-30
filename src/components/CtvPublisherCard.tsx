import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { type CtvPublisherRecommendation, publisherRationale } from '../types';

interface CtvPublisherCardProps {
  pub: CtvPublisherRecommendation;
  logoSrc: string;
  className?: string;
  /** A justification for this publisher is being written (a planner just added it). */
  isWritingRationale?: boolean;
}

export const CtvPublisherCard: React.FC<CtvPublisherCardProps> = ({
  pub,
  logoSrc,
  className = '',
  isWritingRationale = false,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const rationale = publisherRationale(pub);
  const hasRationale = Boolean(rationale);

  return (
    <div
      className={`bg-slate-50/50 border border-slate-100 rounded-xl transition-all duration-150 ${
        hasRationale
          ? 'cursor-pointer hover:bg-slate-100/70 hover:border-slate-200/80 shadow-2xs'
          : 'hover:bg-slate-50/80'
      } p-3.5 sm:p-4 ${className}`}
      onClick={() => {
        if (hasRationale) {
          setIsExpanded((prev) => !prev);
        }
      }}
      role={hasRationale ? 'button' : undefined}
      tabIndex={hasRationale ? 0 : undefined}
      onKeyDown={(e) => {
        if (hasRationale && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          setIsExpanded((prev) => !prev);
        }
      }}
      aria-expanded={hasRationale ? isExpanded : undefined}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3.5 min-w-0 flex-1">
          {/* Logo */}
          <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-full border border-slate-100 bg-white shadow-xs flex items-center justify-center p-[2px] overflow-hidden shrink-0">
            <img
              src={logoSrc}
              alt={pub.publisher}
              className="w-full h-full object-cover rounded-full"
              referrerPolicy="no-referrer"
              onError={(e) => {
                (e.target as HTMLImageElement).src = '/assets/pub-logos/placeholder_80x80.png';
              }}
            />
          </div>

          {/* Name - NO type tag */}
          <div className="min-w-0">
            <span className="block text-sm font-bold text-slate-800 truncate">{pub.publisher}</span>
            {!hasRationale && isWritingRationale && (
              <span className="block text-[11px] text-slate-400 animate-pulse">Writing justification…</span>
            )}
          </div>
        </div>

        {/* Expand Caret on the right (only when there is rationale text to reveal) */}
        {hasRationale && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded((prev) => !prev);
            }}
            className="w-7 h-7 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 flex items-center justify-center transition-colors shrink-0 cursor-pointer"
            aria-label={isExpanded ? `Collapse ${pub.publisher} details` : `Expand ${pub.publisher} details`}
          >
            <ChevronDown
              className={`w-4 h-4 transition-transform duration-200 ${
                isExpanded ? 'rotate-180 text-indigo-600' : ''
              }`}
            />
          </button>
        )}
      </div>

      {/* Expanded Rationale Text (hidden collapsed by default, shown on expand) */}
      {hasRationale && isExpanded && (
        <div className="mt-3 pt-3 border-t border-slate-200/70 text-[11px] text-slate-600 leading-normal">
          <p>{rationale}</p>
        </div>
      )}
    </div>
  );
};
