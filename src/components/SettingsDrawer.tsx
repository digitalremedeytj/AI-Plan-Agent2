import React from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  Download,
  Edit2,
  ExternalLink,
  Eye,
  EyeOff,
  FileSpreadsheet,
  Film,
  FolderSync,
  HelpCircle,
  Image as ImageIcon,
  Info,
  Lock,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Settings,
  Sliders,
  Sparkles,
  Trash2,
  Tv,
  Upload,
  X
} from "lucide-react";
import { CANONICAL_MEDIA_TAXONOMY } from "../utils/mediaTaxonomy";
import {
  BudgetChannelTier,
  clonePlanningSettings,
  CustomProductSetting,
  CUSTOM_PRODUCT_ID_PREFIX,
  DEFAULT_PLANNING_SETTINGS,
  EnhancementPlanningSetting,
  InternalOnlySettingId,
  OverviewMetricId,
  PlanningSettings,
  ProductPlanningSetting,
  validatePlanningSettings,
} from "../planning/settings";
import {
  CtvPublisherSetting,
  DEFAULT_CTV_PUBLISHERS,
  resolvePublisherLogo,
  validateCtvPublishers,
} from "../planning/knowledge/ctvPublishers";
import { authFetch } from "../api/client";
import type { AudienceShareFilter, ReachMediaTypeSetting } from "../planning/reach/reachSettings";
import { DMA_MARKETS, DMA_SOURCE_LABEL } from "../planning/knowledge/dmaMarkets";
import { NATIONAL_TV_HOUSEHOLDS, STATE_HOUSEHOLDS, STATE_HOUSEHOLDS_SOURCE_LABEL } from "../planning/knowledge/stateHouseholds";
import { ScoutPromptsSettings } from "./ScoutPromptsSettings";

interface SettingsDrawerProps {
  open: boolean;
  settings: PlanningSettings;
  ctvPublishers: CtvPublisherSetting[];
  onClose: () => void;
  onSave: (settings: PlanningSettings, ctvPublishers: CtvPublisherSetting[]) => void;
  /**
   * True when the signed-in user may not write global settings. These settings are
   * shared by everyone, so non-admins get a fully read-only view rather than an editor
   * whose changes would be rejected on save.
   */
  readOnly?: boolean;
  /** Error text from the last rejected save attempt, surfaced above the footer. */
  saveError?: string | null;
}

type SettingsTab = "visibility" | "budgets" | "reach" | "products" | "publishers" | "enhancements" | "prompts";

function numericValue(value: string): number {
  if (value.trim() === "") return Number.NaN;
  return Number(value);
}

function nullableNumericValue(value: string): number | null {
  return value.trim() === "" ? null : numericValue(value);
}

function listValue(value: string): string[] {
  return value.split(/[,;]+/).map((item) => item.trim()).filter(Boolean);
}

const inputClass = "mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100";
const labelClass = "text-xs font-semibold text-slate-600";

function ShowToggle({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={`Show ${label}`}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-200 ${checked ? "bg-indigo-600" : "bg-slate-300"}`}
    >
      <span className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${checked ? "translate-x-6" : "translate-x-1"}`} />
    </button>
  );
}

export function SettingsDrawer({ open, settings, ctvPublishers, onClose, onSave, readOnly = false, saveError = null }: SettingsDrawerProps) {
  const [draftSettings, setDraftSettings] = React.useState<PlanningSettings>(() => clonePlanningSettings(settings));
  const [draftPublishers, setDraftPublishers] = React.useState<CtvPublisherSetting[]>(() =>
    Array.isArray(ctvPublishers) && ctvPublishers.length > 0
      ? JSON.parse(JSON.stringify(ctvPublishers))
      : JSON.parse(JSON.stringify(DEFAULT_CTV_PUBLISHERS))
  );

  const [errors, setErrors] = React.useState<string[]>([]);
  const [activeTab, setActiveTab] = React.useState<SettingsTab>("publishers");
  const [search, setSearch] = React.useState("");
  
  // CTV Publisher Filters & Modals
  const [pubCategoryFilter, setPubCategoryFilter] = React.useState<"all" | "App" | "Network" | "OS">("all");
  const [pubStatusFilter, setPubStatusFilter] = React.useState<"all" | "active" | "disabled">("all");
  const [pubTierFilter, setPubTierFilter] = React.useState<"all" | "1" | "2" | "3">("all");
  
  // Logo editing modal state
  const [editingLogoPubId, setEditingLogoPubId] = React.useState<string | null>(null);
  const [logoInputUrl, setLogoInputUrl] = React.useState<string>("");
  const [isUploadingLogo, setIsUploadingLogo] = React.useState(false);
  const [logoUploadError, setLogoUploadError] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const csvImportInputRef = React.useRef<HTMLInputElement | null>(null);

  // Add new publisher modal state
  const [isAddPubModalOpen, setIsAddPubModalOpen] = React.useState(false);
  const [newPubName, setNewPubName] = React.useState("");
  const [newPubCategory, setNewPubCategory] = React.useState<"App" | "Network" | "OS">("App");
  const [newPubTier, setNewPubTier] = React.useState<1 | 2 | 3>(2);
  const [newPubChannel, setNewPubChannel] = React.useState("CTV / OTT");
  const [newPubNotes, setNewPubNotes] = React.useState("");
  const [newPubLogoUrl, setNewPubLogoUrl] = React.useState("");

  React.useEffect(() => {
    if (open) {
      setDraftSettings(clonePlanningSettings(settings));
      setDraftPublishers(
        Array.isArray(ctvPublishers) && ctvPublishers.length > 0
          ? JSON.parse(JSON.stringify(ctvPublishers))
          : JSON.parse(JSON.stringify(DEFAULT_CTV_PUBLISHERS))
      );
      setErrors([]);
      setSearch("");
      setEditingLogoPubId(null);
      setIsAddPubModalOpen(false);
    }
  }, [open, settings, ctvPublishers]);

  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (editingLogoPubId) {
          setEditingLogoPubId(null);
        } else if (isAddPubModalOpen) {
          setIsAddPubModalOpen(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, editingLogoPubId, isAddPubModalOpen, onClose]);

  if (!open) return null;

  const clearErrors = () => setErrors([]);

  // Planning Settings Updaters
  const updateTier = (index: number, patch: Partial<BudgetChannelTier>) => {
    setDraftSettings((current) => ({
      ...current,
      budgetChannelTiers: current.budgetChannelTiers.map((tier, tierIndex) =>
        tierIndex === index ? { ...tier, ...patch } : tier
      ),
    }));
    clearErrors();
  };

  const updateProduct = (productId: string, patch: Partial<ProductPlanningSetting>) => {
    setDraftSettings((current) => ({
      ...current,
      products: current.products.map((product) =>
        product.productId === productId ? { ...product, ...patch } : product
      ),
    }));
    clearErrors();
  };

  const updateEnhancement = (enhancementId: string, patch: Partial<EnhancementPlanningSetting>) => {
    setDraftSettings((current) => ({
      ...current,
      enhancements: current.enhancements.map((enhancement) =>
        enhancement.enhancementId === enhancementId ? { ...enhancement, ...patch } : enhancement
      ),
    }));
    clearErrors();
  };

  const updateOverviewMetric = (metricId: OverviewMetricId, show: boolean) => {
    setDraftSettings((current) => ({
      ...current,
      overviewMetrics: current.overviewMetrics.map((metric) =>
        metric.id === metricId ? { ...metric, show } : metric
      ),
    }));
    clearErrors();
  };

  const updateCustomProduct = (productId: string, patch: Partial<CustomProductSetting>) => {
    setDraftSettings((current) => ({
      ...current,
      customProducts: current.customProducts.map((product) =>
        product.productId === productId ? { ...product, ...patch } : product
      ),
    }));
    clearErrors();
  };

  const addCustomProduct = () => {
    setDraftSettings((current) => {
      const taken = new Set([
        ...current.products.map((product) => product.productId),
        ...current.customProducts.map((product) => product.productId),
      ]);
      let suffix = current.customProducts.length + 1;
      while (taken.has(`${CUSTOM_PRODUCT_ID_PREFIX}media_type_${suffix}`)) suffix += 1;
      const productId = `${CUSTOM_PRODUCT_ID_PREFIX}media_type_${suffix}`;
      // Seeded so the record is valid on save; the admin narrows it from here. Blank
      // roles/KPIs would leave ScoutAI nothing to score the media type on.
      const created: CustomProductSetting = {
        productId,
        displayName: `New media type ${suffix}`,
        enabled: true,
        digitalRemedyExecutable: true,
        status: "live",
        recommendationEligible: true,
        supportedGeographies: ["United States"],
        typicalCpmLow: null,
        typicalCpmHigh: null,
        minimumTotalSpend: 5_000,
        minimumNormalized30DaySpend: 5_000,
        minimumFlightDays: 14,
        minimumAllocationPercent: 10,
        maximumAllocationPercent: 100,
        canonicalId: "ctv",
        aliases: [],
        funnelRoles: ["awareness"],
        supportedKpis: ["reach"],
        audienceSignals: [],
        planningNotes: "",
      };
      return { ...current, customProducts: [...current.customProducts, created] };
    });
    clearErrors();
  };

  const removeCustomProduct = (product: CustomProductSetting) => {
    const confirmed = confirm(
      `Delete "${product.displayName}"?\n\nIt will stop being offered in channel allocations and will no longer be sent to ScoutAI. Plans already generated keep the settings revision they were built against, so their numbers do not change.`
    );
    if (!confirmed) return;
    setDraftSettings((current) => ({
      ...current,
      customProducts: current.customProducts.filter((entry) => entry.productId !== product.productId),
    }));
    clearErrors();
  };

  const updateReachMediaType = (mediaTypeId: string, patch: Partial<ReachMediaTypeSetting>) => {
    setDraftSettings((current) => ({
      ...current,
      reach: {
        ...current.reach,
        mediaTypes: current.reach.mediaTypes.map((row) =>
          row.mediaTypeId === mediaTypeId ? { ...row, ...patch } : row
        ),
      },
    }));
    clearErrors();
  };

  const updateReachBand = (patch: { targetMonthlyFrequencyMin?: number; targetMonthlyFrequencyMax?: number; minimumAudienceSharePercent?: number }) => {
    setDraftSettings((current) => ({ ...current, reach: { ...current.reach, ...patch } }));
    clearErrors();
  };

  const updateAudienceFilter = (id: string, patch: Partial<AudienceShareFilter>) => {
    setDraftSettings((current) => ({
      ...current,
      reach: {
        ...current.reach,
        audienceShareReference: current.reach.audienceShareReference.map((filter) => (filter.id === id ? { ...filter, ...patch } : filter)),
      },
    }));
    clearErrors();
  };

  const addAudienceFilter = () => {
    setDraftSettings((current) => ({
      ...current,
      reach: {
        ...current.reach,
        // Ids only need to be unique and stable; saved plans refer to filters by id.
        audienceShareReference: [
          ...current.reach.audienceShareReference,
          { id: `custom-${Date.now().toString(36)}`, category: "", label: "", sharePercent: Number.NaN, source: "" },
        ],
      },
    }));
    clearErrors();
  };

  const removeAudienceFilter = (id: string) => {
    setDraftSettings((current) => ({
      ...current,
      reach: { ...current.reach, audienceShareReference: current.reach.audienceShareReference.filter((filter) => filter.id !== id) },
    }));
    clearErrors();
  };

  const updateInternalOnlySetting = (settingId: InternalOnlySettingId, show: boolean) => {
    setDraftSettings((current) => ({
      ...current,
      internalOnly: current.internalOnly.map((setting) =>
        setting.id === settingId ? { ...setting, show } : setting
      ),
    }));
    clearErrors();
  };

  const addTier = () => {
    setDraftSettings((current) => {
      const tiers = current.budgetChannelTiers.map((tier) => ({ ...tier }));
      const last = tiers[tiers.length - 1];
      const splitAt = last.maxBudgetExclusive ?? Math.max(last.minBudget + 100_000, last.minBudget * 2);
      if (last.maxBudgetExclusive === null) last.maxBudgetExclusive = splitAt;
      tiers.push({ minBudget: splitAt, maxBudgetExclusive: null, maxChannels: last.maxChannels });
      return { ...current, budgetChannelTiers: tiers };
    });
    clearErrors();
  };

  const deleteTier = (index: number) => {
    setDraftSettings((current) => {
      if (current.budgetChannelTiers.length === 1) return current;
      const tiers = current.budgetChannelTiers.map((tier) => ({ ...tier }));
      const removed = tiers[index];
      tiers.splice(index, 1);
      if (index === 0) tiers[0].minBudget = 0;
      else tiers[index - 1].maxBudgetExclusive = removed.maxBudgetExclusive;
      if (index >= tiers.length) tiers[tiers.length - 1].maxBudgetExclusive = null;
      return { ...current, budgetChannelTiers: tiers };
    });
    clearErrors();
  };

  // CTV Publishers Updaters
  const togglePublisher = (id: string) => {
    setDraftPublishers((current) =>
      current.map((p) => (p.id === id ? { ...p, enabled: !p.enabled } : p))
    );
    clearErrors();
  };

  const updatePublisherField = (id: string, patch: Partial<CtvPublisherSetting>) => {
    setDraftPublishers((current) =>
      current.map((p) => (p.id === id ? { ...p, ...patch } : p))
    );
    clearErrors();
  };

  const deletePublisher = (id: string) => {
    setDraftPublishers((current) => current.filter((p) => p.id !== id));
    clearErrors();
  };

  const setAllPublishersStatus = (enabled: boolean) => {
    setDraftPublishers((current) => current.map((p) => ({ ...p, enabled })));
    clearErrors();
  };

  // Logo upload handler
  const handleLogoFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, targetPubId?: string) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploadingLogo(true);
    setLogoUploadError(null);

    try {
      const formData = new FormData();
      formData.append("logo", file);

      const res = await authFetch("/api/ctv-publishers/upload-logo", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (res.ok && data.success && data.logoUrl) {
        if (targetPubId) {
          updatePublisherField(targetPubId, { logoUrl: data.logoUrl });
          setEditingLogoPubId(null);
        } else {
          setNewPubLogoUrl(data.logoUrl);
        }
      } else {
        // Fallback to local Data URL
        const reader = new FileReader();
        reader.onload = (event) => {
          const dataUrl = event.target?.result as string;
          if (dataUrl) {
            if (targetPubId) {
              updatePublisherField(targetPubId, { logoUrl: dataUrl });
              setEditingLogoPubId(null);
            } else {
              setNewPubLogoUrl(dataUrl);
            }
          }
        };
        reader.readAsDataURL(file);
      }
    } catch (err: any) {
      console.warn("Server upload failed, converting to local image:", err);
      const reader = new FileReader();
      reader.onload = (event) => {
        const dataUrl = event.target?.result as string;
        if (dataUrl) {
          if (targetPubId) {
            updatePublisherField(targetPubId, { logoUrl: dataUrl });
            setEditingLogoPubId(null);
          } else {
            setNewPubLogoUrl(dataUrl);
          }
        }
      };
      reader.readAsDataURL(file);
    } finally {
      setIsUploadingLogo(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // CSV Import handler
  const handleCsvImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        if (!content) return;

        const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
        if (lines.length <= 1) return;

        const headerTokens = lines[0].toLowerCase().split(",").map((s) => s.replace(/^"|"$/g, "").trim());
        const hasHeader = headerTokens.some((h) => h.includes("publisher") || h.includes("channel") || h.includes("tier"));
        const startIndex = hasHeader ? 1 : 0;

        const nameIdx = headerTokens.findIndex((h) => h.includes("publisher") || h.includes("name"));
        const channelIdx = headerTokens.findIndex((h) => h.includes("channel"));
        const notesIdx = headerTokens.findIndex((h) => h.includes("notes") || h.includes("environment"));
        const tierIdx = headerTokens.findIndex((h) => h.includes("tier"));
        const categoryIdx = headerTokens.findIndex((h) => h.includes("category"));

        const parsedPubs: CtvPublisherSetting[] = [];

        for (let i = startIndex; i < lines.length; i++) {
          const line = lines[i];
          // Handle quoted commas properly
          const parts: string[] = [];
          let current = "";
          let inQuotes = false;
          for (let c = 0; c < line.length; c++) {
            const char = line[c];
            if (char === '"') {
              inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
              parts.push(current.trim());
              current = "";
            } else {
              current += char;
            }
          }
          parts.push(current.trim());

          const cleanParts = parts.map((p) => p.replace(/^"|"$/g, "").trim());
          if (cleanParts.length === 0 || !cleanParts[0]) continue;

          // Resolve columns
          const name = (nameIdx >= 0 ? cleanParts[nameIdx] : cleanParts[0]) || "";
          if (!name) continue;

          const channel = (channelIdx >= 0 ? cleanParts[channelIdx] : cleanParts[1] || "CTV / OTT") || "CTV / OTT";
          
          // Ignore audio publishers as requested
          if (channel.toLowerCase().includes("audio")) {
            continue;
          }

          const notes = (notesIdx >= 0 ? cleanParts[notesIdx] : (cleanParts.length >= 3 ? cleanParts[2] : "") || "");

          // Tier resolution (1, 2, or 3)
          let tier: 1 | 2 | 3 = 2;
          if (tierIdx >= 0 && cleanParts[tierIdx]) {
            const parsedTier = parseInt(cleanParts[tierIdx], 10);
            if (parsedTier === 1 || parsedTier === 2 || parsedTier === 3) {
              tier = parsedTier;
            }
          } else if (cleanParts.length >= 4) {
            const lastPart = cleanParts[cleanParts.length - 1];
            const parsedTier = parseInt(lastPart, 10);
            if (parsedTier === 1 || parsedTier === 2 || parsedTier === 3) {
              tier = parsedTier;
            }
          }

          // Category resolution
          let category: "App" | "Network" | "OS" = "App";
          if (categoryIdx >= 0 && cleanParts[categoryIdx]) {
            const catRaw = cleanParts[categoryIdx].toLowerCase();
            if (catRaw.includes("network")) category = "Network";
            else if (catRaw.includes("os") || catRaw.includes("fast")) category = "OS";
            else category = "App";
          } else {
            // Infer from channel, notes, or name
            const lowText = (notes + " " + name + " " + channel).toLowerCase();
            if (lowText.includes("fast") || lowText.includes("smart tv") || lowText.includes("vizio") || lowText.includes("roku") || lowText.includes("lg") || lowText.includes("samsung") || lowText.includes("os")) {
              category = "OS";
            } else if (lowText.includes("network") || lowText.includes("cable") || lowText.includes("broadcast") || lowText.includes("news") || lowText.includes("linear") || lowText.includes("fox") || lowText.includes("nbc") || lowText.includes("cbs") || lowText.includes("abc")) {
              category = "Network";
            } else {
              category = "App";
            }
          }

          const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
          parsedPubs.push({
            id: id || `pub-${Date.now()}-${i}`,
            name,
            category,
            channel,
            notes,
            tier,
            enabled: true,
          });
        }

        if (parsedPubs.length > 0) {
          setDraftPublishers(parsedPubs);
          alert(`Successfully imported ${parsedPubs.length} publishers from CSV!`);
        }
      } catch (err: any) {
        console.error("Error parsing CSV:", err);
        alert("Failed to parse CSV file: " + err.message);
      } finally {
        if (csvImportInputRef.current) csvImportInputRef.current.value = "";
      }
    };
    reader.readAsText(file);
  };

  const handleAddNewPublisher = () => {
    if (!newPubName.trim()) {
      alert("Please provide a publisher name.");
      return;
    }

    const id = newPubName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const newPub: CtvPublisherSetting = {
      id: id || `pub-${Date.now()}`,
      name: newPubName.trim(),
      category: newPubCategory,
      channel: newPubChannel.trim() || "CTV / OTT",
      notes: newPubNotes.trim(),
      tier: newPubTier,
      logoUrl: newPubLogoUrl.trim() || undefined,
      enabled: true,
    };

    setDraftPublishers((current) => [newPub, ...current]);
    setIsAddPubModalOpen(false);
    setNewPubName("");
    setNewPubCategory("App");
    setNewPubTier(2);
    setNewPubChannel("CTV / OTT");
    setNewPubNotes("");
    setNewPubLogoUrl("");
  };

  const handleSave = () => {
    // Belt and braces: the server also refuses this, but there is no reason to send a
    // write we already know will be rejected.
    if (readOnly) return;

    const normalizedDraft = clonePlanningSettings(draftSettings);
    const settingsValidation = validatePlanningSettings(normalizedDraft);
    const pubValidation = validateCtvPublishers(draftPublishers);

    const allErrors: string[] = [];
    if (!settingsValidation.valid) allErrors.push(...settingsValidation.errors);
    if (!pubValidation.valid) allErrors.push(...pubValidation.errors);

    if (allErrors.length > 0) {
      setErrors(allErrors);
      return;
    }

    onSave(settingsValidation.settings || normalizedDraft, pubValidation.publishers || draftPublishers);
    onClose();
  };

  const handleCancel = () => {
    setDraftSettings(clonePlanningSettings(settings));
    setDraftPublishers(
      Array.isArray(ctvPublishers) && ctvPublishers.length > 0
        ? JSON.parse(JSON.stringify(ctvPublishers))
        : JSON.parse(JSON.stringify(DEFAULT_CTV_PUBLISHERS))
    );
    setErrors([]);
    onClose();
  };

  // Filtered publishers list
  const normalizedSearch = search.trim().toLowerCase();
  const visiblePublishers = draftPublishers.filter((pub) => {
    if (pubCategoryFilter !== "all" && pub.category !== pubCategoryFilter) return false;
    if (pubStatusFilter === "active" && !pub.enabled) return false;
    if (pubStatusFilter === "disabled" && pub.enabled) return false;
    if (pubTierFilter !== "all" && String(pub.tier || 2) !== pubTierFilter) return false;
    if (!normalizedSearch) return true;
    const combined = `${pub.name} ${pub.category} ${pub.channel} ${pub.notes} tier ${pub.tier || 2}`.toLowerCase();
    return combined.includes(normalizedSearch);
  });

  const safePublishers = Array.isArray(draftPublishers) ? draftPublishers : [];
  const safeProducts = Array.isArray(draftSettings?.products) ? draftSettings.products : [];
  const safeEnhancements = Array.isArray(draftSettings?.enhancements) ? draftSettings.enhancements : [];
  const safeOverviewMetrics = Array.isArray(draftSettings?.overviewMetrics) ? draftSettings.overviewMetrics : [];
  const safeInternalOnly = Array.isArray(draftSettings?.internalOnly) ? draftSettings.internalOnly : [];

  const enabledCount = safePublishers.filter((p) => p.enabled).length;
  const appCount = safePublishers.filter((p) => p.category === "App").length;
  const networkCount = safePublishers.filter((p) => p.category === "Network").length;
  const osCount = safePublishers.filter((p) => p.category === "OS").length;
  const tier1Count = safePublishers.filter((p) => Number(p.tier) === 1).length;
  const tier2Count = safePublishers.filter((p) => Number(p.tier) === 2 || !p.tier).length;
  const tier3Count = safePublishers.filter((p) => Number(p.tier) === 3).length;

  const visibleEnhancements = safeEnhancements.filter(
    (enhancement) =>
      !normalizedSearch ||
      `${enhancement.displayName} ${(enhancement.attachesTo || []).join(" ")} ${enhancement.trigger} ${enhancement.formatType}`
        .toLowerCase()
        .includes(normalizedSearch)
  );

  const tabs: Array<{ id: SettingsTab; label: string; count?: number }> = [
    { id: "publishers", label: "Recommended CTV Publishers", count: safePublishers.length },
    { id: "budgets", label: "Budget & Media-Type Limits" },
    { id: "reach", label: "Reach & Frequency" },
    { id: "products", label: "Product Rules", count: safeProducts.length },
    { id: "enhancements", label: "Enhancements", count: safeEnhancements.length },
    { id: "visibility", label: "Visibility", count: safeOverviewMetrics.length + safeInternalOnly.length },
    { id: "prompts", label: "ScoutAI Prompts" },
  ];

  const currentEditingPub = editingLogoPubId
    ? safePublishers.find((p) => p.id === editingLogoPubId)
    : null;

  return (
    <div className="fixed inset-0 z-[100] flex justify-end" role="dialog" aria-modal="true" aria-label="Settings">
      <button className="absolute inset-0 bg-slate-950/40 backdrop-blur-xs transition-opacity" aria-label="Close settings" onClick={handleCancel} />
      
      <aside className="relative flex h-full w-full max-w-5xl flex-col bg-white shadow-2xl animate-in slide-in-from-right duration-200">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4 md:px-7 bg-white">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-indigo-50 p-2.5 text-indigo-700">
              <Settings className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">Planning &amp; Publisher Settings</h2>
              <p className="text-xs text-slate-500">
                {readOnly
                  ? "Shared configuration · Read-only for your account"
                  : "Shared configuration · Applies to everyone on the team"}
              </p>
            </div>
          </div>
          <button
            onClick={handleCancel}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
            aria-label="Close settings"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        {/* Tab Navigation */}
        <nav className="flex gap-1 overflow-x-auto border-b border-slate-200 bg-slate-50/80 px-4 py-2 md:px-7" aria-label="Settings sections">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setActiveTab(tab.id);
                setSearch("");
              }}
              className={`whitespace-nowrap rounded-lg px-3.5 py-2 text-xs font-bold transition-all ${
                activeTab === tab.id
                  ? "bg-white text-indigo-700 shadow-sm ring-1 ring-slate-200"
                  : "text-slate-600 hover:bg-white/60"
              }`}
            >
              {tab.label}
              {tab.count !== undefined ? (
                <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] ${activeTab === tab.id ? "bg-indigo-100 text-indigo-800" : "bg-slate-200 text-slate-600"}`}>
                  {tab.count}
                </span>
              ) : null}
            </button>
          ))}
        </nav>

        {/* Tab Content Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5 md:px-7 bg-slate-50/30">
          {readOnly && (
            <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-sm text-amber-900">
              <Lock className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-bold">These settings are shared and read-only for you.</p>
                <p className="text-xs text-amber-800 mt-0.5">
                  They apply to every user and every plan, so only administrators can change them.
                  Sign in with the administrator password to edit.
                </p>
              </div>
            </div>
          )}
          {/* min-w-0: a fieldset defaults to min-content width, which lets a wide table stretch the drawer instead of scrolling in its own box. */}
          <fieldset disabled={readOnly} className={`min-w-0 ${readOnly ? "opacity-90" : ""}`}>
          
          {/* ScoutAI prompt library: its own record, saved from inside the tab */}
          {activeTab === "prompts" && <ScoutPromptsSettings readOnly={readOnly} />}

          {/* TAB 1: RECOMMENDED CTV PUBLISHERS */}
          {activeTab === "publishers" && (
            <section className="space-y-5">
              {/* Header card with explanation & AI leverage */}
              <div className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50/70 via-white to-indigo-50/30 p-5 shadow-xs">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Tv className="h-5 w-5 text-indigo-600" />
                      <h3 className="text-base font-bold text-slate-900">Recommended CTV Publishers &amp; AI Selection Rules</h3>
                    </div>
                    <p className="text-xs text-slate-600 max-w-3xl leading-relaxed">
                      ScoutAI's LLM engine evaluates these active publishers and their targeting rules (demographic skews, programming, cable replacement, FAST, etc.) when picking recommended CTV partners for your audience campaign. You can toggle publishers on/off, edit their targeting notes, modify logos, or add new custom publishers.
                    </p>
                  </div>

                  {/* Active Count Badge */}
                  <div className="flex flex-col sm:items-end shrink-0 gap-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-slate-600">Active for AI:</span>
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        {enabledCount} of {draftPublishers.length} enabled
                      </span>
                    </div>
                    <div className="w-full sm:w-44 bg-slate-200 h-1.5 rounded-full overflow-hidden">
                      <div
                        className="bg-indigo-600 h-full transition-all duration-300"
                        style={{ width: `${(enabledCount / (draftPublishers.length || 1)) * 100}%` }}
                      />
                    </div>
                  </div>
                </div>

                {/* Quick Action Toolbar */}
                <div className="mt-4 pt-4 border-t border-indigo-100/70 flex flex-wrap items-center justify-between gap-3">
                  {/* Category and Tier filters */}
                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-semibold text-slate-500 mr-1">Category:</span>
                      <button
                        type="button"
                        onClick={() => setPubCategoryFilter("all")}
                        className={`rounded-lg px-2.5 py-1 font-semibold transition-colors ${
                          pubCategoryFilter === "all" ? "bg-indigo-600 text-white shadow-xs" : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-100"
                        }`}
                      >
                        All ({draftPublishers.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setPubCategoryFilter("App")}
                        className={`rounded-lg px-2.5 py-1 font-semibold transition-colors ${
                          pubCategoryFilter === "App" ? "bg-indigo-600 text-white shadow-xs" : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-100"
                        }`}
                      >
                        Apps ({appCount})
                      </button>
                      <button
                        type="button"
                        onClick={() => setPubCategoryFilter("Network")}
                        className={`rounded-lg px-2.5 py-1 font-semibold transition-colors ${
                          pubCategoryFilter === "Network" ? "bg-indigo-600 text-white shadow-xs" : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-100"
                        }`}
                      >
                        Networks ({networkCount})
                      </button>
                      <button
                        type="button"
                        onClick={() => setPubCategoryFilter("OS")}
                        className={`rounded-lg px-2.5 py-1 font-semibold transition-colors ${
                          pubCategoryFilter === "OS" ? "bg-indigo-600 text-white shadow-xs" : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-100"
                        }`}
                      >
                        FAST &amp; OS ({osCount})
                      </button>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-semibold text-slate-500 mr-1">Tier:</span>
                      <button
                        type="button"
                        onClick={() => setPubTierFilter("all")}
                        className={`rounded-lg px-2.5 py-1 font-semibold transition-colors ${
                          pubTierFilter === "all" ? "bg-slate-800 text-white shadow-xs" : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-100"
                        }`}
                      >
                        All Tiers
                      </button>
                      <button
                        type="button"
                        onClick={() => setPubTierFilter("1")}
                        className={`rounded-lg px-2.5 py-1 font-semibold transition-colors ${
                          pubTierFilter === "1" ? "bg-amber-600 text-white shadow-xs" : "bg-white border border-amber-200 text-amber-800 hover:bg-amber-50"
                        }`}
                      >
                        Tier 1 ({tier1Count})
                      </button>
                      <button
                        type="button"
                        onClick={() => setPubTierFilter("2")}
                        className={`rounded-lg px-2.5 py-1 font-semibold transition-colors ${
                          pubTierFilter === "2" ? "bg-indigo-600 text-white shadow-xs" : "bg-white border border-indigo-200 text-indigo-800 hover:bg-indigo-50"
                        }`}
                      >
                        Tier 2 ({tier2Count})
                      </button>
                      <button
                        type="button"
                        onClick={() => setPubTierFilter("3")}
                        className={`rounded-lg px-2.5 py-1 font-semibold transition-colors ${
                          pubTierFilter === "3" ? "bg-emerald-600 text-white shadow-xs" : "bg-white border border-emerald-200 text-emerald-800 hover:bg-emerald-50"
                        }`}
                      >
                        Tier 3 ({tier3Count})
                      </button>
                    </div>
                  </div>

                  {/* Right side buttons */}
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setAllPublishersStatus(true)}
                      className="text-xs font-semibold text-indigo-700 hover:text-indigo-900 px-2 py-1 rounded hover:bg-indigo-50"
                    >
                      Enable All
                    </button>
                    <span className="text-slate-300">|</span>
                    <button
                      type="button"
                      onClick={() => setAllPublishersStatus(false)}
                      className="text-xs font-semibold text-slate-600 hover:text-slate-800 px-2 py-1 rounded hover:bg-slate-100"
                    >
                      Disable All
                    </button>
                    <span className="text-slate-300">|</span>
                    
                    {/* CSV Import */}
                    <input
                      type="file"
                      ref={csvImportInputRef}
                      onChange={handleCsvImport}
                      accept=".csv,text/csv"
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => csvImportInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-xs"
                      title="Import publisher rules from a CSV file"
                    >
                      <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />
                      Import CSV
                    </button>

                    {/* Reset to CSV Defaults */}
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm("Reset all CTV publishers and notes to default CSV settings?")) {
                          setDraftPublishers(JSON.parse(JSON.stringify(DEFAULT_CTV_PUBLISHERS)));
                        }
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50 shadow-xs"
                      title="Reset back to default CSV publisher list"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Reset Defaults
                    </button>

                    {/* Add Publisher Button */}
                    <button
                      type="button"
                      onClick={() => setIsAddPubModalOpen(true)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1 text-xs font-bold text-white hover:bg-indigo-700 shadow-xs"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add Publisher
                    </button>
                  </div>
                </div>
              </div>

              {/* Target Recommended CTV Publishers Setting Card */}
              <div className="rounded-2xl border border-indigo-200/80 bg-white p-4 sm:p-5 shadow-xs space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Sliders className="h-4 w-4 text-indigo-600" />
                      <label htmlFor="ctv-target-count-input" className="text-sm font-bold text-slate-900">
                        Target Recommended CTV Publishers Count
                      </label>
                      <span className="inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-700 border border-indigo-200/50 font-mono">
                        Range 1–30
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 max-w-xl">
                      Specifies how many CTV publishers ScoutAI selects for the media plan. Default is 8.
                    </p>
                  </div>

                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min={1}
                      max={30}
                      step={1}
                      value={draftSettings.ctvPublisherTargetCount ?? 8}
                      onChange={(e) => {
                        const val = Math.max(1, Math.min(30, parseInt(e.target.value, 10) || 8));
                        setDraftSettings((curr) => ({ ...curr, ctvPublisherTargetCount: val }));
                      }}
                      className="w-28 sm:w-36 accent-indigo-600 cursor-pointer"
                    />
                    <div className="flex items-center gap-1.5">
                      <input
                        id="ctv-target-count-input"
                        type="number"
                        min={1}
                        max={30}
                        value={draftSettings.ctvPublisherTargetCount ?? 8}
                        onChange={(e) => {
                          const raw = parseInt(e.target.value, 10);
                          const val = Number.isNaN(raw) ? 8 : Math.max(1, Math.min(30, raw));
                          setDraftSettings((curr) => ({ ...curr, ctvPublisherTargetCount: val }));
                        }}
                        className="w-16 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-center text-sm font-bold text-slate-900 shadow-2xs focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                      />
                      <span className="text-xs text-slate-400 font-semibold">pubs</span>
                    </div>
                  </div>
                </div>

                {/* Target Tier Distribution Breakdown & Adjustable Controls */}
                {(() => {
                  const targetCount = Math.max(1, Math.min(30, Math.round(Number(draftSettings.ctvPublisherTargetCount) || 8)));
                  const rawT1 = draftSettings.ctvTier1TargetPercent ?? 35;
                  const rawT2 = draftSettings.ctvTier2TargetPercent ?? 45;
                  const rawT3 = draftSettings.ctvTier3TargetPercent ?? 20;

                  const sumPct = rawT1 + rawT2 + rawT3;
                  const totalPct = sumPct || 100;
                  const isExactly100 = sumPct === 100;

                  const t1Alloc = Math.round(targetCount * (rawT1 / totalPct));
                  const t2Alloc = Math.round(targetCount * (rawT2 / totalPct));
                  const t3Alloc = Math.max(0, targetCount - t1Alloc - t2Alloc);

                  const normalizeTiers = () => {
                    if (sumPct === 0) {
                      setDraftSettings((curr) => ({ ...curr, ctvTier1TargetPercent: 35, ctvTier2TargetPercent: 45, ctvTier3TargetPercent: 20 }));
                      return;
                    }
                    const n1 = Math.round((rawT1 / sumPct) * 100);
                    const n2 = Math.round((rawT2 / sumPct) * 100);
                    const n3 = Math.max(0, 100 - n1 - n2);
                    setDraftSettings((curr) => ({ ...curr, ctvTier1TargetPercent: n1, ctvTier2TargetPercent: n2, ctvTier3TargetPercent: n3 }));
                  };

                  const resetTiers = () => {
                    setDraftSettings((curr) => ({ ...curr, ctvTier1TargetPercent: 35, ctvTier2TargetPercent: 45, ctvTier3TargetPercent: 20 }));
                  };

                  return (
                    <div className="pt-3 border-t border-slate-100 space-y-3">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-bold text-slate-800">
                            Internal Tier Targets:
                          </span>
                          {isExactly100 ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700 border border-emerald-200/80">
                              Total: 100% ✓
                            </span>
                          ) : (
                            <span
                              className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700 border border-amber-200/80"
                              title="ScoutAI will proportionally normalize this to 100% when selecting publishers"
                            >
                              Total: {sumPct}% (Auto-Normalized)
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          {!isExactly100 && (
                            <button
                              type="button"
                              onClick={normalizeTiers}
                              className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-2 py-0.5 rounded-md border border-indigo-200/60 transition-colors"
                            >
                              Auto-Fix to 100%
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={resetTiers}
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-slate-800 hover:bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200 transition-colors"
                            title="Reset to default 35% / 45% / 20%"
                          >
                            <RotateCcw className="h-3 w-3" />
                            Reset (35/45/20)
                          </button>
                        </div>
                      </div>

                      {/* Visual proportion bar */}
                      <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden flex">
                        <div
                          style={{ width: `${Math.max(0, (rawT1 / totalPct) * 100)}%` }}
                          className="bg-amber-500 transition-all duration-200"
                          title={`Tier 1: ${rawT1}% (${t1Alloc} pubs)`}
                        />
                        <div
                          style={{ width: `${Math.max(0, (rawT2 / totalPct) * 100)}%` }}
                          className="bg-indigo-600 transition-all duration-200"
                          title={`Tier 2: ${rawT2}% (${t2Alloc} pubs)`}
                        />
                        <div
                          style={{ width: `${Math.max(0, (rawT3 / totalPct) * 100)}%` }}
                          className="bg-emerald-500 transition-all duration-200"
                          title={`Tier 3: ${rawT3}% (${t3Alloc} pubs)`}
                        />
                      </div>

                      {/* 3 Adjustable Tier Target Cards */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        {/* Tier 1 */}
                        <div className="rounded-xl border border-amber-200/80 bg-amber-50/40 p-3 space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                              <span className="h-2 w-2 rounded-full bg-amber-500" />
                              <span className="text-xs font-bold text-amber-900">Tier 1</span>
                              <span className="text-[10px] text-amber-700 font-medium">(SVOD &amp; Sports)</span>
                            </div>
                            <span className="text-[11px] font-bold text-amber-800 bg-amber-100/90 px-1.5 py-0.5 rounded border border-amber-200/60">
                              {t1Alloc} {t1Alloc === 1 ? "pub" : "pubs"}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <input
                              type="range"
                              min={0}
                              max={100}
                              step={5}
                              value={rawT1}
                              onChange={(e) => {
                                const val = Math.max(0, Math.min(100, parseInt(e.target.value, 10) || 0));
                                setDraftSettings((curr) => ({ ...curr, ctvTier1TargetPercent: val }));
                              }}
                              className="w-full accent-amber-500 cursor-pointer"
                            />
                            <div className="flex items-center shrink-0">
                              <input
                                type="number"
                                min={0}
                                max={100}
                                value={rawT1}
                                onChange={(e) => {
                                  const raw = parseInt(e.target.value, 10);
                                  const val = Number.isNaN(raw) ? 0 : Math.max(0, Math.min(100, raw));
                                  setDraftSettings((curr) => ({ ...curr, ctvTier1TargetPercent: val }));
                                }}
                                className="w-14 rounded-lg border border-amber-300 bg-white px-1.5 py-1 text-center text-xs font-bold text-amber-900 shadow-2xs focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-200"
                              />
                              <span className="text-[11px] font-bold text-amber-700 ml-1">%</span>
                            </div>
                          </div>
                          <p className="text-[10px] text-amber-800/80 leading-tight">
                            Premium SVOD / AVOD &amp; live sports
                          </p>
                        </div>

                        {/* Tier 2 */}
                        <div className="rounded-xl border border-indigo-200/80 bg-indigo-50/40 p-3 space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                              <span className="h-2 w-2 rounded-full bg-indigo-600" />
                              <span className="text-xs font-bold text-indigo-900">Tier 2</span>
                              <span className="text-[10px] text-indigo-700 font-medium">(Linear &amp; Targeted)</span>
                            </div>
                            <span className="text-[11px] font-bold text-indigo-800 bg-indigo-100/90 px-1.5 py-0.5 rounded border border-indigo-200/60">
                              {t2Alloc} {t2Alloc === 1 ? "pub" : "pubs"}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <input
                              type="range"
                              min={0}
                              max={100}
                              step={5}
                              value={rawT2}
                              onChange={(e) => {
                                const val = Math.max(0, Math.min(100, parseInt(e.target.value, 10) || 0));
                                setDraftSettings((curr) => ({ ...curr, ctvTier2TargetPercent: val }));
                              }}
                              className="w-full accent-indigo-600 cursor-pointer"
                            />
                            <div className="flex items-center shrink-0">
                              <input
                                type="number"
                                min={0}
                                max={100}
                                value={rawT2}
                                onChange={(e) => {
                                  const raw = parseInt(e.target.value, 10);
                                  const val = Number.isNaN(raw) ? 0 : Math.max(0, Math.min(100, raw));
                                  setDraftSettings((curr) => ({ ...curr, ctvTier2TargetPercent: val }));
                                }}
                                className="w-14 rounded-lg border border-indigo-300 bg-white px-1.5 py-1 text-center text-xs font-bold text-indigo-900 shadow-2xs focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                              />
                              <span className="text-[11px] font-bold text-indigo-700 ml-1">%</span>
                            </div>
                          </div>
                          <p className="text-[10px] text-indigo-800/80 leading-tight">
                            Broadcast/cable networks &amp; verticals
                          </p>
                        </div>

                        {/* Tier 3 */}
                        <div className="rounded-xl border border-emerald-200/80 bg-emerald-50/40 p-3 space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                              <span className="h-2 w-2 rounded-full bg-emerald-500" />
                              <span className="text-xs font-bold text-emerald-900">Tier 3</span>
                              <span className="text-[10px] text-emerald-700 font-medium">(FAST &amp; OS)</span>
                            </div>
                            <span className="text-[11px] font-bold text-emerald-800 bg-emerald-100/90 px-1.5 py-0.5 rounded border border-emerald-200/60">
                              {t3Alloc} {t3Alloc === 1 ? "pub" : "pubs"}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <input
                              type="range"
                              min={0}
                              max={100}
                              step={5}
                              value={rawT3}
                              onChange={(e) => {
                                const val = Math.max(0, Math.min(100, parseInt(e.target.value, 10) || 0));
                                setDraftSettings((curr) => ({ ...curr, ctvTier3TargetPercent: val }));
                              }}
                              className="w-full accent-emerald-500 cursor-pointer"
                            />
                            <div className="flex items-center shrink-0">
                              <input
                                type="number"
                                min={0}
                                max={100}
                                value={rawT3}
                                onChange={(e) => {
                                  const raw = parseInt(e.target.value, 10);
                                  const val = Number.isNaN(raw) ? 0 : Math.max(0, Math.min(100, raw));
                                  setDraftSettings((curr) => ({ ...curr, ctvTier3TargetPercent: val }));
                                }}
                                className="w-14 rounded-lg border border-emerald-300 bg-white px-1.5 py-1 text-center text-xs font-bold text-emerald-900 shadow-2xs focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                              />
                              <span className="text-[11px] font-bold text-emerald-700 ml-1">%</span>
                            </div>
                          </div>
                          <p className="text-[10px] text-emerald-800/80 leading-tight">
                            FAST platforms &amp; Smart TV operating systems
                          </p>
                        </div>
                      </div>

                      <div className="pt-1 flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-[11px] text-slate-400 italic">
                        <span>
                          ScoutAI matches audience personas to publisher rules while adhering to these tier distribution targets.
                        </span>
                        <span className="font-medium text-slate-500 not-italic">
                          Tier labels remain strictly internal to planning.
                        </span>
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* Search & Status Filter Bar */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
                <div className="relative w-full sm:max-w-md">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100 shadow-xs"
                    placeholder="Search publisher name, category, or targeting rules..."
                  />
                  {search && (
                    <button
                      type="button"
                      onClick={() => setSearch("")}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-2 text-xs w-full sm:w-auto justify-end">
                  <span className="font-semibold text-slate-500">Status:</span>
                  <select
                    value={pubStatusFilter}
                    onChange={(e) => setPubStatusFilter(e.target.value as any)}
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 focus:border-indigo-500 focus:outline-none shadow-xs"
                  >
                    <option value="all">All ({draftPublishers.length})</option>
                    <option value="active">Active Only ({enabledCount})</option>
                    <option value="disabled">Disabled Only ({draftPublishers.length - enabledCount})</option>
                  </select>
                </div>
              </div>

              {/* Publishers List */}
              <div className="space-y-3">
                {visiblePublishers.length === 0 ? (
                  <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-500">
                    <Tv className="mx-auto h-8 w-8 text-slate-300 mb-2" />
                    <p className="font-medium text-slate-700">No publishers match your current filter</p>
                    <p className="text-xs text-slate-400 mt-1">Try clearing your search query or category filters.</p>
                  </div>
                ) : (
                  visiblePublishers.map((pub) => {
                    const resolvedLogo = resolvePublisherLogo(pub.name, draftPublishers);
                    const categoryColors = {
                      App: "bg-indigo-50 text-indigo-700 border-indigo-200",
                      Network: "bg-purple-50 text-purple-700 border-purple-200",
                      OS: "bg-emerald-50 text-emerald-700 border-emerald-200",
                    };

                    return (
                      <article
                        key={pub.id}
                        className={`rounded-2xl border transition-all p-4 ${
                          pub.enabled
                            ? "border-slate-200 bg-white shadow-xs hover:border-indigo-200"
                            : "border-slate-200 bg-slate-100/60 opacity-65"
                        }`}
                      >
                        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                          {/* Left: Logo & Info */}
                          <div className="flex items-start gap-3.5 min-w-0 md:w-1/3">
                            {/* Logo thumbnail with edit button */}
                            <div className="relative group shrink-0">
                              <div className="h-14 w-14 rounded-xl border border-slate-200 bg-white p-1.5 flex items-center justify-center overflow-hidden shadow-xs">
                                <img
                                  src={resolvedLogo}
                                  alt={pub.name}
                                  className="h-full w-full object-contain"
                                  onError={(e) => {
                                    (e.target as HTMLImageElement).src = "/assets/pub-logos/placeholder_80x80.png";
                                  }}
                                />
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingLogoPubId(pub.id);
                                  setLogoInputUrl(pub.logoUrl || "");
                                  setLogoUploadError(null);
                                }}
                                className="absolute inset-0 bg-slate-900/60 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white"
                                title="Edit or upload logo"
                              >
                                <Edit2 className="h-4 w-4" />
                              </button>
                            </div>

                            {/* Name, Category, Channel */}
                            <div className="min-w-0 flex-1 space-y-1">
                              <div className="flex items-center gap-2">
                                <h4 className="font-bold text-slate-900 text-sm truncate" title={pub.name}>
                                  {pub.name}
                                </h4>
                              </div>

                              <div className="flex flex-wrap items-center gap-1.5">
                                <select
                                  value={pub.category}
                                  onChange={(e) => updatePublisherField(pub.id, { category: e.target.value as any })}
                                  className={`rounded-md border px-2 py-0.5 text-[11px] font-bold ${
                                    categoryColors[pub.category] || "bg-slate-50 text-slate-700 border-slate-200"
                                  }`}
                                >
                                  <option value="App">App</option>
                                  <option value="Network">Network</option>
                                  <option value="OS">FAST / OS</option>
                                </select>
                                <select
                                  value={pub.tier || 2}
                                  onChange={(e) => updatePublisherField(pub.id, { tier: Number(e.target.value) as 1 | 2 | 3 })}
                                  className={`rounded-md border px-2 py-0.5 text-[11px] font-bold ${
                                    pub.tier === 1
                                      ? "bg-amber-50 text-amber-800 border-amber-300"
                                      : pub.tier === 3
                                      ? "bg-emerald-50 text-emerald-800 border-emerald-300"
                                      : "bg-indigo-50 text-indigo-800 border-indigo-300"
                                  }`}
                                  title="Internal tier for AI recommendation distribution"
                                >
                                  <option value={1}>Tier 1</option>
                                  <option value={2}>Tier 2</option>
                                  <option value={3}>Tier 3</option>
                                </select>
                                <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                                  {pub.channel || "CTV / OTT"}
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* Center: Targeting Rules & Notes */}
                          <div className="flex-1 space-y-1">
                            <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                              <Sparkles className="h-3 w-3 text-indigo-500" />
                              When to Include / Targeting Guidance (Passed to AI)
                            </label>
                            <textarea
                              value={pub.notes || ""}
                              onChange={(e) => updatePublisherField(pub.id, { notes: e.target.value })}
                              rows={2}
                              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                              placeholder="e.g., Include for female-skewed campaigns; lifestyle & drama audiences"
                            />
                          </div>

                          {/* Right: Toggle Switch & Actions */}
                          <div className="flex items-center justify-between md:flex-col md:items-end gap-2 shrink-0">
                            <div className="flex items-center gap-2">
                              <span className={`text-xs font-bold ${pub.enabled ? "text-emerald-700" : "text-slate-400"}`}>
                                {pub.enabled ? "Active for AI" : "Disabled"}
                              </span>
                              <ShowToggle
                                checked={pub.enabled}
                                onChange={() => togglePublisher(pub.id)}
                                label={pub.name}
                              />
                            </div>

                            <button
                              type="button"
                              onClick={() => {
                                if (confirm(`Remove publisher "${pub.name}"?`)) {
                                  deletePublisher(pub.id);
                                }
                              }}
                              className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition-colors"
                              title="Delete publisher"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      </article>
                    );
                  })
                )}
              </div>
            </section>
          )}

          {/* TAB 2: BUDGETS & CHANNELS */}
          {activeTab === "budgets" && (
            <section className="space-y-4">
              <div>
                <h3 className="text-base font-bold text-slate-900">Budget &amp; Media-Type Limits</h3>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  Campaign budgets are normalized to 30 days before these caps are applied. ScoutAI may recommend fewer media types when minimums or allocation bounds make a wider mix infeasible.
                </p>
              </div>

              <div className="space-y-3">
                {draftSettings.budgetChannelTiers.map((tier, index) => (
                  <div key={index} className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Tier {index + 1}</span>
                      <button
                        type="button"
                        onClick={() => deleteTier(index)}
                        disabled={draftSettings.budgetChannelTiers.length === 1}
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-30"
                        aria-label={`Delete tier ${index + 1}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <label className={labelClass}>
                        Minimum 30-day budget
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={Number.isFinite(tier.minBudget) ? tier.minBudget : ""}
                          onChange={(e) => updateTier(index, { minBudget: numericValue(e.target.value) })}
                          className={inputClass}
                        />
                      </label>
                      <label className={labelClass}>
                        Maximum 30-day budget
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="No maximum"
                          value={tier.maxBudgetExclusive === null || !Number.isFinite(tier.maxBudgetExclusive) ? "" : tier.maxBudgetExclusive}
                          onChange={(e) => updateTier(index, { maxBudgetExclusive: nullableNumericValue(e.target.value) })}
                          className={inputClass}
                        />
                      </label>
                      <label className={labelClass}>
                        Max media types
                        <input
                          type="number"
                          min="1"
                          max="50"
                          step="1"
                          value={Number.isFinite(tier.maxChannels) ? tier.maxChannels : ""}
                          onChange={(e) => updateTier(index, { maxChannels: numericValue(e.target.value) })}
                          className={inputClass}
                        />
                      </label>
                    </div>
                    {tier.maxBudgetExclusive === null && (
                      <p className="mt-2 text-[11px] font-medium text-indigo-600">Open-ended final tier</p>
                    )}
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={addTier}
                className="mt-2 inline-flex items-center gap-2 rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-50 shadow-xs"
              >
                <Plus className="h-4 w-4" /> Add budget tier
              </button>
            </section>
          )}

          {/* TAB: REACH & FREQUENCY */}
          {activeTab === "reach" && (
            <section className="space-y-6">
              <div>
                <h3 className="text-base font-bold text-slate-900">Reach &amp; Frequency</h3>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  The assumptions behind <span className="font-semibold">Estimated Reach</span> and <span className="font-semibold">Avg Monthly Frequency</span> in the plan overview.
                  Saved plans keep the values they were generated with.
                </p>
              </div>

              {/* METHOD */}
              <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-4 text-sm leading-6 text-slate-700">
                <h4 className="flex items-center gap-2 text-sm font-extrabold text-slate-900">
                  <Info className="h-4 w-4 text-indigo-600" /> How it is calculated
                </h4>
                <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs leading-5">
                  <li><span className="font-semibold">Universe:</span> TV households in the plan's geography: the national total, the selected states, or the selected DMAs.</li>
                  <li><span className="font-semibold">Target audience (optional):</span> a planner can narrow the universe on the plan with filters from the audience share reference below, or their own %. Media types marked <em>Audience</em> are measured against that target; the rest against the whole geography.</li>
                  <li><span className="font-semibold">Two windows:</span> the whole flight's impressions give unique reach over the campaign (the card's headline); one month's (impressions × 30 ÷ flight days) give monthly reach and frequency. Flights of 30 days or less are one month. Flight reach is not monthly reach × months: the same households are reached again each month.</li>
                  <li><span className="font-semibold">Per media type:</span> ceiling = universe × max reachable %; x = impressions ÷ (ceiling × s); reach = ceiling × (1 − (1 + x ÷ k)<sup>−k</sup>), the NBD reach curve. Reach builds at about one household per <em>s</em> impressions; <em>k</em> sets how long light viewers keep trickling in before it flattens at the ceiling.</li>
                  <li><span className="font-semibold">Combined:</span> media types overlap at random, so total reach = universe × (1 − the product of each media type's unreached share).</li>
                  <li><span className="font-semibold">Frequency:</span> monthly impressions from counted media types ÷ monthly reach. It is a result, never an input.</li>
                </ol>
              </div>

              {/* FREQUENCY BAND */}
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
                <h4 className="text-sm font-extrabold text-slate-900">Target monthly frequency</h4>
                <p className="mt-1 text-xs text-slate-500">Avg Monthly Frequency is shown green inside this band and amber outside it.</p>
                <div className="mt-3 grid grid-cols-2 gap-3 sm:max-w-sm">
                  <label className={labelClass}>
                    Minimum
                    <input
                      type="number"
                      min="0"
                      step="0.5"
                      value={Number.isFinite(draftSettings.reach.targetMonthlyFrequencyMin) ? draftSettings.reach.targetMonthlyFrequencyMin : ""}
                      onChange={(e) => updateReachBand({ targetMonthlyFrequencyMin: numericValue(e.target.value) })}
                      className={inputClass}
                    />
                  </label>
                  <label className={labelClass}>
                    Maximum
                    <input
                      type="number"
                      min="0"
                      step="0.5"
                      value={Number.isFinite(draftSettings.reach.targetMonthlyFrequencyMax) ? draftSettings.reach.targetMonthlyFrequencyMax : ""}
                      onChange={(e) => updateReachBand({ targetMonthlyFrequencyMax: numericValue(e.target.value) })}
                      className={inputClass}
                    />
                  </label>
                </div>
              </div>

              {/* MEDIA TYPE ASSUMPTIONS */}
              <div className="space-y-2">
                <div>
                  <h4 className="text-sm font-extrabold text-slate-900">Assumptions by media type</h4>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    <span className="font-semibold">Counts</span>: include in household reach. <span className="font-semibold">Max %</span>: share of the geo's TV households the media type can reach at all.{" "}
                    <span className="font-semibold">s</span>: impressions per new household at low volume (higher builds reach more slowly; see the explainer below).{" "}
                    <span className="font-semibold">k</span>: audience concentration; lower means reach keeps building slowly over long flights (see below).{" "}
                    <span className="font-semibold">People/HH</span>: divides people-based impressions (DOOH) into households.{" "}
                    <span className="font-semibold">Min HH</span>: below this geo size the media type is not counted (0 = no minimum).{" "}
                    <span className="font-semibold">Audience</span>: bought against the plan's target audience; when off, the media type reaches across the whole geography.
                  </p>
                </div>

                {/* Explainer for the least intuitive assumption; collapsed so the table stays in view. */}
                <details className="group rounded-xl border border-indigo-200 bg-indigo-50/40 text-xs leading-5 text-slate-700">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-2.5 font-bold text-slate-800">
                    <span className="flex items-center gap-2">
                      <HelpCircle className="h-4 w-4 shrink-0 text-indigo-600" />
                      <span>What is <em>s</em> (duplication factor), and why it matters</span>
                    </span>
                    <ChevronDown className="h-4 w-4 text-slate-400 transition-transform group-open:rotate-180" />
                  </summary>
                  <div className="space-y-3 border-t border-indigo-100 px-4 py-3">
                    <p>
                      <span className="font-semibold">s says how quickly a media type wastes impressions on households it has already reached.</span>{" "}
                      It is roughly the number of impressions it takes to find one new household early in a campaign.
                    </p>

                    <div>
                      <p className="font-semibold text-slate-800">Why it exists</p>
                      <p>Ads never land on a fresh household every time. Even on day one the same households see the ad again, because:</p>
                      <ul className="mt-1 list-disc space-y-0.5 pl-5">
                        <li>heavy viewers, browsers and listeners are served far more ads than light users;</li>
                        <li>one session can show several ads (an ad break, a scrolling feed, a page with several slots);</li>
                        <li>targeting and bidding keep returning to the same high-value viewers.</li>
                      </ul>
                      <p className="mt-1">
                        So with s = 3.5, 1,000 impressions reach about 1,000 ÷ 3.5 ≈ 285 households, each seeing the ad about 3.5 times.
                        That is why frequency starts out close to s.
                      </p>
                    </div>

                    <div>
                      <p className="font-semibold text-slate-800">What it does in the formula</p>
                      <p className="font-mono text-[11px] text-slate-600">x = impressions ÷ (ceiling × s) · reach = ceiling × (1 − (1 + x ÷ k)<sup>−k</sup>)</p>
                      <p className="mt-1">
                        The ceiling is the most households the media type could reach (households × Max %). s sets how fast reach climbs toward it:
                        a higher s spends more impressions on households already reached, so reach builds more slowly and frequency builds faster.
                        Rule of thumb at k = 2 (the CTV default): reach gets to about <span className="font-semibold">56%</span> of the ceiling when impressions = ceiling × s,
                        about <span className="font-semibold">75%</span> at twice that, and about <span className="font-semibold">84%</span> at three times.
                      </p>
                    </div>

                    <div>
                      <p className="font-semibold text-slate-800">Why it matters: one plan, three values of s</p>
                      <p>
                        Example: $1.5M over a year, all CTV, Washington DC DMA only (2.48M TV households, 80% ceiling, k = 2), about 7.76M impressions a month.
                        Same impressions in every row; only s changes.
                      </p>
                      <table className="mt-1.5 w-full max-w-md border-collapse overflow-hidden rounded-lg bg-white text-left">
                        <thead className="text-[10px] uppercase tracking-wide text-slate-500">
                          <tr className="border-b border-slate-200">
                            <th className="px-2 py-1">s</th>
                            <th className="px-2 py-1 text-right">Monthly reach</th>
                            <th className="px-2 py-1 text-right">% of DMA</th>
                            <th className="px-2 py-1 text-right">Frequency</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          <tr><td className="px-2 py-1">2</td><td className="px-2 py-1 text-right">1.48M HH</td><td className="px-2 py-1 text-right">60%</td><td className="px-2 py-1 text-right">5.3×</td></tr>
                          <tr className="font-semibold"><td className="px-2 py-1">3.5 (CTV default)</td><td className="px-2 py-1 text-right">1.17M HH</td><td className="px-2 py-1 text-right">47%</td><td className="px-2 py-1 text-right">6.6×</td></tr>
                          <tr><td className="px-2 py-1">6</td><td className="px-2 py-1 text-right">0.85M HH</td><td className="px-2 py-1 text-right">35%</td><td className="px-2 py-1 text-right">9.1×</td></tr>
                        </tbody>
                      </table>
                      <p className="mt-1">Monthly reach moves by about 1.7× on this one assumption, which is why Media Planning owns it.</p>
                    </div>

                    <div>
                      <p className="font-semibold text-slate-800">Why the defaults differ by media type</p>
                      <ul className="list-disc space-y-0.5 pl-5">
                        <li><span className="font-semibold">About 3–3.5 (CTV, YouTube TV, linear):</span> a limited number of ad breaks per viewing session, spread across more homes, so new households come more easily.</li>
                        <li><span className="font-semibold">About 4–5 (online video, audio, social, native):</span> moderate; heavy users of these platforms take a fair share of impressions.</li>
                        <li><span className="font-semibold">About 6 or more (programmatic display, geofence):</span> heavy browsers see many display ads per session and across sites, so frequency builds quickly and reach slowly.</li>
                      </ul>
                    </div>

                    <div>
                      <p className="font-semibold text-slate-800">How to calibrate it</p>
                      <p>
                        From a DSP reach forecast or a past campaign's reported reach, take a light, early stretch of delivery (well below saturation):
                        <span className="font-semibold"> s ≈ impressions ÷ reach</span>. For example, 2M CTV impressions in a month reaching about 600K households gives s ≈ 3.3.
                        Strict frequency caps push delivery toward new households, so a team that always runs tight caps may use a lower s for that media type.
                      </p>
                    </div>
                  </div>
                </details>

                <details className="group rounded-xl border border-indigo-200 bg-indigo-50/40 text-xs leading-5 text-slate-700">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-2.5 font-bold text-slate-800">
                    <span className="flex items-center gap-2">
                      <HelpCircle className="h-4 w-4 shrink-0 text-indigo-600" />
                      <span>What is <em>k</em> (audience concentration), and why it matters for long flights</span>
                    </span>
                    <ChevronDown className="h-4 w-4 text-slate-400 transition-transform group-open:rotate-180" />
                  </summary>
                  <div className="space-y-3 border-t border-indigo-100 px-4 py-3">
                    <p>
                      <span className="font-semibold">k says how unevenly a media type's delivery falls across households.</span>{" "}
                      Some households watch, browse or listen far more than others. Heavy users are reached early; light users trickle in slowly, often over months.
                    </p>
                    <div>
                      <p className="font-semibold text-slate-800">What it changes</p>
                      <ul className="list-disc space-y-0.5 pl-5">
                        <li><span className="font-semibold">Small k (about 0.5–1):</span> delivery is concentrated in heavy users. Reach builds slowly and keeps creeping up over a long flight.</li>
                        <li><span className="font-semibold">Large k (3 or more):</span> delivery is spread evenly. Reach climbs quickly, then stops dead at the ceiling.</li>
                        <li>s still sets the starting pace (about one new household per s impressions); k shapes the long tail.</li>
                      </ul>
                    </div>
                    <div>
                      <p className="font-semibold text-slate-800">Why it matters: reach building over a year</p>
                      <p>Same DC example (all CTV, s = 3.5, about 7.76M impressions a month). Unique households reached as the flight goes on:</p>
                      <div className="mt-1.5 overflow-x-auto">
                        <table className="w-full min-w-[520px] max-w-2xl border-collapse rounded-lg bg-white text-left">
                          <thead className="text-[10px] uppercase tracking-wide text-slate-500">
                            <tr className="border-b border-slate-200">
                              <th className="px-2 py-1">Curve</th>
                              <th className="px-2 py-1 text-right">1 month</th>
                              <th className="px-2 py-1 text-right">3 months</th>
                              <th className="px-2 py-1 text-right">6 months</th>
                              <th className="px-2 py-1 text-right">12 months</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                          <tr><td className="px-2 py-1">Even spread (k → ∞)</td><td className="px-2 py-1 text-right">1.33M (54%)</td><td className="px-2 py-1 text-right">1.91M (77%)</td><td className="px-2 py-1 text-right">1.98M (80%)</td><td className="px-2 py-1 text-right">1.98M (80%)</td></tr>
                          <tr className="font-semibold"><td className="px-2 py-1">k = 2 (CTV default)</td><td className="px-2 py-1 text-right">1.17M (47%)</td><td className="px-2 py-1 text-right">1.70M (69%)</td><td className="px-2 py-1 text-right">1.88M (76%)</td><td className="px-2 py-1 text-right">1.95M (79%)</td></tr>
                          <tr><td className="px-2 py-1">k = 1</td><td className="px-2 py-1 text-right">1.05M (42%)</td><td className="px-2 py-1 text-right">1.53M (62%)</td><td className="px-2 py-1 text-right">1.72M (70%)</td><td className="px-2 py-1 text-right">1.84M (74%)</td></tr>
                          <tr><td className="px-2 py-1">k = 0.5</td><td className="px-2 py-1 text-right">0.88M (36%)</td><td className="px-2 py-1 text-right">1.27M (51%)</td><td className="px-2 py-1 text-right">1.46M (59%)</td><td className="px-2 py-1 text-right">1.61M (65%)</td></tr>
                          </tbody>
                        </table>
                      </div>
                      <p className="mt-1">
                        With an even spread, months 7–12 add no one; real campaigns keep finding light viewers. Lower k also lowers monthly reach,
                        because the same concentration means fewer different households in any one month.
                      </p>
                    </div>
                    <div>
                      <p className="font-semibold text-slate-800">Why the defaults differ</p>
                      <ul className="list-disc space-y-0.5 pl-5">
                        <li><span className="font-semibold">k ≈ 2 (CTV, linear, TV-like streaming):</span> TV viewing is spread across more homes.</li>
                        <li><span className="font-semibold">k ≈ 1.5 (online video, audio):</span> in between.</li>
                        <li><span className="font-semibold">k ≈ 1 (display, native, social, geofence):</span> heavy browsers and scrollers take most impressions.</li>
                      </ul>
                    </div>
                    <div>
                      <p className="font-semibold text-slate-800">How to calibrate it</p>
                      <p>
                        Set s first from an early, light stretch of delivery. Then compare reach at a later point (say month 3 or month 6) from a DSP forecast or a past
                        campaign: if real reach kept growing more than the curve shows, lower k; if it flattened sooner, raise it.
                        This is the NBD (negative binomial) reach model, the long-standing standard for TV reach building.
                      </p>
                    </div>
                  </div>
                </details>
                <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-xs">
                  <table className="w-full min-w-[1060px] border-collapse text-left">
                    <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-2.5">Media type</th>
                        <th className="w-16 px-2 py-2.5 text-center">Counts</th>
                        <th className="w-16 px-2 py-2.5 text-center" title="Bought against the plan's target audience">Audience</th>
                        <th className="w-20 px-2 py-2.5">Max %</th>
                        <th className="w-20 px-2 py-2.5">s</th>
                        <th className="w-20 px-2 py-2.5" title="Audience concentration">k</th>
                        <th className="w-36 px-2 py-2.5">Unit</th>
                        <th className="w-20 px-2 py-2.5">People/HH</th>
                        <th className="w-28 px-2 py-2.5">Min HH</th>
                        <th className="px-2 py-2.5">Rationale</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {draftSettings.reach.mediaTypes.map((row) => (
                        <tr key={row.mediaTypeId} className={row.countsTowardReach ? undefined : "bg-slate-50/60"}>
                          <td className="px-3 py-2 text-sm font-semibold text-slate-800">{row.label}</td>
                          <td className="px-2 py-2 text-center">
                            <ShowToggle
                              checked={row.countsTowardReach}
                              onChange={(countsTowardReach) => updateReachMediaType(row.mediaTypeId, { countsTowardReach })}
                              label={`${row.label} in reach`}
                            />
                          </td>
                          <td className="px-2 py-2 text-center">
                            <ShowToggle
                              checked={row.appliesAudienceTargeting}
                              onChange={(appliesAudienceTargeting) => updateReachMediaType(row.mediaTypeId, { appliesAudienceTargeting })}
                              label={`${row.label} audience targeting`}
                            />
                          </td>
                          <td className="px-2 py-2">
                            <input
                              type="number" min="0" max="100" step="1" aria-label={`${row.label} max reachable percent`}
                              value={Number.isFinite(row.maxReachPercent) ? row.maxReachPercent : ""}
                              onChange={(e) => updateReachMediaType(row.mediaTypeId, { maxReachPercent: numericValue(e.target.value) })}
                              className={`${inputClass} mt-0 px-2 py-1.5`}
                            />
                          </td>
                          <td className="px-2 py-2">
                            <input
                              type="number" min="1" max="50" step="0.5" aria-label={`${row.label} duplication factor`}
                              value={Number.isFinite(row.duplicationFactor) ? row.duplicationFactor : ""}
                              onChange={(e) => updateReachMediaType(row.mediaTypeId, { duplicationFactor: numericValue(e.target.value) })}
                              className={`${inputClass} mt-0 px-2 py-1.5`}
                            />
                          </td>
                          <td className="px-2 py-2">
                            <input
                              type="number" min="0.1" max="20" step="0.5" aria-label={`${row.label} audience concentration k`}
                              value={Number.isFinite(row.concentrationK) ? row.concentrationK : ""}
                              onChange={(e) => updateReachMediaType(row.mediaTypeId, { concentrationK: numericValue(e.target.value) })}
                              className={`${inputClass} mt-0 px-2 py-1.5`}
                            />
                          </td>
                          <td className="px-2 py-2">
                            <select
                              aria-label={`${row.label} unit`}
                              value={row.unit}
                              onChange={(e) => updateReachMediaType(row.mediaTypeId, { unit: e.target.value as ReachMediaTypeSetting["unit"] })}
                              className={`${inputClass} mt-0 min-w-[8rem] px-2 py-1.5`}
                            >
                              <option value="households">Households</option>
                              <option value="people">People</option>
                            </select>
                          </td>
                          <td className="px-2 py-2">
                            <input
                              type="number" min="1" max="10" step="0.1" aria-label={`${row.label} people per household`}
                              value={Number.isFinite(row.peoplePerHousehold) ? row.peoplePerHousehold : ""}
                              disabled={row.unit !== "people"}
                              onChange={(e) => updateReachMediaType(row.mediaTypeId, { peoplePerHousehold: numericValue(e.target.value) })}
                              className={`${inputClass} mt-0 px-2 py-1.5 disabled:bg-slate-50 disabled:text-slate-400`}
                            />
                          </td>
                          <td className="px-2 py-2">
                            <input
                              type="number" min="0" step="1000" aria-label={`${row.label} minimum targetable households`}
                              value={Number.isFinite(row.minimumTargetableHouseholds) ? row.minimumTargetableHouseholds : ""}
                              onChange={(e) => updateReachMediaType(row.mediaTypeId, { minimumTargetableHouseholds: numericValue(e.target.value) })}
                              className={`${inputClass} mt-0 px-2 py-1.5`}
                            />
                          </td>
                          <td className="px-2 py-2">
                            <input
                              type="text" aria-label={`${row.label} rationale`}
                              value={row.rationale}
                              onChange={(e) => updateReachMediaType(row.mediaTypeId, { rationale: e.target.value })}
                              className={`${inputClass} mt-0 min-w-[220px] px-2 py-1.5 text-xs`}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* AUDIENCE SHARE REFERENCE */}
              <div className="space-y-2">
                <div>
                  <h4 className="text-sm font-extrabold text-slate-900">Audience share reference</h4>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    Planners pick these on a plan (overview &gt; How reach is calculated) to narrow reach to the target audience, or type their own share.
                    Filters in the same category add up; different categories multiply. ScoutAI never sets these shares.
                  </p>
                </div>
                <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-xs">
                  <table className="w-full min-w-[720px] border-collapse text-left">
                    <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="w-44 px-3 py-2.5">Category</th>
                        <th className="w-52 px-2 py-2.5">Filter</th>
                        <th className="w-24 px-2 py-2.5">% of HH</th>
                        <th className="px-2 py-2.5">Source</th>
                        <th className="w-12 px-2 py-2.5"><span className="sr-only">Remove</span></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {draftSettings.reach.audienceShareReference.map((filter) => (
                        <tr key={filter.id}>
                          <td className="px-3 py-2">
                            <input type="text" aria-label="Audience filter category" value={filter.category}
                              onChange={(e) => updateAudienceFilter(filter.id, { category: e.target.value })}
                              className={`${inputClass} mt-0 px-2 py-1.5`} />
                          </td>
                          <td className="px-2 py-2">
                            <input type="text" aria-label="Audience filter label" value={filter.label}
                              onChange={(e) => updateAudienceFilter(filter.id, { label: e.target.value })}
                              className={`${inputClass} mt-0 px-2 py-1.5`} />
                          </td>
                          <td className="px-2 py-2">
                            <input type="number" min="0" max="100" step="0.5" aria-label={`${filter.label || "Audience filter"} share of households`}
                              value={Number.isFinite(filter.sharePercent) ? filter.sharePercent : ""}
                              onChange={(e) => updateAudienceFilter(filter.id, { sharePercent: numericValue(e.target.value) })}
                              className={`${inputClass} mt-0 px-2 py-1.5`} />
                          </td>
                          <td className="px-2 py-2">
                            <input type="text" aria-label={`${filter.label || "Audience filter"} source`} value={filter.source}
                              onChange={(e) => updateAudienceFilter(filter.id, { source: e.target.value })}
                              className={`${inputClass} mt-0 px-2 py-1.5 text-xs`} />
                          </td>
                          <td className="px-2 py-2 text-center">
                            <button type="button" onClick={() => removeAudienceFilter(filter.id)}
                              className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                              aria-label={`Remove ${filter.label || "audience filter"}`}>
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <button type="button" onClick={addAudienceFilter}
                    className="inline-flex items-center gap-2 rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-50 shadow-xs">
                    <Plus className="h-4 w-4" /> Add audience filter
                  </button>
                  <label className={`${labelClass} w-56`}>
                    Minimum audience share (%)
                    <input type="number" min="0.1" max="100" step="0.5"
                      value={Number.isFinite(draftSettings.reach.minimumAudienceSharePercent) ? draftSettings.reach.minimumAudienceSharePercent : ""}
                      onChange={(e) => updateReachBand({ minimumAudienceSharePercent: numericValue(e.target.value) })}
                      className={inputClass} />
                  </label>
                </div>
              </div>

              {/* HOUSEHOLD UNIVERSE REFERENCE */}
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
                <h4 className="text-sm font-extrabold text-slate-900">Household universe (reference)</h4>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  National: <span className="font-semibold text-slate-700">{NATIONAL_TV_HOUSEHOLDS.toLocaleString("en-US")}</span> TV households, the sum of the states.
                  These figures are reference data, changed by replacing <code>assets/state-tv-hh.csv</code> or <code>assets/dma-to-state.csv</code> and regenerating, not edited here.
                </p>
                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                  <details className="rounded-lg border border-slate-200">
                    <summary className="cursor-pointer px-3 py-2 text-xs font-bold text-slate-700">States ({STATE_HOUSEHOLDS.length}) · {STATE_HOUSEHOLDS_SOURCE_LABEL}</summary>
                    <ul className="max-h-64 divide-y divide-slate-100 overflow-y-auto border-t border-slate-100 text-xs">
                      {STATE_HOUSEHOLDS.map((state) => (
                        <li key={state.code} className="flex justify-between gap-2 px-3 py-1.5">
                          <span className="text-slate-700">{state.name}</span>
                          <span className="font-semibold text-slate-900">{state.tvHouseholds.toLocaleString("en-US")}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                  <details className="rounded-lg border border-slate-200">
                    <summary className="cursor-pointer px-3 py-2 text-xs font-bold text-slate-700">DMAs ({DMA_MARKETS.length}) · {DMA_SOURCE_LABEL}</summary>
                    <ul className="max-h-64 divide-y divide-slate-100 overflow-y-auto border-t border-slate-100 text-xs">
                      {DMA_MARKETS.map((market) => (
                        <li key={market.code} className="flex justify-between gap-2 px-3 py-1.5">
                          <span className="text-slate-700">{market.rank}. {market.name}</span>
                          <span className="font-semibold text-slate-900">{market.tvHouseholds.toLocaleString("en-US")}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                </div>
              </div>
            </section>
          )}

          {/* TAB 3: PRODUCT RULES */}
          {activeTab === "products" && (
            <section className="space-y-4">
              <div>
                <h3 className="text-base font-bold text-slate-900">Digital Remedy Product Rules</h3>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  These are conservative planning defaults. Geography defaults to United States only. Hiding a product removes it from planning entirely; clearing <span className="font-semibold">Recommend</span> keeps it available for manual add but stops ScoutAI proposing it.
                </p>
              </div>

              {/* CUSTOM MEDIA TYPES */}
              <section className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h4 className="flex items-center gap-2 text-sm font-extrabold text-slate-900">
                      <Plus className="h-4 w-4 text-indigo-600" /> Custom Media Types
                    </h4>
                    <p className="mt-1 text-xs leading-5 text-slate-600">
                      Media types outside the Digital Remedy workbook. They are planned, scored, and allocated exactly like registry products. ScoutAI only knows what is in the list below, so the funnel roles, KPIs, and notes are what let it judge when to propose one.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={addCustomProduct}
                    disabled={readOnly}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    <Plus className="h-3.5 w-3.5" /> Add media type
                  </button>
                </div>

                {draftSettings.customProducts.length === 0 ? (
                  <p className="mt-3 rounded-lg border border-dashed border-indigo-200 bg-white px-3 py-4 text-center text-xs text-slate-500">
                    No custom media types yet.
                  </p>
                ) : (
                  <div className="mt-4 space-y-4">
                    {draftSettings.customProducts.map((product) => (
                      <article key={product.productId} className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className={`min-w-0 flex-1 ${product.enabled ? "" : "opacity-60"}`}>
                            <input
                              value={product.displayName}
                              onChange={(e) => updateCustomProduct(product.productId, { displayName: e.target.value })}
                              className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm font-bold text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                              placeholder="Media type name"
                            />
                            <p className="mt-1 text-[11px] text-slate-400">{product.productId}</p>
                          </div>
                          <div className="flex flex-wrap items-center gap-3 text-xs font-semibold text-slate-600">
                            <label className={`flex items-center gap-2 ${product.enabled ? "" : "opacity-40"}`}>
                              <input
                                type="checkbox"
                                disabled={!product.enabled}
                                checked={product.recommendationEligible}
                                onChange={(e) => updateCustomProduct(product.productId, { recommendationEligible: e.target.checked })}
                              />
                              Recommend
                            </label>
                            <div className="flex items-center gap-2 border-l border-slate-200 pl-3">
                              <span className={`text-[11px] font-bold uppercase tracking-wide ${product.enabled ? "text-slate-500" : "text-slate-400"}`}>
                                {product.enabled ? "Shown" : "Hidden"}
                              </span>
                              <ShowToggle
                                checked={product.enabled}
                                onChange={(enabled) => updateCustomProduct(product.productId, { enabled })}
                                label={product.displayName}
                              />
                            </div>
                            <button
                              type="button"
                              onClick={() => removeCustomProduct(product)}
                              disabled={readOnly}
                              aria-label={`Delete ${product.displayName}`}
                              title="Delete this custom media type"
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-rose-200 bg-white text-rose-600 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>

                        <div className={`mt-4 space-y-3 ${product.enabled ? "" : "hidden"}`}>
                          <div className="rounded-lg border border-indigo-100 bg-indigo-50/50 p-3">
                            <p className="text-[11px] font-extrabold uppercase tracking-wide text-indigo-900">What ScoutAI reasons from</p>
                            <div className="mt-2 grid gap-3 sm:grid-cols-2">
                              <label className={labelClass}>
                                Funnel roles
                                <input
                                  value={product.funnelRoles.join(", ")}
                                  onChange={(e) => updateCustomProduct(product.productId, { funnelRoles: listValue(e.target.value) })}
                                  className={inputClass}
                                  placeholder="awareness, consideration, conversion"
                                />
                              </label>
                              <label className={labelClass}>
                                Supported KPIs
                                <input
                                  value={product.supportedKpis.join(", ")}
                                  onChange={(e) => updateCustomProduct(product.productId, { supportedKpis: listValue(e.target.value) })}
                                  className={inputClass}
                                  placeholder="reach, vcr, conversion, roas"
                                />
                              </label>
                              <label className={labelClass}>
                                Audience signals
                                <input
                                  value={product.audienceSignals.join(", ")}
                                  onChange={(e) => updateCustomProduct(product.productId, { audienceSignals: listValue(e.target.value) })}
                                  className={inputClass}
                                  placeholder="streaming, sports, mobile"
                                />
                              </label>
                              <label className={labelClass}>
                                Also known as
                                <input
                                  value={product.aliases.join(", ")}
                                  onChange={(e) => updateCustomProduct(product.productId, { aliases: listValue(e.target.value) })}
                                  className={inputClass}
                                  placeholder="Alternate names used in uploaded plans"
                                />
                              </label>
                              <label className={`${labelClass} sm:col-span-2`}>
                                Planning notes
                                <textarea
                                  value={product.planningNotes}
                                  onChange={(e) => updateCustomProduct(product.productId, { planningNotes: e.target.value })}
                                  rows={2}
                                  className={inputClass}
                                  placeholder="When should this be used, what makes it a good fit, what does it need? Passed to ScoutAI verbatim."
                                />
                              </label>
                            </div>
                          </div>

                          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                            <label className={labelClass}>
                              Closest standard media type
                              <select
                                value={product.canonicalId}
                                onChange={(e) => updateCustomProduct(product.productId, { canonicalId: e.target.value as CustomProductSetting["canonicalId"] })}
                                className={inputClass}
                              >
                                {CANONICAL_MEDIA_TAXONOMY.map((item) => (
                                  <option key={item.id} value={item.id}>{item.displayName}</option>
                                ))}
                              </select>
                            </label>
                            <label className={labelClass}>
                              Status
                              <select
                                value={product.status}
                                onChange={(e) => updateCustomProduct(product.productId, { status: e.target.value as any })}
                                className={inputClass}
                              >
                                <option value="live">Live</option>
                                <option value="beta">Beta</option>
                                <option value="future">Future</option>
                                <option value="retired">Retired</option>
                              </select>
                            </label>
                            <label className={`${labelClass} lg:col-span-2`}>
                              Geography coverage
                              <input
                                value={product.supportedGeographies.join(", ")}
                                onChange={(e) => updateCustomProduct(product.productId, { supportedGeographies: listValue(e.target.value) })}
                                className={inputClass}
                                placeholder="United States"
                              />
                            </label>
                            <label className={labelClass}>
                              Typical CPM low
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={product.typicalCpmLow ?? ""}
                                onChange={(e) => updateCustomProduct(product.productId, { typicalCpmLow: nullableNumericValue(e.target.value) })}
                                className={inputClass}
                                placeholder="Varies"
                              />
                            </label>
                            <label className={labelClass}>
                              Typical CPM high
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={product.typicalCpmHigh ?? ""}
                                onChange={(e) => updateCustomProduct(product.productId, { typicalCpmHigh: nullableNumericValue(e.target.value) })}
                                className={inputClass}
                                placeholder="Varies"
                              />
                            </label>
                            <label className={labelClass}>
                              Minimum total spend
                              <input
                                type="number"
                                min="0"
                                step="1"
                                value={product.minimumTotalSpend}
                                onChange={(e) => updateCustomProduct(product.productId, { minimumTotalSpend: numericValue(e.target.value) })}
                                className={inputClass}
                              />
                            </label>
                            <label className={labelClass}>
                              Minimum 30-day spend
                              <input
                                type="number"
                                min="0"
                                step="1"
                                value={product.minimumNormalized30DaySpend}
                                onChange={(e) => updateCustomProduct(product.productId, { minimumNormalized30DaySpend: numericValue(e.target.value) })}
                                className={inputClass}
                              />
                            </label>
                            <label className={labelClass}>
                              Minimum flight days
                              <input
                                type="number"
                                min="1"
                                step="1"
                                value={product.minimumFlightDays}
                                onChange={(e) => updateCustomProduct(product.productId, { minimumFlightDays: numericValue(e.target.value) })}
                                className={inputClass}
                              />
                            </label>
                            <label className={labelClass}>
                              Minimum allocation %
                              <input
                                type="number"
                                min="0"
                                max="100"
                                step="0.1"
                                value={product.minimumAllocationPercent}
                                onChange={(e) => updateCustomProduct(product.productId, { minimumAllocationPercent: numericValue(e.target.value) })}
                                className={inputClass}
                              />
                            </label>
                            <label className={labelClass}>
                              Maximum allocation %
                              <input
                                type="number"
                                min="0"
                                max="100"
                                step="0.1"
                                value={product.maximumAllocationPercent}
                                onChange={(e) => updateCustomProduct(product.productId, { maximumAllocationPercent: numericValue(e.target.value) })}
                                className={inputClass}
                              />
                            </label>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>

              <div className="space-y-4">
                {draftSettings.products.map((product) => (
                  <article key={product.productId} className={`rounded-xl border bg-white p-4 shadow-xs transition-colors ${product.enabled ? "border-slate-200" : "border-slate-200 bg-slate-50"}`}>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className={product.enabled ? "" : "opacity-60"}>
                        <h4 className="font-bold text-slate-900">{product.displayName}</h4>
                        <p className="text-[11px] text-slate-400">{product.productId}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-4 text-xs font-semibold text-slate-600">
                        <label className={`flex items-center gap-2 ${product.enabled ? "" : "opacity-40"}`}>
                          <input
                            type="checkbox"
                            disabled={!product.enabled}
                            checked={product.digitalRemedyExecutable}
                            onChange={(e) => updateProduct(product.productId, { digitalRemedyExecutable: e.target.checked })}
                          />
                          DR executable
                        </label>
                        <label className={`flex items-center gap-2 ${product.enabled ? "" : "opacity-40"}`}>
                          <input
                            type="checkbox"
                            disabled={!product.enabled}
                            checked={product.recommendationEligible}
                            onChange={(e) => updateProduct(product.productId, { recommendationEligible: e.target.checked })}
                          />
                          Recommend
                        </label>
                        <div className="flex items-center gap-2 border-l border-slate-200 pl-4">
                          <span className={`text-[11px] font-bold uppercase tracking-wide ${product.enabled ? "text-slate-500" : "text-slate-400"}`}>
                            {product.enabled ? "Shown" : "Hidden"}
                          </span>
                          <ShowToggle
                            checked={product.enabled}
                            onChange={(enabled) => updateProduct(product.productId, { enabled })}
                            label={product.displayName}
                          />
                        </div>
                      </div>
                    </div>

                    {!product.enabled && (
                      <p className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
                        Hidden from planning entirely &mdash; not scored, not offered in channel allocations, and not sent to ScoutAI.
                      </p>
                    )}

                    <div className={`mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 ${product.enabled ? "" : "hidden"}`}>
                      <label className={labelClass}>
                        Status
                        <select
                          value={product.status}
                          onChange={(e) => updateProduct(product.productId, { status: e.target.value as any })}
                          className={inputClass}
                        >
                          <option value="live">Live</option>
                          <option value="beta">Beta</option>
                          <option value="future">Future</option>
                          <option value="retired">Retired</option>
                        </select>
                      </label>
                      <label className={`${labelClass} lg:col-span-3`}>
                        Geography coverage
                        <input
                          value={product.supportedGeographies.join(", ")}
                          onChange={(e) => updateProduct(product.productId, { supportedGeographies: listValue(e.target.value) })}
                          className={inputClass}
                          placeholder="United States"
                        />
                      </label>
                      <label className={labelClass}>
                        Typical CPM low
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={product.typicalCpmLow ?? ""}
                          onChange={(e) => updateProduct(product.productId, { typicalCpmLow: nullableNumericValue(e.target.value) })}
                          className={inputClass}
                          placeholder="Varies"
                        />
                      </label>
                      <label className={labelClass}>
                        Typical CPM high
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={product.typicalCpmHigh ?? ""}
                          onChange={(e) => updateProduct(product.productId, { typicalCpmHigh: nullableNumericValue(e.target.value) })}
                          className={inputClass}
                          placeholder="Varies"
                        />
                      </label>
                      <label className={labelClass}>
                        Minimum total spend
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={product.minimumTotalSpend}
                          onChange={(e) => updateProduct(product.productId, { minimumTotalSpend: numericValue(e.target.value) })}
                          className={inputClass}
                        />
                      </label>
                      <label className={labelClass}>
                        Minimum 30-day spend
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={product.minimumNormalized30DaySpend}
                          onChange={(e) => updateProduct(product.productId, { minimumNormalized30DaySpend: numericValue(e.target.value) })}
                          className={inputClass}
                        />
                      </label>
                      <label className={labelClass}>
                        Minimum flight days
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={product.minimumFlightDays}
                          onChange={(e) => updateProduct(product.productId, { minimumFlightDays: numericValue(e.target.value) })}
                          className={inputClass}
                        />
                      </label>
                      <label className={labelClass}>
                        Minimum allocation %
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="0.1"
                          value={product.minimumAllocationPercent}
                          onChange={(e) => updateProduct(product.productId, { minimumAllocationPercent: numericValue(e.target.value) })}
                          className={inputClass}
                        />
                      </label>
                      <label className={labelClass}>
                        Maximum allocation %
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="0.1"
                          value={product.maximumAllocationPercent}
                          onChange={(e) => updateProduct(product.productId, { maximumAllocationPercent: numericValue(e.target.value) })}
                          className={inputClass}
                        />
                      </label>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}

          {/* TAB 4: CREATIVE ENHANCEMENTS */}
          {activeTab === "enhancements" && (
            <section className="space-y-4">
              <div>
                <h3 className="text-base font-bold text-slate-900">Creative Enhancements</h3>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  Configure creative enhancement triggers, formats, and vendor specification notes.
                </p>
              </div>

              <div className="relative my-3">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                  placeholder="Search enhancements, channels, triggers, or formats..."
                />
              </div>

              <div className="space-y-3">
                {visibleEnhancements.map((enhancement) => (
                  <article key={enhancement.enhancementId} className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
                    <label className="flex items-center gap-2 text-sm font-bold text-slate-900">
                      <input
                        type="checkbox"
                        checked={enhancement.recommendationEligible}
                        onChange={(e) => updateEnhancement(enhancement.enhancementId, { recommendationEligible: e.target.checked })}
                      />
                      {enhancement.displayName}
                    </label>
                    <p className="mt-1 text-[11px] text-slate-400">{enhancement.enhancementId}</p>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <label className={labelClass}>
                        Attaches to channels
                        <input
                          value={enhancement.attachesTo.join(", ")}
                          onChange={(e) => updateEnhancement(enhancement.enhancementId, { attachesTo: listValue(e.target.value) })}
                          className={inputClass}
                        />
                      </label>
                      <label className={labelClass}>
                        Format type
                        <input
                          value={enhancement.formatType}
                          onChange={(e) => updateEnhancement(enhancement.enhancementId, { formatType: e.target.value })}
                          className={inputClass}
                        />
                      </label>
                      <label className={`${labelClass} md:col-span-2`}>
                        Trigger keywords
                        <input
                          value={enhancement.trigger}
                          onChange={(e) => updateEnhancement(enhancement.enhancementId, { trigger: e.target.value })}
                          className={inputClass}
                        />
                      </label>
                      <label className={`${labelClass} md:col-span-2`}>
                        Specification / vendor notes
                        <textarea
                          value={enhancement.specificationNotes}
                          onChange={(e) => updateEnhancement(enhancement.enhancementId, { specificationNotes: e.target.value })}
                          rows={3}
                          className={inputClass}
                        />
                      </label>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}

          {/* TAB 5: VISIBILITY */}
          {activeTab === "visibility" && (
            <div className="space-y-8">
              <section className="space-y-4">
                <div>
                  <h3 className="text-base font-bold text-slate-900">Overview Metrics</h3>
                  <p className="mt-1 text-sm leading-6 text-slate-600">
                    Choose which Plan vs. AI Scout metrics appear in the left-column overview.
                  </p>
                </div>

                <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
                  <table className="w-full border-collapse text-left">
                    <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-4 py-3">Metric</th>
                        <th className="w-24 px-4 py-3 text-center">Show</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {draftSettings.overviewMetrics.map((metric) => (
                        <tr key={metric.id}>
                          <td className="px-4 py-3 text-sm font-semibold text-slate-800">{metric.label}</td>
                          <td className="px-4 py-3 text-center">
                            <ShowToggle
                              checked={metric.show}
                              onChange={(show) => updateOverviewMetric(metric.id, show)}
                              label={metric.label}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="space-y-4">
                <div>
                  <h3 className="flex items-center gap-2 text-base font-bold text-slate-900">
                    <Lock className="h-4 w-4 text-slate-500" /> Internal Only
                  </h3>
                  <p className="mt-1 text-sm leading-6 text-slate-600">
                    Detail that is useful to the team but noise in front of a client. Turning one off
                    hides it everywhere in the plan &mdash; nothing is recalculated, so a plan can be
                    screen-shared either way without regenerating it.
                  </p>
                </div>

                <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
                  <table className="w-full border-collapse text-left">
                    <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-4 py-3">Detail</th>
                        <th className="w-24 px-4 py-3 text-center">Show</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {draftSettings.internalOnly.map((setting) => (
                        <tr key={setting.id}>
                          <td className="px-4 py-3">
                            <div className="text-sm font-semibold text-slate-800">{setting.label}</div>
                            {setting.description && (
                              <p className="mt-0.5 text-xs text-slate-500">{setting.description}</p>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center align-top">
                            <ShowToggle
                              checked={setting.show}
                              onChange={(show) => updateInternalOnlySetting(setting.id, show)}
                              label={setting.label}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          )}

          {/* Errors list if any */}
          {errors.length > 0 && (
            <div className="sticky bottom-0 mt-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 shadow-lg">
              <div className="mb-2 flex items-center gap-2 font-bold">
                <AlertTriangle className="h-4 w-4" /> Please fix the following errors before saving:
              </div>
              <ul className="max-h-32 list-disc space-y-1 overflow-y-auto pl-5">
                {errors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            </div>
          )}
          </fieldset>
        </div>

        {/* Footer actions */}
        <footer className="border-t border-slate-200 bg-white px-5 py-4 md:px-7">
          {saveError && (
            <div className="mb-3 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-xs font-medium text-rose-800">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
              <span>{saveError}</span>
            </div>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            {/* The prompts tab saves itself; these act on the planning settings only. */}
            <button
              type="button"
              disabled={readOnly}
              hidden={activeTab === "prompts"}
              onClick={() => {
                if (confirm("Reset planning settings to defaults?")) {
                  setDraftSettings(clonePlanningSettings(DEFAULT_PLANNING_SETTINGS));
                  setErrors([]);
                }
              }}
              className="inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <RotateCcw className="h-4 w-4" /> Reset provisional defaults
            </button>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleCancel}
                className="flex-1 rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 sm:flex-none"
              >
                {readOnly ? "Close" : "Cancel"}
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={readOnly}
                hidden={activeTab === "prompts"}
                title={readOnly ? "Only administrators can change global settings." : undefined}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-5 py-2 text-sm font-bold text-white hover:bg-indigo-700 shadow-sm sm:flex-none disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                <Save className="h-4 w-4" /> Save all settings
              </button>
            </div>
          </div>
        </footer>
      </aside>

      {/* MODAL 1: EDIT/UPLOAD LOGO */}
      {currentEditingPub && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <ImageIcon className="h-5 w-5 text-indigo-600" />
                <h3 className="font-bold text-slate-900 text-base">Edit Logo: {currentEditingPub.name}</h3>
              </div>
              <button
                type="button"
                onClick={() => setEditingLogoPubId(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Current preview */}
            <div className="flex items-center gap-4 bg-slate-50 p-4 rounded-xl border border-slate-100">
              <div className="h-16 w-16 rounded-xl border border-slate-200 bg-white p-2 flex items-center justify-center overflow-hidden shadow-xs">
                <img
                  src={logoInputUrl || resolvePublisherLogo(currentEditingPub.name, draftPublishers)}
                  alt="Logo preview"
                  className="h-full w-full object-contain"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = "/assets/pub-logos/placeholder_80x80.png";
                  }}
                />
              </div>
              <div className="text-xs text-slate-600 space-y-1">
                <p className="font-bold text-slate-800">Current Logo Preview</p>
                <p className="text-[11px] text-slate-500">Supports PNG, JPG, SVG, WebP. Displayed at 80x80 px.</p>
              </div>
            </div>

            {/* Upload image file */}
            <div className="space-y-2">
              <label className="block text-xs font-bold text-slate-700">Upload Image File (Local Storage)</label>
              <input
                type="file"
                ref={fileInputRef}
                onChange={(e) => handleLogoFileUpload(e, currentEditingPub.id)}
                accept="image/*"
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploadingLogo}
                className="w-full flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-indigo-200 bg-indigo-50/50 py-3 text-xs font-bold text-indigo-700 hover:bg-indigo-50 hover:border-indigo-300 transition-all cursor-pointer"
              >
                <Upload className="h-4 w-4" />
                {isUploadingLogo ? "Uploading & Saving..." : "Select Logo Image File to Upload"}
              </button>
            </div>

            <div className="relative flex py-1 items-center">
              <div className="flex-grow border-t border-slate-200"></div>
              <span className="flex-shrink mx-3 text-[11px] font-semibold text-slate-400 uppercase">Or provide URL</span>
              <div className="flex-grow border-t border-slate-200"></div>
            </div>

            {/* Direct Image URL input */}
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-700">Custom Image / Logo URL</label>
              <input
                type="text"
                value={logoInputUrl}
                onChange={(e) => setLogoInputUrl(e.target.value)}
                placeholder="https://... or /assets/pub-logos/..."
                className={inputClass}
              />
            </div>

            {logoUploadError && (
              <p className="text-xs text-rose-600 font-medium">{logoUploadError}</p>
            )}

            {/* Actions */}
            <div className="flex items-center justify-between pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => {
                  updatePublisherField(currentEditingPub.id, { logoUrl: undefined });
                  setEditingLogoPubId(null);
                }}
                className="text-xs font-semibold text-slate-500 hover:text-slate-800"
              >
                Reset to Default Placeholder
              </button>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setEditingLogoPubId(null)}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    updatePublisherField(currentEditingPub.id, { logoUrl: logoInputUrl.trim() || undefined });
                    setEditingLogoPubId(null);
                  }}
                  className="rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-indigo-700 shadow-xs"
                >
                  Apply Logo
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: ADD NEW CTV PUBLISHER */}
      {isAddPubModalOpen && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <Tv className="h-5 w-5 text-indigo-600" />
                <h3 className="font-bold text-slate-900 text-base">Add New CTV Publisher</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsAddPubModalOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-3">
              <label className="block text-xs font-bold text-slate-700">
                Publisher Name *
                <input
                  type="text"
                  value={newPubName}
                  onChange={(e) => setNewPubName(e.target.value)}
                  placeholder="e.g. ESPN+, Paramount+, Crunchyroll"
                  className={inputClass}
                  required
                />
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <label className="block text-xs font-bold text-slate-700">
                  Category
                  <select
                    value={newPubCategory}
                    onChange={(e) => setNewPubCategory(e.target.value as any)}
                    className={inputClass}
                  >
                    <option value="App">App (Streaming Service)</option>
                    <option value="Network">Network (Broadcast/Cable)</option>
                    <option value="OS">FAST / Smart TV OS</option>
                  </select>
                </label>

                <label className="block text-xs font-bold text-slate-700">
                  Internal Tier
                  <select
                    value={newPubTier}
                    onChange={(e) => setNewPubTier(Number(e.target.value) as 1 | 2 | 3)}
                    className={inputClass}
                  >
                    <option value={1}>Tier 1 (SVOD / Sports)</option>
                    <option value={2}>Tier 2 (Linear / Targeted)</option>
                    <option value={3}>Tier 3 (FAST / Device OS)</option>
                  </select>
                </label>

                <label className="block text-xs font-bold text-slate-700">
                  Channel
                  <input
                    type="text"
                    value={newPubChannel}
                    onChange={(e) => setNewPubChannel(e.target.value)}
                    placeholder="CTV / OTT"
                    className={inputClass}
                  />
                </label>
              </div>

              <label className="block text-xs font-bold text-slate-700">
                When to Include / Targeting Guidance (Passed to AI Prompt)
                <textarea
                  value={newPubNotes}
                  onChange={(e) => setNewPubNotes(e.target.value)}
                  rows={2}
                  placeholder="e.g. Include for sports fans, live event streaming, 18-49 male demographic"
                  className={inputClass}
                />
              </label>

              <label className="block text-xs font-bold text-slate-700">
                Logo URL (Optional)
                <input
                  type="text"
                  value={newPubLogoUrl}
                  onChange={(e) => setNewPubLogoUrl(e.target.value)}
                  placeholder="https://... or leave blank for placeholder"
                  className={inputClass}
                />
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsAddPubModalOpen(false)}
                className="rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAddNewPublisher}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-700 shadow-xs"
              >
                Add Publisher
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
