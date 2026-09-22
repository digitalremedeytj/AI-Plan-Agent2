import React, { useState, useRef, useEffect } from 'react';
import { Download, Loader2, Check, LayoutGrid, Columns2, ChevronRight } from 'lucide-react';

export interface CtvExportDropdownProps {
  id?: string;
  isExporting: boolean;
  exportSuccess: boolean;
  onExport: (variant: 'detailed' | 'basic') => void;
  activeVariant?: 'detailed' | 'basic' | null;
}

export const CtvExportDropdown: React.FC<CtvExportDropdownProps> = ({
  id = 'ctv-export-slide-dropdown',
  isExporting,
  exportSuccess,
  onExport,
  activeVariant = null,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside or Escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleSelectOption = (variant: 'detailed' | 'basic') => {
    setIsOpen(false);
    onExport(variant);
  };

  return (
    <div ref={containerRef} className="relative inline-block text-left">
      {/* Icon-Only Export Button Trigger */}
      <button
        id={id}
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        disabled={isExporting}
        aria-haspopup="true"
        aria-expanded={isOpen}
        title="Export 16:9 Presentation Slide"
        className={`p-2 inline-flex items-center justify-center rounded-xl border transition-all cursor-pointer shadow-2xs ${
          isOpen
            ? 'bg-indigo-50 border-indigo-300 text-indigo-600 ring-2 ring-indigo-500/20'
            : exportSuccess
            ? 'bg-emerald-50 border-emerald-300 text-emerald-600'
            : 'bg-white hover:bg-slate-50 border-slate-200/90 text-slate-700 hover:text-indigo-600'
        } disabled:opacity-60 disabled:cursor-not-allowed`}
      >
        {isExporting ? (
          <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
        ) : exportSuccess ? (
          <Check className="w-4 h-4 text-emerald-600" />
        ) : (
          <Download className="w-4 h-4 text-slate-700 hover:text-indigo-600" />
        )}
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          role="menu"
          aria-orientation="vertical"
          className="absolute right-0 mt-2 w-72 origin-top-right rounded-2xl bg-white p-1.5 shadow-xl border border-slate-200/90 focus:outline-none z-50 animate-in fade-in zoom-in-95 duration-100"
        >
          <div className="px-3 py-2 border-b border-slate-100 mb-1">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
              Export 16:9 Slide
            </span>
            <span className="text-xs text-slate-600">
              Select presentation layout style
            </span>
          </div>

          <div className="space-y-1">
            {/* Detailed Export Option */}
            <button
              id={`${id}-option-detailed`}
              type="button"
              role="menuitem"
              onClick={() => handleSelectOption('detailed')}
              className="w-full text-left p-2.5 rounded-xl hover:bg-indigo-50/70 transition-colors flex items-start gap-3 group cursor-pointer"
            >
              <div className="p-2 rounded-lg bg-indigo-50 text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white transition-colors shrink-0 mt-0.5">
                <LayoutGrid className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-800 group-hover:text-indigo-950">
                    Detailed Export
                  </span>
                  <ChevronRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-indigo-600 group-hover:translate-x-0.5 transition-all" />
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">
                  3×3 grid with category badges, pricing tiers &amp; targeting rationale
                </p>
              </div>
            </button>

            {/* Basic Export Option */}
            <button
              id={`${id}-option-basic`}
              type="button"
              role="menuitem"
              onClick={() => handleSelectOption('basic')}
              className="w-full text-left p-2.5 rounded-xl hover:bg-indigo-50/70 transition-colors flex items-start gap-3 group cursor-pointer"
            >
              <div className="p-2 rounded-lg bg-indigo-50 text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white transition-colors shrink-0 mt-0.5">
                <Columns2 className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-800 group-hover:text-indigo-950">
                    Basic Export
                  </span>
                  <ChevronRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-indigo-600 group-hover:translate-x-0.5 transition-all" />
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">
                  Clean 2-column layout with publisher logos &amp; insights
                </p>
              </div>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
