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

type SettingsTab = "visibility" | "budgets" | "products" | "publishers" | "enhancements";

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

      const res = await fetch("/api/ctv-publishers/upload-logo", {
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

        const parsedPubs: CtvPublisherSetting[] = [];
        // Skip header if first line contains 'publisher' or 'category'
        const startIndex = lines[0].toLowerCase().includes("publisher") ? 1 : 0;

        for (let i = startIndex; i < lines.length; i++) {
          const line = lines[i];
          // Simple CSV parser supporting quotes
          const match = line.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g);
          const parts = line.split(",").map((p) => p.replace(/^"|"$/g, "").trim());

          if (parts.length >= 1 && parts[0]) {
            const name = parts[0];
            const categoryRaw = (parts[1] || "App").trim();
            const category: "App" | "Network" | "OS" =
              categoryRaw.toLowerCase().includes("network")
                ? "Network"
                : categoryRaw.toLowerCase().includes("os") || categoryRaw.toLowerCase().includes("fast")
                ? "OS"
                : "App";
            const channel = parts[2] || "CTV / OTT";
            const notes = parts.slice(3).join(", ").trim() || "";

            const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
            parsedPubs.push({
              id: id || `pub-${Date.now()}-${i}`,
              name,
              category,
              channel,
              notes,
              enabled: true,
            });
          }
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
      logoUrl: newPubLogoUrl.trim() || undefined,
      enabled: true,
    };

    setDraftPublishers((current) => [newPub, ...current]);
    setIsAddPubModalOpen(false);
    setNewPubName("");
    setNewPubCategory("App");
    setNewPubChannel("CTV / OTT");
    setNewPubNotes("");
    setNewPubLogoUrl("");
  };

  const handleSave = () => {
    // Belt and braces: the server also refuses this, but there is no reason to send a
    // write we already know will be rejected.
    if (readOnly) return;

    const settingsValidation = validatePlanningSettings(draftSettings);
    const pubValidation = validateCtvPublishers(draftPublishers);

    const allErrors: string[] = [];
    if (!settingsValidation.valid) allErrors.push(...settingsValidation.errors);
    if (!pubValidation.valid) allErrors.push(...pubValidation.errors);

    if (allErrors.length > 0) {
      setErrors(allErrors);
      return;
    }

    onSave(settingsValidation.settings || draftSettings, pubValidation.publishers || draftPublishers);
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
    if (!normalizedSearch) return true;
    const combined = `${pub.name} ${pub.category} ${pub.channel} ${pub.notes}`.toLowerCase();
    return combined.includes(normalizedSearch);
  });

  const enabledCount = draftPublishers.filter((p) => p.enabled).length;
  const appCount = draftPublishers.filter((p) => p.category === "App").length;
  const networkCount = draftPublishers.filter((p) => p.category === "Network").length;
  const osCount = draftPublishers.filter((p) => p.category === "OS").length;

  const visibleEnhancements = draftSettings.enhancements.filter(
    (enhancement) =>
      !normalizedSearch ||
      `${enhancement.displayName} ${enhancement.attachesTo.join(" ")} ${enhancement.trigger} ${enhancement.formatType}`
        .toLowerCase()
        .includes(normalizedSearch)
  );

  const tabs: Array<{ id: SettingsTab; label: string; count?: number }> = [
    { id: "publishers", label: "Recommended CTV Publishers", count: draftPublishers.length },
    { id: "budgets", label: "Budget & Media-Type Limits" },
    { id: "products", label: "Product Rules", count: draftSettings.products.length },
    { id: "enhancements", label: "Enhancements", count: draftSettings.enhancements.length },
    { id: "visibility", label: "Visibility", count: draftSettings.overviewMetrics.length + draftSettings.internalOnly.length },
  ];

  const currentEditingPub = editingLogoPubId
    ? draftPublishers.find((p) => p.id === editingLogoPubId)
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
          <fieldset disabled={readOnly} className={readOnly ? "opacity-90" : undefined}>
          
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
                  {/* Category filters */}
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
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
            <button
              type="button"
              disabled={readOnly}
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

              <div className="grid grid-cols-2 gap-3">
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
