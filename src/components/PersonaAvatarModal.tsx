import React, { useState, useEffect } from "react";
import {
  X,
  Sparkles,
  Check,
  History,
  RotateCcw,
  Loader2,
  Image as ImageIcon,
  Trash2,
  Wand2,
  ArrowRight,
  Info
} from "lucide-react";
import type { Persona, PersonaAvatarVersion } from "../types";

interface PersonaAvatarModalProps {
  isOpen: boolean;
  onClose: () => void;
  persona: Persona | null;
  personaIndex: number;
  onSelectAvatar: (personaIndex: number, avatarUrl: string, updatedHistory: PersonaAvatarVersion[]) => void;
  onGenerateNew: (personaIndex: number, instruction: string) => Promise<string | null>;
  isGenerating: boolean;
}

const PRESET_INSTRUCTIONS = [
  "Add stylish modern glasses",
  "Business formal attire (suit & collar)",
  "Creative casual attire & open posture",
  "Warm, welcoming, approachable smile",
  "Make slightly older and distinguished",
  "Slightly younger, energetic look",
  "Subtle modern office background",
  "Outdoor / warm daylight lighting",
];

export const PersonaAvatarModal: React.FC<PersonaAvatarModalProps> = ({
  isOpen,
  onClose,
  persona,
  personaIndex,
  onSelectAvatar,
  onGenerateNew,
  isGenerating,
}) => {
  const [instruction, setInstruction] = useState("");
  const [history, setHistory] = useState<PersonaAvatarVersion[]>([]);
  const [activeUrl, setActiveUrl] = useState<string>("");
  const [previewUrl, setPreviewUrl] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Sync internal state when modal opens or persona changes
  useEffect(() => {
    if (!persona || !isOpen) return;

    const currentUrl = persona.avatarUrl || "";
    setActiveUrl(currentUrl);
    setPreviewUrl(currentUrl);
    setErrorMsg(null);
    setInstruction("");

    // Initialize or adapt history
    const existingHistory = persona.avatarHistory || [];
    if (existingHistory.length > 0) {
      setHistory(existingHistory);
    } else if (currentUrl) {
      // Seed first version if none recorded yet
      const initialVersion: PersonaAvatarVersion = {
        id: `v-init-${Date.now()}`,
        url: currentUrl,
        prompt: "Initial studio archetype portrait",
        createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setHistory([initialVersion]);
    } else {
      setHistory([]);
    }
  }, [isOpen, persona]);

  if (!isOpen || !persona) return null;

  const handleGenerate = async (textToUse?: string) => {
    const textPrompt = textToUse !== undefined ? textToUse : instruction;
    setErrorMsg(null);
    try {
      const newUrl = await onGenerateNew(personaIndex, textPrompt);
      if (newUrl) {
        const newVersion: PersonaAvatarVersion = {
          id: `v-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          url: newUrl,
          prompt: textPrompt.trim() || "Default archetype portrait",
          createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        };
        // Keep up to 8 recent versions to respect storage
        const updatedHistory = [newVersion, ...history].slice(0, 8);
        setHistory(updatedHistory);
        setActiveUrl(newUrl);
        setPreviewUrl(newUrl);
        setInstruction("");
        onSelectAvatar(personaIndex, newUrl, updatedHistory);
      } else {
        setErrorMsg("Image generation did not return a valid portrait. Please try again.");
      }
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to generate headshot variation.");
    }
  };

  const handleSelectVersion = (version: PersonaAvatarVersion) => {
    setPreviewUrl(version.url);
    setActiveUrl(version.url);
    onSelectAvatar(personaIndex, version.url, history);
  };

  const handleDeleteVersion = (e: React.MouseEvent, versionId: string) => {
    e.stopPropagation();
    const updated = history.filter((v) => v.id !== versionId);
    setHistory(updated);
    
    // If deleted the active one, fallback to the first available or empty
    if (previewUrl === history.find((v) => v.id === versionId)?.url) {
      const nextActive = updated[0]?.url || "";
      setPreviewUrl(nextActive);
      setActiveUrl(nextActive);
      onSelectAvatar(personaIndex, nextActive, updated);
    } else {
      onSelectAvatar(personaIndex, activeUrl, updated);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div 
        className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50/70">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-xs">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-slate-800 text-base leading-tight">
                  Customize Persona Headshot
                </h3>
                <span className="text-[10px] uppercase font-mono bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded font-bold border border-indigo-100">
                  Archetype 0{personaIndex + 1}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                <span className="font-medium text-slate-700">{persona.name}</span> • {persona.age || "35"} y/o {persona.gender || "Audience"} • {persona.income || "Middle-income"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto space-y-5">
          {/* Top Stage: Active Preview + Prompting Input */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-5 items-start">
            {/* Left: 160x160 Portrait Preview Box */}
            <div className="sm:col-span-5 flex flex-col items-center">
              <div className="relative group w-44 h-44 rounded-2xl overflow-hidden bg-slate-100 ring-4 ring-indigo-50 border border-slate-200 shadow-sm flex items-center justify-center">
                {isGenerating ? (
                  <div className="absolute inset-0 bg-white/95 backdrop-blur-xs flex flex-col items-center justify-center text-center p-3 text-indigo-600 animate-pulse">
                    <Loader2 className="w-8 h-8 animate-spin mb-2 text-indigo-600" />
                    <span className="text-xs font-semibold text-slate-800">Generating portrait...</span>
                    <span className="text-[11px] text-slate-500 mt-0.5">Applying creative directives</span>
                  </div>
                ) : previewUrl ? (
                  <>
                    <img
                      src={previewUrl}
                      alt={persona.name}
                      className="w-full h-full object-cover object-center"
                    />
                    <div className="absolute bottom-2 left-2 right-2 bg-slate-900/70 backdrop-blur-xs text-white text-[10px] font-medium py-1 px-2 rounded-md flex items-center justify-between">
                      <span className="flex items-center gap-1">
                        <Check className="w-3 h-3 text-emerald-400" /> Active Selection
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center text-slate-400 p-3 text-center">
                    <ImageIcon className="w-10 h-10 mb-1 text-slate-300" />
                    <span className="text-xs font-medium">No headshot yet</span>
                  </div>
                )}
              </div>
              <p className="text-[11px] text-slate-400 text-center mt-2 flex items-center gap-1">
                <Info className="w-3 h-3" /> Centered 1:1 photorealistic studio portrait
              </p>
            </div>

            {/* Right: Custom Directive & Generate Button */}
            <div className="sm:col-span-7 flex flex-col gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Creative Instructions & Styling
                </label>
                <div className="relative">
                  <textarea
                    rows={3}
                    value={instruction}
                    onChange={(e) => setInstruction(e.target.value)}
                    placeholder="E.g., Wearing modern glasses, casual tech startup hoodie, warm natural smile, slightly warmer lighting..."
                    className="w-full text-xs p-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 placeholder:text-slate-400 text-slate-800 resize-none shadow-xs"
                    disabled={isGenerating}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        handleGenerate();
                      }
                    }}
                  />
                </div>
              </div>

              {/* Quick suggestion chips */}
              <div>
                <span className="text-[11px] font-medium text-slate-500 block mb-1.5">
                  Suggested adjustments:
                </span>
                <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1">
                  {PRESET_INSTRUCTIONS.map((preset, idx) => (
                    <button
                      key={idx}
                      type="button"
                      disabled={isGenerating}
                      onClick={() => {
                        const newText = instruction ? `${instruction}, ${preset}` : preset;
                        setInstruction(newText);
                      }}
                      className="text-[10px] font-medium bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 text-slate-600 px-2.5 py-1 rounded-full border border-slate-200/80 transition-colors cursor-pointer disabled:opacity-50"
                    >
                      + {preset}
                    </button>
                  ))}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => handleGenerate()}
                  disabled={isGenerating}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white text-xs font-semibold rounded-xl shadow-xs transition-colors cursor-pointer disabled:opacity-50"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Generating Portrait...</span>
                    </>
                  ) : (
                    <>
                      <Wand2 className="w-4 h-4" />
                      <span>{instruction.trim() ? "Generate Custom Look" : "Generate Variation"}</span>
                    </>
                  )}
                </button>
                {instruction.trim() && (
                  <button
                    type="button"
                    onClick={() => setInstruction("")}
                    disabled={isGenerating}
                    className="p-2.5 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 border border-slate-200 text-xs cursor-pointer"
                    title="Clear prompt"
                  >
                    Clear
                  </button>
                )}
              </div>

              {errorMsg && (
                <div className="text-xs text-rose-600 bg-rose-50 border border-rose-100 p-2.5 rounded-lg flex items-center gap-2">
                  <span className="font-semibold">Error:</span> {errorMsg}
                </div>
              )}
            </div>
          </div>

          {/* Bottom Stage: Version History Strip */}
          <div className="border-t border-slate-100 pt-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <History className="w-4 h-4 text-slate-500" />
                <h4 className="text-xs font-semibold text-slate-800">
                  Version History ({history.length})
                </h4>
              </div>
              <span className="text-[11px] text-slate-400">
                Click any thumbnail to set as active persona headshot
              </span>
            </div>

            {history.length === 0 ? (
              <div className="p-6 text-center border border-dashed border-slate-200 rounded-xl bg-slate-50/50">
                <p className="text-xs text-slate-400">No previous versions recorded yet.</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {history.map((ver, idx) => {
                  const isCurrent = previewUrl === ver.url;
                  const versionNum = history.length - idx;
                  return (
                    <div
                      key={ver.id || idx}
                      onClick={() => handleSelectVersion(ver)}
                      className={`relative group rounded-xl border p-2 cursor-pointer transition-all flex flex-col items-center bg-white ${
                        isCurrent
                          ? "border-indigo-600 ring-2 ring-indigo-500/20 shadow-xs"
                          : "border-slate-200 hover:border-indigo-300 hover:shadow-xs"
                      }`}
                    >
                      {/* Thumbnail with overlay badge */}
                      <div className="w-20 h-20 rounded-lg overflow-hidden bg-slate-100 relative mb-1.5 aspect-square">
                        <img
                          src={ver.url}
                          alt={`Version ${versionNum}`}
                          className="w-full h-full object-cover object-center"
                        />
                        {isCurrent && (
                          <div className="absolute top-1 right-1 w-5 h-5 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow-xs">
                            <Check className="w-3 h-3 stroke-[3]" />
                          </div>
                        )}
                        {/* Delete single version button */}
                        {history.length > 1 && (
                          <button
                            type="button"
                            onClick={(e) => handleDeleteVersion(e, ver.id)}
                            className="absolute bottom-1 right-1 opacity-0 group-hover:opacity-100 p-1 bg-slate-900/70 hover:bg-rose-600 text-white rounded transition-all cursor-pointer"
                            title="Delete this version"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>

                      {/* Version Details */}
                      <div className="text-center w-full min-w-0">
                        <div className="flex items-center justify-center gap-1">
                          <span className={`text-[11px] font-bold ${isCurrent ? "text-indigo-600" : "text-slate-700"}`}>
                            v{versionNum}
                          </span>
                          {idx === 0 && (
                            <span className="text-[9px] bg-slate-100 text-slate-600 px-1 rounded font-medium">
                              Latest
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-slate-400 truncate mt-0.5 px-1" title={ver.prompt || "Default archetype portrait"}>
                          {ver.prompt || "Default portrait"}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-5 py-3.5 border-t border-slate-100 bg-slate-50/70">
          <p className="text-xs text-slate-500">
            Selected look will be saved and used in all slides and exports.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
