import React from 'react';
import { Eye, EyeOff } from 'lucide-react';

export interface SectionVisibilityButtonProps {
  sectionKey: string;
  isInactive: boolean;
  onToggle: (sectionKey: string, inactive: boolean) => void;
  className?: string;
  badgeLabel?: string;
}

export const SectionVisibilityButton: React.FC<SectionVisibilityButtonProps> = ({
  sectionKey,
  isInactive,
  onToggle,
  className = '',
  badgeLabel = 'Inactive in share link',
}) => {
  return (
    <div className={`inline-flex items-center gap-1.5 ${className}`}>
      {isInactive && (
        <span className="inline-flex items-center rounded-md bg-amber-100/90 px-2 py-0.5 text-[10px] font-bold text-amber-800 border border-amber-200/80 shadow-2xs">
          {badgeLabel}
        </span>
      )}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggle(sectionKey, !isInactive);
        }}
        className={`inline-flex h-7 w-7 items-center justify-center rounded-lg transition-all cursor-pointer ${
          isInactive
            ? 'bg-amber-100 text-amber-700 opacity-100 hover:bg-amber-200 shadow-2xs'
            : 'text-slate-400 opacity-0 transition-opacity hover:bg-slate-200/70 hover:text-slate-700 group-hover:opacity-100'
        }`}
        title={
          isInactive
            ? 'Inactive (hidden from share link) — click to show'
            : 'Active — click to hide from share link'
        }
        aria-label={isInactive ? 'Show in share view' : 'Hide from share view'}
      >
        {isInactive ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
};
