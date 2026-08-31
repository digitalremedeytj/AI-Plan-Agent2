import React, { useState } from 'react';
import { X, ShieldCheck, Check, Edit2, AlertCircle, Sparkles } from 'lucide-react';
import { CanonicalMediaType, TaxonomyMapping } from '../types';
import { CANONICAL_MEDIA_TAXONOMY, getCanonicalItem } from '../utils/mediaTaxonomy';

interface TaxonomyVerificationBadgeProps {
  isOpen: boolean;
  onClose: () => void;
  mappings: TaxonomyMapping[];
  onUpdateMapping: (rawLabel: string, canonicalId: CanonicalMediaType) => void;
}

export const TaxonomyVerificationBadge: React.FC<TaxonomyVerificationBadgeProps> = ({
  isOpen,
  onClose,
  mappings,
  onUpdateMapping,
}) => {
  const [editingLabel, setEditingLabel] = useState<string | null>(null);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="bg-slate-900 text-white p-5 flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-600/30 rounded-lg border border-indigo-400/30 text-indigo-300">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-display font-semibold text-lg text-white">
                Media Taxonomy Normalization
              </h3>
              <p className="text-xs text-slate-300">
                ScoutAI standardizes raw channel names into 19 canonical media types for accurate AI evaluation.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content list */}
        <div className="p-5 overflow-y-auto flex-1 divide-y divide-slate-100">
          {mappings.map((map) => {
            const canonical = getCanonicalItem(map.canonicalId);
            const isEditing = editingLabel === map.rawLabel;

            return (
              <div key={map.rawLabel} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-mono font-medium text-slate-500 uppercase tracking-wider">
                    Raw RFP Label
                  </div>
                  <div className="text-sm font-semibold text-slate-800 truncate" title={map.rawLabel}>
                    "{map.rawLabel}"
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="text-xs text-slate-400">Canonical ScoutAI Media Type</div>
                    {isEditing ? (
                      <select
                        value={map.canonicalId}
                        onChange={(e) => {
                          onUpdateMapping(map.rawLabel, e.target.value as CanonicalMediaType);
                          setEditingLabel(null);
                        }}
                        className="mt-1 text-xs font-semibold bg-slate-50 border border-indigo-300 rounded-md px-2 py-1 text-indigo-900 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                        autoFocus
                      >
                        {CANONICAL_MEDIA_TAXONOMY.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.displayName} ({item.category})
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div className="flex items-center gap-1.5 justify-end">
                        <span className="text-xs font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100">
                          {canonical.displayName}
                        </span>
                        {map.isUserVerified ? (
                          <span className="inline-flex items-center text-[10px] bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded border border-emerald-200 font-medium">
                            <Check className="w-3 h-3 mr-0.5 text-emerald-600" />
                            Verified
                          </span>
                        ) : (
                          <span className="inline-flex items-center text-[10px] bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded border border-amber-200 font-medium">
                            <Sparkles className="w-3 h-3 mr-0.5 text-amber-500" />
                            {(map.confidence * 100).toFixed(0)}% Match
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {!isEditing && (
                    <button
                      onClick={() => setEditingLabel(map.rawLabel)}
                      className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors cursor-pointer"
                      title="Override Mapping"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="bg-slate-50 p-4 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
          <div className="flex items-center gap-1.5 text-slate-600">
            <AlertCircle className="w-4 h-4 text-indigo-500 shrink-0" />
            <span>Verify mappings to ensure channel scores match your agency's product taxonomy.</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors cursor-pointer"
          >
            Done & Save
          </button>
        </div>
      </div>
    </div>
  );
};
