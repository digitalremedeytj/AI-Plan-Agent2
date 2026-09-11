import React, { useMemo, useRef, useState } from "react";
import { AlertTriangle, MapPin, Search, Upload, X } from "lucide-react";
import type { GeoEntry, GeoScope } from "../types";
import {
  DMA_SOURCE_LABEL,
} from "../planning/knowledge/dmaMarkets";
import { US_STATES } from "../planning/knowledge/usStates";
import {
  MAX_GEO_UPLOAD_BYTES,
  geoCoverage,
  mergeGeoEntries,
  parseGeoList,
  stateEntry,
  type GeoSelection,
} from "../planning/geoTargeting";

interface GeoTargetingFieldsProps {
  scope: Exclude<GeoScope, "national">;
  selection: GeoSelection;
  onChange: (next: GeoSelection) => void;
}

const PASTE_PLACEHOLDER = {
  state: "New York, New Jersey, CT",
  dma: "501, 803\nSacramento\nPortland, Or",
} as const;

export const GeoTargetingFields: React.FC<GeoTargetingFieldsProps> = ({ scope, selection, onChange }) => {
  const [pasteValue, setPasteValue] = useState("");
  const [stateQuery, setStateQuery] = useState("");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const coverage = useMemo(
    () => geoCoverage({ scope, ...selection }),
    [scope, selection],
  );

  const selectedIds = useMemo(() => new Set(selection.entries.map((entry) => entry.id)), [selection.entries]);

  const stateOptions = useMemo(() => {
    const query = stateQuery.trim().toLowerCase();
    return US_STATES
      .filter((state) => !selectedIds.has(state.code))
      .filter((state) => !query || state.name.toLowerCase().includes(query) || state.code.toLowerCase() === query);
  }, [selectedIds, stateQuery]);

  const addEntries = (entries: GeoEntry[], unresolved: GeoSelection["unresolved"], inputMethod: GeoSelection["inputMethod"], sourceFileName?: string) => {
    onChange({
      entries: mergeGeoEntries(selection.entries, entries),
      // Warnings describe the last thing the user did, so a clean add clears the old ones.
      unresolved,
      inputMethod,
      sourceFileName,
    });
  };

  const handleAddPasted = () => {
    if (!pasteValue.trim()) return;
    const { entries, unresolved } = parseGeoList(pasteValue, scope);
    addEntries(entries, unresolved, "paste");
    setPasteValue("");
  };

  const handleUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploadError(null);

    if (file.size > MAX_GEO_UPLOAD_BYTES) {
      setUploadError(`${file.name} is ${(file.size / 1_000_000).toFixed(1)}MB. Upload a list under 1MB.`);
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => setUploadError(`Could not read ${file.name}.`);
    reader.onload = () => {
      const { entries, unresolved } = parseGeoList(String(reader.result || ""), scope);
      if (entries.length === 0 && unresolved.length === 0) {
        setUploadError(`${file.name} contained no ${scope === "dma" ? "markets" : "states"}.`);
        return;
      }
      addEntries(entries, unresolved, "upload", file.name);
    };
    reader.readAsText(file);
  };

  const removeEntry = (id: string) => {
    onChange({ ...selection, entries: selection.entries.filter((entry) => entry.id !== id) });
  };

  return (
    <div className="border border-slate-200 rounded-xl p-3 space-y-3 bg-slate-50/60">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider flex items-center gap-1">
          <MapPin className="w-3.5 h-3.5 text-slate-400" />
          {scope === "state" ? "Target States" : "Target DMAs"}
        </span>
        <span className="text-[10px] text-slate-400">
          {scope === "state" ? "Select, paste, or upload" : "Paste or upload"}
        </span>
      </div>

      {scope === "state" && (
        <div>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={stateQuery}
              onChange={(e) => setStateQuery(e.target.value)}
              placeholder="Search states..."
              className="w-full text-xs pl-8 pr-3 py-2 border border-slate-200 rounded-xl bg-white focus:outline-hidden focus:border-indigo-500 placeholder:text-slate-400"
            />
          </div>
          {stateQuery.trim() && (
            <div className="mt-1.5 max-h-36 overflow-y-auto custom-scrollbar border border-slate-200 rounded-xl bg-white divide-y divide-slate-50">
              {stateOptions.length === 0 ? (
                <p className="px-3 py-2 text-[11px] text-slate-400">No matching states.</p>
              ) : stateOptions.map((state) => (
                <button
                  key={state.code}
                  type="button"
                  onClick={() => {
                    const entry = stateEntry(state.code);
                    if (entry) addEntries([entry], [], "select");
                    setStateQuery("");
                  }}
                  className="w-full text-left px-3 py-1.5 text-xs text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 cursor-pointer transition-colors"
                >
                  {state.name} <span className="text-slate-400">({state.code})</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div>
        <textarea
          value={pasteValue}
          onChange={(e) => setPasteValue(e.target.value)}
          onBlur={handleAddPasted}
          placeholder={PASTE_PLACEHOLDER[scope]}
          className="w-full h-16 text-xs px-3 py-2 border border-slate-200 rounded-xl bg-white focus:outline-hidden focus:border-indigo-500 resize-none placeholder:text-slate-400"
        />
        <div className="flex items-center gap-2 mt-1.5">
          <button
            type="button"
            onClick={handleAddPasted}
            disabled={!pasteValue.trim()}
            className="px-3 py-1.5 text-[11px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-lg hover:bg-indigo-100 disabled:text-slate-400 disabled:bg-slate-100 disabled:border-slate-200 disabled:cursor-not-allowed cursor-pointer transition-colors"
          >
            Add {scope === "state" ? "states" : "markets"}
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="px-3 py-1.5 text-[11px] font-semibold text-slate-600 bg-white border border-slate-200 rounded-lg hover:border-indigo-300 hover:text-indigo-700 cursor-pointer transition-colors inline-flex items-center gap-1.5"
          >
            <Upload className="w-3 h-3" />
            Upload .csv / .txt
          </button>
          <input ref={fileInputRef} type="file" accept=".csv,.txt,text/csv,text/plain" onChange={handleUpload} className="hidden" />
        </div>
      </div>

      {uploadError && (
        <p className="text-[11px] text-rose-700 bg-rose-50 border border-rose-100 rounded-lg px-2.5 py-1.5">{uploadError}</p>
      )}

      {selection.entries.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selection.entries.map((entry) => (
            <span key={entry.id} className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 text-[11px] font-medium text-slate-700 bg-white border border-slate-200 rounded-lg">
              {entry.name}
              <span className="text-slate-400">{scope === "dma" ? `(${entry.id})` : entry.id}</span>
              <button
                type="button"
                onClick={() => removeEntry(entry.id)}
                className="p-0.5 text-slate-400 hover:text-rose-600 rounded cursor-pointer transition-colors"
                title={`Remove ${entry.name}`}
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {coverage?.scope === "dma" && (
        <p className="text-[11px] text-slate-500">
          <span className="font-semibold text-slate-700">{coverage.marketCount} markets</span>
          {" · "}{coverage.tvHouseholds.toLocaleString()} TV HH
          {" · "}{coverage.usSharePct.toFixed(1)}% of US
          {" · "}{coverage.states.length} states
          <span className="block text-[10px] text-slate-400 mt-0.5">{DMA_SOURCE_LABEL}</span>
        </p>
      )}

      {/* Household coverage is deliberately absent for state targeting: multi-state markets
          would be counted once per state they touch. Overlap and spill are what the mapping
          actually supports. */}
      {coverage?.scope === "state" && (
        <p className="text-[11px] text-slate-500">
          <span className="font-semibold text-slate-700">{coverage.stateCount} states</span>
          {" · "}served by {coverage.overlappingDmaCount} DMAs
          {coverage.spillMarketCount > 0 && (
            <span className="block text-[10px] text-amber-700 mt-0.5">
              {coverage.spillMarketCount} of those markets also deliver into {coverage.spillStates.length} neighbouring states ({coverage.spillStates.join(", ")}).
            </span>
          )}
        </p>
      )}

      {selection.unresolved.length > 0 && (
        <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-2 space-y-1">
          <p className="font-semibold flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" />
            {selection.unresolved.length} entr{selection.unresolved.length === 1 ? "y" : "ies"} not recognised
          </p>
          <ul className="space-y-0.5">
            {selection.unresolved.map((token, index) => (
              <li key={`${token.token}-${index}`} className="leading-snug">
                <span className="font-mono">{token.token}</span>
                {token.reason === "ambiguous" && token.candidates && (
                  <span className="text-amber-700"> — matches {token.candidates.join(", ")}. Enter the full name or code.</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
