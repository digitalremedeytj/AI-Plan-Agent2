import React, { useState, useEffect, useRef } from "react";
import {
  X,
  Sparkles,
  Download,
  Copy,
  Check,
  LayoutGrid,
  User,
  Sliders,
  Maximize2,
  RefreshCw,
  AlertCircle,
  Clock,
  ChevronRight,
  MonitorPlay,
  ChevronDown,
  Layers,
  Target,
  BarChart3,
  ShieldCheck,
  CheckCircle2,
  Users
} from "lucide-react";
import type { ChannelStrategyData, SegmentRecommendation } from "../types";
import type { MediaRecommendationPlan, ChannelPlanRecommendation } from "../planning/types";
import { isNonMediaItem } from "../utils/mediaTaxonomy";

export type SlideAspectRatio = "21:9" | "2:1" | "16:9" | "3:2" | "4:3" | "1:1" | "3:4" | "2:3" | "9:16";

export interface AspectRatioOption {
  value: SlideAspectRatio;
  label: string;
  name: string;
  category: "Horizontal" | "Square" | "Vertical";
  width: number;
  height: number;
  // Bounding box for visual icon: max dimension 28px
  boxWidth: number;
  boxHeight: number;
}

export const ASPECT_RATIO_OPTIONS: AspectRatioOption[] = [
  { value: "21:9", label: "21:9", name: "Ultrawide (21:9)", category: "Horizontal", width: 2560, height: 1088, boxWidth: 28, boxHeight: 12 },
  { value: "2:1",  label: "2:1",  name: "Univisium (2:1)",  category: "Horizontal", width: 2560, height: 1280, boxWidth: 26, boxHeight: 13 },
  { value: "16:9", label: "16:9", name: "Widescreen (16:9)", category: "Horizontal", width: 2560, height: 1440, boxWidth: 24, boxHeight: 13.5 },
  { value: "3:2",  label: "3:2",  name: "Classic Photo (3:2)", category: "Horizontal", width: 2160, height: 1440, boxWidth: 21, boxHeight: 14 },
  { value: "4:3",  label: "4:3",  name: "Standard Deck (4:3)", category: "Horizontal", width: 1920, height: 1440, boxWidth: 20, boxHeight: 15 },
  { value: "1:1",  label: "1:1",  name: "Square Grid (1:1)", category: "Square", width: 2048, height: 2048, boxWidth: 16, boxHeight: 16 },
  { value: "3:4",  label: "3:4",  name: "Portrait Deck (3:4)", category: "Vertical", width: 1440, height: 1920, boxWidth: 15, boxHeight: 20 },
  { value: "2:3",  label: "2:3",  name: "Portrait Photo (2:3)", category: "Vertical", width: 1440, height: 2160, boxWidth: 14, boxHeight: 21 },
  { value: "9:16", label: "9:16", name: "Vertical / Mobile (9:16)", category: "Vertical", width: 1440, height: 2560, boxWidth: 13.5, boxHeight: 24 },
];

export interface PresentationSlideStudioModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialSection?: "personas" | "channels" | "segments";
  personas?: any[];
  segments?: SegmentRecommendation[];
  channelStrategy?: ChannelStrategyData;
  mediaPlan?: MediaRecommendationPlan;
  advertiserName?: string;
  campaignFocus?: string;
  geography?: string;
  api?: {
    authFetch: (url: string, init?: RequestInit) => Promise<Response>;
  };
}

export type PersonaSlideExportModalProps = PresentationSlideStudioModalProps;

interface GeneratedSlide {
  id: string;
  section: "personas" | "channels" | "segments";
  mode: "portfolio" | "spotlight" | "overview";
  personaIndex?: number;
  personaName?: string;
  channelIndex?: number;
  channelName?: string;
  imageUrl: string;
  style: "corporate_light" | "modern_dark" | "minimal_slate";
  aspectRatio?: SlideAspectRatio;
  dimensions?: { width: number; height: number };
  timestamp: Date;
}

export const PresentationSlideStudioModal: React.FC<PresentationSlideStudioModalProps> = ({
  isOpen,
  onClose,
  initialSection = "personas",
  personas = [],
  segments = [],
  channelStrategy,
  mediaPlan,
  advertiserName = "",
  campaignFocus = "",
  geography = "",
  api,
}) => {
  // Current active section dropdown: "personas" | "channels" | "segments"
  const [section, setSection] = useState<"personas" | "channels" | "segments">(initialSection);

  // Aspect ratio state (16:9 is default)
  const [aspectRatio, setAspectRatio] = useState<SlideAspectRatio>("16:9");
  const [isRatioDropdownOpen, setIsRatioDropdownOpen] = useState<boolean>(false);
  const ratioDropdownRef = useRef<HTMLDivElement>(null);

  // Mode state for Personas
  const [personaMode, setPersonaMode] = useState<"portfolio" | "spotlight">("portfolio");

  // Mode state for Channels: "overview" (All active channels on 1 slide) | "spotlight" (1 slide per active channel)
  const [channelMode, setChannelMode] = useState<"overview" | "spotlight">("overview");

  // Common styling and custom directives
  const [style, setStyle] = useState<"corporate_light" | "modern_dark" | "minimal_slate">("corporate_light");
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);
  const [customNotes, setCustomNotes] = useState<string>("");

  // Generation & progress state
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [progressStep, setProgressStep] = useState<number>(0);
  const [completedCount, setCompletedCount] = useState<number>(0);
  const [totalToGenerate, setTotalToGenerate] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  // Gallery of generated slides separated by section so switching preserves state
  const [personaSlides, setPersonaSlides] = useState<GeneratedSlide[]>([]);
  const [activePersonaSlideIndex, setActivePersonaSlideIndex] = useState<number>(0);

  const [channelSlides, setChannelSlides] = useState<GeneratedSlide[]>([]);
  const [activeChannelSlideIndex, setActiveChannelSlideIndex] = useState<number>(0);

  const [segmentSlides, setSegmentSlides] = useState<GeneratedSlide[]>([]);
  const [activeSegmentSlideIndex, setActiveSegmentSlideIndex] = useState<number>(0);

  // Copy feedback & zoom
  const [isCopied, setIsCopied] = useState<boolean>(false);
  const [isZoomed, setIsZoomed] = useState<boolean>(false);

  // Close ratio dropdown on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (ratioDropdownRef.current && !ratioDropdownRef.current.contains(e.target as Node)) {
        setIsRatioDropdownOpen(false);
      }
    };
    if (isRatioDropdownOpen) {
      document.addEventListener("mousedown", handleOutsideClick);
    }
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  }, [isRatioDropdownOpen]);

  // Sync initial section when modal opens
  useEffect(() => {
    if (isOpen && initialSection) {
      setSection(initialSection);
      setError(null);
    }
  }, [isOpen, initialSection]);

  // Step labels for persona generation
  const personaSteps = [
    "Analyzing consumer behavioral data...",
    "Rendering photographic studio portraits...",
    "Arranging structured slide body content...",
    "Composing widescreen 16:9 graphic...",
    "Finalizing high-resolution presentation layout..."
  ];

  // Step labels for channel generation
  const channelSteps = [
    "Auditing active plan allocations & budget parameters...",
    "Formatting channel cards and targeting tactics...",
    "Arranging high-impact 16:9 widescreen layout...",
    "Composing visual allocation distribution and metrics...",
    "Finalizing high-resolution presentation layout..."
  ];

  // Step labels for segment recommendations generation
  const segmentSteps = [
    "Auditing recommended segment taxonomy & signals...",
    "Organizing segments by strategic dimension & tier...",
    "Formatting high-impact 16:9 widescreen layout...",
    "Composing segment activation cards and targeting rationale...",
    "Finalizing high-resolution presentation layout..."
  ];

  const currentSteps = section === "personas" ? personaSteps : section === "channels" ? channelSteps : segmentSteps;

  useEffect(() => {
    let timer: any;
    if (isGenerating) {
      setProgressStep(0);
      timer = setInterval(() => {
        setProgressStep((prev) => (prev < currentSteps.length - 1 ? prev + 1 : prev));
      }, 7000);
    } else {
      setProgressStep(0);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isGenerating, currentSteps.length]);

  if (!isOpen) return null;

  // Active Personas (up to 4)
  const candidatePersonas = (personas || []).slice(0, 4);

  // Active Channels in Plan ONLY (strictly excluding "Media types not in plan")
  const effectiveMediaPlan = mediaPlan || channelStrategy?.mediaPlan;
  const rawChannels = (effectiveMediaPlan?.channels || []) as ChannelPlanRecommendation[];
  const fundedChannels: ChannelPlanRecommendation[] = rawChannels.filter((c) => {
    if (c.canonicalId && isNonMediaItem(c.canonicalId)) return false;
    if (typeof c.allocationPercent === "number" && c.allocationPercent <= 0) return false;
    return true;
  });

  const candidateSegments = segments || [];
  const hasPersonas = candidatePersonas.length > 0;
  const hasChannels = fundedChannels.length > 0;
  const hasSegments = candidateSegments.length > 0;

  // Selected aspect ratio configuration
  const currentRatioOption = ASPECT_RATIO_OPTIONS.find((o) => o.value === aspectRatio) || ASPECT_RATIO_OPTIONS[2];

  // Active slide references depending on current section
  const currentSlides = section === "personas" ? personaSlides : section === "channels" ? channelSlides : segmentSlides;
  const currentActiveIndex = section === "personas" ? activePersonaSlideIndex : section === "channels" ? activeChannelSlideIndex : activeSegmentSlideIndex;
  const activeSlide = currentSlides[currentActiveIndex];

  const handleGenerate = async () => {
    setIsGenerating(true);
    setError(null);

    const fetchFn = api?.authFetch || ((url: string, opts: any) => fetch(url, { ...opts, credentials: "include" }));

    // ==========================================
    // 1. PERSONAS SECTION GENERATION
    // ==========================================
    if (section === "personas") {
      if (personaMode === "portfolio") {
        setTotalToGenerate(1);
        setCompletedCount(0);
        try {
          const payload = {
            mode: "portfolio",
            personaIndex: 0,
            personas: candidatePersonas,
            advertiserName,
            campaignFocus,
            geography,
            style,
            aspectRatio,
            customNotes: customNotes.trim(),
          };

          const res = await fetchFn("/api/personas/generate-slide", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });

          if (!res.ok) {
            const errJson = await res.json().catch(() => ({}));
            throw new Error(errJson.details || errJson.error || `Server responded with ${res.status}`);
          }

          const data = await res.json();
          if (!data.success || !data.imageUrl) {
            throw new Error(data.error || "Model did not return slide image.");
          }

          const newSlide: GeneratedSlide = {
            id: `${Date.now()}-portfolio`,
            section: "personas",
            mode: "portfolio",
            personaName: "All 4 Personas",
            imageUrl: data.imageUrl,
            style,
            aspectRatio,
            dimensions: data.dimensions,
            timestamp: new Date(),
          };

          setCompletedCount(1);
          setPersonaSlides((prev) => [newSlide, ...prev]);
          setActivePersonaSlideIndex(0);
        } catch (err: any) {
          console.error("[SlideStudioModal] Error generating personas portfolio slide:", err);
          setError(err.message || "Failed to generate presentation slide. Please try again.");
        } finally {
          setIsGenerating(false);
        }
      } else {
        // Spotlight mode: generate 1 slide per persona concurrently and tab them
        const total = candidatePersonas.length;
        setTotalToGenerate(total);
        setCompletedCount(0);

        try {
          const fetchSlideForPersona = async (pIdx: number): Promise<GeneratedSlide> => {
            const targetPersona = candidatePersonas[pIdx];
            const payload = {
              mode: "spotlight",
              personaIndex: pIdx,
              personas: candidatePersonas,
              advertiserName,
              campaignFocus,
              geography,
              style,
              aspectRatio,
              customNotes: customNotes.trim(),
            };

            const res = await fetchFn("/api/personas/generate-slide", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            });

            if (!res.ok) {
              const errJson = await res.json().catch(() => ({}));
              throw new Error(errJson.details || errJson.error || `Server error on persona ${pIdx + 1}`);
            }

            const data = await res.json();
            if (!data.success || !data.imageUrl) {
              throw new Error(data.error || `Failed to generate slide for persona ${pIdx + 1}`);
            }

            const slide: GeneratedSlide = {
              id: `${Date.now()}-persona-spotlight-${pIdx}-${Math.random().toString(36).substring(2, 6)}`,
              section: "personas",
              mode: "spotlight",
              personaIndex: pIdx,
              personaName: targetPersona?.name || `Persona ${pIdx + 1}`,
              imageUrl: data.imageUrl,
              style,
              aspectRatio,
              dimensions: data.dimensions,
              timestamp: new Date(),
            };

            setCompletedCount((prev) => prev + 1);
            return slide;
          };

          const settled = await Promise.allSettled(
            candidatePersonas.map((_, pIdx) => fetchSlideForPersona(pIdx))
          );

          const successfulSlides: GeneratedSlide[] = [];
          const failedIndices: number[] = [];

          settled.forEach((result, idx) => {
            if (result.status === "fulfilled") {
              successfulSlides.push(result.value);
            } else {
              console.error(`Persona ${idx + 1} generation failed:`, result.reason);
              failedIndices.push(idx + 1);
            }
          });

          if (successfulSlides.length === 0) {
            throw new Error("Unable to generate spotlight slides. Please verify your connection or try again.");
          }

          successfulSlides.sort((a, b) => (a.personaIndex ?? 0) - (b.personaIndex ?? 0));
          setPersonaSlides((prev) => [...successfulSlides, ...prev]);
          setActivePersonaSlideIndex(0);

          if (failedIndices.length > 0) {
            setError(`Generated ${successfulSlides.length} of ${candidatePersonas.length} slides. Persona ${failedIndices.join(", ")} encountered an issue.`);
          }
        } catch (err: any) {
          console.error("[SlideStudioModal] Error generating persona spotlight slides:", err);
          setError(err.message || "Failed to generate spotlight presentation slides. Please try again.");
        } finally {
          setIsGenerating(false);
        }
      }
    }

    // ==========================================
    // 2. CHANNELS SECTION GENERATION
    // ==========================================
    else {
      if (fundedChannels.length === 0) {
        setError("No active funded channels found in current media plan.");
        setIsGenerating(false);
        return;
      }

      if (channelMode === "overview") {
        setTotalToGenerate(1);
        setCompletedCount(0);
        try {
          const payload = {
            mode: "overview",
            channelIndex: 0,
            channels: fundedChannels,
            workingMediaBudget: effectiveMediaPlan?.workingMediaBudget || channelStrategy?.totalRfpBudget || 0,
            flightDays: effectiveMediaPlan?.flightDays ?? null,
            appliedBudgetTier: effectiveMediaPlan?.appliedBudgetTier || "",
            advertiserName,
            campaignFocus,
            geography,
            style,
            aspectRatio,
            customNotes: customNotes.trim(),
            executiveInsight: channelStrategy?.executiveInsight || "",
          };

          const res = await fetchFn("/api/channels/generate-slide", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });

          if (!res.ok) {
            const errJson = await res.json().catch(() => ({}));
            throw new Error(errJson.details || errJson.error || `Server responded with ${res.status}`);
          }

          const data = await res.json();
          if (!data.success || !data.imageUrl) {
            throw new Error(data.error || "Model did not return channel slide image.");
          }

          const newSlide: GeneratedSlide = {
            id: `${Date.now()}-channel-overview`,
            section: "channels",
            mode: "overview",
            channelName: "Media Mix Overview",
            imageUrl: data.imageUrl,
            style,
            aspectRatio,
            dimensions: data.dimensions,
            timestamp: new Date(),
          };

          setCompletedCount(1);
          setChannelSlides((prev) => [newSlide, ...prev]);
          setActiveChannelSlideIndex(0);
        } catch (err: any) {
          console.error("[SlideStudioModal] Error generating channel overview slide:", err);
          setError(err.message || "Failed to generate channel presentation slide. Please try again.");
        } finally {
          setIsGenerating(false);
        }
      } else {
        // Spotlight mode: generate 1 slide per funded channel concurrently and tab them
        const total = fundedChannels.length;
        setTotalToGenerate(total);
        setCompletedCount(0);

        try {
          const fetchSlideForChannel = async (cIdx: number): Promise<GeneratedSlide> => {
            const targetChannel = fundedChannels[cIdx];
            const payload = {
              mode: "spotlight",
              channelIndex: cIdx,
              channels: fundedChannels,
              workingMediaBudget: effectiveMediaPlan?.workingMediaBudget || channelStrategy?.totalRfpBudget || 0,
              flightDays: effectiveMediaPlan?.flightDays ?? null,
              appliedBudgetTier: effectiveMediaPlan?.appliedBudgetTier || "",
              advertiserName,
              campaignFocus,
              geography,
              style,
              aspectRatio,
              customNotes: customNotes.trim(),
              executiveInsight: channelStrategy?.executiveInsight || "",
            };

            const res = await fetchFn("/api/channels/generate-slide", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            });

            if (!res.ok) {
              const errJson = await res.json().catch(() => ({}));
              throw new Error(errJson.details || errJson.error || `Server error on channel ${cIdx + 1}`);
            }

            const data = await res.json();
            if (!data.success || !data.imageUrl) {
              throw new Error(data.error || `Failed to generate slide for channel ${cIdx + 1}`);
            }

            const slide: GeneratedSlide = {
              id: `${Date.now()}-channel-spotlight-${cIdx}-${Math.random().toString(36).substring(2, 6)}`,
              section: "channels",
              mode: "spotlight",
              channelIndex: cIdx,
              channelName: targetChannel?.channelName || `Channel ${cIdx + 1}`,
              imageUrl: data.imageUrl,
              style,
              aspectRatio,
              dimensions: data.dimensions,
              timestamp: new Date(),
            };

            setCompletedCount((prev) => prev + 1);
            return slide;
          };

          const settled = await Promise.allSettled(
            fundedChannels.map((_, cIdx) => fetchSlideForChannel(cIdx))
          );

          const successfulSlides: GeneratedSlide[] = [];
          const failedIndices: number[] = [];

          settled.forEach((result, idx) => {
            if (result.status === "fulfilled") {
              successfulSlides.push(result.value);
            } else {
              console.error(`Channel ${idx + 1} generation failed:`, result.reason);
              failedIndices.push(idx + 1);
            }
          });

          if (successfulSlides.length === 0) {
            throw new Error("Unable to generate channel spotlight slides. Please verify your connection or try again.");
          }

          successfulSlides.sort((a, b) => (a.channelIndex ?? 0) - (b.channelIndex ?? 0));
          setChannelSlides((prev) => [...successfulSlides, ...prev]);
          setActiveChannelSlideIndex(0);

          if (failedIndices.length > 0) {
            setError(`Generated ${successfulSlides.length} of ${fundedChannels.length} slides. Channel ${failedIndices.join(", ")} encountered an issue.`);
          }
        } catch (err: any) {
          console.error("[SlideStudioModal] Error generating channel spotlight slides:", err);
          setError(err.message || "Failed to generate channel spotlight presentation slides. Please try again.");
        } finally {
          setIsGenerating(false);
        }
      }
    }

    // ==========================================
    // 3. SEGMENTS SECTION GENERATION
    // ==========================================
    if (section === "segments") {
      setTotalToGenerate(1);
      setCompletedCount(0);
      try {
        const payload = {
          segments: candidateSegments,
          advertiserName,
          campaignFocus,
          geography,
          style,
          aspectRatio,
          customNotes: customNotes.trim(),
        };

        const res = await fetchFn("/api/segments/generate-slide", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const errJson = await res.json().catch(() => ({}));
          throw new Error(errJson.details || errJson.error || `Server responded with ${res.status}`);
        }

        const data = await res.json();
        if (!data.success || !data.imageUrl) {
          throw new Error(data.error || "Model did not return slide image.");
        }

        const newSlide: GeneratedSlide = {
          id: `${Date.now()}-segments`,
          section: "segments",
          mode: "overview",
          imageUrl: data.imageUrl,
          style,
          aspectRatio,
          dimensions: data.dimensions,
          timestamp: new Date(),
        };

        setCompletedCount(1);
        setSegmentSlides((prev) => [newSlide, ...prev]);
        setActiveSegmentSlideIndex(0);
      } catch (err: any) {
        console.error("[SlideStudioModal] Error generating segments slide:", err);
        setError(err.message || "Failed to generate segment presentation slide. Please try again.");
      } finally {
        setIsGenerating(false);
      }
    }
  };

  const handleDownload = (slide: GeneratedSlide) => {
    if (!slide || !slide.imageUrl) return;
    const cleanBrand = (advertiserName || "brand").toLowerCase().replace(/[^a-z0-9]/g, "-");
    let namePart = "slide";

    if (slide.section === "personas") {
      namePart = slide.mode === "portfolio"
        ? "all-personas-portfolio"
        : `persona-${(slide.personaIndex !== undefined ? slide.personaIndex + 1 : 1)}-${(slide.personaName || "spotlight").toLowerCase().replace(/[^a-z0-9]/g, "-")}`;
    } else if (slide.section === "channels") {
      namePart = slide.mode === "overview"
        ? "channel-strategy-media-mix-overview"
        : `channel-spotlight-${(slide.channelIndex !== undefined ? slide.channelIndex + 1 : 1)}-${(slide.channelName || "spotlight").toLowerCase().replace(/[^a-z0-9]/g, "-")}`;
    } else {
      namePart = "audience-segment-recommendations";
    }

    const ratioSuffix = (slide.aspectRatio || aspectRatio || "16:9").replace(":", "x");
    const filename = `${cleanBrand}-${namePart}-${ratioSuffix}.png`;

    const link = document.createElement("a");
    link.href = slide.imageUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDownloadAll = () => {
    currentSlides.forEach((slide, index) => {
      setTimeout(() => {
        handleDownload(slide);
      }, index * 300);
    });
  };

  const handleCopyToClipboard = async (slide: GeneratedSlide) => {
    if (!slide || !slide.imageUrl) return;
    try {
      const res = await fetch(slide.imageUrl);
      const blob = await res.blob();
      await navigator.clipboard.write([
        new ClipboardItem({
          [blob.type]: blob,
        }),
      ]);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2500);
    } catch (err) {
      console.warn("Direct blob copy to clipboard failed, falling back to URL copy:", err);
      try {
        await navigator.clipboard.writeText(slide.imageUrl);
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 2500);
      } catch (fallbackErr) {
        console.error("Clipboard write failed:", fallbackErr);
      }
    }
  };

  return (
    <div
      id="presentation-slide-studio-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/70 backdrop-blur-xs overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isGenerating) onClose();
      }}
    >
      <div
        id="presentation-slide-studio-dialog"
        className="bg-white border border-slate-200/90 rounded-2xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/80">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#0e8f86] text-white flex items-center justify-center shadow-xs">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-900">
                  Export Presentation Slide Studio
                </h2>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-700">
                  {currentRatioOption.label} ({currentRatioOption.width}×{currentRatioOption.height})
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Generates clean slide body content designed to drop directly into white master slide decks (no headers, logos, or footers)
              </p>
            </div>
          </div>

          {/* Right controls: Aspect Ratio Dropdown + Section Dropdown + Close X */}
          <div className="flex items-center gap-2.5 sm:gap-3">
            {/* Aspect Ratio Custom Dropdown */}
            <div className="relative" ref={ratioDropdownRef}>
              <div className="flex items-center gap-1.5 sm:gap-2">
                <span className="text-xs font-semibold text-slate-500 hidden sm:inline">
                  Ratio:
                </span>
                <button
                  type="button"
                  id="btn-select-aspect-ratio"
                  onClick={() => !isGenerating && setIsRatioDropdownOpen((prev) => !prev)}
                  disabled={isGenerating}
                  className="flex items-center gap-2 pl-2 pr-2 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-bold text-slate-800 hover:border-slate-400 focus:outline-hidden focus:ring-2 focus:ring-[#0e8f86] cursor-pointer shadow-2xs transition-colors disabled:opacity-50"
                  title="Select slide aspect ratio"
                  aria-haspopup="listbox"
                  aria-expanded={isRatioDropdownOpen}
                >
                  <div className="w-6 h-5 flex items-center justify-center bg-slate-50 rounded-[2px] border border-slate-200 shrink-0">
                    <div
                      style={{
                        width: `${Math.max(4, Math.round(currentRatioOption.boxWidth * 0.7))}px`,
                        height: `${Math.max(4, Math.round(currentRatioOption.boxHeight * 0.7))}px`,
                      }}
                      className="border border-[#0e8f86] bg-[#0e8f86]/25 rounded-[1px]"
                    />
                  </div>
                  <span className="font-bold text-slate-900">{aspectRatio}</span>
                  <ChevronDown className={`w-3.5 h-3.5 text-slate-500 transition-transform ${isRatioDropdownOpen ? "rotate-180" : ""}`} />
                </button>
              </div>

              {/* Aspect Ratio Menu with visual preview boxes */}
              {isRatioDropdownOpen && (
                <div
                  id="menu-aspect-ratio-options"
                  className="absolute right-0 top-full mt-1.5 w-64 bg-white border border-slate-200 rounded-xl shadow-xl z-50 py-1.5 overflow-hidden animate-in fade-in zoom-in-95 duration-100"
                  role="listbox"
                  aria-label="Slide aspect ratios"
                >
                  <div className="px-3 py-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100">
                    Select Aspect Ratio
                  </div>
                  <div className="max-h-80 overflow-y-auto py-1 divide-y divide-slate-100/60">
                    {ASPECT_RATIO_OPTIONS.map((opt) => {
                      const isSelected = opt.value === aspectRatio;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          id={`option-ratio-${opt.value.replace(":", "-")}`}
                          role="option"
                          aria-selected={isSelected}
                          onClick={() => {
                            setAspectRatio(opt.value);
                            setIsRatioDropdownOpen(false);
                          }}
                          className={`w-full px-3 py-2 text-left flex items-center justify-between gap-2.5 hover:bg-slate-50 transition-colors cursor-pointer ${
                            isSelected ? "bg-teal-50/70 text-[#0e8f86]" : "text-slate-700"
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            {/* Visual Box in the option's specific ratio */}
                            <div className="w-8 h-7 flex items-center justify-center bg-slate-100 rounded border border-slate-200 shrink-0">
                              <div
                                style={{
                                  width: `${opt.boxWidth}px`,
                                  height: `${opt.boxHeight}px`,
                                }}
                                className={`rounded-[1.5px] transition-all ${
                                  isSelected
                                    ? "border-2 border-[#0e8f86] bg-[#0e8f86]/30 shadow-2xs"
                                    : "border border-slate-400 bg-white"
                                }`}
                              />
                            </div>
                            <div>
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-bold text-slate-900">
                                  {opt.label}
                                </span>
                                {opt.value === "16:9" && (
                                  <span className="text-[9px] font-semibold px-1.5 py-0.2 rounded bg-slate-200 text-slate-700">
                                    Default
                                  </span>
                                )}
                              </div>
                              <div className="text-[10px] text-slate-500 leading-tight">
                                {opt.name.split(" (")[0]} • {opt.width}×{opt.height}
                              </div>
                            </div>
                          </div>

                          {isSelected && (
                            <Check className="w-4 h-4 text-[#0e8f86] shrink-0" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Section Dropdown */}
            <div className="flex items-center gap-1.5 sm:gap-2">
              <span className="text-xs font-semibold text-slate-500 hidden sm:inline">
                Section:
              </span>
              <div className="relative">
                <select
                  id="select-slide-studio-section"
                  value={section}
                  onChange={(e) => {
                    const newSec = e.target.value as "personas" | "channels" | "segments";
                    setSection(newSec);
                    setError(null);
                  }}
                  disabled={isGenerating}
                  className="appearance-none pl-3 pr-8 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-bold text-slate-800 hover:border-slate-400 focus:outline-hidden focus:ring-2 focus:ring-[#0e8f86] cursor-pointer shadow-2xs transition-colors"
                >
                  <option value="personas" disabled={!hasPersonas}>
                    Personas {candidatePersonas.length > 0 ? `(${candidatePersonas.length} Archetypes)` : ""}
                  </option>
                  <option value="channels" disabled={!hasChannels}>
                    Channels {fundedChannels.length > 0 ? `(${fundedChannels.length} in Plan)` : ""}
                  </option>
                  <option value="segments" disabled={!hasSegments}>
                    Segments {candidateSegments.length > 0 ? `(${candidateSegments.length} Targets)` : ""}
                  </option>
                </select>
                <ChevronDown className="w-3.5 h-3.5 text-slate-500 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            </div>

            <button
              type="button"
              id="btn-close-presentation-slide-studio"
              onClick={onClose}
              disabled={isGenerating}
              className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer disabled:opacity-50"
              title="Close"
              aria-label="Close presentation slide studio"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {error && (
            <div className="p-4 rounded-xl bg-red-50 border border-red-200 flex items-start gap-3 text-red-800 text-xs">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <span className="font-semibold">Slide generation notice: </span>
                {error}
              </div>
              <button
                type="button"
                onClick={() => setError(null)}
                className="text-red-500 hover:text-red-700 text-xs font-semibold cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* ========================================================================= */}
          {/* A. PERSONAS CONFIGURATION VIEW */}
          {/* ========================================================================= */}
          {section === "personas" && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Option 1: 4-in-1 Executive Portfolio */}
                <div
                  id="card-mode-persona-portfolio"
                  onClick={() => !isGenerating && setPersonaMode("portfolio")}
                  className={`p-4 rounded-xl border-2 transition-all cursor-pointer flex flex-col justify-between ${
                    personaMode === "portfolio"
                      ? "border-[#0e8f86] bg-[#0e8f86]/5 shadow-xs ring-2 ring-[#0e8f86]/20"
                      : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/50"
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className={`p-1.5 rounded-lg ${personaMode === "portfolio" ? "bg-[#0e8f86] text-white" : "bg-slate-100 text-slate-600"}`}>
                          <LayoutGrid className="w-4 h-4" />
                        </div>
                        <span className="text-sm font-bold text-slate-900">All 4 Personas on 1 Slide</span>
                      </div>
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-[#0e8f86]/10 text-[#0e8f86]">
                        1 Slide (All 4)
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      Presents all 4 consumer archetypes side-by-side in 4 body cards with round portraits, demographics, and Watch/Browse/Buy habits. Styled with the Teal &amp; Indigo design system on a clean white deck canvas.
                    </p>
                  </div>

                  <div className="mt-3 pt-3 border-t border-slate-200/60 flex items-center justify-between text-[11px] text-slate-500">
                    <span>Best for: Deck Overview &amp; Executive Summaries</span>
                    <span className={`font-semibold ${personaMode === "portfolio" ? "text-[#0e8f86]" : "text-slate-400"}`}>
                      {personaMode === "portfolio" ? "Selected" : "Select"}
                    </span>
                  </div>
                </div>

                {/* Option 2: 4 Individual Spotlight Slides */}
                <div
                  id="card-mode-persona-spotlight"
                  onClick={() => !isGenerating && setPersonaMode("spotlight")}
                  className={`p-4 rounded-xl border-2 transition-all cursor-pointer flex flex-col justify-between ${
                    personaMode === "spotlight"
                      ? "border-[#0e8f86] bg-[#0e8f86]/5 shadow-xs ring-2 ring-[#0e8f86]/20"
                      : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/50"
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className={`p-1.5 rounded-lg ${personaMode === "spotlight" ? "bg-[#0e8f86] text-white" : "bg-slate-100 text-slate-600"}`}>
                          <User className="w-4 h-4" />
                        </div>
                        <span className="text-sm font-bold text-slate-900">4 Individual Spotlight Slides</span>
                      </div>
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-[#6b63e6]/10 text-[#6b63e6]">
                        4 Slides (1 per Persona)
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      Generates all 4 spotlight slides at once (1 detailed slide per persona archetype), automatically tabbed for quick navigation and review. Ready for your white slide deck.
                    </p>
                  </div>

                  <div className="mt-3 pt-3 border-t border-slate-200/60 flex items-center justify-between text-[11px] text-slate-500">
                    <span>Creates 4 separate 16:9 slides</span>
                    <span className={`font-semibold ${personaMode === "spotlight" ? "text-[#0e8f86]" : "text-slate-400"}`}>
                      {personaMode === "spotlight" ? "Selected" : "Select"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* B. CHANNELS CONFIGURATION VIEW */}
          {/* ========================================================================= */}
          {section === "channels" && (
            <div className="space-y-4">
              {/* Context Callout: Note strictly excluding "Media types not in plan" */}
              <div className="p-3 bg-teal-50/80 border border-teal-200/80 rounded-xl flex items-center justify-between gap-3 text-xs text-teal-900">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-[#0e8f86] shrink-0" />
                  <span>
                    <strong>Approved Media Plan Focus:</strong> Exports strictly feature the <strong>{fundedChannels.length} active funded channels</strong> in your plan. Candidate media types not in the plan are excluded.
                  </span>
                </div>
                {effectiveMediaPlan && (
                  <span className="hidden sm:inline-flex px-2 py-0.5 rounded-md bg-white border border-teal-200 text-[11px] font-semibold text-[#0e8f86]">
                    Budget: ${Math.round(effectiveMediaPlan.workingMediaBudget || 0).toLocaleString()} • {effectiveMediaPlan.flightDays ? `${effectiveMediaPlan.flightDays} Days` : "Flight not set"}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Option 1: All Active Channels on 1 Slide (Media Mix Overview) */}
                <div
                  id="card-mode-channel-overview"
                  onClick={() => !isGenerating && setChannelMode("overview")}
                  className={`p-4 rounded-xl border-2 transition-all cursor-pointer flex flex-col justify-between ${
                    channelMode === "overview"
                      ? "border-[#0e8f86] bg-[#0e8f86]/5 shadow-xs ring-2 ring-[#0e8f86]/20"
                      : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/50"
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className={`p-1.5 rounded-lg ${channelMode === "overview" ? "bg-[#0e8f86] text-white" : "bg-slate-100 text-slate-600"}`}>
                          <LayoutGrid className="w-4 h-4" />
                        </div>
                        <span className="text-sm font-bold text-slate-900">All Channels on 1 Slide</span>
                      </div>
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-[#0e8f86]/10 text-[#0e8f86]">
                        1 Slide (Media Mix)
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      Presents the full executive media mix portfolio on a single 16:9 widescreen slide. Adaptively fits all {fundedChannels.length} active channels cleanly using selective metric formatting and balanced multi-column grid layouts. Zero headers or footers.
                    </p>
                  </div>

                  <div className="mt-3 pt-3 border-t border-slate-200/60 flex items-center justify-between text-[11px] text-slate-500">
                    <span>Best for: Deck Overview &amp; Executive Mix Summaries</span>
                    <span className={`font-semibold ${channelMode === "overview" ? "text-[#0e8f86]" : "text-slate-400"}`}>
                      {channelMode === "overview" ? "Selected" : "Select"}
                    </span>
                  </div>
                </div>

                {/* Option 2: Individual Channel Spotlight Slides */}
                <div
                  id="card-mode-channel-spotlight"
                  onClick={() => !isGenerating && setChannelMode("spotlight")}
                  className={`p-4 rounded-xl border-2 transition-all cursor-pointer flex flex-col justify-between ${
                    channelMode === "spotlight"
                      ? "border-[#0e8f86] bg-[#0e8f86]/5 shadow-xs ring-2 ring-[#0e8f86]/20"
                      : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/50"
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className={`p-1.5 rounded-lg ${channelMode === "spotlight" ? "bg-[#0e8f86] text-white" : "bg-slate-100 text-slate-600"}`}>
                          <Layers className="w-4 h-4" />
                        </div>
                        <span className="text-sm font-bold text-slate-900">Individual Channel Slides</span>
                      </div>
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-[#6b63e6]/10 text-[#6b63e6]">
                        {fundedChannels.length} Slides (1 per Channel)
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      Generates all {fundedChannels.length} channel spotlight slides at once (1 deep dive per active channel in your plan), tabbed side-by-side. Details targeting tactics, publishers, and attribution.
                    </p>
                  </div>

                  <div className="mt-3 pt-3 border-t border-slate-200/60 flex items-center justify-between text-[11px] text-slate-500">
                    <span>Creates {fundedChannels.length} separate 16:9 slides</span>
                    <span className={`font-semibold ${channelMode === "spotlight" ? "text-[#0e8f86]" : "text-slate-400"}`}>
                      {channelMode === "spotlight" ? "Selected" : "Select"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* C. SEGMENTS CONFIGURATION VIEW */}
          {/* ========================================================================= */}
          {section === "segments" && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl border-2 border-[#0e8f86] bg-[#0e8f86]/5 shadow-xs ring-2 ring-[#0e8f86]/20">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-[#0e8f86] text-white">
                      <Users className="w-4 h-4" />
                    </div>
                    <span className="text-sm font-bold text-slate-900">Audience Segments Matrix</span>
                  </div>
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-[#0e8f86]/10 text-[#0e8f86]">
                    1 Slide ({candidateSegments.length} Segments)
                  </span>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed mb-3">
                  Renders your entire curated audience segment recommendations onto a single image to drop in a presentation slide. Segments are structured into bento columns by strategic dimension (In-Market / Intent, Behavioral, Interest & Affinity, Demographics), displaying targeting tiers (Core, Expansion, Experimental), data signals, and concise activation rationales. Zero headers or footers.
                </p>
                <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-200/60">
                  {["In-Market / Intent", "Behavioral", "Interest & Affinity", "Demographics"].map((dim) => {
                    const count = candidateSegments.filter((s) => s.dimension === dim).length;
                    if (count === 0) return null;
                    return (
                      <span key={dim} className="text-[11px] font-semibold px-2.5 py-1 rounded-md bg-white border border-slate-200 text-slate-700 inline-flex items-center gap-1.5 shadow-2xs">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#0e8f86]" />
                        <span>{dim}: <strong>{count}</strong></span>
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Collapsible Advanced Custom Notes */}
          <div className="space-y-2">
            <button
              type="button"
              id="btn-toggle-advanced-slide-notes"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-1.5 cursor-pointer"
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>{showAdvanced ? "Hide Custom AI Prompt Directives" : "Add Custom AI Directives & Client Brand Notes (Optional)"}</span>
              <ChevronRight className={`w-3.5 h-3.5 transition-transform ${showAdvanced ? "rotate-90" : ""}`} />
            </button>

            {showAdvanced && (
              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2 animate-in fade-in duration-150">
                <label htmlFor="input-custom-notes" className="text-xs font-semibold text-slate-700 block">
                  Additional Creative or Strategic Directives:
                </label>
                <textarea
                  id="input-custom-notes"
                  rows={2}
                  value={customNotes}
                  onChange={(e) => setCustomNotes(e.target.value)}
                  placeholder={
                    section === "personas"
                      ? "e.g., Emphasize live sports CTV viewing, highlight suburban family lifestyle, or focus on mobile app commerce..."
                      : section === "channels"
                      ? "e.g., Emphasize premium live sports inventory on CTV, highlight ROAS attribution, or focus on brand lift metrics..."
                      : "e.g., Emphasize In-Market intent signals, highlight automotive purchase data, or emphasize cross-device reach..."
                  }
                  className="w-full text-xs p-2.5 rounded-lg border border-slate-200 bg-white focus:outline-hidden focus:ring-2 focus:ring-[#0e8f86]/20 focus:border-[#0e8f86] placeholder:text-slate-400"
                />
                <p className="text-[11px] text-slate-500">
                  Custom guidance will be embedded directly into the 16:9 visual composition engine.
                </p>
              </div>
            )}
          </div>

          {/* Primary Action Button */}
          <div className="flex items-center justify-between pt-2">
            <div className="text-xs text-slate-500">
              {section === "personas" ? (
                personaMode === "portfolio" ? (
                  <span>Creates 1 comprehensive {aspectRatio} slide with all 4 personas</span>
                ) : (
                  <span>Creates 4 individual {aspectRatio} spotlight slides tabbed side-by-side</span>
                )
              ) : section === "channels" ? (
                channelMode === "overview" ? (
                  <span>Creates 1 comprehensive {aspectRatio} slide with all {fundedChannels.length} active channels</span>
                ) : (
                  <span>Creates {fundedChannels.length} individual {aspectRatio} spotlight slides tabbed side-by-side</span>
                )
              ) : (
                <span>Creates 1 comprehensive {aspectRatio} slide with all {candidateSegments.length} recommended segments</span>
              )}
            </div>

            <button
              type="button"
              id="btn-generate-slide-studio"
              onClick={handleGenerate}
              disabled={isGenerating || (section === "personas" ? candidatePersonas.length === 0 : section === "channels" ? fundedChannels.length === 0 : candidateSegments.length === 0)}
              className={`px-6 py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all cursor-pointer shadow-xs ${
                isGenerating
                  ? "bg-slate-200 text-slate-400 cursor-not-allowed"
                  : "bg-[#0e8f86] hover:bg-[#0c7a72] active:scale-[0.99] text-white"
              }`}
            >
              {isGenerating ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin text-slate-400" />
                  <span>
                    {section === "personas"
                      ? personaMode === "spotlight"
                        ? `Generating All 4 Spotlight Slides... (${completedCount}/${totalToGenerate || candidatePersonas.length})`
                        : "Generating All 4 Personas Slide..."
                      : section === "channels"
                        ? channelMode === "spotlight"
                          ? `Generating All ${fundedChannels.length} Channel Slides... (${completedCount}/${totalToGenerate || fundedChannels.length})`
                          : "Generating Media Mix Overview Slide..."
                        : "Generating Audience Segments Slide..."}
                  </span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>
                    {section === "personas"
                      ? personaMode === "spotlight"
                        ? (personaSlides.length > 0 ? "Regenerate All 4 Spotlight Slides" : `Generate All 4 Spotlight Slides (${aspectRatio})`)
                        : (personaSlides.length > 0 ? "Regenerate All 4 Personas on 1 Slide" : `Generate All 4 Personas on 1 Slide (${aspectRatio})`)
                      : section === "channels"
                        ? channelMode === "spotlight"
                          ? (channelSlides.length > 0 ? `Regenerate All ${fundedChannels.length} Channel Slides` : `Generate All ${fundedChannels.length} Channel Slides (${aspectRatio})`)
                          : (channelSlides.length > 0 ? "Regenerate Media Mix Overview Slide" : `Generate Media Mix Overview Slide (${aspectRatio})`)
                        : (segmentSlides.length > 0 ? "Regenerate Audience Segments Slide" : `Generate Audience Segments Slide (${aspectRatio})`)}
                  </span>
                </>
              )}
            </button>
          </div>

          {/* Progress Indicator when generating */}
          {isGenerating && (
            <div className="p-4 bg-teal-50/80 border border-teal-100 rounded-xl space-y-2.5 animate-pulse">
              <div className="flex items-center justify-between text-xs text-teal-950 font-semibold">
                <div className="flex items-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-[#0e8f86]" />
                  <span>
                    {section === "personas"
                      ? personaMode === "spotlight"
                        ? `Rendering 4 Spotlight Slides in parallel (${completedCount}/${totalToGenerate || candidatePersonas.length} completed)...`
                        : "AI Rendering All 4 Personas on 1 Slide..."
                      : section === "channels"
                        ? channelMode === "spotlight"
                          ? `Rendering ${fundedChannels.length} Channel Slides in parallel (${completedCount}/${totalToGenerate || fundedChannels.length} completed)...`
                          : "AI Rendering Media Mix Overview on 1 Slide..."
                        : "AI Rendering Audience Segments on 1 Slide..."}
                  </span>
                </div>
                <div className="flex items-center gap-1 text-slate-500 font-normal">
                  <Clock className="w-3.5 h-3.5" />
                  <span>~30–45s for {aspectRatio} ultra-high fidelity</span>
                </div>
              </div>

              {/* Progress bar */}
              <div className="w-full h-1.5 bg-teal-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#0e8f86] rounded-full transition-all duration-500 ease-out"
                  style={{
                    width: totalToGenerate > 0
                      ? `${Math.max(12, (completedCount / totalToGenerate) * 100)}%`
                      : `${((progressStep + 1) / currentSteps.length) * 100}%`,
                  }}
                />
              </div>

              <div className="text-xs text-teal-900 font-medium flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#0e8f86]" />
                  <span>
                    {totalToGenerate > 1 && completedCount > 0
                      ? `Completed ${completedCount} of ${totalToGenerate} slides...`
                      : currentSteps[progressStep]}
                  </span>
                </div>
                {totalToGenerate > 1 && (
                  <span className="text-[11px] text-[#0e8f86] font-semibold">
                    {Math.round(((completedCount) / totalToGenerate) * 100)}%
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Generated Slide Preview & Tabbed Gallery Section */}
          {currentSlides.length > 0 && (
            <div className="space-y-4 pt-4 border-t border-slate-200">
              {/* Gallery Header / Tabs */}
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <MonitorPlay className="w-4 h-4 text-[#0e8f86]" />
                  <span className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                    Generated {section === "personas" ? "Persona" : section === "channels" ? "Channel" : "Segment"} Slides ({currentSlides.length})
                  </span>
                </div>

                {/* Tab selector for switching slides */}
                {currentSlides.length > 1 && (
                  <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg overflow-x-auto max-w-full">
                    {currentSlides.map((s, idx) => {
                      const isActive = currentActiveIndex === idx;
                      let tabLabel = "Slide";
                      if (s.section === "personas") {
                        tabLabel = s.mode === "portfolio"
                          ? "All 4 Personas"
                          : s.personaIndex !== undefined
                            ? `${s.personaIndex + 1}. ${s.personaName}`
                            : s.personaName || `Persona ${idx + 1}`;
                      } else if (s.section === "channels") {
                        tabLabel = s.mode === "overview"
                          ? "Media Mix Overview"
                          : s.channelIndex !== undefined
                            ? `${s.channelIndex + 1}. ${s.channelName}`
                            : s.channelName || `Channel ${idx + 1}`;
                      } else {
                        tabLabel = "Audience Segments Matrix";
                      }

                      return (
                        <button
                          key={s.id}
                          type="button"
                          id={`btn-slide-tab-${idx}`}
                          onClick={() => {
                            if (section === "personas") {
                              setActivePersonaSlideIndex(idx);
                            } else if (section === "channels") {
                              setActiveChannelSlideIndex(idx);
                            } else {
                              setActiveSegmentSlideIndex(idx);
                            }
                          }}
                          className={`px-3 py-1.5 text-xs rounded-md font-medium transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                            isActive
                              ? "bg-white text-[#0e8f86] shadow-xs font-bold border border-slate-200/80"
                              : "text-slate-600 hover:text-slate-900 hover:bg-slate-200/50"
                          }`}
                        >
                          {s.mode === "portfolio" || s.mode === "overview" ? (
                            <LayoutGrid className={`w-3 h-3 ${isActive ? "text-[#0e8f86]" : "text-slate-400"}`} />
                          ) : s.section === "personas" ? (
                            <User className={`w-3 h-3 ${isActive ? "text-[#0e8f86]" : "text-slate-400"}`} />
                          ) : s.section === "segments" ? (
                            <Users className={`w-3 h-3 ${isActive ? "text-[#0e8f86]" : "text-slate-400"}`} />
                          ) : (
                            <Layers className={`w-3 h-3 ${isActive ? "text-[#0e8f86]" : "text-slate-400"}`} />
                          )}
                          <span>{tabLabel}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Active Slide Display */}
              {activeSlide && (
                <div className="space-y-3">
                  {/* Slide Container with dynamic aspect ratio, light gray border and 4px border-radius */}
                  <div className="flex justify-center w-full">
                    <div
                      className="relative group bg-white rounded-[4px] overflow-hidden shadow-xs border border-gray-200 flex items-center justify-center p-1 sm:p-2"
                      style={{
                        aspectRatio: (activeSlide.aspectRatio || aspectRatio).replace(":", "/"),
                        maxHeight: "520px",
                        maxWidth: "100%",
                      }}
                    >
                      <img
                        id="generated-slide-image"
                        src={activeSlide.imageUrl}
                        alt="Generated Presentation Slide"
                        className="max-w-full max-h-full object-contain rounded-[4px]"
                      />

                      {/* Overlay Action Pills */}
                      <div className="absolute top-2.5 right-2.5 flex items-center gap-2 opacity-90 group-hover:opacity-100 transition-opacity">
                        <button
                          type="button"
                          id="btn-zoom-slide"
                          onClick={() => setIsZoomed(true)}
                          className="p-1.5 rounded-[4px] bg-slate-900/80 hover:bg-slate-900 text-white backdrop-blur-xs text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer shadow-xs"
                          title="View Fullscreen"
                        >
                          <Maximize2 className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline text-[11px]">Inspect Full</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Slide Action Bar */}
                  <div className="flex items-center justify-between flex-wrap gap-3 p-3.5 bg-slate-50 border border-slate-200 rounded-xl">
                    <div className="text-xs text-slate-600">
                      <span className="font-semibold text-slate-900">
                        {activeSlide.section === "personas"
                          ? (activeSlide.mode === "portfolio" ? "All 4 Personas on 1 Slide" : `Spotlight: ${activeSlide.personaName}`)
                          : activeSlide.section === "channels"
                            ? (activeSlide.mode === "overview" ? "Media Mix Overview" : `Spotlight: ${activeSlide.channelName}`)
                            : "Audience Segments Matrix"}
                      </span>
                      <span className="text-slate-400 mx-1.5">•</span>
                      <span>
                        {activeSlide.dimensions ? `${activeSlide.dimensions.width}×${activeSlide.dimensions.height}` : `${currentRatioOption.width}×${currentRatioOption.height}`} PNG ({activeSlide.aspectRatio || aspectRatio})
                      </span>
                      <span className="text-slate-400 mx-1.5">•</span>
                      <span className="text-emerald-700 font-medium">Slide Deck Ready (No Headers/Footers)</span>
                    </div>

                    <div className="flex items-center gap-2">
                      {/* Copy to Clipboard */}
                      <button
                        type="button"
                        id="btn-copy-slide-clipboard"
                        onClick={() => handleCopyToClipboard(activeSlide)}
                        className="px-3.5 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-100 text-slate-700 font-semibold text-xs flex items-center gap-1.5 transition-all cursor-pointer"
                      >
                        {isCopied ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-600" />
                            <span className="text-emerald-700 font-bold">Copied to Clipboard!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5 text-slate-500" />
                            <span>Copy to Clipboard</span>
                          </>
                        )}
                      </button>

                      {/* Download PNG */}
                      <button
                        type="button"
                        id="btn-download-slide-png"
                        onClick={() => handleDownload(activeSlide)}
                        className="px-4 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Download {activeSlide.aspectRatio || aspectRatio} PNG</span>
                      </button>

                      {/* Download All Slides if multiple */}
                      {currentSlides.length > 1 && (
                        <button
                          type="button"
                          id="btn-download-all-slides"
                          onClick={handleDownloadAll}
                          className="px-3.5 py-1.5 rounded-lg border border-teal-200 bg-teal-50 hover:bg-teal-100 text-teal-800 font-semibold text-xs flex items-center gap-1.5 transition-all cursor-pointer"
                          title="Download all generated slides"
                        >
                          <Download className="w-3.5 h-3.5 text-[#0e8f86]" />
                          <span>Download All ({currentSlides.length})</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Fullscreen Zoom Modal */}
      {isZoomed && activeSlide && (
        <div
          className="fixed inset-0 z-60 bg-black/90 backdrop-blur-sm flex flex-col p-4"
          onClick={() => setIsZoomed(false)}
        >
          <div className="flex items-center justify-between pb-3 text-white">
            <span className="text-sm font-semibold">
              {activeSlide.section === "personas"
                ? (activeSlide.mode === "portfolio" ? "All 4 Personas" : `Spotlight: ${activeSlide.personaName}`)
                : activeSlide.section === "channels"
                  ? (activeSlide.mode === "overview" ? "Media Mix Overview" : `Spotlight: ${activeSlide.channelName}`)
                  : "Audience Segments Matrix"} ({activeSlide.aspectRatio || aspectRatio})
            </span>
            <button
              type="button"
              onClick={() => setIsZoomed(false)}
              className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="flex-1 flex items-center justify-center overflow-hidden">
            <img
              src={activeSlide.imageUrl}
              alt="Fullscreen Presentation Slide"
              className="max-w-full max-h-full object-contain rounded-[4px] border border-gray-200 bg-white shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export const PersonaSlideExportModal = PresentationSlideStudioModal;
