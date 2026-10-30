import React, { useState, useMemo, useEffect } from 'react';
import {
  Tv,
  X,
  Search,
  Check,
  Plus,
  RotateCcw,
  Sparkles,
  AlertCircle,
} from 'lucide-react';
import {
  type CtvPublisherRecommendation,
  publisherRationale,
} from '../types';
import {
  type CtvPublisherSetting,
  DEFAULT_CTV_PUBLISHERS,
  resolvePublisherLogo,
} from '../planning/knowledge/ctvPublishers';

export interface CtvPublishersModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedPublishers: CtvPublisherRecommendation[];
  onUpdatePublishers: (publishers: CtvPublisherRecommendation[]) => void;
  onResetToDefault?: () => void;
  catalogPublishers?: CtvPublisherSetting[];
  readOnly?: boolean;
}

export const CtvPublishersModal: React.FC<CtvPublishersModalProps> = ({
  isOpen,
  onClose,
  selectedPublishers,
  onUpdatePublishers,
  onResetToDefault,
  catalogPublishers = DEFAULT_CTV_PUBLISHERS,
  readOnly = false,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'All' | 'App' | 'Network' | 'OS'>('All');
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customCategory, setCustomCategory] = useState<'App' | 'Network' | 'OS'>('App');

  // Close on Escape key press
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Set of selected publisher names (normalized for comparison)
  const selectedNamesSet = useMemo(() => {
    return new Set(selectedPublishers.map((p) => p.publisher.toLowerCase().trim()));
  }, [selectedPublishers]);

  // Master catalog including any custom items already selected
  const allAvailablePublishers = useMemo(() => {
    const list: Array<{ name: string; category: string; notes: string; logoUrl?: string }> = [
      ...catalogPublishers.map((p) => ({
        name: p.name,
        category: p.category,
        notes: p.notes,
        logoUrl: p.logoUrl,
      })),
    ];

    // Ensure any currently selected publisher not in catalog is included in the available master list
    selectedPublishers.forEach((sel) => {
      const exists = list.some((item) => item.name.toLowerCase().trim() === sel.publisher.toLowerCase().trim());
      if (!exists) {
        list.push({
          name: sel.publisher,
          category: sel.category || 'App',
          notes: sel.why || '',
        });
      }
    });

    return list;
  }, [catalogPublishers, selectedPublishers]);

  // Unselected publishers filtered by search and category
  const unselectedPublishers = useMemo(() => {
    return allAvailablePublishers.filter((item) => {
      const isSelected = selectedNamesSet.has(item.name.toLowerCase().trim());
      if (isSelected) return false;

      if (categoryFilter !== 'All' && item.category !== categoryFilter) {
        return false;
      }

      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const matchesName = item.name.toLowerCase().includes(query);
        const matchesNotes = item.notes?.toLowerCase().includes(query);
        const matchesCategory = item.category?.toLowerCase().includes(query);
        return matchesName || matchesNotes || matchesCategory;
      }

      return true;
    });
  }, [allAvailablePublishers, selectedNamesSet, categoryFilter, searchQuery]);

  // Add publisher to selected
  const handleSelectPublisher = (publisher: { name: string; category: string; notes?: string }) => {
    if (readOnly) return;
    const exists = selectedNamesSet.has(publisher.name.toLowerCase().trim());
    if (exists) return;

    const newTarget: CtvPublisherRecommendation = {
      publisher: publisher.name,
      category: publisher.category || 'App',
      why: '',
      isUserAdded: true,
    };

    onUpdatePublishers([...selectedPublishers, newTarget]);
  };

  // Remove publisher from selected
  const handleDeselectPublisher = (publisherName: string) => {
    if (readOnly) return;
    const filtered = selectedPublishers.filter(
      (p) => p.publisher.toLowerCase().trim() !== publisherName.toLowerCase().trim()
    );
    onUpdatePublishers(filtered);
  };

  // Clear all selected publishers
  const handleClearAll = () => {
    if (readOnly) return;
    onUpdatePublishers([]);
  };

  // Add custom publisher
  const handleAddCustomPublisher = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customName.trim()) return;

    const newPublisher: CtvPublisherRecommendation = {
      publisher: customName.trim(),
      category: customCategory,
      why: '',
      isUserAdded: true,
    };

    onUpdatePublishers([...selectedPublishers, newPublisher]);
    setCustomName('');
    setShowCustomForm(false);
  };

  if (!isOpen) return null;

  return (
    <div
      id="ctv-publishers-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 md:p-6 bg-slate-900/60 backdrop-blur-xs transition-opacity animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="ctv-modal-title"
    >
      <div
        id="ctv-publishers-modal-card"
        className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-5xl h-[88vh] max-h-[820px] flex flex-col overflow-hidden text-slate-900 font-sans"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-start justify-between p-5 md:px-6 md:py-5 border-b border-slate-200 bg-slate-50/60 shrink-0">
          <div>
            <div className="flex items-center gap-2 text-indigo-600 text-xs font-bold uppercase tracking-wider mb-1">
              <Tv className="w-4 h-4" />
              <span>Connected TV Targeting</span>
            </div>
            <h2 id="ctv-modal-title" className="text-xl md:text-2xl font-bold font-display text-slate-900">
              Edit CTV Publishers to Target
            </h2>
            <p className="text-xs md:text-sm text-slate-600 mt-0.5">
              Select and customize the streaming apps, networks, and smart TV platforms included in this media plan.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <span className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
              <Check className="w-3.5 h-3.5" />
              <span>{selectedPublishers.length} Selected</span>
            </span>
            <button
              id="close-ctv-publishers-modal-btn"
              type="button"
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
              aria-label="Close modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body - 2 Columns (Not Selected vs Selected) */}
        <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-200 flex-1 overflow-hidden min-h-0 bg-slate-50/30">
          
          {/* Column 1: Available (Not Selected) */}
          <div className="flex flex-col min-h-0 p-4 md:p-5 overflow-hidden">
            <div className="flex items-center justify-between gap-2 mb-3 shrink-0">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-slate-800">Available Publishers</h3>
                <span className="px-2 py-0.5 text-[11px] font-bold rounded-full bg-slate-200/80 text-slate-700">
                  {unselectedPublishers.length}
                </span>
              </div>
              <span className="text-[11px] text-slate-500 hidden sm:inline">Click to target</span>
            </div>

            {/* Search and Category Filters */}
            <div className="space-y-2 mb-3 shrink-0">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="ctv-publishers-search-input"
                  type="text"
                  placeholder="Search publishers by name or topic..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-8 py-2 text-xs rounded-xl border border-slate-200 bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-slate-900 placeholder:text-slate-400 shadow-2xs transition-all"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
                    aria-label="Clear search"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Category Filter Chips */}
              <div className="flex flex-wrap items-center gap-1.5">
                {(['All', 'App', 'Network', 'OS'] as const).map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCategoryFilter(cat)}
                    className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg transition-colors cursor-pointer ${
                      categoryFilter === cat
                        ? 'bg-indigo-600 text-white shadow-2xs'
                        : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200/80'
                    }`}
                  >
                    {cat === 'All' ? 'All Categories' : cat === 'OS' ? 'Smart TV OS' : `${cat}s`}
                  </button>
                ))}
              </div>
            </div>

            {/* Scrollable Available Publishers List */}
            <div className="flex-1 overflow-y-auto pr-1 space-y-2 min-h-0">
              {unselectedPublishers.length === 0 ? (
                <div className="p-8 text-center bg-white rounded-xl border border-dashed border-slate-200 my-auto">
                  <Search className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                  <p className="text-xs font-semibold text-slate-700">No matching publishers found</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {searchQuery ? `Try clearing your search "${searchQuery}".` : 'All available publishers are currently selected!'}
                  </p>
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="mt-2 text-xs font-semibold text-indigo-600 hover:underline"
                    >
                      Clear search
                    </button>
                  )}
                </div>
              ) : (
                unselectedPublishers.map((pub) => {
                  const logoSrc = resolvePublisherLogo(pub.name, catalogPublishers);
                  return (
                    <div
                      key={pub.name}
                      onClick={() => handleSelectPublisher(pub)}
                      className="bg-white border border-slate-200/90 hover:border-indigo-300 hover:shadow-xs p-3 rounded-xl flex items-center gap-3 transition-all cursor-pointer group"
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleSelectPublisher(pub);
                        }
                      }}
                    >
                      <div className="w-10 h-10 rounded-full border border-slate-100 bg-white shadow-2xs flex items-center justify-center p-[2px] overflow-hidden shrink-0">
                        <img
                          src={logoSrc}
                          alt={pub.name}
                          className="w-full h-full object-cover rounded-full"
                          referrerPolicy="no-referrer"
                          onError={(e) => {
                            (e.target as HTMLImageElement).src = '/assets/pub-logos/placeholder_80x80.png';
                          }}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="text-xs font-bold text-slate-800 group-hover:text-indigo-600 truncate block">
                          {pub.name}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSelectPublisher(pub);
                        }}
                        className="w-7 h-7 rounded-lg bg-slate-50 group-hover:bg-indigo-50 text-slate-400 group-hover:text-indigo-600 border border-slate-200 group-hover:border-indigo-200 flex items-center justify-center shrink-0 transition-colors"
                        title={`Add ${pub.name} to target roster`}
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            {/* Add Custom Publisher Toggle / Form */}
            <div className="mt-3 pt-3 border-t border-slate-200/80 shrink-0">
              {!showCustomForm ? (
                <button
                  type="button"
                  onClick={() => setShowCustomForm(true)}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-700 transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add unlisted custom publisher</span>
                </button>
              ) : (
                <form onSubmit={handleAddCustomPublisher} className="space-y-2 bg-white p-3 rounded-xl border border-indigo-100 shadow-2xs">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-800">Add Custom Publisher</span>
                    <button
                      type="button"
                      onClick={() => setShowCustomForm(false)}
                      className="text-slate-400 hover:text-slate-600 p-0.5"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <input
                      type="text"
                      placeholder="Publisher name"
                      value={customName}
                      onChange={(e) => setCustomName(e.target.value)}
                      className="col-span-2 px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 text-slate-900 placeholder:text-slate-400 focus:outline-hidden focus:ring-1 focus:ring-indigo-500"
                      required
                    />
                    <select
                      value={customCategory}
                      onChange={(e) => setCustomCategory(e.target.value as any)}
                      className="px-2 py-1.5 text-xs rounded-lg border border-slate-200 text-slate-800 bg-white"
                    >
                      <option value="App">App</option>
                      <option value="Network">Network</option>
                      <option value="OS">Smart TV OS</option>
                    </select>
                  </div>
                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setShowCustomForm(false)}
                      className="px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-100 rounded-md"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={!customName.trim()}
                      className="px-3 py-1 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-md disabled:opacity-50"
                    >
                      Add to Plan
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>

          {/* Column 2: Selected for Plan (Visual Multi-Select with Green Outline and Check) */}
          <div className="flex flex-col min-h-0 p-4 md:p-5 overflow-hidden bg-white">
            <div className="flex items-center justify-between gap-2 mb-3 shrink-0">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-slate-900">Selected for Plan</h3>
                <span className="px-2.5 py-0.5 text-[11px] font-extrabold rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                  {selectedPublishers.length} Targeted
                </span>
              </div>
              {selectedPublishers.length > 0 && !readOnly && (
                <button
                  type="button"
                  onClick={handleClearAll}
                  className="text-[11px] font-semibold text-slate-400 hover:text-rose-600 transition-colors cursor-pointer"
                >
                  Clear all
                </button>
              )}
            </div>

            <p className="text-xs text-slate-500 mb-3 shrink-0">
              These publishers will be featured in the CTV audience profile and deterministic media allocation.
            </p>

            {/* Scrollable Selected Publishers List */}
            <div className="flex-1 overflow-y-auto pr-1 space-y-2.5 min-h-0">
              {selectedPublishers.length === 0 ? (
                <div className="p-8 text-center bg-slate-50/70 rounded-xl border border-dashed border-amber-200/80 my-auto space-y-2">
                  <AlertCircle className="w-8 h-8 text-amber-500 mx-auto" />
                  <p className="text-xs font-bold text-slate-800">No CTV publishers selected</p>
                  <p className="text-[11px] text-slate-500 max-w-xs mx-auto">
                    At least 1 publisher is recommended for a balanced CTV media plan. Click any publisher on the left to add it.
                  </p>
                </div>
              ) : (
                selectedPublishers.map((pub, idx) => {
                  const logoSrc = resolvePublisherLogo(pub.publisher, catalogPublishers);
                  const rationale = publisherRationale(pub);
                  const hasRationale = Boolean(rationale);

                  return (
                    <div
                      key={`${pub.publisher}-${idx}`}
                      className={`bg-emerald-50/20 border-2 border-emerald-500 rounded-xl p-3 shadow-2xs transition-all relative group flex ${
                        hasRationale ? 'items-start' : 'items-center'
                      } gap-3`}
                    >
                      {/* Logo */}
                      <div className="w-10 h-10 rounded-full border border-emerald-200 bg-white shadow-2xs flex items-center justify-center p-[2px] overflow-hidden shrink-0">
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

                      {/* Name, plus its justification when it has one */}
                      <div className={`flex-1 min-w-0 ${hasRationale ? 'space-y-0.5' : ''}`}>
                        <span className="text-xs font-bold text-slate-900 truncate block">{pub.publisher}</span>
                        {hasRationale && (
                          <p className="text-[11px] text-slate-600 leading-normal">
                            {rationale}
                          </p>
                        )}
                      </div>

                      {/* Right Actions: Green Checkmark & Remove button */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        {/* Circular Green Checkmark Badge */}
                        <div
                          className="w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow-2xs"
                          title="Selected"
                        >
                          <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                        </div>

                        {/* Quick Remove Button */}
                        {!readOnly && (
                          <button
                            type="button"
                            onClick={() => handleDeselectPublisher(pub.publisher)}
                            className="w-6 h-6 rounded-full bg-white hover:bg-rose-50 text-slate-400 hover:text-rose-600 border border-slate-200 hover:border-rose-200 flex items-center justify-center transition-colors cursor-pointer"
                            title={`Remove ${pub.publisher} from selection`}
                            aria-label={`Remove ${pub.publisher}`}
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 md:px-6 border-t border-slate-200 bg-slate-50 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3">
            {onResetToDefault && !readOnly && (
              <button
                id="reset-ctv-publishers-default-btn"
                type="button"
                onClick={onResetToDefault}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 hover:text-slate-900 border border-slate-300 rounded-xl transition-colors shadow-2xs cursor-pointer"
                title="Reset back to ScoutAI initial recommendation"
              >
                <RotateCcw className="w-3.5 h-3.5 text-slate-500" />
                <span>Reset to ScoutAI Recommendations</span>
              </button>
            )}
            <span className="text-[11px] font-medium text-emerald-700 flex items-center gap-1">
              <Check className="w-3.5 h-3.5 text-emerald-600 stroke-[2.5]" />
              <span>Changes applied in real time</span>
            </span>
          </div>

          <button
            id="done-ctv-publishers-modal-btn"
            type="button"
            onClick={onClose}
            className="w-full sm:w-auto px-6 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition-colors shadow-2xs cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
