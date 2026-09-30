import React, { useState } from "react";
import * as XLSX from "xlsx";
import drIconWhite from "./images/dr-icon-white.png";
import {
  Tv,
  MapPin,
  Target,
  Globe,
  FileText,
  Sparkles,
  Copy,
  Download,
  RefreshCw,
  TrendingUp,
  User,
  CheckCircle,
  Clock,
  Layers,
  ArrowRight,
  ExternalLink,
  Info,
  ShieldCheck,
  Award,
  BookOpen,
  Loader2,
  Check,
  AlertTriangle,
  HelpCircle,
  Smartphone,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Bookmark,
  Search,
  Save,
  Trash2,
  Edit3,
  Pencil,
  History,
  Calendar,
  Lock,
  Eye,
  EyeOff,
  Plus,
  X,
  Building2,
  DollarSign,
  Menu,
  Monitor,
  Tablet,
  Users,
  UserCheck,
  Upload,
  FileSpreadsheet,
  Share2,
  AlertCircle,
  ShoppingCart
} from "lucide-react";
import Markdown from "react-markdown";

import { AudienceProfile, type Persona, PersonaAvatarVersion, ExtractedPlacement, GenerateProfileResponse, ParsedPlanOption, TaxonomyMapping, CanonicalMediaType, RfpAnalysis, type ChannelStrategyData, type ChannelOverridesMap, GeographyType, GeographyTargetConfig, isUserAddedPublisher } from "./types";
import { parseGeoTextInput, extractGeoFromSpreadsheetRows } from "./utils/geoReference";
import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";
import {
  DomainsChart,
  DeviceChart,
  AgeChart,
  GenderChart,
  IncomeChart,
  DayOfWeekChart,
  HourOfDayChart
} from "./components/ProfileCharts";
import { exportProfileToMarkdown, exportSourcesToMarkdown } from "./utils/markdownExporter";
import { MediaPlanSelector } from "./components/MediaPlanSelector";
import { TaxonomyVerificationBadge } from "./components/TaxonomyVerificationBadge";
import { ALL_INTERNAL_VISIBLE, ChannelStrategySection, type InternalOnlyVisibility } from "./components/ChannelStrategySection";
import { SectionVisibilityButton } from "./components/SectionVisibilityButton";
import { PerformanceLearningsSection } from "./components/PerformanceLearningsSection";
import { OverviewMetricsTab } from "./components/OverviewMetricsTab";
import { SettingsDrawer } from "./components/SettingsDrawer";
import { SharePlanModal } from "./components/SharePlanModal";
import { ClonePlanModal } from "./components/ClonePlanModal";
import { DeletePlanModal } from "./components/DeletePlanModal";
import { CtvPublishersModal } from "./components/CtvPublishersModal";
import { CtvPublisherCard } from "./components/CtvPublisherCard";
import { CtvSlideExportView } from "./components/CtvSlideExportView";
import { CtvExportDropdown } from "./components/CtvExportDropdown";
import { PersonaSlideExportModal } from "./components/PersonaSlideExportModal";
import { PersonaAvatarModal } from "./components/PersonaAvatarModal";
import { SegmentRecommendations, SEGMENT_DIMENSION_STYLES, type SegmentStatus } from "./components/SegmentRecommendations";
import {
  createUserSegment,
  extractPlanAudiences,
  MAX_TOTAL_SEGMENTS,
  profileBaselineFingerprint,
  segmentKey,
  segmentsToCsv,
  topUpCount,
} from "./research/segmentRecommendations";
import type { SegmentRecommendation } from "./types";
import { captureElementToCanvas } from "./utils/html2canvasPolyfill";
import { CtvPublisherRecommendation } from "./types";
import { groupPlacementsIntoPlanOptions } from "./utils/planPromptOptimizer";
import { normalizeRawChannel } from "./utils/mediaTaxonomy";
import {
  findBudgetChannelTier,
  normalizeCampaignBudget,
  parseCurrencyInput,
  type PlanningSettings,
  clonePlanningSettings,
  migrateStoredSettings,
  validatePlanningSettings,
} from "./planning/settings";
import {
  addMediaTypeAndRebalance,
  allocationBasisPoints,
  allocationsEqual,
  applyBasisPointAllocations,
  removeMediaTypeAndRebalance,
  type AllocationBasisPoints,
} from "./planning/manualAllocations";
import {
  type CtvPublisherSetting,
  DEFAULT_CTV_PUBLISHERS,
  resolvePublisherLogo,
} from "./planning/knowledge/ctvPublishers";
import * as api from "./api/client";
import { ApiError, type PlanSummary, type SessionUser } from "./api/client";
import { migrateLocalPlans } from "./api/migrateLocalPlans";
import { BriefOfRecordCard } from "./components/BriefOfRecordCard";
import { ExecutiveBriefSection, type ExecutiveBriefStatus } from "./components/ExecutiveBriefSection";
import { briefFingerprint, buildBriefSnapshot, withoutHistory, type ExecutiveBrief } from "./research/executiveBrief";
import { QaFindings } from "./components/QaFindings";
import { GenerationLog } from "./components/GenerationLog";
import { PlanAuditModal } from "./components/PlanAuditModal";
import { ScoutAssistantPanel, type ScoutFollowUpAction, type ScoutPreview } from "./components/ScoutAssistantPanel";
import { PlanText } from "./components/PlanText";
import { syncCtvChannelPublishers } from "./planning/ctvChannel";
import { ErrorBoundary, PlanRenderError, RenderBelow } from "./components/ErrorBoundary";
import { DEFAULT_PLANNING_SETTINGS } from "./planning/settings";

const getPublisherLogo = (name: string, customPublishers?: CtvPublisherSetting[]): string => {
  return resolvePublisherLogo(name, customPublishers);
};

const normalizeAndValidateSettings = (s: unknown): PlanningSettings => {
  const migrated = migrateStoredSettings(s);
  const validated = validatePlanningSettings(migrated);
  return validated.valid && validated.settings ? validated.settings : clonePlanningSettings(s as PlanningSettings);
};

// Shown wherever research did not supply a section's figures. Summaries never fall back to
// sample numbers: a collapsed header with invented stats reads exactly like a real one.
const NOT_FOUND_IN_RESEARCH = "Not found in research";

// Summary highlight extractor for Device Share (Option C: Tag + Metric Chips)
function getDeviceShareSummary(deviceData?: any[]) {
  if (!deviceData || deviceData.length === 0) {
    return { tag: NOT_FOUND_IN_RESEARCH, chips: [] };
  }

  const sorted = [...deviceData].sort((a, b) => (b.value || 0) - (a.value || 0));
  const total = sorted.reduce((sum, d) => sum + (d.value || 0), 0) || 100;
  
  const ctvItem = sorted.find(d => d.device?.toLowerCase().includes("ctv") || d.device?.toLowerCase().includes("tv") || d.device?.toLowerCase().includes("connected"));
  const mobileItem = sorted.find(d => d.device?.toLowerCase().includes("mobile") || d.device?.toLowerCase().includes("phone") || d.device?.toLowerCase().includes("smart"));
  
  const ctvShare = ctvItem ? (ctvItem.value / total) : 0;
  const mobileShare = mobileItem ? (mobileItem.value / total) : 0;
  
  let tag = "Multi-Screen Balanced";
  if (ctvShare >= 0.35 && mobileShare >= 0.25) tag = "CTV & Mobile Led";
  else if (ctvShare >= 0.45) tag = "CTV Dominant";
  else if (mobileShare >= 0.45) tag = "Mobile First";
  else if (sorted[0]?.device) tag = `${sorted[0].device.split("/")[0].trim()} Led`;

  const chips = sorted.slice(0, 3).map(d => {
    const rawDev = (d.device || "").toLowerCase();
    let shortName = d.device || "Device";
    let iconType: "tv" | "mobile" | "desktop" | "tablet" | "device" = "device";

    if (rawDev.includes("ctv") || rawDev.includes("tv") || rawDev.includes("connected")) {
      shortName = "CTV";
      iconType = "tv";
    } else if (rawDev.includes("mobile") || rawDev.includes("smart") || rawDev.includes("phone")) {
      shortName = "Mobile";
      iconType = "mobile";
    } else if (rawDev.includes("desktop") || rawDev.includes("pc") || rawDev.includes("laptop")) {
      shortName = "Desktop";
      iconType = "desktop";
    } else if (rawDev.includes("tablet") || rawDev.includes("ipad")) {
      shortName = "Tablet";
      iconType = "tablet";
    }

    const valStr = typeof d.value === "number" ? `${Math.round(d.value)}%` : String(d.value);
    return { label: shortName, value: valStr, icon: iconType };
  });

  return { tag, chips };
}

// Summary highlight extractor for Demographics (Option C: Tag + Metric Chips)
function getDemographicsSummary(demo?: any) {
  const hasAny = ["ageChartData", "genderChartData", "incomeChartData"].some((key) => Array.isArray(demo?.[key]) && demo[key].length > 0);
  if (!hasAny) {
    return { tag: NOT_FOUND_IN_RESEARCH, chips: [] };
  }

  // Age calculation
  let ageTag = "Demographic Profile";
  let ageChipVal = "";
  if (demo.ageChartData && demo.ageChartData.length > 0) {
    const sortedAge = [...demo.ageChartData].sort((a, b) => (b.value || 0) - (a.value || 0));
    const a25_34 = demo.ageChartData.find((a: any) => a.range?.includes("25-34") || a.range?.includes("25–34"))?.value || 0;
    const a35_44 = demo.ageChartData.find((a: any) => a.range?.includes("35-44") || a.range?.includes("35–44"))?.value || 0;
    const combined25_44 = a25_34 + a35_44;

    if (combined25_44 >= 38) {
      ageTag = "Primary 25–44 Cohort";
      ageChipVal = `25–44: ${Math.round(combined25_44)}%`;
    } else if (sortedAge[0]) {
      ageTag = `Primary ${sortedAge[0].range}`;
      ageChipVal = `${sortedAge[0].range}: ${Math.round(sortedAge[0].value)}%`;
    }
  }

  // Gender calculation
  let genderChipVal = "";
  if (demo.genderChartData && demo.genderChartData.length > 0) {
    const f = demo.genderChartData.find((g: any) => g.gender?.toLowerCase().startsWith("f"))?.value || 0;
    const m = demo.genderChartData.find((g: any) => g.gender?.toLowerCase().startsWith("m"))?.value || 0;
    if (f > 0 && m > 0) {
      genderChipVal = `${Math.round(f)}% F / ${Math.round(m)}% M`;
    } else if (f > 0) {
      genderChipVal = `${Math.round(f)}% Female`;
    } else if (m > 0) {
      genderChipVal = `${Math.round(m)}% Male`;
    } else if (demo.genderChartData[0]) {
      genderChipVal = `${demo.genderChartData[0].gender}: ${Math.round(demo.genderChartData[0].value)}%`;
    }
  }

  // Income calculation
  let incomeChipVal = "";
  let isAffluent = false;
  if (demo.incomeChartData && demo.incomeChartData.length > 0) {
    const highIncome = demo.incomeChartData
      .filter((i: any) => i.bracket?.includes("100k") || i.bracket?.includes("125k") || i.bracket?.includes("150k") || i.bracket?.includes("200k") || i.bracket?.includes("$100k+"))
      .reduce((sum: number, i: any) => sum + (i.value || 0), 0);
    
    if (highIncome >= 38) {
      isAffluent = true;
      incomeChipVal = `$100k+: ${Math.round(highIncome)}%`;
    } else {
      const topInc = [...demo.incomeChartData].sort((a, b) => (b.value || 0) - (a.value || 0))[0];
      if (topInc) {
        incomeChipVal = `${topInc.bracket}: ${Math.round(topInc.value)}%`;
      }
    }
  }

  const tag = isAffluent ? "Affluent Core Audience" : ageTag;

  const chips = [
    ...(ageChipVal ? [{ label: "Age", value: ageChipVal, icon: "users" }] : []),
    ...(genderChipVal ? [{ label: "Gender", value: genderChipVal, icon: "gender" }] : []),
    ...(incomeChipVal ? [{ label: "Income", value: incomeChipVal, icon: "income" }] : []),
  ];

  return { tag, chips };
}

// Summary highlight extractor for Temporal Patterns (Option C: Tag + Metric Chips)
function getTemporalSummary(temp?: any) {
  const hasDays = Array.isArray(temp?.dayOfWeekChartData) && temp.dayOfWeekChartData.length > 0;
  const hasHours = Array.isArray(temp?.hourOfDayChartData) && temp.hourOfDayChartData.length > 0;
  if (!hasDays && !hasHours) {
    return { tag: NOT_FOUND_IN_RESEARCH, chips: [] };
  }

  // Peak Days calculation
  let daysVal = "";
  if (temp.dayOfWeekChartData && temp.dayOfWeekChartData.length > 0) {
    const sortedDays = [...temp.dayOfWeekChartData].sort((a: any, b: any) => (b.index || 0) - (a.index || 0));
    const topDays = sortedDays.slice(0, 3).map((d: any) => d.day);
    const topAvgIdx = Math.round(sortedDays.slice(0, 3).reduce((sum: number, d: any) => sum + (d.index || 0), 0) / Math.max(1, Math.min(3, sortedDays.length)));
    
    daysVal = `Peak: ${topDays.join(", ")} (Idx ${topAvgIdx})`;
  }

  // Peak Hours calculation
  let hoursVal = "";
  if (temp.hourOfDayChartData && temp.hourOfDayChartData.length > 0) {
    const sortedHours = [...temp.hourOfDayChartData].sort((a: any, b: any) => (b.index || 0) - (a.index || 0));
    const topHour = sortedHours[0];
    if (topHour) {
      hoursVal = `Top: ${topHour.hour} (Idx ${topHour.index})`;
    }
  }

  return {
    tag: "Peak Activity Windows",
    chips: [
      ...(daysVal ? [{ label: "Days", value: daysVal, icon: "calendar" }] : []),
      ...(hoursVal ? [{ label: "Hours", value: hoursVal, icon: "clock" }] : []),
    ]
  };
}

// Summary highlight extractor for Domain Affinity (Top 3 Domains + Index values)
function getDomainAffinitySummary(browserAndReach?: any) {
  if (!browserAndReach || !browserAndReach.chartData || browserAndReach.chartData.length === 0) {
    return { tag: NOT_FOUND_IN_RESEARCH, chips: [], top3: [] };
  }

  // Domain items carry their affinity index in `value`; reading `index` sorted nothing and
  // labelled every chip "Idx 0".
  const affinity = (d: any) => Number(d.value ?? d.index) || 0;
  const sorted = [...browserAndReach.chartData].sort((a: any, b: any) => affinity(b) - affinity(a));
  const top3 = sorted.slice(0, 3);
  
  const chips = top3.map((d: any) => {
    const cleanDomain = (d.domain || "").replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/.*$/, "");
    return {
      label: cleanDomain || "Domain",
      value: `Idx ${Math.round(affinity(d))}`,
      domain: d.domain,
      index: affinity(d)
    };
  });

  const tag = "Top 3 Affinity Domains";

  return { tag, chips, top3 };
}

function getColumnLetter(colIndex: number): string {
  let temp = colIndex;
  let letter = "";
  while (temp >= 0) {
    letter = String.fromCharCode((temp % 26) + 65) + letter;
    temp = Math.floor(temp / 26) - 1;
  }
  return letter;
}

function detectDelimiter(text: string): string {
  const lines = text.split("\n").slice(0, 5);
  let commaCount = 0;
  let semiCount = 0;
  
  lines.forEach(line => {
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (!inQuotes) {
        if (char === ',') commaCount++;
        else if (char === ';') semiCount++;
      }
    }
  });
  
  return semiCount > commaCount ? ";" : ",";
}

function parseCSVLine(line: string, delimiter: string = ","): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  
  return result.map(val => {
    let cleaned = val.trim();
    if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
      cleaned = cleaned.slice(1, -1);
    }
    cleaned = cleaned.replace(/""/g, '"');
    return cleaned;
  });
}

const extractMetadata = (rows: any[][]) => {
  const metadata: Array<{ key: string; value: string }> = [];
  if (!rows || !Array.isArray(rows)) return metadata;
  const labelsToMatch = [
    "advertiser", "client", "brand", "campaign", "media planner", 
    "planner", "media buyer", "buyer", "agency", "date", 
    "budget", "total budget", "estimated net total cost"
  ];
  
  const scanLimit = Math.min(rows.length, 15);
  for (let r = 0; r < scanLimit; r++) {
    const row = rows[r];
    if (!row) continue;
    
    for (let c = 0; c < row.length; c++) {
      const cellVal = row[c];
      if (cellVal === null || cellVal === undefined) continue;
      const cellStr = String(cellVal).trim();
      if (!cellStr) continue;
      
      const colonIdx = cellStr.indexOf(":");
      if (colonIdx > 0 && colonIdx < 35) {
        const potentialKey = cellStr.substring(0, colonIdx).trim();
        const potentialVal = cellStr.substring(colonIdx + 1).trim();
        const lowerKey = potentialKey.toLowerCase();
        
        if (labelsToMatch.some(l => lowerKey.includes(l)) && potentialVal) {
          metadata.push({ key: potentialKey, value: potentialVal });
          continue;
        }
      }
      
      const lowerCell = cellStr.toLowerCase();
      if (labelsToMatch.some(l => lowerCell === l || lowerCell === l + ":")) {
        let foundVal = "";
        for (let nextC = c + 1; nextC < Math.min(row.length, c + 4); nextC++) {
          if (row[nextC] !== null && row[nextC] !== undefined && String(row[nextC]).trim()) {
            foundVal = String(row[nextC]).trim();
            break;
          }
        }
        
        if (foundVal) {
          const cleanKey = cellStr.endsWith(":") ? cellStr.slice(0, -1).trim() : cellStr;
          metadata.push({ key: cleanKey, value: foundVal });
        }
      }
    }
  }
  
  const seenKeys = new Set<string>();
  return metadata.filter(m => {
    const k = m.key.toLowerCase();
    if (seenKeys.has(k)) return false;
    seenKeys.add(k);
    return true;
  });
};


// Hard client-side deadline for a generation run. The server heartbeats every 4s, so the
// socket never idles out on its own; without this an interrupted run spins indefinitely.
// Matches the server's 870s run budget plus margin, inside Cloud Run's 900s request timeout.
const CLIENT_GENERATION_TIMEOUT_MS = 900000; // 15 minutes

// Helper to compress base64 avatar images using Canvas with object-cover center cropping
async function compressAvatarUrl(url?: string, maxDim = 120, quality = 0.65): Promise<string | undefined> {
  if (!url || !url.startsWith("data:image/")) return url;
  if (url.length < 10000) return url; // Already compact

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = maxDim;
        canvas.height = maxDim;
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(url);

        // Calculate aspect-fill / center-crop parameters
        const srcWidth = img.naturalWidth || img.width;
        const srcHeight = img.naturalHeight || img.height;
        const minDim = Math.min(srcWidth, srcHeight);
        const sx = (srcWidth - minDim) / 2;
        const sy = (srcHeight - minDim) / 2;

        ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, maxDim, maxDim);
        const compressed = canvas.toDataURL("image/jpeg", quality);
        resolve(compressed);
      } catch (e) {
        resolve(url);
      }
    };
    img.onerror = () => resolve(url);
    img.src = url;
  });
}

export default function App() {
  // --- AUTHENTICATION -------------------------------------------------------
  // The session lives in a signed, HTTP-only cookie the server issues. The client
  // cannot mint or extend it, so editing browser storage no longer grants access -
  // the previous localStorage timestamp was a UI gate only.
  const [session, setSession] = useState<SessionUser | null>(null);
  const [isSessionChecked, setIsSessionChecked] = useState(false);
  const isAuthenticated = session !== null;
  const canEditSettings = session?.canEditSettings === true;

  const [usernameInput, setUsernameInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [displayNameInput, setDisplayNameInput] = useState("");
  const [adminPasswordInput, setAdminPasswordInput] = useState("");
  const [showAdminField, setShowAdminField] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Ask the server who we are on load, rather than trusting anything client-side.
  React.useEffect(() => {
    api
      .fetchSession()
      .then(setSession)
      .catch((err) => console.warn("Could not check session:", err))
      .finally(() => setIsSessionChecked(true));
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!usernameInput || !passwordInput) {
      setLoginError("Please enter both username and password.");
      return;
    }
    if (!displayNameInput.trim()) {
      setLoginError("Please enter your name so saved plans show who created them.");
      return;
    }

    setIsLoggingIn(true);
    setLoginError(null);

    try {
      const user = await api.login({
        username: usernameInput,
        password: passwordInput,
        displayName: displayNameInput,
        adminPassword: adminPasswordInput || undefined,
      });
      setSession(user);
      setLoginError(null);
      setPasswordInput("");
      setAdminPasswordInput("");
    } catch (err: any) {
      console.error("Login request failed:", err);
      setLoginError(err instanceof ApiError ? err.message : "Connection error. Please try again.");
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    try {
      await api.logout();
    } catch (err) {
      console.warn("Logout request failed:", err);
    }
    setSession(null);
    setIsHeaderMenuOpen(false);
  };

  // Input fields state
  const [advertiserName, setAdvertiserName] = useState("");
  const [budget, setBudget] = useState("$100,000");
  const [campaignLength, setCampaignLength] = useState("30");
  const [kpis, setKpis] = useState<string[]>([""]);
  const [audienceDescription, setAudienceDescription] = useState("");
  const [url, setUrl] = useState("");
  const [geographyType, setGeographyType] = useState<GeographyType>("National");
  const [geoTargets, setGeoTargets] = useState<string[]>([]);
  const [geoRawInput, setGeoRawInput] = useState("");
  const [geoUnrecognized, setGeoUnrecognized] = useState<string[]>([]);
  const [geoUploadNotice, setGeoUploadNotice] = useState<string | null>(null);
  const [isGeoFileDragging, setIsGeoFileDragging] = useState(false);
  const [geoCopiedNotice, setGeoCopiedNotice] = useState(false);
  const geoFileInputRef = React.useRef<HTMLInputElement | null>(null);
  const [campaignFocus, setCampaignFocus] = useState("Full-funnel digital media plan");
  const [additionalContext, setAdditionalContext] = useState("");
  const [isAdvancedPersonaOpen, setIsAdvancedPersonaOpen] = useState(false);
  const [targetPersonas, setTargetPersonas] = useState<string[]>(["", "", "", ""]);
  const [isInsightsExpanded, setIsInsightsExpanded] = useState(false);
  const [isCitationsExpanded, setIsCitationsExpanded] = useState(false);
  const [isAuditExpanded, setIsAuditExpanded] = useState(false);
  // Settings come from the server and only from the server. They used to be seeded from
  // localStorage first, which meant a fresh container answering with defaults could
  // overwrite good settings in a live tab - and the next save pushed those defaults back
  // up as the shared truth. Defaults here are a first-paint placeholder, nothing more.
  const [planningSettings, setPlanningSettings] = useState<PlanningSettings>(DEFAULT_PLANNING_SETTINGS);
  const [settingsRevision, setSettingsRevision] = useState<number | null>(null);
  const [ctvPublishers, setCtvPublishers] = useState<CtvPublisherSetting[]>(DEFAULT_CTV_PUBLISHERS);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isHeaderMenuOpen, setIsHeaderMenuOpen] = useState(false);

  // Load the shared settings and publisher list once signed in.
  React.useEffect(() => {
    if (!isAuthenticated) return;

    api
      .fetchSettings()
      .then((data) => {
        if (data?.settings) {
          setPlanningSettings(normalizeAndValidateSettings(data.settings));
          setSettingsRevision(data.revision);
        }
      })
      .catch((err) => console.warn("Could not load shared settings from the server:", err));

    api
      .fetchPublishers()
      .then((data) => {
        if (Array.isArray(data?.publishers) && data.publishers.length > 0) {
          setCtvPublishers(data.publishers);
        }
      })
      .catch((err) => console.warn("Could not load shared CTV publishers from the server:", err));
  }, [isAuthenticated]);

  const budgetNormalization = React.useMemo(
    () => normalizeCampaignBudget(parseCurrencyInput(budget), Number(campaignLength)),
    [budget, campaignLength],
  );
  // Settings store internal-only visibility as a list; the plan UI wants it keyed by id.
  const internalOnlyVisibility = React.useMemo(
    () => ({
      ...ALL_INTERNAL_VISIBLE,
      ...Object.fromEntries(
        (Array.isArray(planningSettings?.internalOnly) ? planningSettings.internalOnly : []).map((setting) => [setting.id, setting.show])
      ),
    }) as InternalOnlyVisibility,
    [planningSettings?.internalOnly],
  );
  const appliedBudgetTier = React.useMemo(
    () => findBudgetChannelTier(budgetNormalization.normalized30DayBudget, planningSettings),
    [budgetNormalization.normalized30DayBudget, planningSettings],
  );

  const geography = React.useMemo(() => {
    if (geographyType === "National") return "National";
    if (geoTargets.length === 0) return geographyType;
    if (geographyType === "State") {
      if (geoTargets.length <= 4) {
        return `State (${geoTargets.map((t) => t.match(/\(([^)]+)\)/)?.[1] || t).join(", ")})`;
      }
      return `State (${geoTargets.length} States: ${geoTargets.slice(0, 3).map((t) => t.match(/\(([^)]+)\)/)?.[1] || t).join(", ")}, +${geoTargets.length - 3} more)`;
    }
    if (geographyType === "DMA") {
      if (geoTargets.length <= 3) {
        return `DMA (${geoTargets.map((t) => t.split(",")[0]).join(", ")})`;
      }
      return `DMA (${geoTargets.length} Markets: ${geoTargets.slice(0, 2).map((t) => t.split(",")[0]).join(", ")}, +${geoTargets.length - 2} more)`;
    }
    return geographyType;
  }, [geographyType, geoTargets]);

  const geographyOptions = React.useMemo(() => {
    const base: string[] = ["National", "State", "DMA"];
    const configured = Array.from(
      new Set(
        planningSettings.products
          .filter(
            (product) =>
              product.digitalRemedyExecutable &&
              product.recommendationEligible &&
              product.status === "live",
          )
          .flatMap((product) => product.supportedGeographies),
      ),
    );
    const extras = configured.filter(
      (g) => !["united states", "us", "usa", "national"].includes(g.trim().toLowerCase()),
    );
    return [...base, ...extras];
  }, [planningSettings]);

  React.useEffect(() => {
    if (!geographyOptions.includes(geographyType)) {
      setGeographyType("National");
    }
  }, [geographyOptions, geographyType]);

  const handleApplyGeoRawInput = () => {
    if (!geoRawInput.trim()) return;
    const parsed = parseGeoTextInput(geoRawInput, geographyType as "State" | "DMA");
    if (parsed.valid.length > 0) {
      setGeoTargets((prev) => Array.from(new Set([...prev, ...parsed.valid])));
    }
    if (parsed.unrecognized.length > 0) {
      setGeoUnrecognized(parsed.unrecognized);
    } else {
      setGeoUnrecognized([]);
    }
    setGeoRawInput("");
  };

  const handleRemoveGeoTarget = (target: string) => {
    setGeoTargets((prev) => prev.filter((t) => t !== target));
  };

  const processGeoSpreadsheet = (file: File) => {
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
          setGeoUploadNotice(`No sheets found in file "${file.name}".`);
          return;
        }
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: "" }) as any[][];
        const result = extractGeoFromSpreadsheetRows(rows, geographyType as "State" | "DMA");

        if (result.valid.length > 0) {
          setGeoTargets((prev) => Array.from(new Set([...prev, ...result.valid])));
          setGeoUploadNotice(
            `Added ${result.valid.length} ${geographyType === "State" ? "states" : "DMAs"} from "${file.name}"${result.detectedColumnName ? ` (${result.detectedColumnName})` : ""}.`,
          );
        } else {
          setGeoUploadNotice(`No matching ${geographyType === "State" ? "US states" : "Nielsen DMAs"} detected in "${file.name}".`);
        }

        if (result.unrecognized.length > 0) {
          setGeoUnrecognized(result.unrecognized.slice(0, 10));
        } else {
          setGeoUnrecognized([]);
        }
      } catch (err: any) {
        setGeoUploadNotice(`Could not parse "${file.name}": ${err?.message || "Invalid file format"}`);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleGeoFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processGeoSpreadsheet(file);
      e.target.value = "";
    }
  };

  const handleGeoFileDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsGeoFileDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      processGeoSpreadsheet(file);
    }
  };

  /**
   * Settings are global and shared, so the server decides whether the write is allowed
   * and what the resulting state is. Local state is updated from the server's response,
   * never optimistically - otherwise a rejected write would leave this tab showing
   * settings nobody else has.
   */
  const handleSavePlanningSettings = async (nextSettings: PlanningSettings, nextPublishers?: CtvPublisherSetting[]) => {
    setSettingsError(null);
    try {
      const saved = await api.saveSettings(nextSettings);
      setPlanningSettings(normalizeAndValidateSettings(saved.settings));
      setSettingsRevision(saved.revision);

      if (nextPublishers && Array.isArray(nextPublishers)) {
        const savedPublishers = await api.savePublishers(nextPublishers);
        setCtvPublishers(savedPublishers.publishers);
      }
    } catch (err: any) {
      console.error("Failed to save shared settings:", err);
      if (err instanceof ApiError && err.isForbidden) {
        setSettingsError("Only administrators can change global planning settings.");
      } else {
        setSettingsError(err?.message || "Could not save settings. Please try again.");
      }
      // Re-read so this tab shows what is actually stored, not the rejected edit.
      try {
        const current = await api.fetchSettings();
        setPlanningSettings(normalizeAndValidateSettings(current.settings));
        setSettingsRevision(current.revision);
      } catch {
        // Leave the current view alone if even the re-read fails.
      }
    }
  };

  const handleAddKpi = () => {
    setKpis((prev) => [...prev, ""]);
  };

  const handleRemoveKpi = (index: number) => {
    setKpis((prev) => {
      if (prev.length <= 1) return [""];
      return prev.filter((_, i) => i !== index);
    });
  };

  const handleKpiChange = (index: number, value: string) => {
    setKpis((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };

  const extractCampaignMetadata = (sheetsData: Array<{ name: string; rows: any[][] }>) => {
    let advertiserName = "";
    let websiteUrl = "";
    const foundKpis: string[] = [];

    const advLabels = ["advertiser", "client", "brand", "advertiser name", "client name", "brand name"];
    const urlLabels = ["url", "website", "website url", "site", "landing page", "domain"];
    const kpiLabels = ["kpi", "kpis", "goal", "goals", "primary kpi", "target kpi", "objective", "objectives", "campaign goal", "campaign kpi"];

    for (const sheet of sheetsData) {
      const rows = sheet.rows || [];
      const scanLimit = Math.min(rows.length, 30);

      for (let r = 0; r < scanLimit; r++) {
        const row = rows[r];
        if (!row) continue;

        for (let c = 0; c < row.length; c++) {
          const cellVal = row[c];
          if (cellVal === null || cellVal === undefined) continue;
          const cellStr = String(cellVal).trim();
          if (!cellStr) continue;

          const lowerCell = cellStr.toLowerCase();

          const colonIdx = cellStr.indexOf(":");
          let keyPart = "";
          let valPart = "";

          if (colonIdx > 0 && colonIdx < 35) {
            keyPart = cellStr.substring(0, colonIdx).trim().toLowerCase();
            valPart = cellStr.substring(colonIdx + 1).trim();
          }

          if (!valPart) {
            for (let nextC = c + 1; nextC < Math.min(row.length, c + 4); nextC++) {
              if (row[nextC] !== null && row[nextC] !== undefined && String(row[nextC]).trim()) {
                valPart = String(row[nextC]).trim();
                break;
              }
            }
          }

          const checkKey = keyPart || lowerCell.replace(/:$/, "").trim();

          if (!advertiserName && advLabels.some((l) => checkKey === l || checkKey.includes(l))) {
            if (valPart && !advLabels.includes(valPart.toLowerCase())) {
              advertiserName = valPart;
            }
          }

          if (!websiteUrl && urlLabels.some((l) => checkKey === l || checkKey.includes(l))) {
            if (valPart && !urlLabels.includes(valPart.toLowerCase())) {
              websiteUrl = valPart;
            }
          }

          if (kpiLabels.some((l) => checkKey === l || checkKey.includes(l))) {
            if (valPart && !kpiLabels.includes(valPart.toLowerCase())) {
              const splitParts = valPart.split(/[,;\n\/]+/).map((s) => s.trim()).filter(Boolean);
              splitParts.forEach((p) => {
                if (!foundKpis.includes(p)) {
                  foundKpis.push(p);
                }
              });
            }
          }
        }
      }
    }

    return { advertiserName, websiteUrl, kpis: foundKpis };
  };

  // Media plan upload states
  const [briefMode, setBriefMode] = useState<"text" | "upload">("text");
  const [uploadedFileName, setUploadedFileName] = useState<string>("");
  const [uploadedFileText, setUploadedFileText] = useState<string>("");
  const [parsedSheetsData, setParsedSheetsData] = useState<Array<{
    name: string;
    rows: any[][];
    headers: string[];
    diagnostics?: string;
  }>>([]);
  const [extractedPlacements, setExtractedPlacements] = useState<ExtractedPlacement[]>([]);
  const [rfpAnalysis, setRfpAnalysis] = useState<RfpAnalysis | null>(null);
  const [activePlanSubTab, setActivePlanSubTab] = useState<string>("ALL");
  const [isParsingPlan, setIsParsingPlan] = useState<boolean>(false);
  const [parsingError, setParsingError] = useState<string | null>(null);
  const [ignoreCache, setIgnoreCache] = useState<boolean>(false);
  const lastUploadedFileRef = React.useRef<File | null>(null);
  const mediaPlanFileInputRef = React.useRef<HTMLInputElement | null>(null);

  // Media plan option selection & taxonomy state
  const [planOptions, setPlanOptions] = useState<ParsedPlanOption[]>([]);
  const [taxonomyMappings, setTaxonomyMappings] = useState<TaxonomyMapping[]>([]);
  const [isTaxonomyModalOpen, setIsTaxonomyModalOpen] = useState<boolean>(false);
  const [budgetStrategyMode, setBudgetStrategyMode] = useState<'reallocation' | 'incremental'>('reallocation');
  const [channelStrategyUndo, setChannelStrategyUndo] = useState<ChannelStrategyData | null>(null);

  // Sync planOptions & taxonomyMappings whenever extractedPlacements update
  React.useEffect(() => {
    if (extractedPlacements && extractedPlacements.length > 0) {
      const options = groupPlacementsIntoPlanOptions(extractedPlacements);
      setPlanOptions(options);
      const initiallySelected = options.filter((option) => option.selected);
      const selectedBudget = initiallySelected.reduce((sum, option) => sum + (Number(option.budget) || 0), 0);
      if (selectedBudget > 0) setBudget(`$${selectedBudget.toLocaleString()}`);
      const starts = initiallySelected.map((option) => option.flightDates?.start).filter(Boolean) as string[];
      const ends = initiallySelected.map((option) => option.flightDates?.end).filter(Boolean) as string[];
      if (starts.length > 0 && ends.length > 0) {
        const start = new Date([...starts].sort()[0]);
        const end = new Date([...ends].sort().at(-1)!);
        if (Number.isFinite(start.getTime()) && Number.isFinite(end.getTime()) && end >= start) {
          setCampaignLength(String(Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1));
        }
      }

      const uniqueRaw = Array.from(
        new Set(
          extractedPlacements
            .map(p => p.mediaType || p.productType || p.publisher || 'Programmatic Display')
            .filter(Boolean)
        )
      );
      const mappings = uniqueRaw.map(raw => normalizeRawChannel(String(raw)));
      setTaxonomyMappings(mappings);
    } else {
      setPlanOptions([]);
      setTaxonomyMappings([]);
    }
  }, [extractedPlacements]);

  const handleTogglePlanOption = (id: string) => {
    setPlanOptions(prev => prev.map(p => p.id === id ? { ...p, selected: !p.selected } : p));
  };

  const handleToggleAllPlanOptions = (selectAll: boolean) => {
    setPlanOptions(prev => prev.map(p => ({ ...p, selected: selectAll })));
  };

  const handleUpdateTaxonomyMapping = (rawLabel: string, canonicalId: CanonicalMediaType) => {
    setTaxonomyMappings(prev =>
      prev.map(m => (m.rawLabel === rawLabel ? { ...m, canonicalId, isUserVerified: true } : m))
    );
  };

  const uniquePlanNames = React.useMemo(() => {
    const set = new Set<string>();
    extractedPlacements.forEach((p) => {
      if (p.planName && p.planName.trim()) {
        set.add(p.planName.trim());
      }
    });
    return Array.from(set);
  }, [extractedPlacements]);

  const displayedPlacements = React.useMemo(() => {
    if (activePlanSubTab === "ALL" || uniquePlanNames.length <= 1) {
      return extractedPlacements;
    }
    return extractedPlacements.filter((p) => (p.planName || "").trim() === activePlanSubTab);
  }, [extractedPlacements, activePlanSubTab, uniquePlanNames]);

  // Modal preview states
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState<boolean>(false);
  const [modalTab, setModalTab] = useState<"ai" | "raw">("ai");
  const [activeSheetIndex, setActiveSheetIndex] = useState<number>(0);
  const [modalSearchQuery, setModalSearchQuery] = useState<string>("");
  const [modalCurrentPage, setModalCurrentPage] = useState<number>(1);
  const rowsPerPage = 30;

  // UI state
  const [loading, setLoading] = useState(false);
  const [profileData, setProfileData] = useState<AudienceProfile | null>(null);
  const [groundingSources, setGroundingSources] = useState<Array<{ title: string; uri: string }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Failures of actions taken on a delivered plan (re-analysis, slide export). Shown above the
  // plan, since the brief panel that carries `error` is usually collapsed by then.
  const [actionError, setActionError] = useState<string | null>(null);
  const [personaPage, setPersonaPage] = useState<number>(0);
  const [arePersonasExpanded, setArePersonasExpanded] = useState<boolean>(false);
  const [expandedPersonaIndices, setExpandedPersonaIndices] = useState<Record<number, boolean>>({});
  const [isDeviceShareExpanded, setIsDeviceShareExpanded] = useState<boolean>(false);
  const [isDemographicsExpanded, setIsDemographicsExpanded] = useState<boolean>(false);
  const [isTemporalExpanded, setIsTemporalExpanded] = useState<boolean>(false);
  const [isDomainAffinityExpanded, setIsDomainAffinityExpanded] = useState<boolean>(false);

  const toggleAllPersonasExpanded = () => {
    setArePersonasExpanded((prev) => {
      const next = !prev;
      setExpandedPersonaIndices({});
      return next;
    });
  };

  const togglePersonaExpanded = (idx: number) => {
    setExpandedPersonaIndices((prev) => {
      const rowIndex = Math.floor(idx / 2);
      const firstInRow = rowIndex * 2;
      const secondInRow = firstInRow + 1;
      const current =
        prev[firstInRow] !== undefined
          ? prev[firstInRow]
          : (prev[secondInRow] !== undefined ? prev[secondInRow] : arePersonasExpanded);
      const nextState = !current;
      return {
        ...prev,
        [firstInRow]: nextState,
        [secondInRow]: nextState,
      };
    });
  };
  
  // Real-time research stream console logs
  const [researchLogs, setResearchLogs] = useState<Array<{
    id: string;
    timestamp: string;
    type: "status" | "research_result";
    message?: string;
    label?: string;
    sources?: Array<{ title: string; uri: string }>;
    blurb?: string;
    failed?: boolean;
  }>>([]);

  const logContainerRef = React.useRef<HTMLDivElement>(null);
  const isLogHoveredRef = React.useRef<boolean>(false);
  const [isLogHovered, setIsLogHovered] = useState<boolean>(false);
  const pendingLogsRef = React.useRef<any[]>([]);
  const [serverCompleteData, setServerCompleteData] = useState<{ profile: any; groundingSources: any; savedPlanId?: string | null } | null>(null);
  // Whether the draft the server saves for this run becomes the open plan. Not for a
  // regeneration of a plan that is already saved: Save should keep updating that plan, and the
  // draft stays in the list as a backup.
  const adoptDraftRef = React.useRef(true);
  const [isAuditModalOpen, setIsAuditModalOpen] = useState(false);

  // Segment recommendations. They are requested after the profile renders (like headshots),
  // live on profileData.segmentRecommendations, and auto-save onto an already-saved plan.
  const [segmentStatus, setSegmentStatus] = useState<SegmentStatus>("idle");
  const [isToppingUpSegments, setIsToppingUpSegments] = useState(false);
  const [segmentError, setSegmentError] = useState<string | null>(null);
  const [segmentAutoSaveError, setSegmentAutoSaveError] = useState<string | null>(null);
  const [segmentUndoName, setSegmentUndoName] = useState<string | null>(null);
  const [hoveredSegment, setHoveredSegment] = useState<SegmentRecommendation | null>(null);
  /** Session-only removal history: powers Undo and keeps "Suggest more" from re-offering them. */
  const removedSegmentsRef = React.useRef<Array<{ segment: SegmentRecommendation; index: number }>>([]);
  const segmentUndoTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Bumped whenever the workspace switches profile, so a late response cannot land on the wrong plan. */
  const segmentRequestTokenRef = React.useRef(0);
  const requestSegmentsRef = React.useRef<(mode: "initial" | "top-up", profileOverride?: AudienceProfile) => Promise<void>>(async () => {});
  // Executive brief: written after the plan is delivered, and rewritten on demand.
  const [briefStatus, setBriefStatus] = useState<ExecutiveBriefStatus>("idle");
  const [briefError, setBriefError] = useState<string | null>(null);
  const briefRequestTokenRef = React.useRef(0);
  const executiveBriefDirtyRef = React.useRef(false);
  const [autoBriefToken, setAutoBriefToken] = useState<number | null>(null);

  // Derived QA audit state from logs
  const isQAStarted = researchLogs.some(log => 
    log.message?.toLowerCase().includes("programmatic validation") || 
    log.message?.toLowerCase().includes("qa audit")
  );
  const isQAFinished = researchLogs.some(log => 
    log.message?.toLowerCase().includes("qa audit complete")
  );
  
  // Extract specific corrections starting with bullet points
  const auditCorrections = researchLogs
    .filter(log => log.message?.trim().startsWith("•"))
    .map(log => log.message!.trim().substring(1).trim());

  // Auto-scroll the live research feed on logs update (if not hovered, keep top visible where newest messages arrive)
  React.useEffect(() => {
    if (logContainerRef.current && !isLogHoveredRef.current) {
      logContainerRef.current.scrollTop = 0;
    }
  }, [researchLogs]);

  // Track indices of persona avatars actively generating portraits in the background or on demand
  const [generatingAvatarIndices, setGeneratingAvatarIndices] = useState<number[]>([]);
  // Headshots that failed to generate or load, shown as failed rather than as an empty frame.
  const [failedAvatarIndices, setFailedAvatarIndices] = useState<number[]>([]);
  const markAvatarFailed = React.useCallback((index: number, failed: boolean) => {
    setFailedAvatarIndices((prev) => failed ? Array.from(new Set([...prev, index])) : prev.filter((i) => i !== index));
  }, []);

  // Persona portraits are generated off the critical path. The server returns the profile
  // as soon as it is ready and the client fills in headshots as they arrive, in parallel,
  // so up to 4 x 45s of image generation no longer gates the run.
  const hydratePersonaAvatars = React.useCallback((personas: any[]) => {
    if (!Array.isArray(personas)) return;

    // Immediately mark all personas without an image as actively generating
    const pendingIndices: number[] = [];
    personas.forEach((persona, index) => {
      if (!persona?.avatarUrl || !persona.avatarUrl.startsWith("data:image/")) {
        pendingIndices.push(index);
      }
    });
    if (pendingIndices.length > 0) {
      setGeneratingAvatarIndices((prev) => Array.from(new Set([...prev, ...pendingIndices])));
    }

    personas.forEach((persona, index) => {
      if (persona?.avatarUrl && persona.avatarUrl.startsWith("data:image/")) return;
      markAvatarFailed(index, false);
      api.authFetch("/api/generate-persona-avatar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ persona })
      })
        .then((res) => res.json())
        .then(async (data) => {
          if (!data?.success || !data.avatarUrl) {
            markAvatarFailed(index, true);
            return;
          }
          const compressed = await compressAvatarUrl(data.avatarUrl);
          const finalAvatar = compressed || data.avatarUrl;
          setProfileData((prev) => {
            if (!prev || !prev.personas || !prev.personas[index]) return prev;
            const updated = [...prev.personas];
            const existingHistory = updated[index].avatarHistory || [];
            const newHistory = existingHistory.length > 0
              ? existingHistory
              : [{
                  id: `v-init-${Date.now()}`,
                  url: finalAvatar,
                  prompt: "Initial archetype portrait",
                  createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                }];
            updated[index] = { ...updated[index], avatarUrl: finalAvatar, avatarHistory: newHistory };
            return { ...prev, personas: updated };
          });
        })
        .catch((err) => {
          console.error("Error generating persona headshot:", err);
          markAvatarFailed(index, true);
        })
        .finally(() => {
          setGeneratingAvatarIndices((prev) => prev.filter((i) => i !== index));
        });
    });
  }, [markAvatarFailed]);

  // Queue and live-log ticker Effect
  React.useEffect(() => {
    if (!loading) return;

    // Only real server events are logged. This used to fill quiet stretches with invented
    // steps ("Cross-referencing Comscore & Similarweb...") that never happened; a quiet stretch
    // now gets an honest elapsed-time line instead.
    const startedAt = Date.now();
    let lastLogAt = Date.now();

    let finished = false;
    const tick = () => {
      if (finished) return;
      if (pendingLogsRef.current.length > 0) {
        lastLogAt = Date.now();
        // One line per tick keeps a live run readable. But a hidden tab's timers run as rarely
        // as once a minute, so draining one line per tick there delayed a finished plan by
        // minutes while the queue caught up. Once the run is complete, or nobody is watching,
        // everything waiting is shown at once.
        const batch = serverCompleteData || document.hidden
          ? pendingLogsRef.current.splice(0)
          : [pendingLogsRef.current.shift()];
        const formattedBatch = batch.map((nextLog) => ({
          id: Math.random().toString(),
          // The server's time, so the log shows when each step happened rather than when
          // this queue got round to displaying it.
          timestamp: new Date(nextLog.at || Date.now()).toLocaleTimeString(),
          ...nextLog
        }));
        // Most recent message always at the top, pushing older ones down.
        // For a multi-item batch arriving in chronological order, reversing puts the newest at index 0.
        setResearchLogs(prev => [
          ...formattedBatch.reverse(),
          ...prev
        ]);
      }
      // If server has sent the completion event, and all real logs are drained, finish up!
      if (serverCompleteData && pendingLogsRef.current.length === 0) {
        finished = true;
        const rawProfile = serverCompleteData.profile;
        if (rawProfile && rawProfile.personas) {
          Promise.all(
            rawProfile.personas.map(async (persona) => ({
              ...persona,
              avatarUrl: await compressAvatarUrl(persona.avatarUrl)
            }))
          ).then((compressedPersonas) => {
            setProfileData({ ...rawProfile, personas: compressedPersonas });
            hydratePersonaAvatars(compressedPersonas);
          }).catch((err) => {
            console.error("Avatar compression failed, rendering profile uncompressed:", err);
            setProfileData(rawProfile);
            hydratePersonaAvatars(rawProfile.personas);
          });
        } else {
          setProfileData(rawProfile);
        }
        if (rawProfile) {
          // The executive brief follows the segments, because its audience section is built on
          // them. It runs whether or not the segments succeed.
          const briefToken = briefRequestTokenRef.current;
          if (rawProfile.channelStrategy?.mediaPlan?.channels?.length && !rawProfile.executiveBrief) setBriefStatus("loading");
          requestSegmentsRef.current("initial", rawProfile).finally(() => {
            // Picked up by an effect, so the brief reads the profile after the segments render.
            if (briefToken === briefRequestTokenRef.current) setAutoBriefToken(briefToken);
          });
        }
        // The server already saved this run as a draft. Opening it as the active plan means
        // Save updates that record instead of creating a second copy.
        const draftId = serverCompleteData.savedPlanId;
        if (draftId && adoptDraftRef.current) {
          setActiveSavedId(draftId);
          api.getPlan(draftId)
            .then((plan) => { markPlanPersisted(plan); return refreshPlans(); })
            .catch((err) => console.error("Could not open the auto-saved draft:", err));
        } else if (draftId) {
          refreshPlans().catch(() => undefined);
        }
        setGroundingSources(serverCompleteData.groundingSources);
        setPersonaPage(0);
        setArePersonasExpanded(false);
        setLoading(false);
        setRegenType(null);
        setServerCompleteData(null);
        
        // Scroll workspace into view
        setTimeout(() => {
          const workspace = document.getElementById("profile-workspace");
          if (workspace) {
            workspace.scrollIntoView({ behavior: "smooth" });
          }
        }, 100);
        return;
      }
      if (!serverCompleteData && pendingLogsRef.current.length === 0 && Date.now() - lastLogAt >= 15000) {
        lastLogAt = Date.now();
        setResearchLogs(prev => [
          {
            id: Math.random().toString(),
            timestamp: new Date().toLocaleTimeString(),
            type: "status",
            message: `Still working... ${Math.round((Date.now() - startedAt) / 1000)}s elapsed.`
          },
          ...prev
        ]);
      }
    };

    // A completed run finishes on this render rather than waiting for the next tick.
    if (serverCompleteData) tick();
    const interval = setInterval(tick, 1800); // Stagger every 1.8 seconds

    return () => clearInterval(interval);
  }, [loading, serverCompleteData, audienceDescription, url, geography, campaignFocus, planOptions, hydratePersonaAvatars]);
  
  // Feedback states for buttons
  const [copyProfileCopied, setCopyProfileCopied] = useState(false);
  const [copySourcesCopied, setCopySourcesCopied] = useState(false);
  const [regenType, setRegenType] = useState<string | null>(null);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [pdfGenerating, setPdfGenerating] = useState(false);
  // Deliberately not persisted: the same people demo and plan for real, so forgetting to
  // untick it should fall back to the full, audited run.
  const [quickMode, setQuickMode] = useState(false);

  // Persona Avatar Customizer Modal State
  const [editingAvatarPersonaIndex, setEditingAvatarPersonaIndex] = useState<number | null>(null);

  const handleOpenAvatarModal = (personaIndex: number) => {
    setEditingAvatarPersonaIndex(personaIndex);
  };

  const handleCloseAvatarModal = () => {
    setEditingAvatarPersonaIndex(null);
  };

  const handleSelectPersonaAvatar = (
    personaIndex: number,
    avatarUrl: string,
    updatedHistory: PersonaAvatarVersion[]
  ) => {
    if (!profileData || !profileData.personas || !profileData.personas[personaIndex]) return;
    const updatedPersonas = [...profileData.personas];
    updatedPersonas[personaIndex] = {
      ...updatedPersonas[personaIndex],
      avatarUrl,
      avatarHistory: updatedHistory,
    };
    setProfileData({
      ...profileData,
      personas: updatedPersonas,
    });
  };

  const handleGeneratePersonaAvatar = async (
    personaIndex: number,
    instruction?: string
  ): Promise<string | null> => {
    if (!profileData || !profileData.personas || !profileData.personas[personaIndex]) return null;
    setGeneratingAvatarIndices((prev) => Array.from(new Set([...prev, personaIndex])));
    markAvatarFailed(personaIndex, false);
    try {
      const targetPersona = profileData.personas[personaIndex];
      const res = await api.authFetch("/api/generate-persona-avatar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          persona: targetPersona,
          instruction: instruction && instruction.trim() ? instruction.trim() : undefined,
        }),
      });
      const data = await res.json();
      if (data.success && data.avatarUrl) {
        const compressed = await compressAvatarUrl(data.avatarUrl);
        const finalAvatar = compressed || data.avatarUrl;
        return finalAvatar;
      } else {
        markAvatarFailed(personaIndex, true);
        return null;
      }
    } catch (err) {
      console.error("Failed to generate persona headshot photo:", err);
      markAvatarFailed(personaIndex, true);
      return null;
    } finally {
      setGeneratingAvatarIndices((prev) => prev.filter((i) => i !== personaIndex));
    }
  };

  const handleRegenerateAvatar = async (personaIndex: number) => {
    if (!profileData || !profileData.personas || !profileData.personas[personaIndex]) return;
    const finalAvatar = await handleGeneratePersonaAvatar(personaIndex);
    if (finalAvatar) {
      const targetPersona = profileData.personas[personaIndex];
      const currentHistory = targetPersona.avatarHistory || (targetPersona.avatarUrl ? [
        {
          id: `v-prev-${Date.now()}`,
          url: targetPersona.avatarUrl,
          prompt: "Initial archetype portrait",
          createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        }
      ] : []);
      const newVersion: PersonaAvatarVersion = {
        id: `v-${Date.now()}`,
        url: finalAvatar,
        prompt: "Regenerated studio portrait",
        createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      const updatedHistory = [newVersion, ...currentHistory].slice(0, 8);
      handleSelectPersonaAvatar(personaIndex, finalAvatar, updatedHistory);
    }
  };

  // --- SHARED PLANS ---------------------------------------------------------
  // Plans live on the server, so everyone sees the same list from any machine. The
  // browser holds no authoritative copy: this list is refreshed from the server and
  // never written back to localStorage.
  const [planSummaries, setPlanSummaries] = useState<PlanSummary[]>([]);
  const [isLoadingPlans, setIsLoadingPlans] = useState(false);
  const [plansError, setPlansError] = useState<string | null>(null);
  const [migrationNotice, setMigrationNotice] = useState<string | null>(null);

  /** Revision of the plan currently open, needed to detect a conflicting save. */
  const [activePlanRevision, setActivePlanRevision] = useState<number | null>(null);

  const refreshPlans = React.useCallback(async () => {
    setIsLoadingPlans(true);
    setPlansError(null);
    try {
      const plans = await api.listPlans();
      setPlanSummaries(Array.isArray(plans) ? plans : []);
    } catch (err: any) {
      console.error("Could not load shared plans:", err);
      setPlansError(err?.message || "Could not load saved plans.");
      setPlanSummaries([]);
    } finally {
      setIsLoadingPlans(false);
    }
  }, []);

  // Load the shared plan list as soon as we are signed in.
  React.useEffect(() => {
    if (!isAuthenticated) return;
    void refreshPlans();
  }, [isAuthenticated, refreshPlans]);

  /**
   * Guards the one-time import below. A ref rather than state because the import must
   * fire exactly once per page load: StrictMode double-invokes effects in development,
   * and this effect legitimately re-runs when the settings revision resolves.
   */
  const migrationStartedRef = React.useRef(false);

  // On first sign-in, import any plans this browser saved before plans were shared.
  // The local copy is backed up rather than deleted, so a failed import loses nothing.
  // Waits for the settings revision so imported plans are pinned to a real revision.
  React.useEffect(() => {
    if (!isAuthenticated || settingsRevision === null) return;
    if (migrationStartedRef.current) return;
    migrationStartedRef.current = true;

    (async () => {
      try {
        const result = await migrateLocalPlans(window.localStorage, api.createPlan, settingsRevision);
        if (result.migrated > 0) {
          setMigrationNotice(
            result.failed > 0
              ? `Imported ${result.migrated} of ${result.attempted} local plans. ${result.failed} failed and will be retried next time you sign in.`
              : `Imported ${result.migrated} plan${result.migrated === 1 ? "" : "s"} from this browser into the shared workspace.`,
          );
          await refreshPlans();
        }
      } catch (err) {
        console.error("Local plan import failed:", err);
        // Allow another attempt on the next sign-in rather than wedging the flag.
        migrationStartedRef.current = false;
      }
    })();
  }, [isAuthenticated, refreshPlans, settingsRevision]);

  // Saved profiles interaction states
  const [leftTab, setLeftTab] = useState<"brief" | "saved" | "overview" | "scout">("brief");
  const prevProfileDataRef = React.useRef<AudienceProfile | null>(null);

  // Auto-switch to overview tab when output results arrive / update, fallback to brief if cleared.
  // The ScoutAI tab stays put: applying one of its changes updates the plan, and switching away
  // would pull the planner out of the conversation that made the change.
  React.useEffect(() => {
    if (!profileData) {
      if (leftTab === "overview" || leftTab === "scout") {
        setLeftTab("brief");
      }
    } else if (profileData !== prevProfileDataRef.current && leftTab !== "scout") {
      setLeftTab("overview");
    }
    prevProfileDataRef.current = profileData;
  }, [profileData]);
  const [scoutUnread, setScoutUnread] = useState(false);
  const [scoutPreview, setScoutPreview] = useState<ScoutPreview | null>(null);
  const [scoutRevisionBump, setScoutRevisionBump] = useState<{ from: number; to: number } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveTitle, setSaveTitle] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  /** True while a create/update request is in flight, to disable the confirm button. */
  const [isPersistingPlan, setIsPersistingPlan] = useState(false);
  /** Id of the plan currently being fetched, so the list can show a spinner on that row. */
  const [loadingPlanId, setLoadingPlanId] = useState<string | null>(null);
  const [activeSavedId, setActiveSavedId] = useState<string | null>(null);

  // A different plan starts a different ScoutAI conversation; land on its overview as usual.
  React.useEffect(() => {
    setScoutPreview(null);
    setScoutUnread(false);
    setLeftTab((tab) => (tab === "scout" ? "overview" : tab));
  }, [activeSavedId]);
  const [activeSavedTitle, setActiveSavedTitle] = useState<string | null>(null);

  const currentPlanTitle = React.useMemo(() => {
    if (activeSavedTitle) return activeSavedTitle;
    if (activeSavedId) {
      const match = planSummaries.find((p) => p.id === activeSavedId);
      if (match?.title) return match.title;
    }
    const advertiser = advertiserName.trim();
    if (advertiser) {
      return /\bplans?\b/i.test(advertiser) ? advertiser : `${advertiser} Plan`;
    }
    const desc = audienceDescription.trim();
    if (desc) {
      return desc.length > 50 ? `${desc.slice(0, 50)}...` : desc;
    }
    return saveTitle.trim() || "Strategic Audience Profile";
  }, [activeSavedTitle, activeSavedId, planSummaries, advertiserName, audienceDescription, saveTitle]);
  
  // Renaming state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");

  // Blueprint panel inline title editing
  const [isEditingBlueprintTitle, setIsEditingBlueprintTitle] = useState(false);
  const [blueprintTitleInput, setBlueprintTitleInput] = useState("");
  const [isSavingBlueprintTitle, setIsSavingBlueprintTitle] = useState(false);

  // Saved plans search and filter state
  const [savedSearchQuery, setSavedSearchQuery] = useState("");
  const [savedUserFilter, setSavedUserFilter] = useState<string>("ALL");

  const savedPlanUsers = React.useMemo(() => {
    const userSet = new Set<string>();
    planSummaries.forEach((p) => {
      if (p.createdBy?.trim()) userSet.add(p.createdBy.trim());
      if (p.updatedBy?.trim()) userSet.add(p.updatedBy.trim());
    });
    return Array.from(userSet).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [planSummaries]);

  const filteredPlanSummaries = React.useMemo(() => {
    let result = planSummaries;

    // Filter by user's name
    if (savedUserFilter && savedUserFilter !== "ALL") {
      const targetUser = savedUserFilter.toLowerCase();
      result = result.filter(
        (p) =>
          p.createdBy?.trim().toLowerCase() === targetUser ||
          p.updatedBy?.trim().toLowerCase() === targetUser
      );
    }

    // Search query filter: once more than 2 characters start filtering by what is entered
    const trimmedQuery = savedSearchQuery.trim().toLowerCase();
    if (trimmedQuery.length > 2) {
      result = result.filter((p) => {
        return Boolean(
          p.title?.toLowerCase().includes(trimmedQuery) ||
          p.audienceDescription?.toLowerCase().includes(trimmedQuery) ||
          p.advertiserName?.toLowerCase().includes(trimmedQuery) ||
          p.geography?.toLowerCase().includes(trimmedQuery) ||
          p.campaignFocus?.toLowerCase().includes(trimmedQuery) ||
          p.url?.toLowerCase().includes(trimmedQuery) ||
          p.createdBy?.toLowerCase().includes(trimmedQuery) ||
          p.updatedBy?.toLowerCase().includes(trimmedQuery)
        );
      });
    }

    return result;
  }, [planSummaries, savedUserFilter, savedSearchQuery]);

  // Share Token & Public View State
  const [shareToken, setShareToken] = useState<string | null>(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      return params.get("share");
    }
    return null;
  });
  const isShareView = Boolean(shareToken);
  const [sharedPlanLoading, setSharedPlanLoading] = useState<boolean>(Boolean(shareToken));
  const [sharedPlanError, setSharedPlanError] = useState<string | null>(null);

  // Share Management Modal State (for planners)
  const [shareModalPlan, setShareModalPlan] = useState<{
    id: string;
    title: string;
    shareToken?: string | null;
    isShared?: boolean;
  } | null>(null);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);

  // Clone Plan Modal State
  const [cloneModalPlan, setCloneModalPlan] = useState<{ id: string; title: string } | null>(null);
  const [isCloneModalOpen, setIsCloneModalOpen] = useState(false);

  // Delete Plan Modal State
  const [deleteModalPlan, setDeleteModalPlan] = useState<{ id: string; title: string } | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);

  // CTV Publishers Edit Modal State
  const [isCtvPublishersModalOpen, setIsCtvPublishersModalOpen] = useState(false);
  const initialCtvPublishersRef = React.useRef<CtvPublisherRecommendation[] | null>(null);

  // Presentation AI Slide Studio (gpt-image-2.5-sunburst) Modal State
  const [isSlideStudioOpen, setIsSlideStudioOpen] = useState(false);
  const [slideStudioSection, setSlideStudioSection] = useState<'personas' | 'channels' | 'segments'>('personas');

  const handleOpenSlideStudio = (section: 'personas' | 'channels' | 'segments' = 'personas') => {
    setSlideStudioSection(section);
    setIsSlideStudioOpen(true);
  };

  // CTV Publishers 16:9 Slide Export State
  const [isExportingCtvSlide, setIsExportingCtvSlide] = useState(false);
  const [exportingVariant, setExportingVariant] = useState<'detailed' | 'basic' | null>(null);
  const [ctvSlideExportSuccess, setCtvSlideExportSuccess] = useState(false);
  const [summarizedPublisherInsights, setSummarizedPublisherInsights] = useState<string | null>(null);
  const ctvSlideDetailedExportRef = React.useRef<HTMLDivElement>(null);
  const ctvSlideBasicExportRef = React.useRef<HTMLDivElement>(null);

  // Store initial CTV publisher recommendations when profileData is populated
  React.useEffect(() => {
    setSummarizedPublisherInsights(null);
    if (profileData && initialCtvPublishersRef.current === null) {
      initialCtvPublishersRef.current = profileData.ctvPublishers ?? [];
    }
  }, [profileData]);

  // Set noindex, nofollow robots tag when viewing a shared plan link
  React.useEffect(() => {
    if (!isShareView) return;
    let metaRobots = document.querySelector('meta[name="robots"]');
    if (!metaRobots) {
      metaRobots = document.createElement("meta");
      metaRobots.setAttribute("name", "robots");
      document.head.appendChild(metaRobots);
    }
    metaRobots.setAttribute("content", "noindex, nofollow");
  }, [isShareView]);

  // Handler to open Save Dialog with a suggested title based on user's brief or uploaded plan.
  // The advertiser leads: it is what makes a row in the saved-plans list identifiable at a
  // glance, where a truncated audience description or a generic "Audience Profile" is not.
  const handleOpenSaveDialog = () => {
    if (!profileData) return;
    const advertiser = advertiserName.trim();
    const desc = audienceDescription.trim();
    const defaultTitle = activeSavedTitle
      ? activeSavedTitle
      : advertiser
        ? (/\bplans?\b/i.test(advertiser) ? advertiser : `${advertiser} Plan`)
        : desc
          ? (desc.length > 50 ? desc.slice(0, 50) + "..." : desc)
          : uploadedFileName
            ? uploadedFileName.replace(/\.[^/.]+$/, "")
            : "Audience Profile";
    setSaveTitle(defaultTitle);
    setSaveError(null);
    setIsSaving(true);
  };

  /** Everything about the current workspace that belongs in a saved plan. */
  const buildPlanPayload = (): api.PlanPayload => ({
    kpis: kpis.filter((k) => k.trim().length > 0),
    audienceDescription,
    url,
    geography,
    geographyConfig: {
      type: geographyType,
      targets: geoTargets,
      rawInput: geoRawInput,
    },
    campaignFocus,
    additionalContext,
    targetPersonas: targetPersonas.filter(p => p.trim().length > 0),
    budget,
    campaignLength,
    planningSettings,
    profile: profileData!,
    groundingSources: groundingSources || undefined,
  });

  // --- Segment recommendations -------------------------------------------------------

  /**
   * The plan exactly as the server last returned it. Segment auto-save writes onto this
   * record rather than the live workspace, so it never sweeps unrelated unsaved edits (or a
   * regenerated profile) into the saved plan.
   */
  const lastPersistedPlanRef = React.useRef<api.StoredPlan | null>(null);
  const activePlanRevisionRef = React.useRef<number | null>(activePlanRevision);
  activePlanRevisionRef.current = activePlanRevision;
  const segmentsDirtyRef = React.useRef(false);
  const channelOverridesDirtyRef = React.useRef(false);
  const hiddenSectionsDirtyRef = React.useRef(false);
  const segmentAutoSaveQueueRef = React.useRef<Promise<void>>(Promise.resolve());

  const handleToggleSectionActive = (sectionKey: string, inactive: boolean) => {
    hiddenSectionsDirtyRef.current = true;
    setProfileData((prev) => {
      if (!prev) return null;
      const currentHidden = new Set(prev.hiddenSections || []);
      if (inactive) {
        currentHidden.add(sectionKey);
      } else {
        currentHidden.delete(sectionKey);
      }
      return {
        ...prev,
        hiddenSections: Array.from(currentHidden),
      };
    });
  };

  const hiddenSections = new Set(profileData?.hiddenSections || []);
  const isIntroHidden = hiddenSections.has("intro");
  const isPersonasHidden = hiddenSections.has("personas");
  const isSegmentsHidden = hiddenSections.has("segments");
  const isInsightsHidden = hiddenSections.has("insights");
  const isDomainAffinityHidden = hiddenSections.has("domainAffinity");
  const isDeviceShareHidden = hiddenSections.has("deviceShare") || hiddenSections.has("deviceSplit");
  const isDemographicsHidden = hiddenSections.has("demographics");
  const isTemporalHidden = hiddenSections.has("temporal") || hiddenSections.has("daypart");
  const isChannelsHidden = hiddenSections.has("channels");
  const isExecutiveSummaryHidden = hiddenSections.has("executiveSummary") || hiddenSections.has("blueprint");

  // The brief is out of date once the plan it was written from no longer matches the plan on screen.
  const liveBriefFingerprint = React.useMemo(
    () => (profileData?.executiveBrief ? briefFingerprint(buildBriefSnapshot(profileData)) : ""),
    [profileData],
  );
  const isBriefStale = Boolean(profileData?.executiveBrief && profileData.executiveBrief.inputFingerprint !== liveBriefFingerprint);
  const briefLivePercents = React.useMemo(
    () => Object.fromEntries((profileData?.channelStrategy?.mediaPlan?.channels || []).map((c) => [c.channelId, Math.round(c.allocationPercent * 10) / 10])),
    [profileData?.channelStrategy?.mediaPlan?.channels],
  );
  const briefGlance = React.useMemo(() => {
    const plan = profileData?.channelStrategy?.mediaPlan;
    const facts: Array<{ label: string; value: string }> = [];
    if (plan?.workingMediaBudget) facts.push({ label: "Media budget", value: `$${Math.round(plan.workingMediaBudget).toLocaleString()}` });
    if (plan?.flightDays) facts.push({ label: "Flight", value: `${plan.flightDays} days` });
    const primaryKpi = kpis.find((k) => k.trim());
    if (primaryKpi) facts.push({ label: "Primary KPI", value: primaryKpi.trim() });
    if (plan?.channels?.length) facts.push({ label: "Channels", value: String(plan.channels.length) });
    const geo = geography || profileData?.briefOfRecord?.geography;
    if (geo) facts.push({ label: "Geography", value: geo });
    return facts;
  }, [profileData?.channelStrategy?.mediaPlan, profileData?.briefOfRecord, kpis, geography]);
  const isSourcesHidden = hiddenSections.has("sources");

  const markPlanPersisted = (plan: api.StoredPlan) => {
    lastPersistedPlanRef.current = plan;
    activePlanRevisionRef.current = plan.revision;
    setActivePlanRevision(plan.revision);
    setActiveSavedTitle(plan.title);
  };

  const resetSegmentSession = () => {
    segmentRequestTokenRef.current += 1;
    briefRequestTokenRef.current += 1;
    executiveBriefDirtyRef.current = false;
    setBriefStatus("idle");
    setBriefError(null);
    setAutoBriefToken(null);
    removedSegmentsRef.current = [];
    segmentsDirtyRef.current = false;
    hiddenSectionsDirtyRef.current = false;
    if (segmentUndoTimerRef.current) clearTimeout(segmentUndoTimerRef.current);
    setSegmentUndoName(null);
    setSegmentStatus("idle");
    setIsToppingUpSegments(false);
    setSegmentError(null);
    setSegmentAutoSaveError(null);
    setHoveredSegment(null);
  };

  const updateSegments = (update: (current: SegmentRecommendation[]) => SegmentRecommendation[]) => {
    segmentsDirtyRef.current = true;
    setProfileData((prev) => (prev ? { ...prev, segmentRecommendations: update(prev.segmentRecommendations ?? []) } : prev));
  };

  const requestSegments = async (mode: "initial" | "top-up", profileOverride?: AudienceProfile) => {
    const profile = profileOverride ?? profileData;
    if (!profile || isShareView) return;
    const existing = profile.segmentRecommendations ?? [];
    const count = mode === "top-up" ? topUpCount(existing.length) : 0;
    if (mode === "top-up" && count <= 0) return;

    const token = segmentRequestTokenRef.current;
    setSegmentStatus("loading");
    setIsToppingUpSegments(mode === "top-up");
    setSegmentError(null);

    try {
      const response = await api.authFetch("/api/generate-segments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          count,
          advertiserName,
          audienceDescription,
          url,
          geography,
          campaignFocus,
          kpis: kpis.filter((k) => k.trim().length > 0),
          // Headshots and avatar history are large data URLs and say nothing about targeting.
          personas: (profile.personas || []).map(({ avatarUrl: _avatar, avatarHistory: _history, ...persona }) => persona),
          profileContext: {
            intro: profile.intro,
            executiveSummary: profile.executiveSummary,
            takeaways: profile.takeaways,
            recommendations: (profile.recommendations || []).map((r) => r.title),
          },
          planAudiences: extractPlanAudiences((planOptions || []).filter((p) => p.selected)),
          existingSegments: existing.map(({ name, dimension }) => ({ name, dimension })),
          removedNames: removedSegmentsRef.current.map((entry) => entry.segment.name),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (token !== segmentRequestTokenRef.current) return;
      if (!response.ok || !Array.isArray(data.segments)) {
        throw new Error(data.error || "Segment recommendations could not be generated.");
      }

      updateSegments((current) => {
        // Planner edits made while the request was in flight win over the response.
        const taken = new Set(current.map((s) => segmentKey(s.name)));
        const additions = (data.segments as SegmentRecommendation[]).filter((s) => !taken.has(segmentKey(s.name)));
        return [...current, ...additions].slice(0, MAX_TOTAL_SEGMENTS);
      });
      setSegmentStatus("idle");
    } catch (err: any) {
      if (token !== segmentRequestTokenRef.current) return;
      console.error("Could not generate segment recommendations:", err);
      setSegmentError(err?.message || "Segment recommendations could not be generated.");
      setSegmentStatus("error");
    } finally {
      if (token === segmentRequestTokenRef.current) setIsToppingUpSegments(false);
    }
  };
  requestSegmentsRef.current = requestSegments;

  /**
   * Writes (or rewrites) the executive brief from the plan as it stands on screen: channel
   * edits applied, hidden sections left out. Hand edits are dropped unless the planner keeps
   * them; the version being replaced is kept for Undo.
   */
  const requestExecutiveBrief = async ({ instructions = "", keepEdits = false, auto = false }: { instructions?: string; keepEdits?: boolean; auto?: boolean } = {}) => {
    const profile = profileData;
    if (!profile || isShareView) return;
    if (auto && profile.executiveBrief) return;
    if (!profile.channelStrategy?.mediaPlan?.channels?.length) {
      setBriefError(auto ? null : "This plan has no channel plan yet, so there is nothing to summarise.");
      setBriefStatus(auto ? "idle" : "error");
      return;
    }

    const token = ++briefRequestTokenRef.current;
    const snapshot = buildBriefSnapshot(profile, { advertiserName, url, geography, campaignFocus, kpis });
    setBriefStatus("loading");
    setBriefError(null);
    try {
      const response = await api.authFetch("/api/executive-brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshot, instructions }),
      });
      const data = await response.json().catch(() => ({}));
      if (token !== briefRequestTokenRef.current) return;
      if (!response.ok || !data.brief) {
        throw new Error(data.error || "The executive summary could not be written.");
      }
      const generated = data.brief as ExecutiveBrief;
      executiveBriefDirtyRef.current = true;
      setProfileData((prev) => {
        if (!prev) return prev;
        const current = prev.executiveBrief;
        const next: ExecutiveBrief = {
          ...generated,
          // The client's fingerprint, so the out-of-date check compares like with like.
          inputFingerprint: briefFingerprint(snapshot),
          ...(current?.hiddenPanels?.length ? { hiddenPanels: current.hiddenPanels } : {}),
          ...(keepEdits && current?.edits ? { edits: current.edits } : {}),
          ...(current ? { previous: withoutHistory(current) } : {}),
        };
        return { ...prev, executiveBrief: next };
      });
      setBriefStatus("idle");
    } catch (err: any) {
      if (token !== briefRequestTokenRef.current) return;
      console.error("Could not write the executive brief:", err);
      setBriefError(err?.message || "The executive summary could not be written.");
      setBriefStatus("error");
    }
  };

  // The first brief of a new run, once its segments have rendered.
  React.useEffect(() => {
    if (autoBriefToken === null) return;
    setAutoBriefToken(null);
    if (autoBriefToken !== briefRequestTokenRef.current || !profileData || profileData.executiveBrief) {
      if (autoBriefToken === briefRequestTokenRef.current) setBriefStatus("idle");
      return;
    }
    requestExecutiveBrief({ auto: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoBriefToken]);

  const handleChangeExecutiveBrief = (next: ExecutiveBrief) => {
    executiveBriefDirtyRef.current = true;
    setProfileData((prev) => (prev ? { ...prev, executiveBrief: next } : prev));
  };

  const handleUndoExecutiveBrief = () => {
    executiveBriefDirtyRef.current = true;
    setProfileData((prev) => (prev?.executiveBrief?.previous ? { ...prev, executiveBrief: prev.executiveBrief.previous } : prev));
  };

  const handleRemoveSegment = (id: string) => {
    const list = profileData?.segmentRecommendations ?? [];
    const index = list.findIndex((s) => s.id === id);
    if (index < 0) return;
    const removed = list[index];
    removedSegmentsRef.current.push({ segment: removed, index });
    updateSegments((current) => current.filter((s) => s.id !== id));
    setHoveredSegment(null);
    setSegmentUndoName(removed.name);
    if (segmentUndoTimerRef.current) clearTimeout(segmentUndoTimerRef.current);
    segmentUndoTimerRef.current = setTimeout(() => setSegmentUndoName(null), 6000);
  };

  const handleUndoRemoveSegment = () => {
    const last = removedSegmentsRef.current.pop();
    if (segmentUndoTimerRef.current) clearTimeout(segmentUndoTimerRef.current);
    setSegmentUndoName(null);
    if (!last) return;
    updateSegments((current) => {
      if (current.length >= MAX_TOTAL_SEGMENTS || current.some((s) => segmentKey(s.name) === segmentKey(last.segment.name))) {
        return current;
      }
      const next = [...current];
      next.splice(Math.min(last.index, next.length), 0, last.segment);
      return next;
    });
  };

  const handleAddSegment = (input: { name: string; dimension: string; justification: string }): string | null => {
    const result = createUserSegment(input, profileData?.segmentRecommendations ?? []);
    if (!result.segment) return result.error;
    const added = result.segment;
    updateSegments((current) => [...current, added]);
    return null;
  };

  const handleExportSegmentsCsv = () => {
    const segments = profileData?.segmentRecommendations ?? [];
    if (!profileData || segments.length === 0) return;
    const base = (advertiserName.trim() || profileData.personas?.[0]?.name || "audience")
      .replace(/[^a-z0-9]+/gi, "_")
      .replace(/^_+|_+$/g, "")
      .toLowerCase() || "audience";
    const blob = new Blob([segmentsToCsv(segments, profileData.personas || [])], { type: "text/csv;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = `${base}_segment_recommendations.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  };

  // Auto-save segment edits onto an already-saved plan. Unsaved plans pick the segments up on
  // their first manual save. Saves are queued so two quick edits never race each other into
  // a self-inflicted revision conflict.
  React.useEffect(() => {
    if (!segmentsDirtyRef.current || isShareView || !activeSavedId || !profileData) return;
    const planId = activeSavedId;
    const segments = profileData.segmentRecommendations ?? [];
    const liveFingerprint = profileBaselineFingerprint(profileData);

    const timer = setTimeout(() => {
      segmentAutoSaveQueueRef.current = segmentAutoSaveQueueRef.current.then(async () => {
        const persisted = lastPersistedPlanRef.current;
        const revision = activePlanRevisionRef.current;
        if (!segmentsDirtyRef.current || !persisted || persisted.id !== planId || revision === null) return;
        // A regenerated or otherwise edited profile is not the saved plan; writing its segments
        // onto the saved one would mismatch them, so they wait for the planner's next Save.
        if (profileBaselineFingerprint(persisted.payload.profile) !== liveFingerprint) {
          setSegmentAutoSaveError("Other parts of this plan have unsaved changes, so segment changes will be saved with your next Save.");
          return;
        }

        segmentsDirtyRef.current = false;
        try {
          const updated = await api.updatePlan(planId, revision, {
            title: persisted.title,
            advertiserName: persisted.advertiserName,
            settingsRevision: persisted.settingsRevision,
            payload: { ...persisted.payload, profile: { ...persisted.payload.profile, segmentRecommendations: segments } },
          });
          markPlanPersisted(updated);
          setSegmentAutoSaveError(null);
        } catch (err: any) {
          console.error("Could not auto-save segment changes:", err);
          segmentsDirtyRef.current = true;
          setSegmentAutoSaveError(
            err instanceof ApiError && err.isConflict
              ? "Someone else updated this plan, so segment changes were not auto-saved. Reload it from the saved list to continue."
              : "Segment changes could not be auto-saved. Use Save to try again.",
          );
        }
      });
    }, 1200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileData?.segmentRecommendations, activeSavedId, isShareView]);

  // Auto-save channel overrides onto an already-saved plan
  React.useEffect(() => {
    if (!channelOverridesDirtyRef.current || isShareView || !activeSavedId || !profileData) return;
    const planId = activeSavedId;
    const overrides = profileData.channelStrategy?.channelOverrides;
    const liveFingerprint = profileBaselineFingerprint(profileData);

    const timer = setTimeout(() => {
      segmentAutoSaveQueueRef.current = segmentAutoSaveQueueRef.current.then(async () => {
        const persisted = lastPersistedPlanRef.current;
        const revision = activePlanRevisionRef.current;
        if (!channelOverridesDirtyRef.current || !persisted || persisted.id !== planId || revision === null) return;
        if (profileBaselineFingerprint(persisted.payload.profile) !== liveFingerprint) {
          return;
        }

        channelOverridesDirtyRef.current = false;
        try {
          const updated = await api.updatePlan(planId, revision, {
            title: persisted.title,
            advertiserName: persisted.advertiserName,
            settingsRevision: persisted.settingsRevision,
            payload: {
              ...persisted.payload,
              profile: {
                ...persisted.payload.profile,
                channelStrategy: persisted.payload.profile.channelStrategy
                  ? {
                      ...persisted.payload.profile.channelStrategy,
                      channelOverrides: overrides,
                    }
                  : undefined,
              },
            },
          });
          markPlanPersisted(updated);
        } catch (err: any) {
          console.error("Could not auto-save channel overrides:", err);
          channelOverridesDirtyRef.current = true;
        }
      });
    }, 1200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileData?.channelStrategy?.channelOverrides, activeSavedId, isShareView]);

  // Auto-save hidden sections onto an already-saved plan
  React.useEffect(() => {
    if (!hiddenSectionsDirtyRef.current || isShareView || !activeSavedId || !profileData) return;
    const planId = activeSavedId;
    const hidden = profileData.hiddenSections || [];
    const liveFingerprint = profileBaselineFingerprint(profileData);

    const timer = setTimeout(() => {
      segmentAutoSaveQueueRef.current = segmentAutoSaveQueueRef.current.then(async () => {
        const persisted = lastPersistedPlanRef.current;
        const revision = activePlanRevisionRef.current;
        if (!hiddenSectionsDirtyRef.current || !persisted || persisted.id !== planId || revision === null) return;
        if (profileBaselineFingerprint(persisted.payload.profile) !== liveFingerprint) {
          return;
        }

        hiddenSectionsDirtyRef.current = false;
        try {
          const updated = await api.updatePlan(planId, revision, {
            title: persisted.title,
            advertiserName: persisted.advertiserName,
            settingsRevision: persisted.settingsRevision,
            payload: {
              ...persisted.payload,
              profile: {
                ...persisted.payload.profile,
                hiddenSections: hidden,
              },
            },
          });
          markPlanPersisted(updated);
        } catch (err: any) {
          console.error("Could not auto-save hidden sections:", err);
          hiddenSectionsDirtyRef.current = true;
        }
      });
    }, 1200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileData?.hiddenSections, activeSavedId, isShareView]);

  // Auto-save the executive brief (generated, regenerated, hand-edited) onto an already-saved plan.
  React.useEffect(() => {
    if (!executiveBriefDirtyRef.current || isShareView || !activeSavedId || !profileData) return;
    const planId = activeSavedId;
    const brief = profileData.executiveBrief;
    const liveFingerprint = profileBaselineFingerprint(profileData);

    const timer = setTimeout(() => {
      segmentAutoSaveQueueRef.current = segmentAutoSaveQueueRef.current.then(async () => {
        const persisted = lastPersistedPlanRef.current;
        const revision = activePlanRevisionRef.current;
        if (!executiveBriefDirtyRef.current || !persisted || persisted.id !== planId || revision === null) return;
        // Other unsaved changes: the brief waits for the planner's next Save, like the segments.
        if (profileBaselineFingerprint(persisted.payload.profile) !== liveFingerprint) return;

        executiveBriefDirtyRef.current = false;
        try {
          const updated = await api.updatePlan(planId, revision, {
            title: persisted.title,
            advertiserName: persisted.advertiserName,
            settingsRevision: persisted.settingsRevision,
            payload: { ...persisted.payload, profile: { ...persisted.payload.profile, executiveBrief: brief } },
          });
          markPlanPersisted(updated);
        } catch (err: any) {
          console.error("Could not auto-save the executive brief:", err);
          executiveBriefDirtyRef.current = true;
        }
      });
    }, 1200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileData?.executiveBrief, activeSavedId, isShareView]);

  /**
   * Save to the shared store. An existing plan is updated against the revision we last
   * read; if somebody else saved in the meantime the server refuses with a conflict and
   * we say so rather than overwriting their work.
   */
  const handleSaveProfile = async () => {
    if (!profileData) return;
    const titleToSave = saveTitle.trim() || "Untitled Audience Profile";

    setIsPersistingPlan(true);
    setSaveError(null);

    try {
      // An in-flight segment auto-save would otherwise bump the revision underneath us.
      await segmentAutoSaveQueueRef.current;
      const input = {
        title: titleToSave,
        advertiserName: advertiserName || undefined,
        settingsRevision,
        payload: buildPlanPayload(),
      };
      const expectedRevision = activePlanRevisionRef.current;

      if (activeSavedId && expectedRevision !== null) {
        const updated = await api.updatePlan(activeSavedId, expectedRevision, input);
        markPlanPersisted(updated);
      } else {
        const created = await api.createPlan(input);
        setActiveSavedId(created.id);
        markPlanPersisted(created);
      }
      segmentsDirtyRef.current = false;
      hiddenSectionsDirtyRef.current = false;
      setSegmentAutoSaveError(null);

      await refreshPlans();
      setIsSaving(false);
    } catch (err: any) {
      console.error("Could not save plan:", err);
      if (err instanceof ApiError && err.isConflict) {
        setSaveError(
          "Someone else saved changes to this plan while you were working. Reload it from the list, then reapply your changes.",
        );
      } else {
        setSaveError(err?.message || "Could not save the plan. Please try again.");
      }
    } finally {
      setIsPersistingPlan(false);
    }
  };

  /**
   * Opens the Share modal for the currently active media plan in the workspace.
   * If the plan has not been saved yet, it auto-saves it first to obtain a plan ID.
   */
  const handleOpenShareForActivePlan = async () => {
    if (!profileData) return;
    let targetPlanId = activeSavedId;
    let targetTitle =
      (advertiserName.trim() ? (/\bplans?\b/i.test(advertiserName.trim()) ? advertiserName.trim() : `${advertiserName.trim()} Plan`) : "") ||
      saveTitle.trim() ||
      "Audience Strategy Plan";
    let targetShareToken: string | null | undefined = null;
    let targetIsShared = false;

    if (targetPlanId) {
      const existing = planSummaries.find((p) => p.id === targetPlanId);
      if (existing) {
        targetTitle = existing.title;
        targetShareToken = existing.shareToken;
        targetIsShared = Boolean(existing.isShared);
      }
    } else {
      // Auto-save the plan if not yet persisted, so we have a permanent server ID to share
      try {
        setIsPersistingPlan(true);
        const input = {
          title: targetTitle,
          advertiserName: advertiserName || undefined,
          settingsRevision,
          payload: buildPlanPayload(),
        };
        const created = await api.createPlan(input);
        targetPlanId = created.id;
        targetTitle = created.title;
        targetShareToken = created.shareToken;
        targetIsShared = Boolean(created.isShared);
        setActiveSavedId(created.id);
        markPlanPersisted(created);
        segmentsDirtyRef.current = false;
        await refreshPlans();
      } catch (err: any) {
        console.error("Could not auto-save plan prior to sharing:", err);
        setSaveError("Could not save the plan before sharing. Please save the plan first.");
        setIsSaving(true);
        return;
      } finally {
        setIsPersistingPlan(false);
      }
    }

    if (targetPlanId) {
      setShareModalPlan({
        id: targetPlanId,
        title: targetTitle,
        shareToken: targetShareToken,
        isShared: targetIsShared,
      });
      setIsShareModalOpen(true);
    }
  };

  /**
   * Applies stored plan payload into workspace states.
   */
  /** The geography picker's state from a saved payload: its structured config, or else the text. */
  const restoreGeographyFromPayload = (body: any) => {
      if (body.geographyConfig) {
        setGeographyType(body.geographyConfig.type || "National");
        setGeoTargets(Array.isArray(body.geographyConfig.targets) ? body.geographyConfig.targets : []);
        setGeoRawInput(body.geographyConfig.rawInput || "");
        setGeoUnrecognized([]);
        setGeoUploadNotice(null);
      } else if (body.geography) {
        const savedGeo = String(body.geography);
        if (savedGeo.toLowerCase().includes("dma")) {
          setGeographyType("DMA");
          const parsed = parseGeoTextInput(savedGeo.replace(/^dma[\s:(-]+/i, "").replace(/[)]+$/, ""), "DMA");
          setGeoTargets(parsed.valid);
          setGeoRawInput("");
        } else if (savedGeo.toLowerCase().includes("state")) {
          setGeographyType("State");
          const parsed = parseGeoTextInput(savedGeo.replace(/^state[\s:(-]+/i, "").replace(/[)]+$/, ""), "State");
          setGeoTargets(parsed.valid);
          setGeoRawInput("");
        } else {
          setGeographyType(savedGeo === "United States" ? "National" : (savedGeo as any));
          setGeoTargets([]);
          setGeoRawInput("");
        }
        setGeoUnrecognized([]);
        setGeoUploadNotice(null);
      } else {
        setGeographyType("National");
        setGeoTargets([]);
        setGeoRawInput("");
        setGeoUnrecognized([]);
        setGeoUploadNotice(null);
      }
  };

  const applyPlanToWorkspace = (saved: api.StoredPlan, isSharedViewMode = false) => {
    const body = saved.payload as any;
    setAdvertiserName(saved.advertiserName || "");
    setKpis(body.kpis && body.kpis.length > 0 ? body.kpis : [""]);
    setAudienceDescription(body.audienceDescription || "");
    setUrl(body.url || "");
    restoreGeographyFromPayload(body);
    setCampaignFocus(body.campaignFocus || "Full-funnel digital media plan");
    setAdditionalContext(body.additionalContext || "");
    if (Array.isArray(body.targetPersonas) && body.targetPersonas.length > 0) {
      const restored = ["", "", "", ""];
      body.targetPersonas.slice(0, 4).forEach((p, idx) => { restored[idx] = p; });
      setTargetPersonas(restored);
      setIsAdvancedPersonaOpen(true);
    } else {
      setTargetPersonas(["", "", "", ""]);
      setIsAdvancedPersonaOpen(false);
    }
    // A saved plan without a budget reloads without one; defaulting it would change the
    // per-market figures shown in the plan.
    setBudget(body.budget || "");
    setCampaignLength(body.campaignLength || "");
    resetSegmentSession();
    setFailedAvatarIndices([]);
    setActionError(null);
    setProfileData(body.profile);
    setGroundingSources(body.groundingSources || null);
    if (body.extractedPlacements) setExtractedPlacements(body.extractedPlacements);
    if (body.planOptions) setPlanOptions(body.planOptions);
    if (body.rfpAnalysis) setRfpAnalysis(body.rfpAnalysis);
    setActiveSavedId(saved.id);
    markPlanPersisted(saved);
    setError(null);
    setPersonaPage(0);
    setArePersonasExpanded(false);
    setIsDomainAffinityExpanded(false);
    setIsEditingBlueprintTitle(false);

    // Restore the settings this plan was generated against.
    if (saved.settingsRevision !== null) {
      api
        .fetchSettingsRevision(saved.settingsRevision)
        .then((record) => {
          if (record?.settings) setPlanningSettings(normalizeAndValidateSettings(record.settings));
          else if (body.planningSettings) setPlanningSettings(normalizeAndValidateSettings(body.planningSettings));
        })
        .catch(() => {
          if (body.planningSettings) setPlanningSettings(normalizeAndValidateSettings(body.planningSettings));
        });
    } else if (body.planningSettings) {
      setPlanningSettings(normalizeAndValidateSettings(body.planningSettings));
    }

    // Auto-generate missing headshots in background if authenticated and not in shared view
    if (!isSharedViewMode && body.profile && body.profile.personas) {
      const pendingIndices: number[] = [];
      body.profile.personas.forEach((persona: any, index: number) => {
        if (!persona.avatarUrl || persona.avatarUrl.includes("example.com")) {
          pendingIndices.push(index);
        }
      });
      if (pendingIndices.length > 0) {
        setGeneratingAvatarIndices((prev) => Array.from(new Set([...prev, ...pendingIndices])));
      }

      body.profile.personas.forEach((persona: any, index: number) => {
        if (!persona.avatarUrl || persona.avatarUrl.includes("example.com")) {
          api.authFetch("/api/generate-persona-avatar", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ persona })
          })
            .then(res => res.json())
            .then(async data => {
              if (data.success && data.avatarUrl) {
                const compressed = await compressAvatarUrl(data.avatarUrl);
                const finalAvatar = compressed || data.avatarUrl;
                setProfileData(prev => {
                  if (!prev || !prev.personas) return prev;
                  const updated = [...prev.personas];
                  if (updated[index]) {
                    const existingHistory = updated[index].avatarHistory || [];
                    const newHistory = existingHistory.length > 0
                      ? existingHistory
                      : [{
                          id: `v-init-${Date.now()}`,
                          url: finalAvatar,
                          prompt: "Initial archetype portrait",
                          createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                        }];
                    updated[index] = { ...updated[index], avatarUrl: finalAvatar, avatarHistory: newHistory };
                  }
                  return { ...prev, personas: updated };
                });
              }
            })
            .catch(err => console.error("Error generating missing persona headshot:", err))
            .finally(() => {
              setGeneratingAvatarIndices((prev) => prev.filter((i) => i !== index));
            });
        }
      });
    }

    // Scroll workspace into view
    const workspace = document.getElementById("profile-workspace");
    if (workspace) {
      workspace.scrollIntoView({ behavior: "smooth" });
    }
  };

  // Load shared plan if viewing via share token
  React.useEffect(() => {
    if (!shareToken) return;
    setSharedPlanLoading(true);
    setSharedPlanError(null);
    api
      .fetchSharedPlan(shareToken)
      .then((stored) => {
        applyPlanToWorkspace(stored, true);
        setLeftTab("overview");
      })
      .catch((err: any) => {
        console.error("Could not load shared plan:", err);
        setSharedPlanError(
          err?.message || "This shared media plan link does not exist, has expired, or was revoked."
        );
      })
      .finally(() => {
        setSharedPlanLoading(false);
      });
  }, [shareToken]);

  /**
   * Open a shared plan. The settings revision the plan was generated against is restored
   * alongside it, so the numbers render the way they did when it was saved even if the
   * global settings have moved on since.
   */
  const handleLoadSavedProfile = async (summary: { id: string; [key: string]: any }) => {
    setPlansError(null);
    setLoadingPlanId(summary.id);

    try {
      const saved = await api.getPlan(summary.id);
      applyPlanToWorkspace(saved, false);
    } catch (err: any) {
      console.error("Could not open plan:", err);
      setPlansError(err?.message || "Could not open that plan.");
    } finally {
      setLoadingPlanId(null);
    }
  };

  /** Open permanent delete confirmation modal */
  const handleDeleteSavedProfile = (plan: { id: string; title: string }, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setDeleteModalPlan({ id: plan.id, title: plan.title });
    setIsDeleteModalOpen(true);
  };

  // Start renaming
  const handleStartRename = (id: string, currentTitle: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(id);
    setEditingTitle(currentTitle);
  };

  /** Rename round-trips the payload so the title change is a normal, versioned edit. */
  const handleSaveRename = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const nextTitle = editingTitle.trim();
    if (!nextTitle) return;
    setEditingId(null);

    try {
      const existing = await api.getPlan(id);
      const updated = await api.updatePlan(id, existing.revision, {
        title: nextTitle,
        advertiserName: existing.advertiserName,
        settingsRevision: existing.settingsRevision,
        payload: existing.payload,
      });
      if (activeSavedId === id) markPlanPersisted(updated);
      await refreshPlans();
    } catch (err: any) {
      console.error("Could not rename plan:", err);
      setPlansError(
        err instanceof ApiError && err.isConflict
          ? "Someone else changed this plan just now. Reload the list and try renaming again."
          : err?.message || "Could not rename that plan.",
      );
    }
  };

  // Blueprint title inline editing handlers
  const handleStartEditBlueprintTitle = () => {
    setBlueprintTitleInput(currentPlanTitle);
    setIsEditingBlueprintTitle(true);
  };

  const handleSaveBlueprintTitle = async () => {
    const nextTitle = blueprintTitleInput.trim();
    if (!nextTitle) return;

    setIsSavingBlueprintTitle(true);
    setActiveSavedTitle(nextTitle);
    setSaveTitle(nextTitle);

    if (activeSavedId) {
      try {
        const existing = await api.getPlan(activeSavedId);
        const updated = await api.updatePlan(activeSavedId, existing.revision, {
          title: nextTitle,
          advertiserName: existing.advertiserName,
          settingsRevision: existing.settingsRevision,
          payload: existing.payload,
        });
        markPlanPersisted(updated);
        await refreshPlans();
      } catch (err: any) {
        console.error("Could not update plan title:", err);
        setPlansError(
          err instanceof ApiError && err.isConflict
            ? "Someone else changed this plan just now. Reload the list and try renaming again."
            : err?.message || "Could not rename that plan.",
        );
      }
    }

    setIsSavingBlueprintTitle(false);
    setIsEditingBlueprintTitle(false);
  };

  // File upload and parsing handler using SheetJS (XLSX) with smart client & server caching
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement> | { target: { files: FileList | null } }, forceReparse = false) => {
    const file = e.target.files?.[0];
    if (!file) return;

    lastUploadedFileRef.current = file;
    setUploadedFileName(file.name);
    const extension = file.name.split('.').pop()?.toLowerCase();
    const fileFingerprint = `${file.name}_${file.size}_${file.lastModified}`;
    const clientCacheKey = `media_plan_parsed_cache_${fileFingerprint}`;

    const shouldBypassCache = forceReparse || ignoreCache;

    // 1. Instant Client-Side Cache Check: Load cached placements immediately if user re-selects or tests identical file
    if (!shouldBypassCache) {
      try {
        const cachedRaw = localStorage.getItem(clientCacheKey);
        if (cachedRaw) {
          const cached = JSON.parse(cachedRaw);
          if (cached && Array.isArray(cached.extractedPlacements) && cached.extractedPlacements.length > 0) {
            console.log("⚡ INSTANT CLIENT CACHE HIT: Restored media plan parsing results for", file.name);
            setUploadedFileText(cached.uploadedFileText || "");
            setParsedSheetsData(cached.parsedSheetsData || []);
            setExtractedPlacements(cached.extractedPlacements);
            setActiveSheetIndex(0);
            setModalCurrentPage(1);
            setIsPreviewModalOpen(true);
            setIsParsingPlan(false);
            setParsingError(null);
            return;
          }
        }
      } catch (err) {
        console.warn("Error reading media plan cache from localStorage:", err);
      }
    }

    let localFullText = "";
    let localSheetsData: any[] = [];

    if (extension === 'xlsx' || extension === 'xls') {
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const data = new Uint8Array(evt.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          let fullText = "";
          const sheetsData: any[] = [];

          workbook.SheetNames.forEach((sheetName) => {
            const sheet = workbook.Sheets[sheetName];
            const jsonRows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
            
            // Fill merged cells with top-left values if sheet has '!merges'
            if (sheet['!merges']) {
              sheet['!merges'].forEach((merge: any) => {
                const startRow = merge.s.r;
                const startCol = merge.s.c;
                const endRow = merge.e.r;
                const endCol = merge.e.c;

                const val = jsonRows[startRow]?.[startCol];
                if (val !== undefined && val !== null && String(val).trim() !== "") {
                  for (let r = startRow; r <= endRow; r++) {
                    if (!jsonRows[r]) {
                      jsonRows[r] = [];
                    }
                    for (let c = startCol; c <= endCol; c++) {
                      const currentVal = jsonRows[r][c];
                      if (currentVal === undefined || currentVal === null || String(currentVal).trim() === "") {
                        jsonRows[r][c] = val;
                      }
                    }
                  }
                }
              });
            }

            const rawRows = jsonRows.filter(r => r && r.length > 0);
            if (rawRows.length === 0) return;

            // Find the maximum number of columns across all rows in this sheet
            const maxCols = Math.max(1, ...rawRows.map(r => r.length));

            // Normalize all rows to have exactly maxCols length
            const normalizedRows = rawRows.map(row => {
              const newRow = [...row];
              while (newRow.length < maxCols) {
                newRow.push("");
              }
              return newRow.map(cell => cell !== null && cell !== undefined ? String(cell).trim() : "");
            });

            // Generate column letters: A, B, C...
            const headers = Array.from({ length: maxCols }, (_, i) => getColumnLetter(i));

            let sheetText = `--- Sheet: ${sheetName} ---\n`;
            normalizedRows.forEach((row) => {
              sheetText += row.join(" | ") + "\n";
            });
            fullText += sheetText + "\n";

            // Automated content heuristic analysis
            let diagnostics = "Standard Spreadsheet Tab";
            const rowTextJoined = normalizedRows.map(r => r.join(" ")).join(" ").toLowerCase();
            if (rowTextJoined.includes("zip") || rowTextJoined.includes("postal") || rowTextJoined.includes("dma")) {
              diagnostics = "Location / Geo Targeting List";
            } else if (rowTextJoined.includes("cpm") || rowTextJoined.includes("budget") || rowTextJoined.includes("impressions") || rowTextJoined.includes("rate") || rowTextJoined.includes("spend")) {
              diagnostics = "Media Buy / Plan Table";
            } else if (rowTextJoined.includes("channel") || rowTextJoined.includes("publisher") || rowTextJoined.includes("placement") || rowTextJoined.includes("site")) {
              diagnostics = "Publisher & Placement Details";
            } else if (rowTextJoined.includes("audience") || rowTextJoined.includes("persona") || rowTextJoined.includes("segment")) {
              diagnostics = "Audience Targeting Criteria";
            }

            sheetsData.push({
              name: sheetName,
              rows: normalizedRows,
              headers,
              diagnostics
            });
          });

          if (sheetsData.length === 0) {
            throw new Error("No data found in any sheet.");
          }

          localFullText = fullText.trim();
          localSheetsData = sheetsData;

          // Auto extract metadata (Advertiser Name, Website URL, KPIs)
          const meta = extractCampaignMetadata(sheetsData);
          if (meta.advertiserName) setAdvertiserName(meta.advertiserName);
          if (meta.websiteUrl && !url) setUrl(meta.websiteUrl);
          if (meta.kpis && meta.kpis.length > 0) setKpis(meta.kpis);

          setUploadedFileText(fullText.trim());
          setParsedSheetsData(sheetsData);
          setActiveSheetIndex(0);
          setModalCurrentPage(1);
          setIsPreviewModalOpen(true);
          setError(null);
        } catch (err: any) {
          setError("Error reading Excel file: " + err.message);
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      // CSV or plain TXT
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const text = (evt.target?.result as string) || '';
          localFullText = text;

          const lines = text.split("\n").filter(l => l.trim() !== "");
          const rawRows: any[][] = [];
          
          if (extension === 'csv') {
            const delim = detectDelimiter(text);
            lines.forEach(line => {
              const cells = parseCSVLine(line, delim);
              rawRows.push(cells);
            });
          } else {
            lines.forEach(line => {
              rawRows.push([line]);
            });
          }

          if (rawRows.length === 0) {
            throw new Error("Uploaded file is empty.");
          }

          // Find the maximum number of columns across all rows in this file
          const maxCols = Math.max(1, ...rawRows.map(r => r.length));

          // Normalize all rows to have exactly maxCols length
          const normalizedRows = rawRows.map(row => {
            const newRow = [...row];
            while (newRow.length < maxCols) {
              newRow.push("");
            }
            return newRow.map(cell => cell !== null && cell !== undefined ? String(cell).trim() : "");
          });

          // Generate column letters: A, B, C...
          const headers = Array.from({ length: maxCols }, (_, i) => getColumnLetter(i));

          const diagnostics = extension === 'csv' ? "CSV Data Table" : "Plain Text Document";
          const sheetsData = [{
            name: file.name,
            rows: normalizedRows,
            headers,
            diagnostics
          }];
          localSheetsData = sheetsData;

          // Auto extract metadata (Advertiser Name, Website URL, KPIs)
          const meta = extractCampaignMetadata(sheetsData);
          if (meta.advertiserName) setAdvertiserName(meta.advertiserName);
          if (meta.websiteUrl && !url) setUrl(meta.websiteUrl);
          if (meta.kpis && meta.kpis.length > 0) setKpis(meta.kpis);

          setUploadedFileText(text);
          setParsedSheetsData(sheetsData);
          setActiveSheetIndex(0);
          setModalCurrentPage(1);
          setIsPreviewModalOpen(true);
          setError(null);
        } catch (err: any) {
          setError("Error reading text file: " + err.message);
        }
      };
      reader.readAsText(file);
    }

    // Launch server-side high-accuracy AI parsing pipeline
    const formData = new FormData();
    formData.append("file", file);
    if (shouldBypassCache) {
      formData.append("ignoreCache", "true");
    }

    setIsParsingPlan(true);
    setParsingError(null);
    setModalTab("raw"); // Default to raw grid on upload
    setExtractedPlacements([]); // Reset previous

    api.authFetch("/api/parse-plan", {
      method: "POST",
      body: formData,
    })
      .then(async (res) => {
        const contentType = res.headers.get("content-type") || "";
        if (!res.ok) {
          let errorMsg = "Failed to parse file on the server.";
          try {
            const errJson = await res.json();
            if (errJson.error) {
              errorMsg = errJson.error + (errJson.details ? `: ${errJson.details}` : "");
            }
          } catch (_) {
            try {
              const text = await res.text();
              if (text && text.length < 300) {
                errorMsg += ` (${text})`;
              }
            } catch (__) {}
          }
          throw new Error(errorMsg);
        }
        
        if (!contentType.includes("application/json")) {
          const text = await res.text();
          console.error("Non-JSON response from server:", text);
          throw new Error("Server returned an invalid non-JSON response. This can happen if the backend server is restarting or has crashed. Please wait a few seconds and try uploading again.");
        }
        
        return res.json();
      })
      .then((data) => {
        if (data.success && data.placements) {
          setExtractedPlacements(data.placements);
          if (data.rfpAnalysis) {
            setRfpAnalysis(data.rfpAnalysis);
            if (data.rfpAnalysis.extractedMetadata) {
              const meta = data.rfpAnalysis.extractedMetadata;
              if (meta.advertiserName) setAdvertiserName(meta.advertiserName);
              if (meta.websiteUrl && !url) setUrl(meta.websiteUrl);
              if (meta.kpis && meta.kpis.length > 0) {
                setKpis(meta.kpis);
              }
            }
          } else {
            setRfpAnalysis(null);
          }
          setActivePlanSubTab("ALL");
          console.log("AI Parsed Placements:", data.placements, data.rfpAnalysis ? "(RFP Analyzed)" : "", data.cached ? "(Server Cache Hit)" : "(Fresh Parse)");

          // Save parsed output to client-side localStorage cache
          try {
            const cachePayload = {
              uploadedFileText: localFullText,
              parsedSheetsData: localSheetsData,
              extractedPlacements: data.placements,
              rfpAnalysis: data.rfpAnalysis || null,
              timestamp: Date.now()
            };
            // Clean up old parsed_plan_file_ keys to keep localStorage clean
            for (let i = 0; i < localStorage.length; i++) {
              const k = localStorage.key(i);
              if (k && k.startsWith("media_plan_parsed_cache_") && k !== clientCacheKey) {
                localStorage.removeItem(k);
              }
            }
            localStorage.setItem(clientCacheKey, JSON.stringify(cachePayload));
          } catch (cacheErr) {
            console.warn("Could not save parsed media plan to localStorage:", cacheErr);
          }
        } else {
          console.warn("AI parsing completed but did not return expected placements structure", data);
          setParsingError("AI parsing completed but did not return expected placements structure.");
        }
      })
      .catch((err: any) => {
        console.error("Error during server-side AI parsing:", err);
        setParsingError(err.message || String(err));
      })
      .finally(() => {
        setIsParsingPlan(false);
      });
  };

  const handleReRunAnalysis = () => {
    if (lastUploadedFileRef.current) {
      handleFileUpload({ target: { files: [lastUploadedFileRef.current] as any } } as any, true);
    }
  };

  // Submit handler
  const handleGenerate = async (e?: React.FormEvent, typeOverride?: string, { pinBrief = false }: { pinBrief?: boolean } = {}) => {
    if (e) e.preventDefault();
    // Regenerating a plan whose Brief of Record a planner edited keeps their brief. A run from the
    // Brief tab is a new plan and writes its own.
    const pinnedBriefOfRecord = (typeOverride || pinBrief) && profileData?.briefOfRecordEdited ? profileData.briefOfRecord : undefined;

    if (briefMode === "upload") {
      if (!uploadedFileText && !rfpAnalysis && extractedPlacements.length === 0) {
        setError("Please upload a media plan or RFP file first.");
        return;
      }
      if (!url) {
        setError("Advertiser Website URL is required when a media plan file is uploaded.");
        return;
      }
    } else {
      if (!audienceDescription && !url) {
        setError("Please provide at least an Audience Description or a Website URL.");
        return;
      }
    }

    setLoading(true);
    setError(null);
    setRegenType(typeOverride || null);
    setPersonaPage(0);
    setArePersonasExpanded(false);
    setIsDomainAffinityExpanded(false);
    setIsEditingBlueprintTitle(false);
    setGeneratingAvatarIndices([]);
    resetSegmentSession();
    setFailedAvatarIndices([]);
    setActionError(null);

    // Reset the queue reference and server completion state
    pendingLogsRef.current = [];
    setServerCompleteData(null);

    // Clear logs for the new run
    const targetBriefSummary = audienceDescription 
      ? `"${audienceDescription.slice(0, 40)}${audienceDescription.length > 40 ? '...' : ''}"` 
      : (url ? `Brand URL: ${url}` : 'Target Audience');

    setResearchLogs([
      {
        id: "init",
        timestamp: new Date().toLocaleTimeString(),
        type: "status",
        message: `Establishing research channel connection for ${targetBriefSummary} in ${geography || 'United States'}...`
      }
    ]);

    // Clear the active save tracking on a completely new run (non-regenerated version)
    adoptDraftRef.current = !typeOverride || !activeSavedId;
    if (!typeOverride) {
      setActiveSavedId(null);
      setActiveSavedTitle(null);
    }

    // Bound the run from the client side. The server's 4s SSE heartbeat means a stalled
    // pipeline would otherwise hold the socket open forever with no way to recover.
    const abortController = new AbortController();
    const hardTimeout = setTimeout(() => abortController.abort(), CLIENT_GENERATION_TIMEOUT_MS);

    try {
      const selectedOpts = (planOptions && planOptions.length > 0) ? planOptions.filter(p => p.selected) : undefined;
      const response = await api.authFetch("/api/generate-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abortController.signal,
        body: JSON.stringify({
          advertiserName,
          kpis: kpis.filter((k) => k.trim().length > 0),
          audienceDescription: briefMode === "upload" ? `[Media Plan / RFP: ${uploadedFileName || 'Uploaded File'}]\n\n${(uploadedFileText || '').slice(0, 1500)}` : audienceDescription,
          url,
          geography,
          campaignFocus,
          additionalContext,
          targetPersonas: targetPersonas.map(p => p.trim()).filter(p => p.length > 0),
          regenerateType: typeOverride,
          pinnedBriefOfRecord,
          selectedPlanOptions: selectedOpts,
          budgetStrategyMode,
          rfpAnalysis,
          workingMediaBudget: budgetNormalization.workingMediaBudget,
          campaignFlightDays: budgetNormalization.campaignFlightDays,
          planningSettings,
          ctvPublishers,
          quickMode,
          // What the server needs, beyond the brief above, to save the finished run as a draft.
          draft: {
            title: advertiserName.trim()
              ? (/\bplans?\b/i.test(advertiserName.trim()) ? advertiserName.trim() : `${advertiserName.trim()} Plan`)
              : (saveTitle.trim() || undefined),
            settingsRevision,
            geographyConfig: { type: geographyType, targets: geoTargets, rawInput: geoRawInput },
            budget,
            campaignLength,
          },
        })
      });

      if (!response.ok) {
        let errorMsg = "Failed to generate audience profile.";
        try {
          const errJson = await response.json();
          errorMsg = errJson.details || errJson.error || errorMsg;
        } catch (_) {}
        throw new Error(errorMsg);
      }

      if (!response.body) {
        throw new Error("Streaming is not supported in this browser environment.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";
      let sawComplete = false;
      let serverError: string | null = null;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // Keep partial line

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          if (!trimmed.startsWith("data: ")) continue; // ":" heartbeat comments

          const rawJson = trimmed.slice(6).trim();
          if (!rawJson) continue;

          // Only the parse itself is recoverable. A malformed line can be skipped, but a
          // server-reported failure must not be — it is recorded and rethrown after the
          // loop so it reaches the outer catch instead of being swallowed here.
          let event: any;
          try {
            event = JSON.parse(rawJson);
          } catch (parseErr) {
            console.error("Malformed SSE line, skipping:", parseErr, rawJson.slice(0, 200));
            continue;
          }

          if (event.type === "status") {
            pendingLogsRef.current.push({
              type: "status",
              message: event.message,
              at: event.at
            });
          } else if (event.type === "research_result") {
            pendingLogsRef.current.push({
              type: "research_result",
              label: event.label,
              sources: event.sources,
              blurb: event.blurb,
              failed: Boolean(event.failed),
              at: event.at
            });
          } else if (event.type === "complete") {
            sawComplete = true;
            setServerCompleteData({
              profile: event.profile,
              groundingSources: event.groundingSources || null,
              savedPlanId: event.savedPlanId || null,
            });
          } else if (event.type === "error") {
            serverError = event.details || event.error || "An error occurred during profile generation.";
          } else {
            console.warn("Unknown SSE event type, ignoring:", event.type);
          }
        }
      }

      // The stream is over. Surface a server-reported failure, and treat a stream that ended
      // without a completion event as a failure too (Cloud Run deadline, proxy cut, restart).
      // Without these, the loop simply falls through, `loading` stays true, and the thought
      // ticker keeps inventing progress forever.
      if (serverError) throw new Error(serverError);
      if (!sawComplete) {
        throw new Error("The research stream ended before a profile was returned. The server may have timed out or restarted. Please try again.");
      }
    } catch (err: any) {
      console.error(err);
      const message = err?.name === "AbortError"
        ? `Generation exceeded ${Math.round(CLIENT_GENERATION_TIMEOUT_MS / 60000)} minutes and was cancelled. Please try again, or simplify the brief.`
        : (err.message || "An unexpected error occurred during profile generation.");
      setError(message);
      setLoading(false);
      setRegenType(null);
    } finally {
      // Only clears the deadline timer. Deliberately does NOT touch `loading`: on the happy
      // path the run stays "loading" until the ticker drains its queue and runs the
      // completion branch, which is what actually sets the profile data.
      clearTimeout(hardTimeout);
    }
  };

  // The manual audit saved the plan with the approved fixes and a new audit; show that version.
  // Headshots generated in this session are kept: a server-saved draft does not carry them.
  const handleAuditApplied = (result: { plan: api.StoredPlan; applied: number; stale: number; verifyError: string | null }) => {
    const saved = result.plan.payload.profile as AudienceProfile | undefined;
    if (saved) {
      setProfileData((prev) => ({
        ...saved,
        personas: (saved.personas || []).map((persona, i) => ({
          ...persona,
          avatarUrl: persona.avatarUrl || prev?.personas?.[i]?.avatarUrl,
          avatarHistory: persona.avatarHistory || prev?.personas?.[i]?.avatarHistory,
        })),
      }));
    }
    markPlanPersisted(result.plan);
    refreshPlans().catch(() => undefined);
    setIsAuditModalOpen(false);
    setIsAuditExpanded(true);
    const notes = [
      result.stale > 0 ? `${result.stale} approved fix${result.stale === 1 ? " was" : "es were"} skipped because the text had changed since the audit.` : "",
      result.verifyError ? `The fixes were saved but could not be re-verified (${result.verifyError}).` : "",
    ].filter(Boolean);
    setActionError(notes.length > 0 ? notes.join(" ") : null);
  };

  // ScoutAI reads and edits the saved plan. Edits the planner has not saved yet would be lost
  // under an applied change, so the panel holds Apply until they are saved. The fields that
  // auto-save (segments, overrides, hidden sections, the brief) are not counted.
  const scoutHasUnsavedChanges = React.useMemo(() => {
    const persisted = lastPersistedPlanRef.current;
    if (!profileData || !persisted || persisted.id !== activeSavedId) return false;
    return profileBaselineFingerprint(persisted.payload.profile) !== profileBaselineFingerprint(profileData);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileData, activePlanRevision, activeSavedId]);

  const handleScoutApplied = (plan: api.StoredPlan) => {
    const saved = plan.payload.profile as AudienceProfile | undefined;
    // Read before markPlanPersisted replaces it below.
    const previousProfile = lastPersistedPlanRef.current?.payload?.profile as AudienceProfile | undefined;
    if (saved) {
      // The auto-saved fields (segments, hidden sections, the brief, channel panel edits) may hold
      // an edit still waiting on its debounce. Where the change left a field as it was, the live
      // value is kept and its auto-save lands on the new revision; where the change edited it,
      // the saved value is what the planner approved.
      const changed = (a: unknown, b: unknown) => JSON.stringify(a ?? null) !== JSON.stringify(b ?? null);
      const pick = <K extends keyof AudienceProfile>(key: K, live: AudienceProfile | null): AudienceProfile[K] =>
        changed(saved[key], previousProfile?.[key]) || !live ? saved[key] : live[key];
      setProfileData((prev) => ({
        ...saved,
        personas: (saved.personas || []).map((persona) => {
          // A persona's headshot may exist only in the browser (headshots wait for a manual Save).
          const live = prev?.personas?.find((p) => p.name === persona.name);
          return { ...persona, avatarUrl: persona.avatarUrl || live?.avatarUrl, avatarHistory: persona.avatarHistory || live?.avatarHistory };
        }),
        segmentRecommendations: pick("segmentRecommendations", prev),
        hiddenSections: pick("hiddenSections", prev),
        executiveBrief: pick("executiveBrief", prev),
        slideExports: pick("slideExports", prev),
        channelStrategy: saved.channelStrategy
          ? {
              ...saved.channelStrategy,
              channelOverrides: changed(saved.channelStrategy.channelOverrides, previousProfile?.channelStrategy?.channelOverrides) || !prev
                ? saved.channelStrategy.channelOverrides
                : prev.channelStrategy?.channelOverrides,
            }
          : saved.channelStrategy,
      }));
    }
    // The brief fields ScoutAI may change, so the Brief tab shows what was saved.
    // Only fields the change touched are reset, so an unrelated apply keeps the form as it is.
    const body = plan.payload as any;
    const previous = (lastPersistedPlanRef.current?.payload ?? {}) as any;
    if (typeof body.budget === "string" && body.budget !== previous.budget) setBudget(body.budget);
    if (Array.isArray(body.kpis) && JSON.stringify(body.kpis) !== JSON.stringify(previous.kpis)) setKpis(body.kpis.length > 0 ? body.kpis : [""]);
    if ((body.geography ?? "") !== (previous.geography ?? "")) restoreGeographyFromPayload(body);
    // The one-step channel undo would restore the pre-ScoutAI plan as an unsaved edit; the
    // ScoutAI card's Revert is the saved way back.
    setChannelStrategyUndo(null);
    markPlanPersisted(plan);
    refreshPlans().catch(() => undefined);
    generateScoutHeadshots(plan);
  };

  // A persona ScoutAI added or replaced has no headshot. It gets one straight away, saved onto the
  // plan (headshots otherwise wait for the next manual Save), so a new persona never appears
  // faceless on a reload or a share link.
  const generateScoutHeadshots = (plan: api.StoredPlan) => {
    const personas = (plan.payload.profile?.personas || []) as Persona[];
    personas.forEach((persona, index) => {
      if (persona.avatarUrl) return;
      setGeneratingAvatarIndices((prev) => Array.from(new Set([...prev, index])));
      markAvatarFailed(index, false);
      api.authFetch("/api/generate-persona-avatar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ persona: { ...persona, avatarHistory: undefined } }),
      })
        .then((res) => res.json())
        .then(async (data) => {
          if (!data.success || !data.avatarUrl) { markAvatarFailed(index, true); return; }
          const avatarUrl = (await compressAvatarUrl(data.avatarUrl)) || data.avatarUrl;
          const version: PersonaAvatarVersion = {
            id: `v-${Date.now()}`,
            url: avatarUrl,
            prompt: "ScoutAI persona portrait",
            createdAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          };
          const withHeadshot = (p: Persona): Persona => ({ ...p, avatarUrl, avatarHistory: [version, ...(p.avatarHistory || [])].slice(0, 8) });
          // Matched by name: the persona may have moved, or been changed again, since.
          setProfileData((prev) => prev ? { ...prev, personas: prev.personas.map((p) => (p.name === persona.name && !p.avatarUrl ? withHeadshot(p) : p)) } : prev);
          segmentAutoSaveQueueRef.current = segmentAutoSaveQueueRef.current.then(async () => {
            const persisted = lastPersistedPlanRef.current;
            const revision = activePlanRevisionRef.current;
            const savedPersonas: Persona[] = persisted?.payload?.profile?.personas || [];
            if (!persisted || persisted.id !== plan.id || revision === null) return;
            if (!savedPersonas.some((p) => p.name === persona.name && !p.avatarUrl)) return;
            try {
              const updated = await api.updatePlan(plan.id, revision, {
                title: persisted.title,
                advertiserName: persisted.advertiserName,
                settingsRevision: persisted.settingsRevision,
                payload: {
                  ...persisted.payload,
                  profile: { ...persisted.payload.profile, personas: savedPersonas.map((p) => (p.name === persona.name && !p.avatarUrl ? withHeadshot(p) : p)) },
                },
              });
              markPlanPersisted(updated);
              // Only the headshot changed, so pending ScoutAI proposals and its Revert still hold.
              setScoutRevisionBump({ from: revision, to: updated.revision });
            } catch (err) {
              console.error("Could not save the new persona headshot:", err);
            }
          });
        })
        .catch((err) => {
          console.error("Could not generate a headshot for the new persona:", err);
          markAvatarFailed(index, true);
        })
        .finally(() => setGeneratingAvatarIndices((prev) => prev.filter((i) => i !== index)));
    });
  };

  const handleScoutFollowUp = (action: ScoutFollowUpAction, instructions?: string) => {
    if (action === "executive_summary") {
      requestExecutiveBrief({ instructions: instructions || "" });
      document.getElementById("executive-brief")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } else if (action === "qa_audit") {
      setIsAuditModalOpen(true);
    } else if (action === "regenerate_plan") {
      const confirmed = window.confirm(
        "Regenerate this plan from its current brief? Research, personas, segments and the channel plan are rebuilt, which takes several minutes. The result is saved as a new draft; this version stays in your saved plans.",
      );
      if (confirmed) handleGenerate(undefined, undefined, { pinBrief: true });
    }
  };

  // Reset workspace to a fresh blank brief and clear the active plan
  const handleNewPlan = () => {
    // Reset brief input fields
    setAdvertiserName("");
    setBudget("$100,000");
    setCampaignLength("30");
    setKpis([""]);
    setAudienceDescription("");
    setUrl("");
    setGeographyType("National");
    setGeoTargets([]);
    setGeoRawInput("");
    setGeoUnrecognized([]);
    setGeoUploadNotice(null);
    setCampaignFocus("Full-funnel digital media plan");
    setAdditionalContext("");
    setIsAdvancedPersonaOpen(false);
    setTargetPersonas(["", "", "", ""]);

    // Reset media plan upload & parsing states
    setBriefMode("text");
    setUploadedFileName("");
    setUploadedFileText("");
    setParsedSheetsData([]);
    setExtractedPlacements([]);
    setRfpAnalysis(null);
    setActivePlanSubTab("ALL");
    setIsParsingPlan(false);
    setParsingError(null);
    setPlanOptions([]);
    setTaxonomyMappings([]);
    setBudgetStrategyMode("reallocation");
    setChannelStrategyUndo(null);
    if (lastUploadedFileRef.current) lastUploadedFileRef.current = null;
    if (geoFileInputRef.current) geoFileInputRef.current.value = "";
    if (mediaPlanFileInputRef.current) mediaPlanFileInputRef.current.value = "";

    // Reset active profile output & generation states
    resetSegmentSession();
    setFailedAvatarIndices([]);
    setActionError(null);
    setProfileData(null);
    setGroundingSources(null);
    setError(null);
    setLoading(false);
    setPersonaPage(0);
    setArePersonasExpanded(false);
    setIsDeviceShareExpanded(false);
    setIsDemographicsExpanded(false);
    setIsTemporalExpanded(false);
    setIsDomainAffinityExpanded(false);
    setResearchLogs([]);
    setServerCompleteData(null);
    setGeneratingAvatarIndices([]);
    setSummarizedPublisherInsights(null);
    if (initialCtvPublishersRef.current) initialCtvPublishersRef.current = null;

    // Reset saved plan selection & modals
    setActiveSavedId(null);
    setActiveSavedTitle(null);
    setIsEditingBlueprintTitle(false);
    setActivePlanRevision(null);
    setLeftTab("brief");
    setIsExportOpen(false);
    setIsPreviewModalOpen(false);
    setIsCtvPublishersModalOpen(false);
    setIsSlideStudioOpen(false);
    setIsShareModalOpen(false);
    setIsInsightsExpanded(false);
    setIsCitationsExpanded(false);
    setIsAuditExpanded(false);

    // Clear any share token or URL query parameters and scroll to top
    if (typeof window !== "undefined") {
      if (window.location.search) {
        window.history.replaceState({}, document.title, window.location.pathname);
      }
      setShareToken(null);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  // Copy Profile Markdown to clipboard
  const handleCopyProfile = () => {
    if (!profileData) return;
    const md = exportProfileToMarkdown(profileData, false, false);
    navigator.clipboard.writeText(md);
    setCopyProfileCopied(true);
    setTimeout(() => setCopyProfileCopied(false), 2000);
  };

  // Copy Sources Markdown to clipboard
  const handleCopySources = () => {
    if (!profileData) return;
    const md = exportSourcesToMarkdown(profileData);
    navigator.clipboard.writeText(md);
    setCopySourcesCopied(true);
    setTimeout(() => setCopySourcesCopied(false), 2000);
  };

  const handleToggleBudgetMode = async (mode: 'reallocation' | 'incremental') => {
    setBudgetStrategyMode(mode);
    if (!profileData || !planOptions || planOptions.length === 0) return;

    const selectedOpts = planOptions.filter(p => p.selected);
    if (selectedOpts.length === 0) return;
    const currentStrategy = profileData.channelStrategy;
    const candidateSignals = currentStrategy?.mediaPlan?.evaluatedCandidates.map((candidate) => ({
      channelId: candidate.product.id,
      components: candidate.components,
      gapAddressed: candidate.gapAddressed,
      evidence: candidate.evidence,
      activationGuidance: candidate.activationGuidance,
      measurementApproach: candidate.measurementApproach,
      tradeoffs: candidate.tradeoffs,
      allocationRationale: candidate.allocationRationale,
      decisionRule: candidate.decisionRule,
    })) || [];

    try {
      const res = await api.authFetch("/api/analyze-media-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audienceProfile: profileData,
          selectedPlanOptions: selectedOpts,
          budgetStrategyMode: mode,
          advertiserName,
          advertiserUrl: url,
          kpis: kpis.filter((k) => k.trim().length > 0),
          campaignFocus,
          geography,
          workingMediaBudget: budgetNormalization.workingMediaBudget,
          campaignFlightDays: budgetNormalization.campaignFlightDays,
          planningSettings,
          requiredChannelIds: currentStrategy?.manualIncludedChannelIds || [],
          excludedChannelIds: currentStrategy?.manualExcludedChannelIds || [],
          candidateSignals,
        })
      });
      const data = await res.json();
      if (data.success && data.channelStrategy) {
        // The re-analysis rebuilds the allocations but not the planner's panel edits, which belong
        // to the media type rather than its numbers; they carry over for every media type kept.
        setProfileData(prev => {
          if (!prev) return null;
          const kept = new Set((data.channelStrategy.mediaPlan?.channels || []).map((c: any) => c.channelId));
          const overrides = Object.fromEntries(Object.entries(prev.channelStrategy?.channelOverrides || {}).filter(([id]) => kept.has(id)));
          return { ...prev, channelStrategy: { ...data.channelStrategy, ...(Object.keys(overrides).length ? { channelOverrides: overrides } : {}) } };
        });
        setActionError(null);
      } else {
        throw new Error(data.details || data.error || "The media plan could not be re-analyzed.");
      }
    } catch (err: any) {
      console.error("Failed to re-analyze channel strategy for budget mode toggle:", err);
      setActionError(`The budget mode changed, but the media plan could not be re-analyzed, so the channel strategy shown is still the previous one: ${err?.message || err}`);
    }
  };

  const handleManualMediaTypeChange = async (channelId: string, action: 'add' | 'remove') => {
    const currentStrategy = profileData?.channelStrategy;
    if (!profileData || !currentStrategy?.mediaPlan) throw new Error("No active media plan is available to update.");

    const included = new Set(currentStrategy.manualIncludedChannelIds || []);
    const excluded = new Set(currentStrategy.manualExcludedChannelIds || []);
    const lockedChannelIds = currentStrategy.lockedAllocationChannelIds || [];
    const nextPlan = action === 'add'
      ? addMediaTypeAndRebalance(currentStrategy.mediaPlan, channelId, lockedChannelIds)
      : removeMediaTypeAndRebalance(currentStrategy.mediaPlan, channelId, lockedChannelIds);

    if (action === 'add') {
      included.add(channelId);
      excluded.delete(channelId);
    } else {
      included.delete(channelId);
      excluded.add(channelId);
    }

    const nextStrategy: ChannelStrategyData = {
      ...currentStrategy,
      generatedAt: new Date().toISOString(),
      manualIncludedChannelIds: Array.from(included),
      manualExcludedChannelIds: Array.from(excluded),
      allocationBaselineBasisPoints: allocationBasisPoints(nextPlan),
      lockedAllocationChannelIds: lockedChannelIds.filter((id) => nextPlan.channels.some((channel) => channel.channelId === id)),
      hasManualAllocationChanges: false,
      mediaPlan: nextPlan,
    };
    setChannelStrategyUndo(currentStrategy);
    setProfileData((previous) => previous ? { ...previous, channelStrategy: nextStrategy } : null);
  };

  const handleSaveManualAllocations = async (basisPoints: AllocationBasisPoints, lockedChannelIds: string[], newBudget?: number) => {
    const currentStrategy = profileData?.channelStrategy;
    if (!profileData || !currentStrategy?.mediaPlan) throw new Error("No active media plan is available to update.");
    const budgetToApply = newBudget ?? currentStrategy.mediaPlan.workingMediaBudget;
    const baseline = currentStrategy.allocationBaselineBasisPoints || allocationBasisPoints(currentStrategy.mediaPlan);
    const nextPlan = applyBasisPointAllocations(
      currentStrategy.mediaPlan,
      basisPoints,
      `Planner saved manual allocation changes${newBudget && newBudget !== currentStrategy.mediaPlan.workingMediaBudget ? ` with budget $${newBudget.toLocaleString()}` : ''}; unlocked media types were proportionally rebalanced within the working-media budget.`,
      budgetToApply,
    );
    const budgetChanged = budgetToApply !== currentStrategy.mediaPlan.workingMediaBudget;
    const nextStrategy: ChannelStrategyData = {
      ...currentStrategy,
      generatedAt: new Date().toISOString(),
      allocationBaselineBasisPoints: baseline,
      lockedAllocationChannelIds: lockedChannelIds.filter((id) => nextPlan.channels.some((channel) => channel.channelId === id)),
      hasManualAllocationChanges: !allocationsEqual(baseline, basisPoints) || budgetChanged,
      mediaPlan: nextPlan,
    };
    setChannelStrategyUndo(currentStrategy);
    setProfileData((previous) => previous ? { ...previous, channelStrategy: nextStrategy } : null);
    if (budgetChanged) {
      setBudget(`$${budgetToApply.toLocaleString()}`);
    }
  };

  const handleResetManualAllocations = async () => {
    const currentStrategy = profileData?.channelStrategy;
    if (!profileData || !currentStrategy?.mediaPlan) throw new Error("No active media plan is available to reset.");
    const baseline = currentStrategy.allocationBaselineBasisPoints;
    if (!baseline) return;
    const nextPlan = applyBasisPointAllocations(
      currentStrategy.mediaPlan,
      baseline,
      "Planner reset allocations to the ScoutAI recommendation for the current selected portfolio.",
    );
    const nextStrategy: ChannelStrategyData = {
      ...currentStrategy,
      generatedAt: new Date().toISOString(),
      lockedAllocationChannelIds: [],
      hasManualAllocationChanges: false,
      mediaPlan: nextPlan,
    };
    setChannelStrategyUndo(currentStrategy);
    setProfileData((previous) => previous ? { ...previous, channelStrategy: nextStrategy } : null);
  };

  const handleUndoChannelStrategyChange = () => {
    if (!channelStrategyUndo) return;
    const strategyToRestore = channelStrategyUndo;
    setChannelStrategyUndo(null);
    setProfileData((previous) => previous ? { ...previous, channelStrategy: strategyToRestore } : null);
  };

  const handleUpdateCtvPublishers = (updated: CtvPublisherRecommendation[]) => {
    setProfileData((previous) => {
      if (!previous) return null;
      // The CTV media types list the same publishers, so exports and the executive summary agree.
      return syncCtvChannelPublishers({
        ...previous,
        ctvPublishers: updated,
        channelStrategy: previous.channelStrategy
          ? {
              ...previous.channelStrategy,
              ctvPublishers: updated,
            }
          : undefined,
      });
    });
  };

  const handleResetCtvPublishers = () => {
    // Reset restores the plan's own AI selection - or none, never a canned list.
    const toRestore = initialCtvPublishersRef.current ?? [];
    handleUpdateCtvPublishers(toRestore);
  };

  const handleUpdateChannelOverrides = (overrides: ChannelOverridesMap) => {
    channelOverridesDirtyRef.current = true;
    setProfileData((previous) => {
      if (!previous) return null;
      return {
        ...previous,
        channelStrategy: previous.channelStrategy
          ? {
              ...previous.channelStrategy,
              channelOverrides: overrides,
            }
          : undefined,
      };
    });
  };

  // Download Profile Markdown file
  const handleDownloadMarkdown = () => {
    if (!profileData) return;
    const md = exportProfileToMarkdown(profileData, true, Boolean(internalOnlyVisibility.qaAudit));
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8;" });
    const fileUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = fileUrl;
    
    // Clean name for filename
    const sanitizedName = (currentPlanTitle || profileData.personas[0]?.name || "audience_profile")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_");
    
    link.setAttribute("download", `${sanitizedName}_media_strategy.md`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Download Profile Text file (Markdown format)
  const handleDownloadTxt = () => {
    if (!profileData) return;
    const md = exportProfileToMarkdown(profileData, true, Boolean(internalOnlyVisibility.qaAudit));
    const blob = new Blob([md], { type: "text/plain;charset=utf-8;" });
    const fileUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = fileUrl;
    
    // Clean name for filename
    const sanitizedName = (currentPlanTitle || profileData.personas[0]?.name || "audience_profile")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_");
    
    link.setAttribute("download", `${sanitizedName}_media_strategy.txt`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Download Profile PDF file using html2canvas and jsPDF
  const handleDownloadPDF = async () => {
    if (!profileData) return;
    setPdfGenerating(true);

    const originalGetComputedStyle = window.getComputedStyle;

    // Helper to convert oklch(...) to standard rgb(...) or rgba(...) color strings
    const oklchToRgb = (oklchStr: string): string => {
      try {
        const regex = /oklch\s*\(\s*([\d.]+%?)\s+([\d.]+%?)\s+([\d.]+(?:deg|rad|grad|turn)?|none)\s*(?:\/\s*([\d.]+%?))?\s*\)/i;
        const match = oklchStr.match(regex);
        if (!match) return oklchStr;

        const [, lStr, cStr, hStr, aStr] = match;

        const L = lStr.endsWith("%") ? parseFloat(lStr) / 100 : parseFloat(lStr);
        const C = cStr.endsWith("%") ? parseFloat(cStr) / 100 : parseFloat(cStr);

        let H = 0;
        if (hStr !== "none") {
          if (hStr.endsWith("deg")) H = parseFloat(hStr);
          else if (hStr.endsWith("rad")) H = parseFloat(hStr) * (180 / Math.PI);
          else if (hStr.endsWith("grad")) H = parseFloat(hStr) * 0.9;
          else if (hStr.endsWith("turn")) H = parseFloat(hStr) * 360;
          else H = parseFloat(hStr);
        }

        let alpha = 1;
        if (aStr) {
          alpha = aStr.endsWith("%") ? parseFloat(aStr) / 100 : parseFloat(aStr);
        }

        // Convert OKLCH to OKLab coordinates
        const hRad = (H * Math.PI) / 180;
        const aVal = C * Math.cos(hRad);
        const bVal = C * Math.sin(hRad);

        // OKLab to LMS
        const L_ = L + 0.3963377774 * aVal + 0.2158037573 * bVal;
        const M_ = L - 0.1055613458 * aVal - 0.0638541728 * bVal;
        const S_ = L - 0.0894841775 * aVal - 1.291485548 * bVal;

        // LMS to linear RGB (cubing coordinates)
        const l = Math.pow(Math.max(0, L_), 3);
        const m = Math.pow(Math.max(0, M_), 3);
        const s = Math.pow(Math.max(0, S_), 3);

        // Linear LMS to linear sRGB
        const r_lin = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
        const g_lin = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
        const b_lin = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

        // Linear sRGB to standard sRGB (gamma correction)
        const r = r_lin <= 0.0031308 ? 12.92 * r_lin : 1.055 * Math.pow(r_lin, 1 / 2.4) - 0.055;
        const g = g_lin <= 0.0031308 ? 12.92 * g_lin : 1.055 * Math.pow(g_lin, 1 / 2.4) - 0.055;
        const b = b_lin <= 0.0031308 ? 12.92 * b_lin : 1.055 * Math.pow(b_lin, 1 / 2.4) - 0.055;

        const R = Math.round(Math.max(0, Math.min(1, r)) * 255);
        const G = Math.round(Math.max(0, Math.min(1, g)) * 255);
        const B = Math.round(Math.max(0, Math.min(1, b)) * 255);

        if (aStr) {
          return `rgba(${R}, ${G}, ${B}, ${alpha})`;
        } else {
          return `rgb(${R}, ${G}, ${B})`;
        }
      } catch (e) {
        console.warn("Failed to convert oklch to rgb:", e);
        return oklchStr;
      }
    };

    // Helper to convert oklab(...) to standard rgb(...) or rgba(...) color strings
    const oklabToRgb = (oklabStr: string): string => {
      try {
        const regex = /oklab\s*\(\s*([\d.]+%?)\s+([-+\d.]+%?)\s+([-+\d.]+%?)\s*(?:\/\s*([\d.]+%?))?\s*\)/i;
        const match = oklabStr.match(regex);
        if (!match) return oklabStr;

        const [, lStr, aStr, bStr, alphaStr] = match;

        const L = lStr.endsWith("%") ? parseFloat(lStr) / 100 : parseFloat(lStr);
        const aVal = aStr.endsWith("%") ? parseFloat(aStr) / 100 : parseFloat(aStr);
        const bVal = bStr.endsWith("%") ? parseFloat(bStr) / 100 : parseFloat(bStr);

        let alpha = 1;
        if (alphaStr) {
          alpha = alphaStr.endsWith("%") ? parseFloat(alphaStr) / 100 : parseFloat(alphaStr);
        }

        // OKLab to LMS
        const L_ = L + 0.3963377774 * aVal + 0.2158037573 * bVal;
        const M_ = L - 0.1055613458 * aVal - 0.0638541728 * bVal;
        const S_ = L - 0.0894841775 * aVal - 1.291485548 * bVal;

        // LMS to linear RGB (cubing coordinates)
        const l = Math.pow(Math.max(0, L_), 3);
        const m = Math.pow(Math.max(0, M_), 3);
        const s = Math.pow(Math.max(0, S_), 3);

        // Linear LMS to linear sRGB
        const r_lin = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
        const g_lin = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
        const b_lin = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

        // Linear sRGB to standard sRGB (gamma correction)
        const r = r_lin <= 0.0031308 ? 12.92 * r_lin : 1.055 * Math.pow(r_lin, 1 / 2.4) - 0.055;
        const g = g_lin <= 0.0031308 ? 12.92 * g_lin : 1.055 * Math.pow(g_lin, 1 / 2.4) - 0.055;
        const b = b_lin <= 0.0031308 ? 12.92 * b_lin : 1.055 * Math.pow(b_lin, 1 / 2.4) - 0.055;

        const R = Math.round(Math.max(0, Math.min(1, r)) * 255);
        const G = Math.round(Math.max(0, Math.min(1, g)) * 255);
        const B = Math.round(Math.max(0, Math.min(1, b)) * 255);

        if (alphaStr) {
          return `rgba(${R}, ${G}, ${B}, ${alpha})`;
        } else {
          return `rgb(${R}, ${G}, ${B})`;
        }
      } catch (e) {
        console.warn("Failed to convert oklab to rgb:", e);
        return oklabStr;
      }
    };

    // Override getComputedStyle temporarily
    window.getComputedStyle = function (elt, pseudoElt) {
      const style = originalGetComputedStyle.call(this, elt, pseudoElt);
      return new Proxy(style, {
        get(target, prop, receiver) {
          const val = Reflect.get(target, prop, target);
          if (typeof val === "string" && (val.includes("oklch(") || val.includes("oklab("))) {
            let replaced = val;
            if (replaced.includes("oklch(")) {
              replaced = replaced.replace(/oklch\s*\([^)]+\)/gi, (m) => oklchToRgb(m));
            }
            if (replaced.includes("oklab(")) {
              replaced = replaced.replace(/oklab\s*\([^)]+\)/gi, (m) => oklabToRgb(m));
            }
            return replaced;
          }
          if (typeof val === "function") {
            if (prop === "getPropertyValue") {
              return function (propertyName: string) {
                const rawVal = target.getPropertyValue(propertyName);
                if (typeof rawVal === "string" && (rawVal.includes("oklch(") || rawVal.includes("oklab("))) {
                  let replaced = rawVal;
                  if (replaced.includes("oklch(")) {
                    replaced = replaced.replace(/oklch\s*\([^)]+\)/gi, (m) => oklchToRgb(m));
                  }
                  if (replaced.includes("oklab(")) {
                    replaced = replaced.replace(/oklab\s*\([^)]+\)/gi, (m) => oklabToRgb(m));
                  }
                  return replaced;
                }
                return rawVal;
              };
            }
            return val.bind(target);
          }
          return val;
        },
      });
    };

    try {
      const element = document.getElementById("profile-export-content");
      if (!element) {
        return;
      }

      // Briefly wait for charts and legends to be fully stabilized
      await new Promise((resolve) => setTimeout(resolve, 350));

      const canvas = await html2canvas(element, {
        scale: 2, // High resolution retina rendering
        useCORS: true,
        logging: false,
        backgroundColor: "#f8fafc", // match background slate-50
      });

      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF("p", "mm", "a4");
      
      const imgWidth = 210; // A4 standard width in mm
      const pageHeight = 295; // A4 standard height in mm (with safety margin)
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      
      let heightLeft = imgHeight;
      let position = 0;

      // Add first page
      pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;

      // Add additional pages if the content spans multiple A4 sheets
      while (heightLeft > 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }

      const sanitizedName = (currentPlanTitle || profileData.personas[0]?.name || "audience_profile")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_");

      pdf.save(`${sanitizedName}_audience_strategy.pdf`);
    } catch (err) {
      console.error("Failed to export PDF:", err);
    } finally {
      // Restore original getComputedStyle
      window.getComputedStyle = originalGetComputedStyle;
      setPdfGenerating(false);
    }
  };

  // Export 16:9 Slide Image of CTV Publishers & Publisher Insights for Presentations (Detailed or Basic)
  const handleExportCtvSlide = async (variant: 'detailed' | 'basic' = 'detailed') => {
    if (isExportingCtvSlide) return;
    setIsExportingCtvSlide(true);
    setExportingVariant(variant);
    setCtvSlideExportSuccess(false);

    // Wait a moment for React to toggle the active canvas variant in the DOM
    await new Promise((resolve) => setTimeout(resolve, 80));

    const targetRef = variant === 'basic' ? ctvSlideBasicExportRef.current : ctvSlideDetailedExportRef.current;
    if (!targetRef) {
      setIsExportingCtvSlide(false);
      return;
    }

    try {
      // Ensure AI summarizes publisher insights if over limits (basic has a larger column than detailed)
      const rawInsights = (profileData?.publisherInsights || "").trim();
      const maxWords = variant === 'basic' ? 110 : 65;
      const maxCharacters = variant === 'basic' ? 780 : 450;
      const wordCount = rawInsights.split(/\s+/).length;

      if ((rawInsights.length > maxCharacters || wordCount > maxWords) && !summarizedPublisherInsights) {
        try {
          const sumRes = await fetch("/api/summarize-publisher-insights", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              text: rawInsights,
              maxWords,
              maxCharacters,
            }),
          });
          const sumData = await sumRes.json().catch(() => ({}));
          if (sumRes.ok && sumData.summary) {
            setSummarizedPublisherInsights(sumData.summary);
            // Wait for React to flush state to the DOM
            await new Promise((resolve) => setTimeout(resolve, 200));
          } else {
            throw new Error(sumData.details || sumData.error || "The publisher insight could not be summarized.");
          }
        } catch (sumErr: any) {
          // No clipped-text fallback: exporting a truncated paragraph would present it as the
          // finished insight. The export stops and says why.
          console.warn("AI summarization failed before export:", sumErr);
          setActionError(`The CTV slide was not exported: the publisher insight is too long for the slide and could not be summarized (${sumErr?.message || sumErr}).`);
          return;
        }
      }

      const canvas = await captureElementToCanvas(targetRef, {
        scale: 2, // 3840x2160 crisp 4K presentation quality
        width: 1920,
        height: 1080,
        backgroundColor: variant === 'basic' ? "#ffffff" : "#f8fafc",
      });

      canvas.toBlob((blob) => {
        if (!blob) return;

        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        const sanitizedName = (profileData?.personas?.[0]?.name || advertiserName || "ctv_publisher_strategy")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_");
        link.download = `${sanitizedName}_ctv_publishers_${variant}_16x9.png`;
        link.href = url;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(url), 1500);

        // Attempt direct copy to clipboard for immediate pasting into Google Slides or PowerPoint
        if (navigator.clipboard && typeof ClipboardItem !== "undefined") {
          try {
            navigator.clipboard
              .write([
                new ClipboardItem({
                  "image/png": blob,
                }),
              ])
              .catch(() => {
                // Clipboard write permission may be restricted in sandboxed iframe contexts
              });
          } catch {
            // Ignore clipboard errors gracefully
          }
        }

        setCtvSlideExportSuccess(true);
        setTimeout(() => setCtvSlideExportSuccess(false), 3500);
      }, "image/png");
    } catch (err: any) {
      console.error("Failed to export CTV slide image:", err);
      setActionError(`The CTV slide could not be exported: ${err?.message || err}`);
    } finally {
      setIsExportingCtvSlide(false);
      setExportingVariant(null);
    }
  };

  // When viewing via a share token, bypass the login screen and render the shared plan.
  if (isShareView) {
    if (sharedPlanLoading) {
      return (
        <div className="min-h-screen bg-[#fafbfc] flex flex-col items-center justify-center p-4 font-sans space-y-4">
          <div className="w-12 h-12 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-xs overflow-hidden p-2.5">
            <img src={drIconWhite} alt="Digital Remedy Logo" className="w-full h-full object-contain" referrerPolicy="no-referrer" />
          </div>
          <div className="flex items-center gap-2 text-indigo-600 font-medium text-sm">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span>Loading shared media plan...</span>
          </div>
        </div>
      );
    }

    if (sharedPlanError) {
      return (
        <div className="min-h-screen bg-[#fafbfc] flex items-center justify-center p-4 md:p-6 font-sans">
          <div className="w-full max-w-md bg-white border border-slate-100 rounded-2xl shadow-xl p-8 space-y-6 text-center">
            <div className="w-12 h-12 bg-rose-50 border border-rose-100 rounded-xl flex items-center justify-center text-rose-600 mx-auto">
              <AlertCircle className="w-6 h-6" />
            </div>
            <div className="space-y-2">
              <h2 className="text-xl font-display font-bold text-slate-900">Shared Plan Unavailable</h2>
              <p className="text-xs text-slate-500 leading-relaxed">
                {sharedPlanError}
              </p>
            </div>
            <button
              onClick={() => {
                window.history.replaceState({}, "", window.location.pathname);
                setShareToken(null);
                setSharedPlanError(null);
              }}
              className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl transition-all shadow-xs cursor-pointer"
            >
              Back to Sign In
            </button>
          </div>
        </div>
      );
    }
  } else {
    // Avoid flashing the login screen while the session cookie is being verified.
    if (!isSessionChecked) {
      return (
        <div className="min-h-screen bg-[#fafbfc] flex items-center justify-center p-4 font-sans">
          <Loader2 className="w-6 h-6 text-indigo-600 animate-spin" />
        </div>
      );
    }

    if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-[#fafbfc] flex items-center justify-center p-4 md:p-6 font-sans">
        <div className="w-full max-w-md bg-white border border-slate-100 rounded-2xl shadow-xl p-8 space-y-6">
          <div className="text-center space-y-2">
            <div className="w-12 h-12 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-xs mx-auto mb-4 overflow-hidden p-2.5">
              <img src={drIconWhite} alt="Digital Remedy Logo" className="w-full h-full object-contain" referrerPolicy="no-referrer" />
            </div>
            <h1 className="text-2xl font-display font-bold text-slate-900 tracking-tight">Welcome Back</h1>
            <p className="text-xs text-slate-500 font-medium">Sign in to AI Plan Agent</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            {loginError && (
              <div className="bg-rose-50 border border-rose-100 text-rose-700 p-3 rounded-xl text-xs font-medium flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{loginError}</span>
              </div>
            )}

            <div className="space-y-1.5">
              <label htmlFor="displayName" className="text-xs font-bold text-slate-700 block">
                Your Name
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3.5 pointer-events-none text-slate-400">
                  <UserCheck className="w-4 h-4" />
                </span>
                <input
                  id="displayName"
                  type="text"
                  required
                  value={displayNameInput}
                  onChange={(e) => setDisplayNameInput(e.target.value)}
                  placeholder="e.g. TJ Pascal"
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-indigo-600/10 focus:border-indigo-600 transition-all text-slate-800"
                />
              </div>
              <p className="text-[10px] text-slate-400 leading-snug">
                Shown on the plans you save, so the team knows who created them.
              </p>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="username" className="text-xs font-bold text-slate-700 block">
                Username
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3.5 pointer-events-none text-slate-400">
                  <User className="w-4 h-4" />
                </span>
                <input
                  id="username"
                  type="text"
                  required
                  value={usernameInput}
                  onChange={(e) => setUsernameInput(e.target.value)}
                  placeholder="Enter your username"
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-indigo-600/10 focus:border-indigo-600 transition-all text-slate-800"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="password" className="text-xs font-bold text-slate-700 block">
                Password
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3.5 pointer-events-none text-slate-400">
                  <Lock className="w-4 h-4" />
                </span>
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  required
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  placeholder="Enter your password"
                  className="w-full pl-10 pr-12 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-indigo-600/10 focus:border-indigo-600 transition-all text-slate-800"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 flex items-center pr-3.5 text-slate-400 hover:text-slate-600 transition-colors"
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            {showAdminField ? (
              <div className="space-y-1.5">
                <label htmlFor="adminPassword" className="text-xs font-bold text-slate-700 block">
                  Administrator Password <span className="font-normal text-slate-400">(optional)</span>
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 flex items-center pl-3.5 pointer-events-none text-slate-400">
                    <ShieldCheck className="w-4 h-4" />
                  </span>
                  <input
                    id="adminPassword"
                    type="password"
                    value={adminPasswordInput}
                    onChange={(e) => setAdminPasswordInput(e.target.value)}
                    placeholder="Only needed to change global settings"
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-indigo-600/10 focus:border-indigo-600 transition-all text-slate-800"
                  />
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowAdminField(true)}
                className="text-[11px] font-semibold text-slate-400 hover:text-indigo-600 hover:underline cursor-pointer"
              >
                Sign in as an administrator
              </button>
            )}

            <div className="text-right text-[11px] text-slate-400 font-mono">
              Session duration: 24 hours
            </div>

            <button
              type="submit"
              disabled={isLoggingIn}
              className="w-full py-3 bg-[#5856fd] hover:bg-[#4338ca] disabled:bg-[#5856fd]/60 disabled:cursor-not-allowed text-white font-medium text-sm rounded-xl transition-all shadow-md hover:shadow-lg flex items-center justify-center gap-2 cursor-pointer"
            >
              {isLoggingIn ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Signing In...</span>
                </>
              ) : (
                <>
                  <span>Sign In</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          <div className="text-center pt-4 border-t border-slate-100">
            <span className="text-[11px] text-slate-400 font-sans tracking-wide">AI Plan Agent Intelligence</span>
          </div>
        </div>
      </div>
    );
  }
}

  return (
    <div className="min-h-screen bg-[#fafbfc] text-slate-800 flex flex-col font-sans">
      {/* Header */}
      <header className="bg-white border-b border-slate-100 py-5 px-6 sticky top-0 z-50 shadow-xs">
        <div className="max-w-[1500px] mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-xs overflow-hidden p-2">
              <img src={drIconWhite} alt="Digital Remedy Logo" className="w-full h-full object-contain" referrerPolicy="no-referrer" />
            </div>
            <div>
              <h1 className="text-xl font-display font-bold text-slate-900 tracking-tight">AI Plan Agent</h1>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            {/* Plan Action Buttons (Save, Share, New Plan, Export) */}
            {!isShareView && profileData && !loading && (
              <div className="flex items-center gap-2 flex-wrap">
                {/* Reset Hidden Sections Button (Visible if any section is hidden) */}
                {profileData.hiddenSections && profileData.hiddenSections.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      hiddenSectionsDirtyRef.current = true;
                      setProfileData((prev) => (prev ? { ...prev, hiddenSections: [] } : prev));
                    }}
                    className="inline-flex items-center gap-1.5 text-xs bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200/90 px-3 py-2 rounded-xl transition-colors cursor-pointer font-semibold shadow-2xs"
                    title="Click to restore all hidden sections in the share link"
                  >
                    <EyeOff className="w-3.5 h-3.5 text-amber-700" />
                    <span>{profileData.hiddenSections.length} hidden from share • Reset</span>
                  </button>
                )}

                {/* Save to History Button */}
                <button
                  onClick={handleOpenSaveDialog}
                  className="inline-flex items-center justify-center gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 py-2 rounded-xl transition-colors cursor-pointer font-semibold shadow-xs"
                  title="Save this profile to history list"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{activeSavedId ? "Update Save" : "Save Profile"}</span>
                </button>

                {/* Share Plan Button */}
                <button
                  onClick={handleOpenShareForActivePlan}
                  className="inline-flex items-center justify-center gap-1.5 text-xs bg-indigo-600 hover:bg-indigo-700 text-white px-3.5 py-2 rounded-xl transition-colors cursor-pointer font-semibold shadow-xs"
                  title="Create or manage shareable link for this plan"
                >
                  <Share2 className="w-3.5 h-3.5" />
                  <span>Share Plan</span>
                </button>

                {/* New Plan Button */}
                <button
                  onClick={handleNewPlan}
                  className="inline-flex items-center justify-center gap-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-white px-3.5 py-2 rounded-xl transition-colors cursor-pointer font-semibold shadow-xs"
                  title="Start a new blank brief and clear the current plan"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>New Plan</span>
                </button>

                {/* Export Dropdown */}
                <div className="relative">
                  <button
                    onClick={() => setIsExportOpen(!isExportOpen)}
                    className="inline-flex items-center justify-center gap-1.5 text-xs bg-indigo-600 hover:bg-indigo-700 text-white px-3.5 py-2 rounded-xl transition-colors cursor-pointer font-semibold shadow-xs"
                    title="Export this profile to Markdown or text formats"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Export Plan</span>
                    <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${isExportOpen ? 'rotate-180' : ''}`} />
                  </button>
                  
                  {isExportOpen && (
                    <>
                      <div className="fixed inset-0 z-40 cursor-default" onClick={() => setIsExportOpen(false)} />
                      <div className="absolute right-0 mt-2 w-52 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl py-1.5 z-50 text-left">
                        <button
                          onClick={() => {
                            setIsExportOpen(false);
                            handleDownloadMarkdown();
                          }}
                          className="w-full text-left px-4 py-2 text-xs text-slate-200 hover:bg-slate-700 flex items-center gap-2 cursor-pointer transition-colors"
                        >
                          <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                          <div>
                            <span className="block font-semibold">Download Markdown</span>
                            <span className="block text-[9px] text-slate-400 font-mono">Clean document (.md)</span>
                          </div>
                        </button>
                        <button
                          onClick={() => {
                            setIsExportOpen(false);
                            handleDownloadTxt();
                          }}
                          className="w-full text-left px-4 py-2 text-xs text-slate-200 hover:bg-slate-700 flex items-center gap-2 cursor-pointer transition-colors"
                        >
                          <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                          <div>
                            <span className="block font-semibold">Download Text File</span>
                            <span className="block text-[9px] text-slate-400 font-mono">Markdown text (.txt)</span>
                          </div>
                        </button>
                        <button
                          onClick={() => {
                            setIsExportOpen(false);
                            handleCopyProfile();
                          }}
                          className="w-full text-left px-4 py-2 text-xs text-slate-200 hover:bg-slate-700 flex items-center gap-2 cursor-pointer transition-colors"
                        >
                          {copyProfileCopied ? (
                            <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                          ) : (
                            <Copy className="w-4 h-4 text-slate-400 shrink-0" />
                          )}
                          <div>
                            <span className="block font-semibold">{copyProfileCopied ? "Copied!" : "Copy to Clipboard"}</span>
                            <span className="block text-[9px] text-slate-400 font-mono">Markdown content</span>
                          </div>
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Menu button for authenticated planners; hidden for shared read-only link */}
            {!isShareView ? (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setIsHeaderMenuOpen((open) => !open)}
                  className="rounded-xl border border-slate-200 bg-white p-2.5 text-slate-600 shadow-xs transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700"
                  aria-label="Open application menu"
                  aria-expanded={isHeaderMenuOpen}
                >
                  <Menu className="h-5 w-5" />
                </button>
                {isHeaderMenuOpen && (
                  <>
                    <button className="fixed inset-0 z-40 cursor-default" aria-label="Close application menu" onClick={() => setIsHeaderMenuOpen(false)} />
                    <div className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">
                      <div className="px-3 py-2 border-b border-slate-100 mb-1">
                        <p className="text-xs font-bold text-slate-800 truncate">{session?.name}</p>
                        <p className="text-[10px] text-slate-400">
                          {canEditSettings ? "Can edit global settings" : "Settings are read-only"}
                        </p>
                      </div>
                      <a
                        href="https://forms.gle/Ug9JjxKt9RSCFkJv6"
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => setIsHeaderMenuOpen(false)}
                        className="flex items-center justify-between w-full rounded-lg px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 transition-colors"
                      >
                        <span>Feedback</span>
                        <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
                      </a>
                      <button
                        type="button"
                        onClick={() => { setIsHeaderMenuOpen(false); setIsSettingsOpen(true); }}
                        className="w-full rounded-lg px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-indigo-50 hover:text-indigo-700"
                      >
                        {canEditSettings ? "Settings" : "View Settings"}
                      </button>
                      <button
                        type="button"
                        onClick={handleLogout}
                        className="w-full rounded-lg px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-rose-50 hover:text-rose-700"
                      >
                        Sign Out
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <SettingsDrawer
        open={isSettingsOpen}
        settings={planningSettings}
        ctvPublishers={ctvPublishers}
        onClose={() => { setIsSettingsOpen(false); setSettingsError(null); }}
        onSave={handleSavePlanningSettings}
        readOnly={!canEditSettings}
        saveError={settingsError}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-[1500px] w-full mx-auto p-4 md:p-6 flex flex-col lg:flex-row gap-6 items-start">
        {/* Left Column: Media Planner Inputs (350px fixed on lg) */}
        <section
          className="w-full lg:w-[350px] shrink-0 bg-white border border-slate-100 rounded-2xl shadow-xs sticky lg:top-24 flex flex-col overflow-hidden"
          // The chat needs the full height so its input sits at the bottom of the column.
          style={{ maxHeight: "calc(100vh - 120px)", ...(!isShareView && leftTab === "scout" ? { height: "calc(100vh - 120px)" } : {}) }}
        >
          {/* Tabs header: shown for authenticated planners, hidden on shared read-only link */}
          {!isShareView ? (
            <div className="flex border-b border-slate-100 p-4 pb-3 gap-1 shrink-0 bg-white">
              <button
                onClick={() => setLeftTab("brief")}
                className={`flex-1 flex items-center justify-center gap-1 py-2 px-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                  leftTab === "brief"
                    ? "bg-indigo-50 text-indigo-700 font-bold"
                    : "text-slate-500 hover:text-slate-800 hover:bg-slate-50"
                }`}
              >
                <Target className="w-3.5 h-3.5 shrink-0" />
                <span>Brief</span>
              </button>
              <button
                onClick={() => setLeftTab("saved")}
                className={`flex-1 flex items-center justify-center gap-1 py-2 px-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                  leftTab === "saved"
                    ? "bg-indigo-50 text-indigo-700 font-bold"
                    : "text-slate-500 hover:text-slate-800 hover:bg-slate-50"
                }`}
              >
                <History className="w-3.5 h-3.5 shrink-0" />
                <span>Saved</span>
              </button>
              {profileData && (
                <button
                  onClick={() => setLeftTab("overview")}
                  className={`flex-1 flex items-center justify-center gap-1 py-2 px-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                    leftTab === "overview"
                      ? "bg-indigo-50 text-indigo-700 font-bold"
                      : "text-slate-500 hover:text-slate-800 hover:bg-slate-50"
                  }`}
                >
                  <TrendingUp className="w-3.5 h-3.5 shrink-0" />
                  <span>Overview</span>
                </button>
              )}
              {profileData && (
                <button
                  onClick={() => setLeftTab("scout")}
                  title="Ask ScoutAI about this plan"
                  className={`relative flex-1 flex items-center justify-center gap-1 py-2 px-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                    leftTab === "scout"
                      ? "bg-indigo-50 text-indigo-700 font-bold"
                      : "text-slate-500 hover:text-indigo-700 hover:bg-indigo-50/60"
                  }`}
                >
                  <Sparkles className={`w-3.5 h-3.5 shrink-0 ${leftTab === "scout" ? "" : "text-indigo-500"}`} />
                  <span>ScoutAI</span>
                  {scoutUnread && leftTab !== "scout" && (
                    <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-indigo-500" aria-label="New reply" />
                  )}
                </button>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-between border-b border-slate-100 p-4 shrink-0 bg-white">
              <div className="flex items-center gap-2 text-indigo-700 font-bold text-xs uppercase tracking-wider">
                <TrendingUp className="w-4 h-4 text-indigo-600" />
                <span>Campaign Overview</span>
              </div>
              <span className="text-[10px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200/60 px-2 py-0.5 rounded-full flex items-center gap-1">
                <Sparkles className="w-2.5 h-2.5 text-indigo-500" />
                ScoutAI
              </span>
            </div>
          )}

          {!isShareView && leftTab === "brief" ? (
            <form onSubmit={(e) => handleGenerate(e)} className="flex flex-col flex-1 min-h-0">
              <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-4">
                <div className="flex items-center gap-2 mb-1">
                  <Target className="w-4 h-4 text-indigo-600" />
                  <h2 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Media Brief Parameters</h2>
                </div>

                <div className="flex bg-slate-100 p-1 rounded-xl gap-1 mb-2">
                  <button
                    type="button"
                    onClick={() => setBriefMode("text")}
                    className={`flex-1 text-center py-1.5 px-2 text-[11px] font-bold rounded-lg transition-all cursor-pointer ${
                      briefMode === "text"
                        ? "bg-white text-slate-800 shadow-xs"
                        : "text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    Text Brief
                  </button>
                  <button
                    type="button"
                    onClick={() => setBriefMode("upload")}
                    className={`flex-1 text-center py-1.5 px-2 text-[11px] font-bold rounded-lg transition-all cursor-pointer ${
                      briefMode === "upload"
                        ? "bg-white text-slate-800 shadow-xs"
                        : "text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    Upload
                  </button>
                </div>

                {briefMode === "text" ? (
                  /* Input 1: Audience Description */
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                      <FileText className="w-3.5 h-3.5 text-slate-400" />
                      Audience Description
                    </label>
                    <textarea
                      value={audienceDescription}
                      onChange={(e) => setAudienceDescription(e.target.value)}
                      placeholder="Describe your ideal audience (e.g. 'Luxury travelers', 'B2B IT decision-makers')"
                      className="w-full h-20 text-sm px-3 py-2 border border-slate-200 rounded-xl focus:outline-hidden focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all resize-none placeholder:text-slate-400"
                    />
                  </div>
                ) : (
                  /* Input 1b: Document / Media Plan Upload Card */
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                      <FileText className="w-3.5 h-3.5 text-slate-400" />
                      Upload Media Plan / RFP
                    </label>
                    <div className="relative border border-dashed border-slate-200 hover:border-indigo-400 bg-slate-50/50 hover:bg-slate-50 rounded-xl p-4 text-center cursor-pointer transition min-h-[110px] flex flex-col justify-center items-center group">
                      <input
                        ref={mediaPlanFileInputRef}
                        type="file"
                        accept=".pdf,.doc,.docx,.txt,.csv,.xlsx,.xls"
                        onChange={handleFileUpload}
                        className="absolute inset-0 opacity-0 cursor-pointer w-full h-full z-10"
                      />
                      <div className="flex flex-col items-center space-y-2">
                        <div className="w-8 h-8 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-600 group-hover:scale-110 transition-transform">
                          <Download className="w-4 h-4 transform rotate-180" />
                        </div>
                        {uploadedFileName ? (
                          <div className="space-y-1">
                            <div className="inline-flex items-center space-x-1.5 bg-emerald-50 border border-emerald-100 text-emerald-800 px-2.5 py-1 rounded-lg">
                              <span className="text-xs font-semibold truncate max-w-[200px]">{uploadedFileName}</span>
                            </div>
                            <p className="text-[10px] text-slate-400">Tap or drag to replace file</p>
                          </div>
                        ) : (
                          <div className="flex flex-col items-center space-y-1">
                            <span className="text-xs font-semibold text-slate-600">Drag & drop or tap to select file</span>
                            <span className="text-[10px] text-slate-400">Supports .pdf, .docx, .xlsx, .xls, .csv, .txt</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Ignore Cache Toggle & Re-run Control under Dropzone */}
                    <div className="mt-2.5 bg-slate-50 border border-slate-200/80 rounded-xl p-2.5 space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="flex items-center gap-2 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={ignoreCache}
                            onChange={(e) => setIgnoreCache(e.target.checked)}
                            className="w-3.5 h-3.5 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 cursor-pointer"
                          />
                          <span className="text-xs font-semibold text-slate-700">
                            Bypass / Ignore Cache
                          </span>
                        </label>
                        <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${
                          ignoreCache 
                            ? "bg-amber-100 text-amber-800 border border-amber-200" 
                            : "bg-slate-200/60 text-slate-500"
                        }`}>
                          {ignoreCache ? "Cache Off" : "Cache On"}
                        </span>
                      </div>

                      {uploadedFileName && lastUploadedFileRef.current && (
                        <div className="pt-1.5 border-t border-slate-200/60 flex items-center justify-between text-[10px]">
                          <span className="text-slate-500">
                            {ignoreCache ? "Cache disabled — file will re-parse" : "Uploads will use cached results"}
                          </span>
                          <button
                            type="button"
                            onClick={handleReRunAnalysis}
                            disabled={isParsingPlan}
                            className="font-bold text-indigo-600 hover:text-indigo-800 hover:underline flex items-center gap-1 cursor-pointer disabled:opacity-50"
                          >
                            <RefreshCw className={`w-3 h-3 ${isParsingPlan ? 'animate-spin' : ''}`} />
                            <span>Re-run Process</span>
                          </button>
                        </div>
                      )}
                    </div>

                    {uploadedFileName && (
                      <div className="mt-2.5 flex items-center justify-between">
                        <button
                          type="button"
                          onClick={() => {
                            setIsPreviewModalOpen(true);
                            setModalTab("ai");
                          }}
                          className="text-xs font-bold text-indigo-600 hover:text-indigo-800 hover:underline flex items-center gap-1 cursor-pointer"
                        >
                          <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
                          AI-Extracted Content & Analysis
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setUploadedFileName("");
                            setUploadedFileText("");
                            setParsedSheetsData([]);
                            setExtractedPlacements([]);
                            setRfpAnalysis(null);
                          }}
                          className="text-[10px] text-rose-600 hover:text-rose-800 hover:underline cursor-pointer"
                        >
                          Remove
                        </button>
                      </div>
                    )}

                    {/* Media Plan Parsing Status Spinner & Message */}
                    {isParsingPlan && (
                      <div className="mt-3 p-3.5 bg-indigo-50/90 border border-indigo-200/80 rounded-xl flex items-center gap-3 text-indigo-900 shadow-xs">
                        <Loader2 className="w-5 h-5 text-indigo-600 animate-spin shrink-0" />
                        <div>
                          <p className="text-xs font-bold leading-snug">Parsing and analyzing upload, this may take a minute or two.</p>
                          <p className="text-[10px] text-indigo-600/80 mt-0.5">Analyzing RFP document text, images/screenshots, capability asks, and media lines...</p>
                        </div>
                      </div>
                    )}

                    {/* Parsing Error Message */}
                    {parsingError && !isParsingPlan && (
                      <div className="mt-3 p-3 bg-rose-50 border border-rose-100 rounded-xl text-xs text-rose-700 flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                        <div>
                          <p className="font-semibold text-xs">Plan Parsing Error</p>
                          <p className="text-[11px] text-rose-600 mt-0.5">{parsingError}</p>
                        </div>
                      </div>
                    )}

                    {/* Media Plan Option Selector */}
                    {planOptions.length > 0 && !isParsingPlan && (
                      <div className="mt-4 space-y-3">
                        <MediaPlanSelector
                          filename={uploadedFileName}
                          planOptions={planOptions}
                          taxonomyMappings={taxonomyMappings}
                          onToggleOption={handleTogglePlanOption}
                          onToggleAll={handleToggleAllPlanOptions}
                          onOpenTaxonomyModal={() => setIsTaxonomyModalOpen(true)}
                        />
                      </div>
                    )}

                    {/* RFP Analysis & Grounded Capability Match Card */}
                    {rfpAnalysis && !isParsingPlan && (
                      <div className="mt-4 p-4 bg-slate-900 text-white rounded-xl border border-slate-800 shadow-md space-y-3.5">
                        <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                          <div className="flex items-center gap-2">
                            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                            <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                              RFP Analysis & Capability Mapping
                            </h4>
                          </div>
                          <span className="text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full border border-emerald-500/30">
                            Digital Remedy Grounded
                          </span>
                        </div>

                        {rfpAnalysis.rfpSummary && (
                          <div className="bg-slate-800/60 p-2.5 rounded-lg border border-slate-700/50 space-y-1">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Executive Summary</span>
                            <p className="text-xs text-slate-300 leading-relaxed">
                              {rfpAnalysis.rfpSummary}
                            </p>
                          </div>
                        )}

                        {/* Extracted Metadata Overview */}
                        {rfpAnalysis.extractedMetadata && (
                          <div className="bg-slate-800/40 p-2.5 rounded-lg border border-slate-700/40 space-y-2 text-xs">
                            <div className="flex items-center justify-between border-b border-slate-700/50 pb-1.5">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-300">Extracted Brief Parameters</span>
                              {rfpAnalysis.extractedMetadata.submissionDueDate && (
                                <span className="text-[10px] font-bold text-amber-300 bg-amber-950/60 px-2 py-0.5 rounded border border-amber-800/50">
                                  Due: {rfpAnalysis.extractedMetadata.submissionDueDate}
                                </span>
                              )}
                            </div>

                            <div className="grid grid-cols-1 gap-1.5 text-[11px]">
                              {rfpAnalysis.extractedMetadata.flightDates && (
                                <div>
                                  <span className="text-slate-400 font-semibold">Flight Dates: </span>
                                  <span className="text-slate-200 font-mono">{rfpAnalysis.extractedMetadata.flightDates}</span>
                                </div>
                              )}

                              {rfpAnalysis.extractedMetadata.targetAudiences && rfpAnalysis.extractedMetadata.targetAudiences.length > 0 && (
                                <div>
                                  <span className="text-slate-400 font-semibold block mb-0.5">Target Audiences:</span>
                                  <div className="flex flex-wrap gap-1">
                                    {rfpAnalysis.extractedMetadata.targetAudiences.map((aud, i) => (
                                      <span key={i} className="bg-indigo-950/80 text-indigo-200 border border-indigo-700/50 px-2 py-0.5 rounded text-[10px]">
                                        {aud}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {rfpAnalysis.extractedMetadata.geographies && rfpAnalysis.extractedMetadata.geographies.length > 0 && (
                                <div>
                                  <span className="text-slate-400 font-semibold block mb-0.5">Geographic Targeting:</span>
                                  <div className="flex flex-wrap gap-1">
                                    {rfpAnalysis.extractedMetadata.geographies.map((geo, i) => (
                                      <span key={i} className="bg-slate-800 text-slate-300 border border-slate-700 px-2 py-0.5 rounded text-[10px]">
                                        {geo}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {rfpAnalysis.extractedMetadata.paymentTerms && (
                                <div>
                                  <span className="text-slate-400 font-semibold">Terms: </span>
                                  <span className="text-slate-300">{rfpAnalysis.extractedMetadata.paymentTerms}</span>
                                </div>
                              )}

                              {rfpAnalysis.extractedMetadata.reportingRequirements && rfpAnalysis.extractedMetadata.reportingRequirements.length > 0 && (
                                <div>
                                  <span className="text-slate-400 font-semibold block mb-0.5">Reporting & Measurement:</span>
                                  <ul className="list-disc list-inside text-[10px] text-slate-300 space-y-0.5 pl-1">
                                    {rfpAnalysis.extractedMetadata.reportingRequirements.map((rep, i) => (
                                      <li key={i}>{rep}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {rfpAnalysis.digitalRemedyCapabilityMatches && rfpAnalysis.digitalRemedyCapabilityMatches.length > 0 && (
                          <div className="space-y-2 pt-1">
                            <h5 className="text-[11px] font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                              <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                              RFP Asks vs. Digital Remedy Capability Map
                            </h5>
                            <div className="space-y-2 max-h-60 overflow-y-auto pr-1 custom-scrollbar">
                              {rfpAnalysis.digitalRemedyCapabilityMatches.map((match, idx) => (
                                <div key={idx} className="bg-slate-800/80 p-2.5 rounded-lg border border-slate-700/80 text-xs space-y-1">
                                  <div className="flex items-start justify-between gap-2">
                                    <span className="font-semibold text-slate-200 text-[11px] leading-snug">
                                      Ask: {match.rfpAsk}
                                    </span>
                                    <span className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-700/50 flex items-center gap-1">
                                      <Check className="w-3 h-3 text-emerald-400" />
                                      {match.digitalRemedySolution}
                                    </span>
                                  </div>
                                  <p className="text-[11px] text-slate-400 leading-normal">
                                    {match.capabilityDetails}
                                  </p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Note when no explicit pre-existing placement lines are present */}
                        {extractedPlacements.length === 0 && (
                          <div className="bg-indigo-950/60 border border-indigo-500/30 p-2.5 rounded-lg text-[11px] text-indigo-200 flex items-start gap-2">
                            <Info className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
                            <span>
                              <strong>RFP Brief Mode:</strong> Document contains general guidelines and asks (no pre-existing media plan table). Digital Remedy's strategy engine will construct a custom channel plan based on these specs.
                            </span>
                          </div>
                        )}

                        <div className="pt-1 flex justify-end">
                          <button
                            type="button"
                            onClick={() => {
                              setIsPreviewModalOpen(true);
                              setModalTab("ai");
                            }}
                            className="text-xs font-bold text-emerald-400 hover:text-emerald-300 hover:underline flex items-center gap-1 cursor-pointer bg-slate-800/90 px-3 py-1.5 rounded-lg border border-slate-700"
                          >
                            <Eye className="w-3.5 h-3.5 text-emerald-400" />
                            <span>Inspect Full AI-Extracted Content & Analysis &rarr;</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Input 1.5: Advertiser Name Input */}
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                    <Building2 className="w-3.5 h-3.5 text-slate-400" />
                    Advertiser Name
                  </label>
                  <input
                    type="text"
                    value={advertiserName}
                    onChange={(e) => setAdvertiserName(e.target.value)}
                    placeholder="e.g. Acura, Nike, Digital Remedy (Optional)"
                    className="w-full text-sm px-3 py-2 border border-slate-200 rounded-xl focus:outline-hidden focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all placeholder:text-slate-400"
                  />
                </div>

                {/* Input 2: URL Input */}
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                    <Globe className="w-3.5 h-3.5 text-slate-400" />
                    Website URL {briefMode === "upload" && <span className="text-rose-500 font-bold">*</span>}
                  </label>
                  <input
                    type="text"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="Advertiser or product landing page URL"
                    className="w-full text-sm px-3 py-2 border border-slate-200 rounded-xl focus:outline-hidden focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all placeholder:text-slate-400"
                  />
                  <p className="text-[10px] text-slate-400 mt-1 leading-normal">
                    {briefMode === "upload" 
                      ? "Website URL is required for media plans so we can analyze and cross-reference the advertiser's site."
                      : "If provided, we will analyze the brand identity, price tier, and product category to tailor recommendations."}
                  </p>
                </div>

                {/* Input: Budget & Campaign Length */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                      <DollarSign className="w-3.5 h-3.5 text-slate-400" />
                      Budget
                    </label>
                    <input
                      type="text"
                      value={budget}
                      onChange={(e) => setBudget(e.target.value)}
                      placeholder="$100,000"
                      className="w-full text-sm px-3 py-2 border border-slate-200 rounded-xl focus:outline-hidden focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all placeholder:text-slate-400"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5 text-slate-400" />
                      Campaign Length
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        value={campaignLength}
                        onChange={(e) => setCampaignLength(e.target.value)}
                        placeholder="30"
                        className="w-full text-sm px-3 py-2 pr-14 border border-slate-200 rounded-xl focus:outline-hidden focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all placeholder:text-slate-400"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-400 pointer-events-none">
                        Days
                      </span>
                    </div>
                  </div>
                </div>
                <div className="rounded-xl border border-indigo-100 bg-indigo-50/70 p-3">
                  <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                    <div>
                      <span className="block text-[10px] font-bold uppercase tracking-wide text-slate-500">30-day normalized</span>
                      <span className="font-bold text-slate-900">${budgetNormalization.normalized30DayBudget.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                    </div>
                    <div>
                      <span className="block text-[10px] font-bold uppercase tracking-wide text-slate-500">Media-type cap</span>
                      <span className="font-bold text-indigo-700">{appliedBudgetTier.maxChannels}</span>
                    </div>
                  </div>
                  {internalOnlyVisibility.planningAssumptions && budgetNormalization.assumptions.map((assumption) => (
                    <p key={assumption} className="mt-2 text-[10px] leading-4 text-amber-700">{assumption}</p>
                  ))}
                </div>

                {/* Input 2.5: KPI (Goal) Inputs */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider flex items-center gap-1">
                      <Target className="w-3.5 h-3.5 text-slate-400" />
                      KPI (Goal)
                    </label>
                    <button
                      type="button"
                      onClick={handleAddKpi}
                      className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1 rounded-lg transition-colors cursor-pointer"
                      title="Add an additional KPI goal input"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add KPI</span>
                    </button>
                  </div>
                  <div className="space-y-2">
                    {kpis.map((kpi, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <input
                          type="text"
                          value={kpi}
                          onChange={(e) => handleKpiChange(index, e.target.value)}
                          placeholder={
                            index === 0
                              ? "e.g. CPA < $45, ROAS > 3.0, 80% VCR, Brand Awareness (Optional)"
                              : `KPI / Campaign Goal ${index + 1}`
                          }
                          className="w-full text-sm px-3 py-2 border border-slate-200 rounded-xl focus:outline-hidden focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all placeholder:text-slate-400"
                        />
                        {kpis.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveKpi(index)}
                            className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-colors shrink-0 cursor-pointer"
                            title="Remove this KPI input"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1 leading-normal">
                    Click <strong className="text-indigo-600">[+] Add KPI</strong> to define multiple target campaign goals or performance metrics.
                  </p>
                </div>

                {/* Geography & Goal */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                      <MapPin className="w-3.5 h-3.5 text-slate-400" />
                      Geography
                    </label>
                    <select
                      value={geographyType}
                      onChange={(e) => {
                        const nextType = e.target.value as GeographyType;
                        setGeographyType(nextType);
                        if (nextType === "National") {
                          setGeoTargets([]);
                          setGeoRawInput("");
                          setGeoUnrecognized([]);
                          setGeoUploadNotice(null);
                        }
                      }}
                      className="w-full text-xs px-2 py-2 border border-slate-200 bg-white rounded-xl focus:outline-hidden focus:border-indigo-500 cursor-pointer font-medium text-slate-700"
                    >
                      {geographyOptions.map((market) => (
                        <option key={market} value={market}>
                          {market === "United States" ? "National" : market}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                      <Target className="w-3.5 h-3.5 text-slate-400" />
                      Campaign Focus
                    </label>
                    <select
                      value={campaignFocus}
                      onChange={(e) => setCampaignFocus(e.target.value)}
                      className="w-full text-xs px-2 py-2 border border-slate-200 bg-white rounded-xl focus:outline-hidden focus:border-indigo-500 cursor-pointer font-medium text-slate-700"
                    >
                      <option value="CTV-first digital media plan">CTV-First</option>
                      <option value="Full-funnel digital media plan">Full-Funnel</option>
                      <option value="Display/social/video plan">Display & Social</option>
                    </select>
                  </div>
                </div>

                {/* Conditional Geo-Targeting Panel for State or DMA */}
                {(geographyType === "State" || geographyType === "DMA") && (
                  <div className="bg-slate-50/90 border border-slate-200/90 rounded-2xl p-3.5 space-y-3 transition-all">
                    {/* Panel Header */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-xs">
                          {geographyType === "State" ? "ST" : "DMA"}
                        </span>
                        <div>
                          <h4 className="text-xs font-bold text-slate-700">
                            {geographyType === "State" ? "Target States" : "Target Designated Market Areas (DMAs)"}
                          </h4>
                          <p className="text-[10px] text-slate-400">
                            {geographyType === "State"
                              ? "Type state names or 2-letter codes, or upload a CSV / XLSX list."
                              : "Type Nielsen DMA names or codes, or upload a CSV / XLSX list."}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-white border border-slate-200 text-slate-700 shadow-2xs">
                          {geoTargets.length} {geographyType === "State" ? (geoTargets.length === 1 ? "State" : "States") : (geoTargets.length === 1 ? "DMA" : "DMAs")}
                        </span>
                        {geoTargets.length > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              setGeoTargets([]);
                              setGeoRawInput("");
                              setGeoUnrecognized([]);
                              setGeoUploadNotice(null);
                            }}
                            className="text-[10px] text-slate-400 hover:text-rose-600 hover:underline cursor-pointer font-medium"
                          >
                            Clear all
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Comma-separated Text Input */}
                    <div>
                      <textarea
                        value={geoRawInput}
                        onChange={(e) => setGeoRawInput(e.target.value)}
                        onBlur={handleApplyGeoRawInput}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            handleApplyGeoRawInput();
                          }
                        }}
                        placeholder={
                          geographyType === "State"
                            ? "Type or paste comma-separated states (e.g. CA, NY, TX, Florida, Washington)..."
                            : "Type or paste comma-separated DMAs (e.g. New York, Los Angeles, Chicago, Atlanta, DFW)..."
                        }
                        className="w-full h-16 text-xs px-3 py-2 border border-slate-200 bg-white rounded-xl focus:outline-hidden focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all resize-none placeholder:text-slate-400"
                      />
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-[10px] text-slate-400">
                          Press <kbd className="px-1 py-0.5 bg-slate-100 border border-slate-200 rounded text-[9px] font-mono">Enter</kbd> or click Apply to add
                        </span>
                        <button
                          type="button"
                          onClick={handleApplyGeoRawInput}
                          disabled={!geoRawInput.trim()}
                          className="text-[10px] font-semibold px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 text-white rounded-lg transition-colors cursor-pointer"
                        >
                          + Add Targets
                        </button>
                      </div>
                    </div>

                    {/* CSV / XLSX File Upload Dropzone */}
                    <div
                      onDragOver={(e) => {
                        e.preventDefault();
                        setIsGeoFileDragging(true);
                      }}
                      onDragLeave={() => setIsGeoFileDragging(false)}
                      onDrop={handleGeoFileDrop}
                      onClick={() => geoFileInputRef.current?.click()}
                      className={`border border-dashed rounded-xl p-3 text-center cursor-pointer transition-all ${
                        isGeoFileDragging
                          ? "border-indigo-500 bg-indigo-50/50"
                          : "border-slate-200 bg-white/80 hover:bg-white hover:border-slate-300"
                      }`}
                    >
                      <input
                        ref={geoFileInputRef}
                        type="file"
                        accept=".csv, .xlsx, .xls"
                        onChange={handleGeoFileInputChange}
                        className="hidden"
                      />
                      <div className="flex items-center justify-center gap-2 text-slate-600">
                        <Upload className="w-3.5 h-3.5 text-indigo-600" />
                        <span className="text-xs font-medium">
                          Drop CSV or XLSX file here, or <span className="text-indigo-600 underline">browse</span>
                        </span>
                      </div>
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        Auto-detects {geographyType === "State" ? "State names & postal codes" : "Nielsen DMA names & codes"}
                      </p>
                    </div>

                    {/* Upload Notification */}
                    {geoUploadNotice && (
                      <div className="p-2 bg-indigo-50/80 border border-indigo-100 rounded-xl text-[11px] text-indigo-800 flex items-start gap-1.5">
                        <CheckCircle className="w-3.5 h-3.5 text-indigo-600 shrink-0 mt-0.5" />
                        <span className="flex-1">{geoUploadNotice}</span>
                        <button
                          type="button"
                          onClick={() => setGeoUploadNotice(null)}
                          className="text-indigo-400 hover:text-indigo-700"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    )}

                    {/* Unrecognized Tokens Alert */}
                    {geoUnrecognized.length > 0 && (
                      <div className="p-2.5 bg-amber-50 border border-amber-200/80 rounded-xl text-[10px] text-amber-800 flex items-start gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                        <div className="flex-1">
                          <p className="font-semibold">Unrecognized entries ({geoUnrecognized.length}):</p>
                          <p className="mt-0.5 font-mono text-[9px] text-amber-700">
                            {geoUnrecognized.slice(0, 5).join(", ")}
                            {geoUnrecognized.length > 5 ? ` +${geoUnrecognized.length - 5} more` : ""}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setGeoUnrecognized([])}
                          className="text-amber-500 hover:text-amber-800"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    )}

                    {/* Selected Targets Chip List */}
                    {geoTargets.length > 0 && (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-[10px] text-slate-500 font-medium">
                          <span>Active Target List ({geoTargets.length})</span>
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(geoTargets.join(", "));
                              setGeoCopiedNotice(true);
                              setTimeout(() => setGeoCopiedNotice(false), 2000);
                            }}
                            className="text-indigo-600 hover:underline cursor-pointer flex items-center gap-1 font-medium"
                          >
                            <Copy className="w-3 h-3" />
                            {geoCopiedNotice ? "Copied!" : "Copy list"}
                          </button>
                        </div>
                        <div className="max-h-28 overflow-y-auto custom-scrollbar flex flex-wrap gap-1.5 p-2 bg-white rounded-xl border border-slate-200/80">
                          {geoTargets.map((target) => (
                            <span
                              key={target}
                              className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 bg-indigo-50 border border-indigo-100/80 text-indigo-700 rounded-md font-medium"
                            >
                              {target}
                              <button
                                type="button"
                                onClick={() => handleRemoveGeoTarget(target)}
                                className="text-indigo-400 hover:text-rose-600 hover:bg-rose-50 rounded p-0.5 transition-colors cursor-pointer"
                                title={`Remove ${target}`}
                              >
                                <X className="w-2.5 h-2.5" />
                              </button>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Market Budget Density & Fragmentation Advisory */}
                    {geoTargets.length > 0 && parseCurrencyInput(budget) > 0 && (
                      <div className="pt-1">
                        <div className="flex items-center justify-between text-[11px] px-3 py-2 bg-indigo-50/50 rounded-xl border border-indigo-100/60 text-slate-700">
                          <span className="font-medium text-slate-600">Est. Budget per Market</span>
                          <span className="font-bold text-indigo-700 font-mono">
                            ~${Math.round((parseCurrencyInput(budget) || 0) / geoTargets.length).toLocaleString()} / {geographyType === "State" ? "state" : "DMA"}
                          </span>
                        </div>

                        {Math.round((parseCurrencyInput(budget) || 0) / geoTargets.length) < 500 && (
                          <div className="mt-2 p-2.5 bg-amber-50 border border-amber-200/80 rounded-xl text-[10px] text-amber-800 flex items-start gap-1.5">
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                            <span>
                              <strong>Market Fragmentation Advisory:</strong> Targeting {geoTargets.length} {geographyType === "State" ? "states" : "DMAs"} with this budget averages less than $500/market. Consider prioritizing top markets to ensure sufficient reach and frequency capping.
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Input 3: Additional Context */}
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                    <Info className="w-3.5 h-3.5 text-slate-400" />
                    Additional Context
                  </label>
                  <textarea
                    value={additionalContext}
                    onChange={(e) => setAdditionalContext(e.target.value)}
                    placeholder="e.g. 'Advertiser sells premium gaming accessories', 'Avoid unsupported assumptions', 'Target age 25-54'"
                    className="w-full h-20 text-sm px-3 py-2 border border-slate-200 rounded-xl focus:outline-hidden focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all resize-none placeholder:text-slate-400"
                  />
                </div>

                {/* Advanced: Target Specific Personas */}
                <div className="pt-0.5">
                  <div className="flex items-center justify-between">
                    <button
                      type="button"
                      id="btn-toggle-advanced-personas"
                      onClick={() => setIsAdvancedPersonaOpen(!isAdvancedPersonaOpen)}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition-colors py-1 group"
                    >
                      <ChevronRight className={`w-3.5 h-3.5 text-indigo-500 transition-transform duration-200 ${isAdvancedPersonaOpen ? 'rotate-90' : ''}`} />
                      <span>Advanced</span>
                      {targetPersonas.filter(p => p.trim().length > 0).length > 0 && !isAdvancedPersonaOpen && (
                        <span className="ml-1 text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-indigo-100 text-indigo-700 font-bold border border-indigo-200">
                          {targetPersonas.filter(p => p.trim().length > 0).length}/4 set
                        </span>
                      )}
                    </button>
                    {isAdvancedPersonaOpen && targetPersonas.some(p => p.trim().length > 0) && (
                      <button
                        type="button"
                        id="btn-clear-target-personas"
                        onClick={() => setTargetPersonas(["", "", "", ""])}
                        className="text-[11px] font-medium text-slate-400 hover:text-rose-600 transition-colors"
                      >
                        Clear personas
                      </button>
                    )}
                  </div>

                  {isAdvancedPersonaOpen && (
                    <div className="mt-2.5 p-3.5 bg-slate-50/80 border border-slate-200/90 rounded-xl space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-1.5">
                            <Users className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                            <h4 className="text-xs font-semibold text-slate-800">Target Specific Personas</h4>
                          </div>
                          <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                            Define up to 4 exact archetypes for ScoutAI to adopt. If fewer than 4 are provided, ScoutAI will generate complementary expansion personas.
                          </p>
                        </div>
                        <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-md bg-white border border-slate-200 text-slate-600 shrink-0">
                          {targetPersonas.filter(p => p.trim().length > 0).length} of 4 defined
                        </span>
                      </div>

                      <div className="space-y-2 pt-1">
                        {[0, 1, 2, 3].map((slotIdx) => {
                          const isFilled = targetPersonas[slotIdx]?.trim().length > 0;
                          return (
                            <div key={slotIdx} className="space-y-1">
                              <div className="flex items-center justify-between">
                                <label className="text-[11px] font-medium text-slate-600 flex items-center gap-1.5">
                                  <span className="w-4 h-4 rounded-full bg-white border border-slate-200 text-slate-600 text-[10px] font-mono font-bold inline-flex items-center justify-center shadow-xs">
                                    {slotIdx + 1}
                                  </span>
                                  <span>Persona {slotIdx + 1}</span>
                                  {isFilled ? (
                                    <span className="text-[9px] uppercase font-mono font-bold tracking-wider text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.2 rounded">
                                      User Target
                                    </span>
                                  ) : (
                                    <span className="text-[9px] uppercase font-mono text-slate-400">
                                      AI Auto-Generated
                                    </span>
                                  )}
                                </label>
                                {isFilled && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const updated = [...targetPersonas];
                                      updated[slotIdx] = "";
                                      setTargetPersonas(updated);
                                    }}
                                    className="text-[10px] text-slate-400 hover:text-rose-600 transition-colors"
                                  >
                                    Clear
                                  </button>
                                )}
                              </div>
                              <input
                                type="text"
                                id={`input-target-persona-${slotIdx + 1}`}
                                value={targetPersonas[slotIdx] || ""}
                                onChange={(e) => {
                                  const updated = [...targetPersonas];
                                  updated[slotIdx] = e.target.value;
                                  setTargetPersonas(updated);
                                }}
                                placeholder={
                                  slotIdx === 0
                                    ? "e.g. Competitive Esports Enthusiast"
                                    : slotIdx === 1
                                    ? "e.g. Weekend Streamer & Content Creator"
                                    : slotIdx === 2
                                    ? "e.g. Budget-Conscious Casual Gamer"
                                    : "e.g. High-Income Audio Tech Early Adopter"
                                }
                                className="w-full text-xs px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg focus:outline-hidden focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all placeholder:text-slate-400"
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* Error Message */}
                {error && (
                  <div className="p-3 bg-rose-50 border border-rose-100 rounded-xl text-xs text-rose-700 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                )}
              </div>

              {/* Fixed Bottom Submit Button Container */}
              <div className="p-4 pt-3 bg-white border-t border-slate-100 shrink-0 shadow-[0_-4px_12px_rgba(0,0,0,0.03)] z-10">
                <label className="flex items-start gap-2 mb-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={quickMode}
                    onChange={(e) => setQuickMode(e.target.checked)}
                    disabled={loading}
                    className="mt-0.5 w-3.5 h-3.5 accent-indigo-600 cursor-pointer"
                  />
                  <span className="text-[11px] leading-snug text-slate-600">
                    <span className="font-semibold text-slate-800">Quick mode</span>
                    <span className="block text-[10px] text-slate-400">For live demos: skips the QA audit (about 4-6 min faster). Run QA Audit before sharing with a client.</span>
                  </span>
                </label>
                <button
                  type="submit"
                  disabled={
                    loading || 
                    (briefMode === "upload" && (
                      isParsingPlan || 
                      !uploadedFileName || 
                      (!uploadedFileText && !rfpAnalysis && extractedPlacements.length === 0)
                    ))
                  }
                  className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:border disabled:border-slate-300 disabled:shadow-none disabled:cursor-not-allowed text-white font-semibold py-3 px-4 rounded-xl shadow-xs hover:shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer text-xs uppercase tracking-wider"
                >
                  {loading && !regenType ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Processing Analysis...</span>
                    </>
                  ) : isParsingPlan ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Parsing Uploaded Plan...</span>
                    </>
                  ) : briefMode === "upload" && !uploadedFileText && !rfpAnalysis && extractedPlacements.length === 0 && uploadedFileName ? (
                    <>
                      <Sparkles className="w-4 h-4" />
                      <span>Awaiting Parsed Plan...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      <span>
                        {briefMode === "upload" || extractedPlacements.length > 0
                          ? "Run Analysis"
                          : "Generate Plan"}
                      </span>
                    </>
                  )}
                </button>
              </div>
            </form>
          ) : !isShareView && leftTab === "saved" ? (
            <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Shared Plans</h3>
                  <p className="text-[10px] text-slate-400 mt-0.5">Visible to everyone on the team</p>
                </div>
                <button
                  onClick={() => refreshPlans()}
                  disabled={isLoadingPlans}
                  className="text-[10px] text-slate-500 hover:text-indigo-600 font-medium hover:underline cursor-pointer flex items-center gap-1 disabled:opacity-50"
                  title="Reload the shared plan list"
                >
                  <RefreshCw className={`w-3 h-3 ${isLoadingPlans ? "animate-spin" : ""}`} />
                  Refresh
                </button>
              </div>

              {migrationNotice && (
                <div className="bg-emerald-50 border border-emerald-100 text-emerald-800 p-2.5 rounded-xl text-[11px] font-medium flex items-start gap-2">
                  <CheckCircle className="w-3.5 h-3.5 shrink-0 mt-px" />
                  <span className="flex-1">{migrationNotice}</span>
                  <button onClick={() => setMigrationNotice(null)} className="text-emerald-600 hover:text-emerald-900 shrink-0">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )}

              {plansError && (
                <div className="bg-rose-50 border border-rose-100 text-rose-700 p-2.5 rounded-xl text-[11px] font-medium flex items-start gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
                  <span>{plansError}</span>
                </div>
              )}

              {isLoadingPlans && planSummaries.length === 0 ? (
                <div className="text-center py-8 px-4 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                  <Loader2 className="w-6 h-6 text-slate-300 mx-auto mb-2 animate-spin" />
                  <p className="text-xs font-semibold text-slate-500">Loading shared plans...</p>
                </div>
              ) : planSummaries.length === 0 ? (
                <div className="text-center py-8 px-4 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                  <Bookmark className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                  <p className="text-xs font-semibold text-slate-600">No Shared Plans Yet</p>
                  <p className="text-[11px] text-slate-400 mt-1 max-w-[200px] mx-auto leading-normal">
                    Generate an audience profile, then click <strong className="text-indigo-600 font-semibold">Save Profile</strong> in the actions bar. Everyone on the team will see it.
                  </p>
                  <button
                    onClick={() => setLeftTab("brief")}
                    className="mt-3.5 inline-flex items-center gap-1 text-[11px] font-bold text-indigo-600 hover:text-indigo-800 hover:underline cursor-pointer"
                  >
                    Go write a brief <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <div className="space-y-3 pr-1">
                  {/* Search and User Filter Controls */}
                  <div className="space-y-2 pb-1">
                    {/* Search Input */}
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="text"
                        value={savedSearchQuery}
                        onChange={(e) => setSavedSearchQuery(e.target.value)}
                        placeholder="Search plans (type 3+ chars)..."
                        className="w-full text-xs pl-8 pr-7 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-hidden focus:border-indigo-500 focus:bg-white focus:ring-1 focus:ring-indigo-500/20 transition-all"
                      />
                      {savedSearchQuery && (
                        <button
                          type="button"
                          onClick={() => setSavedSearchQuery("")}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 rounded cursor-pointer"
                          title="Clear search"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>

                    {/* Filter by User's Name */}
                    <div className="flex items-center gap-1.5">
                      <div className="relative flex-1">
                        <User className="w-3 h-3 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <select
                          value={savedUserFilter}
                          onChange={(e) => setSavedUserFilter(e.target.value)}
                          className="w-full text-xs pl-7 pr-6 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-700 focus:outline-hidden focus:border-indigo-500 focus:bg-white focus:ring-1 focus:ring-indigo-500/20 transition-all appearance-none cursor-pointer"
                          title="Filter plans by creator or editor"
                        >
                          <option value="ALL">All Users</option>
                          {savedPlanUsers.map((userName) => (
                            <option key={userName} value={userName}>
                              {userName}
                            </option>
                          ))}
                        </select>
                        <ChevronDown className="w-3 h-3 text-slate-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                      </div>

                      {(savedUserFilter !== "ALL" || savedSearchQuery.trim().length > 2) && (
                        <button
                          type="button"
                          onClick={() => {
                            setSavedSearchQuery("");
                            setSavedUserFilter("ALL");
                          }}
                          className="text-[10px] text-slate-500 hover:text-indigo-600 font-medium px-2 py-1.5 rounded-lg bg-slate-100 hover:bg-indigo-50 transition-colors shrink-0 cursor-pointer"
                          title="Reset all filters"
                        >
                          Reset
                        </button>
                      )}
                    </div>

                    {/* Count indicator & 3+ char hint */}
                    <div className="flex items-center justify-between text-[10px] text-slate-400 px-0.5">
                      <span>
                        {filteredPlanSummaries.length} of {planSummaries.length} {planSummaries.length === 1 ? "plan" : "plans"}
                      </span>
                      {savedSearchQuery.trim().length > 0 && savedSearchQuery.trim().length <= 2 && (
                        <span className="text-amber-500/90 text-[10px] font-medium">
                          Type {3 - savedSearchQuery.trim().length} more char{savedSearchQuery.trim().length === 2 ? "" : "s"} to search
                        </span>
                      )}
                    </div>
                  </div>

                  {filteredPlanSummaries.length === 0 ? (
                    <div className="text-center py-6 px-3 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                      <Search className="w-6 h-6 text-slate-300 mx-auto mb-1.5" />
                      <p className="text-xs font-semibold text-slate-600">No matching plans</p>
                      <p className="text-[10px] text-slate-400 mt-0.5 max-w-[200px] mx-auto leading-normal">
                        {savedUserFilter !== "ALL" && savedSearchQuery.trim().length > 2
                          ? `No plans matching "${savedSearchQuery.trim()}" for user "${savedUserFilter}".`
                          : savedUserFilter !== "ALL"
                          ? `No plans found for user "${savedUserFilter}".`
                          : `No plans matching "${savedSearchQuery.trim()}".`}
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setSavedSearchQuery("");
                          setSavedUserFilter("ALL");
                        }}
                        className="mt-2.5 inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 cursor-pointer"
                      >
                        Clear filters
                      </button>
                    </div>
                  ) : (
                    filteredPlanSummaries.map((saved) => (
                      <div
                        key={saved.id}
                        onClick={() => loadingPlanId === null && handleLoadSavedProfile(saved)}
                        className={`group p-3.5 rounded-xl border transition-all cursor-pointer text-left relative ${
                          activeSavedId === saved.id
                            ? "bg-indigo-50/40 border-indigo-200 ring-2 ring-indigo-50"
                            : "bg-white border-slate-100 hover:border-slate-200 hover:shadow-xs"
                        }`}
                      >
                        {/* Saved Header with Renaming Option */}
                        <div className="flex items-start justify-between gap-2 mb-1.5">
                          {editingId === saved.id ? (
                            <div className="flex items-center gap-1.5 w-full" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="text"
                                value={editingTitle}
                                onChange={(e) => setEditingTitle(e.target.value)}
                                className="text-xs font-bold text-slate-800 border border-slate-300 rounded px-1.5 py-0.5 w-full focus:outline-hidden focus:border-indigo-500 bg-white"
                                autoFocus
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") handleSaveRename(saved.id, e as any);
                                  if (e.key === "Escape") setEditingId(null);
                                }}
                              />
                              <button
                                type="button"
                                onClick={(e) => handleSaveRename(saved.id, e)}
                                className="p-1 px-1.5 shrink-0 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white transition-colors shadow-xs flex items-center justify-center cursor-pointer"
                                title="Save Title"
                                aria-label="Save Title"
                              >
                                <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingId(null);
                                }}
                                className="text-slate-400 hover:text-slate-600 p-1 shrink-0 rounded-md hover:bg-slate-100 transition-colors cursor-pointer"
                                title="Cancel"
                                aria-label="Cancel"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-start gap-1 pr-14 min-w-0 flex-1">
                              <h4 className="text-xs font-bold text-slate-800 group-hover:text-indigo-900 leading-snug line-clamp-2">
                                {saved.title}
                              </h4>
                              <button
                                type="button"
                                onClick={(e) => handleStartRename(saved.id, saved.title, e)}
                                className="p-1 -mt-0.5 text-slate-400 hover:text-indigo-600 hover:bg-slate-100 rounded-md transition-colors shrink-0 opacity-0 group-hover:opacity-100 focus:opacity-100 cursor-pointer"
                                title="Rename Plan"
                              >
                                <Edit3 className="w-3 h-3" />
                              </button>
                            </div>
                          )}

                          {/* Top-Right Action Row (Share / Clone / Delete) */}
                          {editingId !== saved.id && (
                          <div className="absolute top-3 right-3 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setShareModalPlan({
                                  id: saved.id,
                                  title: saved.title,
                                  shareToken: saved.shareToken,
                                  isShared: saved.isShared,
                                });
                                setIsShareModalOpen(true);
                              }}
                              className={`p-1 rounded-md transition-colors cursor-pointer ${
                                saved.isShared
                                  ? "text-indigo-600 hover:bg-indigo-50"
                                  : "text-slate-400 hover:text-indigo-600 hover:bg-slate-50"
                              }`}
                              title={saved.isShared ? "Manage Share Link" : "Create Share Link"}
                            >
                              <Share2 className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setCloneModalPlan({
                                  id: saved.id,
                                  title: saved.title,
                                });
                                setIsCloneModalOpen(true);
                              }}
                              className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-slate-50 rounded-md transition-colors cursor-pointer"
                              title="Clone Plan"
                            >
                              <Copy className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => handleDeleteSavedProfile(saved, e)}
                              className="p-1 text-slate-400 hover:text-rose-600 hover:bg-slate-50 rounded-md transition-colors cursor-pointer"
                              title="Delete Plan"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          )}
                        </div>

                      {/* Audience brief snippets */}
                      <p className="text-[10px] text-slate-400 line-clamp-2 leading-relaxed mb-2">
                        {saved.audienceDescription || "No description brief"}
                      </p>

                      {/* Metadata badges */}
                      <div className="flex flex-wrap items-center gap-1.5 text-[9px] font-semibold text-slate-500">
                        {saved.isShared && (
                          <span className="bg-indigo-50 text-indigo-700 border border-indigo-200 px-1.5 py-0.5 rounded font-mono text-[9px] flex items-center gap-1">
                            <Share2 className="w-2.5 h-2.5" />
                            Shared
                          </span>
                        )}
                        {saved.geography && (
                          <span className="bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded uppercase font-mono">
                            {saved.geography}
                          </span>
                        )}
                        {saved.campaignFocus && (
                          <span className="bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded truncate max-w-[110px]">
                            {saved.campaignFocus.split(" ")[0]}
                          </span>
                        )}
                        {saved.url && (
                          <span className="bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded truncate max-w-[100px]" title={saved.url}>
                            {saved.url.replace(/^https?:\/\/(www\.)?/, "")}
                          </span>
                        )}
                      </div>

                      {/* Saved Timestamp */}
                      <div className="mt-2 pt-2 border-t border-slate-50 flex items-center justify-between gap-2 text-[8px] text-slate-400 font-mono">
                        <span className="flex items-center gap-1 truncate" title={`Created by ${saved.createdBy} - last saved by ${saved.updatedBy}`}>
                          <Calendar className="w-2.5 h-2.5 shrink-0" />
                          <span className="truncate">
                            {new Date(saved.updatedAt).toLocaleString()} &middot; {saved.updatedBy}
                          </span>
                        </span>
                        {loadingPlanId === saved.id ? (
                          <Loader2 className="w-2.5 h-2.5 animate-spin text-indigo-600 shrink-0" />
                        ) : activeSavedId === saved.id ? (
                          <span className="text-indigo-600 font-bold uppercase tracking-wider shrink-0">Active</span>
                        ) : null}
                      </div>
                    </div>
                  ))
                )}
                </div>
              )}
            </div>
          ) : (isShareView || leftTab === "overview") && profileData ? (
            <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
              <ErrorBoundary resetKey={profileData} fallback={(error, retry) => <PlanRenderError error={error} retry={retry} draftSaved={Boolean(activeSavedId)} />}>
                <OverviewMetricsTab
                  extractedPlacements={extractedPlacements}
                  planOptions={planOptions}
                  rfpAnalysis={rfpAnalysis}
                  profileData={profileData}
                  metricSettings={planningSettings.overviewMetrics}
                  hideHeader={isShareView}
                />
              </ErrorBoundary>
            </div>
          ) : null}

          {/* Kept mounted while hidden so the conversation survives switching tabs. */}
          {!isShareView && profileData && (
            <div className={leftTab === "scout" ? "flex-1 min-h-0 flex flex-col" : "hidden"}>
              {activeSavedId ? (
                <ScoutAssistantPanel
                  key={activeSavedId}
                  planId={activeSavedId}
                  advertiserName={advertiserName || planSummaries.find((p) => p.id === activeSavedId)?.advertiserName || ""}
                  profile={profileData}
                  revision={activePlanRevision}
                  revisionBump={scoutRevisionBump}
                  hasUnsavedChanges={scoutHasUnsavedChanges}
                  isVisible={leftTab === "scout"}
                  isBriefStale={isBriefStale}
                  hasAudit={Boolean(profileData.auditResult && !profileData.auditResult.quickMode)}
                  onApplied={handleScoutApplied}
                  onFollowUp={handleScoutFollowUp}
                  onUnread={setScoutUnread}
                  preview={scoutPreview}
                  onPreview={setScoutPreview}
                />
              ) : (
                <div className="p-6 text-center text-xs text-slate-500">
                  <Sparkles className="w-5 h-5 text-indigo-400 mx-auto mb-2" />
                  Save this plan to chat with ScoutAI about it.
                </div>
              )}
            </div>
          )}
        </section>

        {/* Right Column: Output / Workspace Workspace (fluid width) */}
        <section
          id="profile-workspace"
          className="flex-1 w-full min-w-0 space-y-6 flex flex-col"
          style={{ minHeight: "calc(100vh - 120px)" }}
        >
          <ErrorBoundary resetKey={profileData} fallback={(error, retry) => <PlanRenderError error={error} retry={retry} draftSaved={Boolean(activeSavedId)} />}>
          {/* The workspace is drawn inside RenderBelow so its errors happen below the boundary;
              an error in App's own render would skip it and take down the whole page. */}
          <RenderBelow>{() => (<>
          {/* Loading Overlay State */}
          {loading && (
            <div
              className="bg-slate-950 border border-slate-800 text-slate-100 rounded-2xl p-6 md:p-8 shadow-2xl flex flex-col gap-6 flex-1"
              style={{ minHeight: "calc(100vh - 120px)" }}
            >
              {/* Header block of console */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-800 pb-4 gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-indigo-400 text-xs font-mono font-bold uppercase tracking-widest">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
                    </span>
                    <span>Grounding Engine: Active</span>
                  </div>
                  <h3 className="text-lg font-display font-bold text-white tracking-tight">
                    {regenType === "stricter_sourcing" 
                      ? "Recalibrating Sourcing Integrity..." 
                      : regenType === "more_strategic" 
                      ? "Refining Tactical Media Allocations..." 
                      : "Media Plan Agent"}
                  </h3>
                  <p className="text-xs text-slate-400 font-mono">
                    Analyzing historical data, querying syndicated databases, mapping consumer signals and synthesizing
                  </p>
                </div>

                <div className="flex items-center gap-3 bg-slate-900 border border-slate-800 px-4 py-2.5 rounded-xl self-start sm:self-center">
                  <Loader2 className="w-4 h-4 text-indigo-400 animate-spin" />
                  <div className="text-left">
                    <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider font-mono">Status</span>
                    <span className="block text-xs font-bold text-slate-200">
                      {researchLogs[0]?.message || (researchLogs[0]?.label ? `Research: ${researchLogs[0].label}` : "Analyzing target...")}
                    </span>
                  </div>
                </div>
              </div>

              {/* Progress Stepper Indicator */}
              <div className="grid grid-cols-5 gap-2 text-center text-[10px] font-mono border-b border-slate-900 pb-4 font-semibold text-slate-400">
                <div className={`p-2 rounded-lg border transition-all ${
                  researchLogs.some(log => log.message?.includes("Crawl") || log.message?.includes("website")) 
                    ? "bg-indigo-950/35 border-indigo-800 text-indigo-200 shadow-sm shadow-indigo-500/10" 
                    : "border-slate-900 text-slate-600"
                }`}>
                  1. Brand Crawl
                </div>
                <div className={`p-2 rounded-lg border transition-all ${
                  researchLogs.some(log => log.label === "Demographics" || log.label === "Digital Touchpoints") 
                    ? "bg-indigo-950/35 border-indigo-800 text-indigo-200 shadow-sm shadow-indigo-500/10" 
                    : "border-slate-900 text-slate-600"
                }`}>
                  2. Sector Search
                </div>
                <div className={`p-2 rounded-lg border transition-all ${
                  researchLogs.some(log => log.label === "CTV & Devices" || log.label === "Temporal & Purchase") 
                    ? "bg-indigo-950/35 border-indigo-800 text-indigo-200 shadow-sm shadow-indigo-500/10" 
                    : "border-slate-900 text-slate-600"
                }`}>
                  3. Device Analysis
                </div>
                <div className={`p-2 rounded-lg border transition-all ${
                  researchLogs.some(log => log.message?.includes("Synthesizing") || log.message?.includes("Synthesis")) 
                    ? "bg-indigo-950/35 border-indigo-800 text-indigo-200 shadow-sm shadow-indigo-500/10" 
                    : "border-slate-900 text-slate-600"
                }`}>
                  4. AI Synthesis
                </div>
                <div className={`p-2 rounded-lg border transition-all ${
                  researchLogs.some(log => log.message?.toLowerCase().includes("validation") || log.message?.toLowerCase().includes("qa audit") || log.message?.toLowerCase().includes("sanity check") || log.message?.toLowerCase().includes("audit") || log.message?.toLowerCase().includes("adjustments")) 
                    ? "bg-emerald-950/35 border-emerald-800 text-emerald-200 shadow-sm shadow-emerald-500/10" 
                    : "border-slate-900 text-slate-600"
                }`}>
                  5. QA Validation
                </div>
              </div>

              {/* Live activity log container */}
              <div 
                ref={logContainerRef}
                onMouseEnter={() => {
                  isLogHoveredRef.current = true;
                  setIsLogHovered(true);
                }}
                onMouseLeave={() => {
                  isLogHoveredRef.current = false;
                  setIsLogHovered(false);
                  if (logContainerRef.current) {
                    logContainerRef.current.scrollTop = 0;
                  }
                }}
                className="relative flex-1 bg-slate-900/60 border border-slate-800/80 rounded-xl p-4 md:p-5 font-mono text-xs overflow-y-auto min-h-[300px] space-y-4 custom-scrollbar"
              >
                {isLogHovered && (
                  <div className="sticky top-0 z-20 flex justify-center -mt-1 mb-2 pointer-events-none">
                    <span className="bg-slate-950/90 text-amber-300 border border-amber-500/30 text-[10px] px-2.5 py-0.5 rounded-full shadow-md backdrop-blur-xs flex items-center gap-1.5 font-sans font-medium">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                      Auto-scroll paused while hovering
                    </span>
                  </div>
                )}
                {researchLogs.length === 0 && (
                  <div className="text-slate-500 text-center py-12 italic">
                    Establishing connection to search grounding channels...
                  </div>
                )}
                
                {researchLogs.map((log, index) => (
                  <div 
                    key={log.id} 
                    className="space-y-2 border-b border-slate-800/40 pb-3 last:border-0 last:pb-0"
                  >
                    {/* Timestamp & Type header */}
                    <div className="flex items-center justify-between text-[10px] text-slate-500">
                      <span className="flex items-center gap-1.5 font-bold">
                        <span className={`w-1.5 h-1.5 rounded-full ${index === 0 ? "bg-indigo-400 animate-pulse" : "bg-slate-600"}`}></span>
                        {log.timestamp}
                        {index === 0 && (
                          <span className="text-[9px] text-indigo-400 font-normal uppercase tracking-wider font-mono">Latest</span>
                        )}
                      </span>
                      <span className="uppercase text-[9px] font-bold px-1.5 py-0.5 rounded-sm bg-slate-800 text-slate-400 font-mono">
                        {log.type === "research_result" ? `Grounding: ${log.label}` : "System Status"}
                      </span>
                    </div>

                    {/* Status Log */}
                    {log.type === "status" && (
                      <p className="text-slate-300 leading-relaxed font-medium pl-3 border-l border-indigo-500/40">
                        {log.message}
                      </p>
                    )}

                    {/* Research Result Log */}
                    {log.type === "research_result" && (
                      <div className={`space-y-2.5 pl-3 border-l ${log.failed ? "border-rose-500/50" : "border-emerald-500/40"}`}>
                        <p className={log.failed ? "text-rose-400 font-bold" : "text-emerald-400 font-bold"}>
                          {log.failed ? `Research failed for: ${log.label}` : `Research complete for: ${log.label}`}
                        </p>
                        
                        {/* Visited Sources links */}
                        {log.sources && log.sources.length > 0 && (
                          <div className="space-y-1">
                            <span className="text-[10px] text-slate-500 block font-bold uppercase">Sources Consulted:</span>
                            <div className="flex flex-wrap gap-1.5">
                              {log.sources.map((src, idx) => {
                                // Extract clean domain name or neat label for the source to avoid long unreadable URLs
                                let cleanLabel = `Source ${idx + 1}`;
                                try {
                                  if (src.uri) {
                                    const url = new URL(src.uri);
                                    const host = url.hostname.replace(/^www\./, "");
                                    if (host && !host.includes("google") && !host.includes("vertexai") && !host.includes("googleapis")) {
                                      cleanLabel = host;
                                    } else if (src.title && !src.title.includes("http") && !src.title.includes("google") && !src.title.includes("vertex")) {
                                      cleanLabel = src.title;
                                    } else {
                                      cleanLabel = `Grounded Link ${idx + 1}`;
                                    }
                                  }
                                } catch (_) {
                                  if (src.title && src.title.length < 35 && !src.title.includes("http")) {
                                    cleanLabel = src.title;
                                  }
                                }

                                return (
                                  <a 
                                    key={idx} 
                                    href={src.uri} 
                                    target="_blank" 
                                    referrerPolicy="no-referrer"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 bg-slate-800 hover:bg-slate-700 text-slate-300 px-2 py-0.5 rounded text-[10px] border border-slate-700/60 max-w-[200px]"
                                    title={src.title || src.uri}
                                  >
                                    <span className="truncate">{cleanLabel}</span>
                                    <ExternalLink className="w-2.5 h-2.5 text-slate-500 shrink-0" />
                                  </a>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Finding Blurb Box */}
                        {log.blurb && (
                          <div className="bg-slate-950/80 border border-slate-800/80 rounded-xl p-3 space-y-1 text-slate-300">
                            <span className="text-[9px] font-bold font-mono uppercase tracking-wider text-emerald-500 block">
                              ★ Key Empirical Finding
                            </span>
                            <p className="text-xs leading-relaxed italic">
                              "{log.blurb}"
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Empty state when no data exists and not loading */}
          {!profileData && !loading && (
            <div
              className="bg-white rounded-2xl border border-slate-100 p-8 md:p-12 text-center shadow-xs flex flex-col items-center justify-center gap-5 flex-1"
              style={{ minHeight: "calc(100vh - 120px)" }}
            >
              <div className="w-16 h-16 bg-indigo-50 rounded-2xl flex items-center justify-center text-indigo-600 border border-indigo-100">
                <Tv className="w-7 h-7" />
              </div>
              <div className="max-w-md space-y-2">
                <h3 className="text-lg font-display font-bold text-slate-800">No Media Plans Generated or Analyzed Yet</h3>
                <p className="text-sm text-slate-500 leading-relaxed">
                  Fill in the brief parameters on the left with an audience description, or upload an existing media plan (Excel or CSV), then click <strong className="text-indigo-600 font-semibold">Run Analysis</strong> or <strong className="text-indigo-600 font-semibold">Generate</strong> to analyze channels, evaluate budget allocations, and build research-backed campaign strategies.
                </p>
              </div>

              {/* Suggestion cards for onboarding */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 w-full max-w-2xl text-left mt-4">
                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-100 text-xs space-y-1">
                  <span className="font-bold text-slate-700 block">Method A: Upload Media Plan / RFP</span>
                  <p className="text-slate-500 leading-normal text-[11px]">
                    Upload an Excel (.xlsx) or CSV plan. The agent parses placement lines, identifies options, and scores channels against benchmark data.
                  </p>
                </div>
                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-100 text-xs space-y-1">
                  <span className="font-bold text-slate-700 block">Method B: Audience Description</span>
                  <p className="text-slate-500 leading-normal text-[11px]">
                    Describe a target consumer (e.g., "B2B IT decision-makers") to pull global and national indexes on buying trends and CTV habits.
                  </p>
                </div>
                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-100 text-xs space-y-1">
                  <span className="font-bold text-slate-700 block">Method C: URL Brand Reverse Insights</span>
                  <p className="text-slate-500 leading-normal text-[11px]">
                    Provide a brand landing page URL. The agent reverse-engineers product positioning and demographic profiles automatically.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Active Audience Profile Output */}
          {profileData && !loading && (
            <div className="space-y-6">
              {/* PDF Printable Wrapper and Cover Card */}
              <div id="profile-export-content" className="space-y-6">
                {/* Strategy Report Cover Card */}
                <div className="bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 text-white rounded-2xl p-5 md:p-6 shadow-sm border border-slate-800 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                  <div className="space-y-1">
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-indigo-500/15 border border-indigo-500/20 text-indigo-300 text-[10px] font-semibold font-mono uppercase tracking-wider">
                      <Sparkles className="w-3 h-3" />
                      Research Strategy Blueprint
                    </div>
                    {!isEditingBlueprintTitle ? (
                      <div className="flex items-center gap-2 group/title flex-wrap">
                        <h2 className="text-lg md:text-xl font-display font-bold tracking-tight">
                          {currentPlanTitle}
                        </h2>
                        {!isShareView && (
                          <button
                            type="button"
                            onClick={handleStartEditBlueprintTitle}
                            className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                            title="Edit plan name"
                            aria-label="Edit plan name"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    ) : (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          handleSaveBlueprintTitle();
                        }}
                        className="flex items-center gap-2 flex-wrap max-w-xl my-1"
                      >
                        <input
                          type="text"
                          value={blueprintTitleInput}
                          onChange={(e) => setBlueprintTitleInput(e.target.value)}
                          autoFocus
                          disabled={isSavingBlueprintTitle}
                          onKeyDown={(e) => {
                            if (e.key === "Escape") setIsEditingBlueprintTitle(false);
                          }}
                          className="text-base md:text-lg font-semibold text-white bg-slate-800/90 border border-indigo-500/60 rounded-lg px-3 py-1 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/40 min-w-[240px] sm:w-80 shadow-inner"
                          placeholder="Plan title"
                        />
                        <button
                          type="submit"
                          disabled={isSavingBlueprintTitle || !blueprintTitleInput.trim()}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-600/50 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-lg shadow-sm transition-colors cursor-pointer"
                        >
                          {isSavingBlueprintTitle ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Check className="w-3.5 h-3.5" />
                          )}
                          <span>Save</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setIsEditingBlueprintTitle(false)}
                          disabled={isSavingBlueprintTitle}
                          className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
                          title="Cancel"
                          aria-label="Cancel"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </form>
                    )}
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 mt-2 font-medium">
                      {geoTargets.length > 0 ? (
                        <div className="relative group">
                          <span className="inline-flex items-center gap-1.5 bg-indigo-950/60 hover:bg-indigo-900/70 text-indigo-300 border border-indigo-500/30 px-2.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide cursor-pointer transition-colors">
                            <MapPin className="w-3 h-3 text-indigo-400" />
                            {geographyType}: {geoTargets.length} {geographyType === "State" ? (geoTargets.length === 1 ? "State" : "States") : (geoTargets.length === 1 ? "DMA" : "DMAs")}
                          </span>
                          <div className="hidden group-hover:block absolute top-full left-0 mt-1.5 z-40 w-72 bg-slate-900 border border-slate-700 text-slate-200 rounded-xl p-3 shadow-2xl text-left">
                            <div className="flex items-center justify-between pb-1.5 mb-2 border-b border-slate-800 text-[11px] font-bold text-slate-300">
                              <span>Targeted {geographyType === "State" ? "States" : "Nielsen DMAs"} ({geoTargets.length})</span>
                            </div>
                            <div className="max-h-48 overflow-y-auto custom-scrollbar space-y-1 pr-1 text-[10px]">
                              {geoTargets.map((target, idx) => (
                                <div key={idx} className="flex items-center gap-1.5 text-slate-300">
                                  <span className="text-slate-500 font-mono text-[9px] w-4">{idx + 1}.</span>
                                  <span className="truncate">{target}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1 bg-slate-800/60 px-2 py-0.5 rounded border border-slate-700/50 text-[10px] uppercase font-semibold text-slate-300">
                          <MapPin className="w-3 h-3 text-slate-400" />
                          {geography === "United States" ? "National (US)" : geography}
                        </span>
                      )}
                      <span className="bg-slate-800/60 px-2 py-0.5 rounded border border-slate-700/50 text-[10px] font-semibold">
                        {campaignFocus}
                      </span>
                      {url && (
                        <span className="bg-indigo-950/40 text-indigo-300 px-2 py-0.5 rounded border border-indigo-500/10 truncate max-w-[200px]" title={url}>
                          Source: {url.replace(/^https?:\/\/(www\.)?/, "")}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-left sm:text-right font-mono text-[9px] text-slate-500 flex sm:flex-col gap-2 sm:gap-0.5 border-t border-slate-800/60 sm:border-0 pt-3 sm:pt-0 w-full sm:w-auto shrink-0 justify-between">
                    <div>Date: {new Date().toLocaleDateString()}</div>
                    {activeSavedId && <div>Ref: {activeSavedId.slice(0, 8).toUpperCase()}</div>}
                  </div>
                </div>

                {actionError && (
                  <div role="alert" className="p-3.5 bg-rose-50 border border-rose-200 rounded-2xl text-xs text-rose-800 flex items-start gap-2.5">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
                    <span className="flex-1 leading-relaxed">{actionError}</span>
                    <button type="button" onClick={() => setActionError(null)} className="text-rose-500 hover:text-rose-700 cursor-pointer" aria-label="Dismiss">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}

                {/* Introduction Summary */}
                {(!isShareView || !isIntroHidden) && (
                  <div
                    className={`group relative rounded-2xl border p-5 md:p-6 transition-all ${
                      isIntroHidden
                        ? "border-dashed border-slate-300 bg-slate-100/70 opacity-40 hover:opacity-70"
                        : "border-slate-100 bg-white shadow-xs"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2 text-indigo-600 text-xs font-bold uppercase tracking-wider">
                        <Tv className="w-4 h-4" />
                        <span>Strategic Introduction</span>
                      </div>
                      {!isShareView && (
                        <SectionVisibilityButton
                          sectionKey="intro"
                          isInactive={isIntroHidden}
                          onToggle={handleToggleSectionActive}
                        />
                      )}
                    </div>
                    <h3 className="text-lg font-display font-bold text-slate-900 leading-snug mb-3">Audience Overview</h3>
                    <PlanText text={profileData.intro} className="text-slate-600 text-sm leading-relaxed font-medium" />

                    {profileData.audienceAnalysis && profileData.audienceAnalysis.trim() && (
                      <div className="mt-5 pt-5 border-t border-slate-100">
                        <h3 className="text-lg font-display font-bold text-slate-900 leading-snug mb-3">Audience Analysis</h3>
                        <PlanText text={profileData.audienceAnalysis} className="text-slate-600 text-sm leading-relaxed font-medium" />
                      </div>
                    )}
                  </div>
                )}

                {!isShareView && profileData.briefOfRecord && <BriefOfRecordCard brief={profileData.briefOfRecord} />}

                {/* Key Personas (Grid of cards) */}
                {(!isShareView || !isPersonasHidden) && (
                  <div
                    className={`group relative space-y-4 transition-all ${
                      isPersonasHidden
                        ? "border-dashed border-slate-300 bg-slate-100/70 opacity-40 hover:opacity-70 p-4 rounded-2xl border"
                        : ""
                    }`}
                  >
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-2 text-indigo-600 text-xs font-bold uppercase tracking-wider">
                        <User className="w-4 h-4" />
                        <span>Consumer Segments & Personas</span>
                      </div>
                      <div className="flex items-center gap-2.5">
                        {!isShareView && (
                          <SectionVisibilityButton
                            sectionKey="personas"
                            isInactive={isPersonasHidden}
                            onToggle={handleToggleSectionActive}
                          />
                        )}
                        {profileData.personas && profileData.personas.length > 0 && (
                          <div className="flex items-center gap-2.5">
                            <button
                              type="button"
                              id="btn-open-persona-slide-studio"
                              onClick={() => handleOpenSlideStudio('personas')}
                              className="p-1.5 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200/90 rounded-lg inline-flex items-center justify-center cursor-pointer transition-all shadow-2xs hover:shadow-xs active:scale-[0.98]"
                              title="Export Presentation Slide (16:9)"
                              aria-label="Export Presentation Slide"
                            >
                              <Download className="w-4 h-4 text-indigo-600" />
                            </button>

                            <button
                              type="button"
                              onClick={toggleAllPersonasExpanded}
                              className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 hover:underline flex items-center gap-1 cursor-pointer transition-colors"
                            >
                              {arePersonasExpanded ? (
                                <>
                                  <span>Collapse All</span>
                                  <ChevronUp className="w-3.5 h-3.5" />
                                </>
                              ) : (
                                <>
                                  <span>Expand All</span>
                                  <ChevronDown className="w-3.5 h-3.5" />
                                </>
                              )}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                  {(() => {
                    const personas = profileData.personas || [];
                    const hasRfpPersonas = personas.some(p => p.sourceType === 'RFP');
                    const isUploadedPlanMode = briefMode === "upload" || hasRfpPersonas || (planOptions && planOptions.length > 0 && planOptions.some(p => p.selected));
                    // Only plans saved before the reach estimate was removed still carry a figure.
                    const reachBoost = typeof profileData.expansionReachPercent === "number" && profileData.expansionReachPercent > 0 ? profileData.expansionReachPercent : null;

                    return (
                      <div className="space-y-4">
                        {/* ScoutAI Expansion Audience Note when Media Plan is uploaded */}
                        {isUploadedPlanMode && (
                          <div className="bg-indigo-50/90 border border-indigo-200/80 rounded-xl p-3.5 flex items-start sm:items-center gap-3 text-xs text-indigo-950 font-medium shadow-2xs">
                            <Sparkles className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5 sm:mt-0 animate-pulse" />
                            <div className="leading-relaxed">
                              <span className="font-bold text-indigo-900 mr-1">Audience Expansion Note:</span>
                              Personas marked ScoutAI are recommended expansion audiences beyond those listed in the uploaded plan{reachBoost !== null ? `, estimated to increase addressable reach by approximately ${reachBoost}%` : ""}.
                            </div>
                          </div>
                        )}

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                          {personas.map((persona, globalIndex) => {
                            const isGeneratingThis = generatingAvatarIndices.includes(globalIndex);
                            const avatarFailed = failedAvatarIndices.includes(globalIndex);
                            const hasValidAvatar = Boolean(persona.avatarUrl && !persona.avatarUrl.includes("example.com"));
                            const isUserTarget = persona.sourceType === 'User';
                            const isRfp = persona.sourceType === 'RFP';
                            const rowIndex = Math.floor(globalIndex / 2);
                            const firstInRow = rowIndex * 2;
                            const secondInRow = firstInRow + 1;
                            const isExpanded =
                              expandedPersonaIndices[firstInRow] !== undefined
                                ? expandedPersonaIndices[firstInRow]
                                : (expandedPersonaIndices[secondInRow] !== undefined
                                    ? expandedPersonaIndices[secondInRow]
                                    : arePersonasExpanded);
                            const segmentHighlight = hoveredSegment?.personaIndices.includes(globalIndex)
                              ? SEGMENT_DIMENSION_STYLES[hoveredSegment.dimension].ring
                              : "";

                            return (
                              <div key={globalIndex} className={`bg-white rounded-2xl border border-slate-100 p-4 sm:p-5 shadow-xs flex flex-col hover:shadow-md transition-all duration-200 ${segmentHighlight}`}>
                                {/* Main Persona Row */}
                                <div className="flex items-start gap-3.5 sm:gap-4">
                                  {/* Left: 100x100 Avatar + Archetype Label below */}
                                  <div className="flex flex-col items-center shrink-0 w-[100px]">
                                    <div className="relative group shrink-0">
                                      <div className={`w-[100px] h-[100px] rounded-full overflow-hidden bg-slate-100 ring-2 ${isGeneratingThis ? 'ring-indigo-300 ring-offset-2 animate-pulse bg-indigo-50/50' : 'ring-indigo-100'} border border-slate-200/80 shadow-xs flex items-center justify-center relative aspect-square`}>
                                        {isGeneratingThis ? (
                                          <div className="flex flex-col items-center justify-center text-center p-1 text-indigo-600 bg-white/95 absolute inset-0">
                                            <Loader2 className="w-5 h-5 animate-spin mb-1 text-indigo-600" />
                                            <span className="text-[9px] font-bold tracking-tight text-indigo-700">Creating...</span>
                                          </div>
                                        ) : hasValidAvatar && !avatarFailed ? (
                                          <img
                                            src={persona.avatarUrl}
                                            alt={persona.name}
                                            className="w-full h-full object-cover object-center aspect-square transition-transform duration-300 group-hover:scale-105"
                                            onError={() => markAvatarFailed(globalIndex, true)}
                                          />
                                        ) : (
                                          <div className="flex flex-col items-center justify-center text-slate-400 p-2 text-center">
                                            <User className="w-8 h-8 mb-0.5 text-slate-300" />
                                            {avatarFailed && <span className="text-[8px] font-bold text-rose-600 leading-tight">Photo failed</span>}
                                            <button
                                              onClick={() => handleOpenAvatarModal(globalIndex)}
                                              className="text-[9px] font-bold text-indigo-600 hover:underline cursor-pointer"
                                            >
                                              {avatarFailed ? "Retry" : "+ Photo"}
                                            </button>
                                          </div>
                                        )}
                                      </div>

                                      {!isGeneratingThis && hasValidAvatar && (
                                        <button
                                          onClick={() => handleOpenAvatarModal(globalIndex)}
                                          title="Customize persona headshot"
                                          className="absolute bottom-0 right-0 bg-white hover:bg-indigo-50 text-indigo-600 hover:text-indigo-700 p-1.5 rounded-full border border-slate-200 shadow-xs transition-colors cursor-pointer"
                                        >
                                          <Pencil className="w-3 h-3" />
                                        </button>
                                      )}
                                    </div>

                                    {/* Archetype label moved under the image */}
                                    <div className="mt-2 text-center w-full">
                                      <span className="inline-block text-[10px] uppercase font-mono bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-md font-bold border border-indigo-100 tracking-wide text-center">
                                        Archetype 0{globalIndex + 1}
                                      </span>
                                    </div>
                                  </div>

                                  {/* Right: Persona Name, Badges, Caret & Demographics */}
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-start justify-between gap-2">
                                      <div className="min-w-0 flex-1">
                                        {(isUserTarget || isUploadedPlanMode) && (
                                          <div className="flex items-center gap-1.5 flex-wrap mb-1">
                                            {isUserTarget ? (
                                              <span className="inline-flex items-center gap-1 text-[10px] font-mono font-bold bg-emerald-100/90 text-emerald-900 border border-emerald-200 px-2 py-0.5 rounded-md uppercase tracking-wider">
                                                <User className="w-2.5 h-2.5 text-emerald-700" /> Target Archetype
                                              </span>
                                            ) : isUploadedPlanMode ? (
                                              isRfp ? (
                                                <span className="inline-flex items-center gap-1 text-[10px] font-mono font-bold bg-amber-100/90 text-amber-900 border border-amber-200 px-2 py-0.5 rounded-md uppercase tracking-wider">
                                                  <FileText className="w-2.5 h-2.5 text-amber-700" /> RFP
                                                </span>
                                              ) : (
                                                <span className="inline-flex items-center gap-1 text-[10px] font-mono font-bold bg-indigo-100/90 text-indigo-900 border border-indigo-200 px-2 py-0.5 rounded-md uppercase tracking-wider">
                                                  <Sparkles className="w-2.5 h-2.5 text-indigo-600" /> ScoutAI
                                                </span>
                                              )
                                            ) : null}
                                          </div>
                                        )}
                                        <h4 className="text-base font-display font-bold text-slate-800 leading-snug">{persona.name}</h4>
                                      </div>

                                      {/* Caret in upper right to expand/collapse */}
                                      <button
                                        type="button"
                                        onClick={() => togglePersonaExpanded(globalIndex)}
                                        className="p-1 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-slate-100 transition-colors cursor-pointer shrink-0 ml-1"
                                        title={isExpanded ? "Collapse habits & narrative" : "View habits & narrative"}
                                        aria-label={isExpanded ? "Collapse habits & narrative" : "View habits & narrative"}
                                        aria-expanded={isExpanded}
                                      >
                                        {isExpanded ? (
                                          <ChevronUp className="w-4 h-4 text-indigo-600" />
                                        ) : (
                                          <ChevronDown className="w-4 h-4 text-slate-500" />
                                        )}
                                      </button>
                                    </div>

                                    {/* Demographics content moved up under persona name to save vertical space */}
                                    <div className="mt-2.5 bg-slate-50/80 p-2.5 rounded-xl border border-slate-100 space-y-1.5">
                                      <div className="grid grid-cols-2 gap-2 text-[11px]">
                                        <div>
                                          <span className="text-slate-400 block font-medium text-[10px] uppercase tracking-wider">Age Group</span>
                                          <span className="font-bold text-slate-700 truncate block">{persona.age}</span>
                                        </div>
                                        <div>
                                          <span className="text-slate-400 block font-medium text-[10px] uppercase tracking-wider">Gender Skew</span>
                                          <span className="font-bold text-slate-700 truncate block">{persona.gender}</span>
                                        </div>
                                      </div>
                                      <div className="pt-1.5 border-t border-slate-200/60 flex items-center justify-between text-[11px] gap-2">
                                        <span className="text-slate-400 font-medium text-[10px] uppercase tracking-wider shrink-0">Household Income (HHI)</span>
                                        <span className="font-bold font-mono text-indigo-900 bg-indigo-50/80 px-1.5 py-0.5 rounded border border-indigo-100/50 text-[11px] truncate">{persona.income}</span>
                                      </div>
                                    </div>
                                  </div>
                                </div>

                                {/* Media & Shopping Habits and Narrative (Collapsible) */}
                                {isExpanded && (
                                  <div className="mt-3.5 space-y-3 pt-3 border-t border-slate-100">
                                    <div className="space-y-2 text-xs">
                                      <div className="leading-relaxed bg-slate-50/70 p-2.5 rounded-lg border border-slate-100">
                                        <div className="flex items-center gap-1.5 text-slate-700 text-[11px] font-semibold mb-0.5">
                                          <Tv className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                                          <span>Watch Profile:</span>
                                        </div>
                                        <span className="text-slate-600 block pl-5">{persona.watch}</span>
                                      </div>
                                      <div className="leading-relaxed bg-slate-50/70 p-2.5 rounded-lg border border-slate-100">
                                        <div className="flex items-center gap-1.5 text-slate-700 text-[11px] font-semibold mb-0.5">
                                          <Globe className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                                          <span>Digital Browsing:</span>
                                        </div>
                                        <span className="text-slate-600 block pl-5">{persona.browse}</span>
                                      </div>
                                      <div className="leading-relaxed bg-slate-50/70 p-2.5 rounded-lg border border-slate-100">
                                        <div className="flex items-center gap-1.5 text-slate-700 text-[11px] font-semibold mb-0.5">
                                          <ShoppingCart className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                                          <span>Purchasing Focus:</span>
                                        </div>
                                        <span className="text-slate-600 block pl-5">{persona.buy}</span>
                                      </div>
                                    </div>

                                    {/* Narrative Quote */}
                                    {persona.narrative && (
                                      <div className="text-xs text-slate-600 italic bg-slate-50/50 p-3 rounded-xl border border-slate-100/80 leading-relaxed">
                                        "{persona.narrative}"
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Segment Recommendations Component */}
              <SegmentRecommendations
                segments={profileData.segmentRecommendations}
                personas={profileData.personas || []}
                status={segmentStatus}
                isToppingUp={isToppingUpSegments}
                error={segmentError}
                autoSaveError={segmentAutoSaveError}
                readOnly={isShareView}
                undoName={segmentUndoName}
                onRemove={handleRemoveSegment}
                onUndo={handleUndoRemoveSegment}
                onAdd={handleAddSegment}
                onSuggestMore={() => requestSegments("top-up")}
                onGenerate={() => requestSegments("initial")}
                onExportCsv={handleExportSegmentsCsv}
                onOpenSlideExport={() => handleOpenSlideStudio('segments')}
                onHoverSegment={setHoveredSegment}
                isInactive={isSegmentsHidden}
                onToggleActive={(inactive) => handleToggleSectionActive("segments", inactive)}
              />

                {/* 3. Key Insights & Recommendations (Combined & Collapsible) */}
                {(!isShareView || !isInsightsHidden) && (
                  <div
                    className={`group relative rounded-2xl border shadow-xs overflow-hidden transition-all duration-200 ${
                      isInsightsHidden
                        ? "border-dashed border-slate-300 bg-slate-100/70 opacity-40 hover:opacity-70"
                        : "border-slate-100 bg-white hover:border-slate-200"
                    }`}
                  >
                    <div className="w-full p-4 md:p-5 flex flex-col md:flex-row md:items-center justify-between gap-3 text-left">
                      <button
                        type="button"
                        onClick={() => setIsInsightsExpanded(prev => !prev)}
                        className="flex items-center gap-3 shrink-0 cursor-pointer text-left focus:outline-none"
                        aria-expanded={isInsightsExpanded}
                      >
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="w-8 h-8 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 shrink-0">
                        <Sparkles className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5 text-indigo-600 text-[11px] font-bold uppercase tracking-wider">
                          <span>Key Insights & Recommendations</span>
                        </div>
                        <h3 className="text-base font-display font-bold text-slate-800">Consumer Facts & Tactical Media Guide</h3>
                      </div>
                    </div>
                  </button>

                  {/* Badge Style Highlights in 1 Row */}
                  <div
                    className="flex flex-wrap items-center gap-2 flex-1 md:justify-end md:mr-3 cursor-pointer"
                    onClick={() => setIsInsightsExpanded(prev => !prev)}
                  >
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200/80 rounded-lg">
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      <span>Takeaways ({profileData.takeaways.length})</span>
                    </span>
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200/80 rounded-lg">
                      <Layers className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                      <span>Recommendations ({profileData.recommendations.length})</span>
                    </span>
                  </div>

                  <div className="flex items-center gap-2 self-end md:self-center shrink-0">
                    {!isShareView && (
                      <SectionVisibilityButton
                        sectionKey="insights"
                        isInactive={isInsightsHidden}
                        onToggle={handleToggleSectionActive}
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => setIsInsightsExpanded(prev => !prev)}
                      className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 group-hover:text-indigo-600 hover:text-indigo-600 hover:bg-indigo-50 border border-slate-200/60 transition-colors shrink-0 cursor-pointer"
                      aria-label={isInsightsExpanded ? "Collapse Insights" : "Expand Insights"}
                    >
                      {isInsightsExpanded ? <ChevronUp className="w-4 h-4 text-indigo-600" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
                    </button>
                  </div>
                </div>

                  {isInsightsExpanded && (
                    <div className="border-t border-slate-100 p-5 md:p-6 bg-slate-50/30 space-y-6">
                      {/* Core Takeaways Subsection */}
                      <div className="space-y-3">
                        <div className="flex items-center gap-2 text-emerald-600 text-xs font-bold uppercase tracking-wider">
                          <CheckCircle className="w-4 h-4" />
                          <span>Core Takeaways & Consumer Facts</span>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                          {profileData.takeaways.map((takeaway, idx) => (
                            <div key={idx} className="flex gap-2.5 items-start bg-white border border-slate-100 p-3.5 rounded-xl shadow-xs">
                              <span className="w-5.5 h-5.5 rounded-full bg-emerald-50 text-emerald-700 font-bold font-mono text-[10px] flex items-center justify-center shrink-0 mt-0.5">
                                0{idx + 1}
                              </span>
                              <p className="text-xs text-slate-600 leading-relaxed font-medium">
                                {takeaway}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Strategic Recommendations Subsection */}
                      <div className="space-y-3 pt-4 border-t border-slate-100">
                        <div className="flex items-center gap-2 text-indigo-600 text-xs font-bold uppercase tracking-wider">
                          <Layers className="w-4 h-4" />
                          <span>Tactical Media Guide & Recommendations</span>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                          {profileData.recommendations.map((rec, idx) => (
                            <div key={idx} className="bg-white border border-slate-100 p-3.5 rounded-xl space-y-1.5 shadow-xs hover:border-indigo-200 transition-colors flex flex-col justify-between">
                              <div className="space-y-1.5">
                                <div className="flex items-start justify-between gap-2">
                                  <h4 className="text-xs font-bold text-slate-800">{rec.title}</h4>
                                  <span className="text-[9px] font-mono font-bold uppercase bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded shrink-0">
                                    Rec {idx + 1}
                                  </span>
                                </div>
                                <p className="text-[11px] text-slate-600 leading-relaxed">
                                  <strong className="text-slate-700">Action: </strong> {rec.action}
                                </p>
                                <p className="text-[11px] text-slate-500 leading-normal">
                                  <strong className="text-slate-600">Justification: </strong> {rec.why}
                                </p>
                              </div>
                              <div className="text-[9px] font-mono text-slate-400 mt-2 pt-2 border-t border-slate-100 uppercase tracking-wider">
                                Channels: {rec.channels}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

                <PerformanceLearningsSection
                  learnings={profileData.performanceLearnings || []}
                  isHidden={hiddenSections.has("performanceLearnings")}
                  isShareView={isShareView}
                  onToggle={handleToggleSectionActive}
                />

                {/* Dynamic Domain Affinity & CTV Publishers Bento Rows */}
                {/* Case 1: CTV-First - SHOW CTV Publishers and REPLACE Domains */}
                {campaignFocus === "CTV-first digital media plan" && (!isShareView || !isDomainAffinityHidden) && (
                  <div className={`grid grid-cols-1 lg:grid-cols-5 gap-6 transition-all ${
                    isDomainAffinityHidden ? "border-dashed border-slate-300 bg-slate-100/70 opacity-40 hover:opacity-70 p-4 rounded-2xl border" : ""
                  }`}>
                    {/* CTV Publishers to Target (60% width) */}
                    <div className="lg:col-span-3 bg-white rounded-2xl border border-slate-100 p-5 md:p-6 shadow-xs space-y-4">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-indigo-600 text-xs font-bold uppercase tracking-wider">
                          <Tv className="w-4 h-4" />
                          <span>Recommended CTV Publishers</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <CtvExportDropdown
                            id="export-ctv-slide-dropdown-ctv-first"
                            isExporting={isExportingCtvSlide}
                            exportSuccess={ctvSlideExportSuccess}
                            onExport={handleExportCtvSlide}
                            activeVariant={exportingVariant}
                          />
                          {!isShareView && (
                            <button
                              id="edit-ctv-publishers-btn-ctv-first"
                              type="button"
                              onClick={() => setIsCtvPublishersModalOpen(true)}
                              className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200/70 rounded-xl transition-colors cursor-pointer shadow-2xs"
                              title="Edit CTV Publishers to Target"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                              <span>Edit Publishers</span>
                            </button>
                          )}
                          {!isShareView && (
                            <SectionVisibilityButton
                              sectionKey="domainAffinity"
                              isInactive={isDomainAffinityHidden}
                              onToggle={handleToggleSectionActive}
                            />
                          )}
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <h3 className="text-base font-display font-bold text-slate-800">CTV Publishers to Target</h3>
                        <span className="text-xs font-semibold text-slate-500">
                          {(profileData.ctvPublishers ?? []).length} Targeted
                        </span>
                      </div>
                      
                      {(profileData.ctvPublishers ?? []).length === 0 ? (
                        <div className="p-8 text-center bg-slate-50/70 rounded-xl border border-dashed border-slate-200">
                          <Tv className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                          <p className="text-sm font-semibold text-slate-700">No CTV publishers selected</p>
                          <p className="text-xs text-slate-500 mt-1 mb-3">Click below to select which streaming apps and networks to target.</p>
                          {!isShareView && (
                            <button
                              type="button"
                              onClick={() => setIsCtvPublishersModalOpen(true)}
                              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-xs cursor-pointer"
                            >
                              <Plus className="w-3.5 h-3.5" /> Select Publishers
                            </button>
                          )}
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {(profileData.ctvPublishers ?? []).map((pub, idx) => (
                            <CtvPublisherCard
                              key={`${pub.publisher}-${idx}`}
                              pub={pub}
                              logoSrc={getPublisherLogo(pub.publisher, ctvPublishers)}
                            />
                          ))}
                        </div>
                      )}
                    </div>

                    {/* CTV Publisher Insights (40% width) */}
                    <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-100 p-5 md:p-6 shadow-xs flex flex-col justify-between">
                      <div>
                        <div className="flex items-center gap-2 text-indigo-600 text-xs font-bold uppercase tracking-wider mb-2">
                          <TrendingUp className="w-4 h-4" />
                          <span>Publisher Insights</span>
                        </div>
                        <h3 className="text-base font-display font-bold text-slate-800 mb-3">Publisher Alignment</h3>
                        {profileData.publisherInsights
                          ? <PlanText text={profileData.publisherInsights} className="text-xs text-slate-600 leading-relaxed mb-4" />
                          : <p className="text-xs italic text-slate-400 leading-relaxed mb-4">Publisher insights were not generated for this plan.</p>}
                      </div>
                    </div>
                  </div>
                )}

                {/* Case 2: Full-Funnel - SHOW BOTH Domain Affinity (Collapsible) AND CTV Publishers */}
                {campaignFocus === "Full-funnel digital media plan" && (
                  <div className="space-y-6">
                    {/* Collapsible Domain Affinity Index */}
                    {(!isShareView || !isDomainAffinityHidden) && (() => {
                      const domainSummary = getDomainAffinitySummary(profileData.browserAndReach);
                      return (
                        <div className={`group relative rounded-2xl border shadow-xs overflow-hidden transition-all duration-200 ${
                          isDomainAffinityHidden
                            ? "border-dashed border-slate-300 bg-slate-100/70 opacity-40 hover:opacity-70"
                            : "border-slate-100 bg-white hover:border-slate-200"
                        }`}>
                          <div className="w-full p-4 md:p-5 flex flex-col md:flex-row md:items-center justify-between gap-3 text-left">
                            <button
                              type="button"
                              onClick={() => setIsDomainAffinityExpanded(prev => !prev)}
                              className="flex items-center gap-3 shrink-0 cursor-pointer text-left focus:outline-none"
                              aria-expanded={isDomainAffinityExpanded}
                            >
                              <div className="w-8 h-8 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 shrink-0">
                                <Globe className="w-4 h-4" />
                              </div>
                              <div>
                                <div className="flex items-center gap-1.5 text-indigo-600 text-[11px] font-bold uppercase tracking-wider">
                                  <span>Domain Affinity Index</span>
                                </div>
                                <h3 className="text-base font-display font-bold text-slate-800">Top High-Affinity Web Environments</h3>
                              </div>
                            </button>

                            {/* Option C Highlight: Tag + Top 3 Domains */}
                            <div
                              className="flex flex-wrap items-center gap-2 flex-1 md:justify-end md:mr-3 cursor-pointer"
                              onClick={() => setIsDomainAffinityExpanded(prev => !prev)}
                            >
                              <span className="px-2.5 py-1 text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-100/80 rounded-lg">
                                {domainSummary.tag}
                              </span>
                              {domainSummary.chips.map((chip, idx) => (
                                <span key={idx} className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200/70 rounded-lg">
                                  <Globe className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                                  <span className="font-semibold text-slate-900">{chip.label}</span>
                                  <span className="text-indigo-600 font-mono text-[11px] font-bold bg-indigo-50/80 px-1.5 py-0.5 rounded">
                                    {chip.value}
                                  </span>
                                </span>
                              ))}
                            </div>

                            <div className="flex items-center gap-2 self-end md:self-center shrink-0">
                              {!isShareView && (
                                <SectionVisibilityButton
                                  sectionKey="domainAffinity"
                                  isInactive={isDomainAffinityHidden}
                                  onToggle={handleToggleSectionActive}
                                />
                              )}
                              <button
                                type="button"
                                onClick={() => setIsDomainAffinityExpanded(prev => !prev)}
                                className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 group-hover:text-indigo-600 hover:text-indigo-600 hover:bg-indigo-50 border border-slate-200/60 transition-colors shrink-0 cursor-pointer"
                                aria-label={isDomainAffinityExpanded ? "Collapse Domain Affinity" : "Expand Domain Affinity"}
                              >
                                {isDomainAffinityExpanded ? <ChevronUp className="w-4 h-4 text-indigo-600" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
                              </button>
                            </div>
                          </div>

                          {isDomainAffinityExpanded && (
                            <div className="border-t border-slate-100 p-5 md:p-6 bg-slate-50/30">
                              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                                <div className="lg:col-span-2 bg-white rounded-xl border border-slate-100 p-5 shadow-xs">
                                  <div className="flex items-center gap-2 text-indigo-600 text-xs font-bold uppercase tracking-wider mb-2">
                                    <TrendingUp className="w-4 h-4" />
                                    <span>Top Domain Affinity Index</span>
                                  </div>
                                  <h3 className="text-base font-display font-bold text-slate-800 mb-3">Syndicated Web Reach & Contextual Affinity</h3>
                                  <DomainsChart
                                    data={profileData.browserAndReach.chartData}
                                    source={profileData.browserAndReach.chartSource}
                                  />
                                </div>

                                <div className="lg:col-span-1 bg-white rounded-xl border border-slate-100 p-5 shadow-xs flex flex-col justify-between">
                                  <div>
                                    <div className="flex items-center gap-2 text-indigo-600 text-xs font-bold uppercase tracking-wider mb-2">
                                      <TrendingUp className="w-4 h-4" />
                                      <span>Domain Insights</span>
                                    </div>
                                    <h3 className="text-base font-display font-bold text-slate-800 mb-3">Contextual Alignment</h3>
                                    <p className="text-xs text-slate-600 leading-relaxed mb-4">
                                      {profileData.browserAndReach.overview}
                                    </p>
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {/* CTV Publishers Grid */}
                    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                      {/* CTV Publishers to Target (60% width) */}
                      <div className="lg:col-span-3 bg-white rounded-2xl border border-slate-100 p-5 md:p-6 shadow-xs space-y-4">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 text-indigo-600 text-xs font-bold uppercase tracking-wider">
                            <Tv className="w-4 h-4" />
                            <span>Recommended CTV Publishers</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <CtvExportDropdown
                              id="export-ctv-slide-dropdown-full-funnel"
                              isExporting={isExportingCtvSlide}
                              exportSuccess={ctvSlideExportSuccess}
                              onExport={handleExportCtvSlide}
                              activeVariant={exportingVariant}
                            />
                            {!isShareView && (
                              <button
                                id="edit-ctv-publishers-btn-full-funnel"
                                type="button"
                                onClick={() => setIsCtvPublishersModalOpen(true)}
                                className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200/70 rounded-xl transition-colors cursor-pointer shadow-2xs"
                                title="Edit CTV Publishers to Target"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                                <span>Edit Publishers</span>
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center justify-between">
                          <h3 className="text-base font-display font-bold text-slate-800">CTV Publishers to Target</h3>
                          <span className="text-xs font-semibold text-slate-500">
                            {(profileData.ctvPublishers ?? []).length} Targeted
                          </span>
                        </div>
                        
                        {(profileData.ctvPublishers ?? []).length === 0 ? (
                          <div className="p-8 text-center bg-slate-50/70 rounded-xl border border-dashed border-slate-200">
                            <Tv className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                            <p className="text-sm font-semibold text-slate-700">No CTV publishers selected</p>
                            <p className="text-xs text-slate-500 mt-1 mb-3">Click below to select which streaming apps and networks to target.</p>
                            {!isShareView && (
                              <button
                                type="button"
                                onClick={() => setIsCtvPublishersModalOpen(true)}
                                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-xs cursor-pointer"
                              >
                                <Plus className="w-3.5 h-3.5" /> Select Publishers
                              </button>
                            )}
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {(profileData.ctvPublishers ?? []).map((pub, idx) => (
                              <CtvPublisherCard
                                key={`${pub.publisher}-${idx}`}
                                pub={pub}
                                logoSrc={getPublisherLogo(pub.publisher, ctvPublishers)}
                              />
                            ))}
                          </div>
                        )}
                      </div>

                      {/* CTV Publisher Insights (40% width) */}
                      <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-100 p-5 md:p-6 shadow-xs flex flex-col justify-between">
                        <div>
                          <div className="flex items-center gap-2 text-indigo-600 text-xs font-bold uppercase tracking-wider mb-2">
                            <TrendingUp className="w-4 h-4" />
                            <span>Publisher Insights</span>
                          </div>
                          <h3 className="text-base font-display font-bold text-slate-800 mb-3">Publisher Alignment</h3>
                          {profileData.publisherInsights
                            ? <PlanText text={profileData.publisherInsights} className="text-xs text-slate-600 leading-relaxed mb-4" />
                            : <p className="text-xs italic text-slate-400 leading-relaxed mb-4">Publisher insights were not generated for this plan.</p>}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Case 3: Display & Social - SHOW ONLY Domain Affinity (Collapsible) */}
                {campaignFocus === "Display/social/video plan" && (!isShareView || !isDomainAffinityHidden) && (
                  (() => {
                    const domainSummary = getDomainAffinitySummary(profileData.browserAndReach);
                    return (
                      <div className={`group relative rounded-2xl border shadow-xs overflow-hidden transition-all duration-200 ${
                        isDomainAffinityHidden
                          ? "border-dashed border-slate-300 bg-slate-100/70 opacity-40 hover:opacity-70"
                          : "border-slate-100 bg-white hover:border-slate-200"
                      }`}>
                        <div className="w-full p-4 md:p-5 flex flex-col md:flex-row md:items-center justify-between gap-3 text-left">
                          <button
                            type="button"
                            onClick={() => setIsDomainAffinityExpanded(prev => !prev)}
                            className="flex items-center gap-3 shrink-0 cursor-pointer text-left focus:outline-none"
                            aria-expanded={isDomainAffinityExpanded}
                          >
                            <div className="w-8 h-8 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 shrink-0">
                              <Globe className="w-4 h-4" />
                            </div>
                            <div>
                              <div className="flex items-center gap-1.5 text-indigo-600 text-[11px] font-bold uppercase tracking-wider">
                                <span>Domain Affinity Index</span>
                              </div>
                              <h3 className="text-base font-display font-bold text-slate-800">Top High-Affinity Web Environments</h3>
                            </div>
                          </button>

                          {/* Option C Highlight: Tag + Top 3 Domains */}
                          <div
                            className="flex flex-wrap items-center gap-2 flex-1 md:justify-end md:mr-3 cursor-pointer"
                            onClick={() => setIsDomainAffinityExpanded(prev => !prev)}
                          >
                            <span className="px-2.5 py-1 text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-100/80 rounded-lg">
                              {domainSummary.tag}
                            </span>
                            {domainSummary.chips.map((chip, idx) => (
                              <span key={idx} className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200/70 rounded-lg">
                                <Globe className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                                <span className="font-semibold text-slate-900">{chip.label}</span>
                                <span className="text-indigo-600 font-mono text-[11px] font-bold bg-indigo-50/80 px-1.5 py-0.5 rounded">
                                  {chip.value}
                                </span>
                              </span>
                            ))}
                          </div>

                          <div className="flex items-center gap-2 self-end md:self-center shrink-0">
                            {!isShareView && (
                              <SectionVisibilityButton
                                sectionKey="domainAffinity"
                                isInactive={isDomainAffinityHidden}
                                onToggle={handleToggleSectionActive}
                              />
                            )}
                            <button
                              type="button"
                              onClick={() => setIsDomainAffinityExpanded(prev => !prev)}
                              className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 group-hover:text-indigo-600 hover:text-indigo-600 hover:bg-indigo-50 border border-slate-200/60 transition-colors shrink-0 cursor-pointer"
                              aria-label={isDomainAffinityExpanded ? "Collapse Domain Affinity" : "Expand Domain Affinity"}
                            >
                              {isDomainAffinityExpanded ? <ChevronUp className="w-4 h-4 text-indigo-600" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
                            </button>
                          </div>
                        </div>

                        {isDomainAffinityExpanded && (
                          <div className="border-t border-slate-100 p-5 md:p-6 bg-slate-50/30">
                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                              <div className="lg:col-span-2 bg-white rounded-xl border border-slate-100 p-5 shadow-xs">
                                <div className="flex items-center gap-2 text-indigo-600 text-xs font-bold uppercase tracking-wider mb-2">
                                  <TrendingUp className="w-4 h-4" />
                                  <span>Top Domain Affinity Index</span>
                                </div>
                                <h3 className="text-base font-display font-bold text-slate-800 mb-3">Syndicated Web Reach & Contextual Affinity</h3>
                                <DomainsChart
                                  data={profileData.browserAndReach.chartData}
                                  source={profileData.browserAndReach.chartSource}
                                />
                              </div>

                              <div className="lg:col-span-1 bg-white rounded-xl border border-slate-100 p-5 shadow-xs flex flex-col justify-between">
                                <div>
                                  <div className="flex items-center gap-2 text-indigo-600 text-xs font-bold uppercase tracking-wider mb-2">
                                    <TrendingUp className="w-4 h-4" />
                                    <span>Domain Insights</span>
                                  </div>
                                  <h3 className="text-base font-display font-bold text-slate-800 mb-3">Contextual Alignment</h3>
                                  <p className="text-xs text-slate-600 leading-relaxed mb-4">
                                    {profileData.browserAndReach.overview}
                                  </p>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()
                )}

                {/* 5. Device Share - Collapsible Panel with Option C Highlights */}
                {(!isShareView || !isDeviceShareHidden) && (
                  (() => {
                    const deviceSummary = getDeviceShareSummary(profileData.deviceTypeIndex?.chartData);
                    return (
                      <div className={`group relative rounded-2xl border shadow-xs overflow-hidden transition-all duration-200 ${
                        isDeviceShareHidden
                          ? "border-dashed border-slate-300 bg-slate-100/70 opacity-40 hover:opacity-70"
                          : "border-slate-100 bg-white hover:border-slate-200"
                      }`}>
                        <div className="w-full p-4 md:p-5 flex flex-col md:flex-row md:items-center justify-between gap-3 text-left">
                          <button
                            type="button"
                            onClick={() => setIsDeviceShareExpanded(prev => !prev)}
                            className="flex items-center gap-3 shrink-0 cursor-pointer text-left focus:outline-none"
                            aria-expanded={isDeviceShareExpanded}
                          >
                            <div className="w-8 h-8 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 shrink-0">
                              <Smartphone className="w-4 h-4" />
                            </div>
                            <div>
                              <div className="flex items-center gap-1.5 text-indigo-600 text-[11px] font-bold uppercase tracking-wider">
                                <span>Device Share</span>
                              </div>
                              <h3 className="text-base font-display font-bold text-slate-800">Multi-Screen Habits</h3>
                            </div>
                          </button>

                          {/* Option C Highlight: Tag + Key Metric Chips */}
                          <div
                            className="flex flex-wrap items-center gap-2 flex-1 md:justify-end md:mr-3 cursor-pointer"
                            onClick={() => setIsDeviceShareExpanded(prev => !prev)}
                          >
                            <span className="px-2.5 py-1 text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-100/80 rounded-lg">
                              {deviceSummary.tag}
                            </span>
                            {deviceSummary.chips.map((chip, idx) => (
                              <span key={idx} className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200/70 rounded-lg">
                                {chip.icon === "tv" && <Tv className="w-3.5 h-3.5 text-indigo-600 shrink-0" />}
                                {chip.icon === "mobile" && <Smartphone className="w-3.5 h-3.5 text-indigo-600 shrink-0" />}
                                {chip.icon === "desktop" && <Monitor className="w-3.5 h-3.5 text-indigo-600 shrink-0" />}
                                {chip.icon === "tablet" && <Tablet className="w-3.5 h-3.5 text-indigo-600 shrink-0" />}
                                {chip.icon === "device" && <Layers className="w-3.5 h-3.5 text-indigo-600 shrink-0" />}
                                <span className="font-semibold text-slate-900">{chip.label}:</span>
                                <span>{chip.value}</span>
                              </span>
                            ))}
                          </div>

                          <div className="flex items-center gap-2 self-end md:self-center shrink-0">
                            {!isShareView && (
                              <SectionVisibilityButton
                                sectionKey="deviceShare"
                                isInactive={isDeviceShareHidden}
                                onToggle={handleToggleSectionActive}
                              />
                            )}
                            <button
                              type="button"
                              onClick={() => setIsDeviceShareExpanded(prev => !prev)}
                              className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 group-hover:text-indigo-600 hover:text-indigo-600 hover:bg-indigo-50 border border-slate-200/60 transition-colors shrink-0 cursor-pointer"
                              aria-label={isDeviceShareExpanded ? "Collapse Device Share" : "Expand Device Share"}
                            >
                              {isDeviceShareExpanded ? <ChevronUp className="w-4 h-4 text-indigo-600" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
                            </button>
                          </div>
                        </div>

                        {isDeviceShareExpanded && (
                          <div className="border-t border-slate-100 p-5 md:p-6 bg-slate-50/30">
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
                              {/* Left Column: Device Chart */}
                              <div className="w-full">
                                <DeviceChart
                                  data={profileData.deviceTypeIndex.chartData}
                                  source={profileData.deviceTypeIndex.chartSource}
                                />
                              </div>
                              {/* Right Column: Text content */}
                              <div className="space-y-4 flex flex-col justify-between h-full">
                                <p className="text-xs text-slate-600 leading-relaxed">
                                  {profileData.deviceTypeIndex.overview}
                                </p>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()
                )}

                {/* 6. Demographics - Collapsible Panel with Option C Highlights */}
                {(!isShareView || !isDemographicsHidden) && (
                  (() => {
                    const demoSummary = getDemographicsSummary(profileData.demographics);
                    return (
                      <div className={`group relative rounded-2xl border shadow-xs overflow-hidden transition-all duration-200 ${
                        isDemographicsHidden
                          ? "border-dashed border-slate-300 bg-slate-100/70 opacity-40 hover:opacity-70"
                          : "border-slate-100 bg-white hover:border-slate-200"
                      }`}>
                        <div className="w-full p-4 md:p-5 flex flex-col md:flex-row md:items-center justify-between gap-3 text-left">
                          <button
                            type="button"
                            onClick={() => setIsDemographicsExpanded(prev => !prev)}
                            className="flex items-center gap-3 shrink-0 cursor-pointer text-left focus:outline-none"
                            aria-expanded={isDemographicsExpanded}
                          >
                            <div className="w-8 h-8 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 shrink-0">
                              <Users className="w-4 h-4" />
                            </div>
                            <div>
                              <div className="flex items-center gap-1.5 text-indigo-600 text-[11px] font-bold uppercase tracking-wider">
                                <span>Demographics</span>
                              </div>
                              <h3 className="text-base font-display font-bold text-slate-800">Strategic Demographic Overview</h3>
                            </div>
                          </button>

                          {/* Option C Highlight: Tag + Key Metric Chips */}
                          <div
                            className="flex flex-wrap items-center gap-2 flex-1 md:justify-end md:mr-3 cursor-pointer"
                            onClick={() => setIsDemographicsExpanded(prev => !prev)}
                          >
                            <span className="px-2.5 py-1 text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-100/80 rounded-lg">
                              {demoSummary.tag}
                            </span>
                            {demoSummary.chips.map((chip, idx) => (
                              <span key={idx} className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200/70 rounded-lg">
                                {chip.icon === "users" && <Users className="w-3.5 h-3.5 text-indigo-600 shrink-0" />}
                                {chip.icon === "gender" && <UserCheck className="w-3.5 h-3.5 text-indigo-600 shrink-0" />}
                                {chip.icon === "income" && <DollarSign className="w-3.5 h-3.5 text-indigo-600 shrink-0" />}
                                <span className="font-semibold text-slate-900">{chip.label}:</span>
                                <span>{chip.value}</span>
                              </span>
                            ))}
                          </div>

                          <div className="flex items-center gap-2 self-end md:self-center shrink-0">
                            {!isShareView && (
                              <SectionVisibilityButton
                                sectionKey="demographics"
                                isInactive={isDemographicsHidden}
                                onToggle={handleToggleSectionActive}
                              />
                            )}
                            <button
                              type="button"
                              onClick={() => setIsDemographicsExpanded(prev => !prev)}
                              className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 group-hover:text-indigo-600 hover:text-indigo-600 hover:bg-indigo-50 border border-slate-200/60 transition-colors shrink-0 cursor-pointer"
                              aria-label={isDemographicsExpanded ? "Collapse Demographics" : "Expand Demographics"}
                            >
                              {isDemographicsExpanded ? <ChevronUp className="w-4 h-4 text-indigo-600" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
                            </button>
                          </div>
                        </div>

                      {isDemographicsExpanded && (
                        <div className="border-t border-slate-100 p-5 md:p-6 bg-slate-50/30">
                          {/* Strategic Demographic Overview Text - Full Width */}
                          <p className="text-xs text-slate-600 leading-relaxed mb-6">
                            {profileData.demographics.overview}
                          </p>

                          {/* 3 Columns with 3 Charts */}
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-6">
                            <AgeChart
                              data={profileData.demographics.ageChartData}
                              source={profileData.demographics.ageChartData[0]?.source || ""}
                            />
                            <GenderChart
                              data={profileData.demographics.genderChartData}
                              source={profileData.demographics.genderChartData[0]?.source || ""}
                            />
                            <IncomeChart
                              data={profileData.demographics.incomeChartData}
                              source={profileData.demographics.incomeChartData[0]?.source || ""}
                            />
                          </div>

                          {/* Geographic Concentration Notes & Market Footprint */}
                          {(profileData.demographics.geographyNotes || geoTargets.length > 0) && (
                            <div className="bg-slate-50 rounded-xl border border-slate-100/80 p-4 text-[11px] text-slate-500 space-y-3">
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] uppercase font-mono text-indigo-600 font-bold flex items-center gap-1.5">
                                  <MapPin className="w-3.5 h-3.5" />
                                  Geographic Footprint & Market Targeting
                                </span>
                                {geoTargets.length > 0 && (
                                  <span className="text-[10px] font-semibold bg-white border border-slate-200 px-2 py-0.5 rounded-full text-indigo-700 shadow-2xs">
                                    {geoTargets.length} {geographyType === "State" ? (geoTargets.length === 1 ? "State" : "States") : (geoTargets.length === 1 ? "DMA" : "DMAs")} Targeted
                                  </span>
                                )}
                              </div>

                              {geoTargets.length > 0 && (
                                <div className="space-y-1.5">
                                  <div className="flex items-center justify-between text-[10px] font-semibold text-slate-600">
                                    <span>Target Market Coverage:</span>
                                    {parseCurrencyInput(budget) > 0 && (
                                      <span className="text-slate-400 font-mono text-[9px]">
                                        ~${Math.round(parseCurrencyInput(budget) / geoTargets.length).toLocaleString()} / market
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto custom-scrollbar p-2 bg-white rounded-lg border border-slate-200/60">
                                    {geoTargets.map((market, i) => (
                                      <span key={i} className="px-2 py-0.5 bg-indigo-50 border border-indigo-100/60 text-indigo-700 text-[10px] font-medium rounded-md">
                                        {market}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {profileData.demographics.geographyNotes && (
                                <p className="leading-relaxed text-slate-600">
                                  {profileData.demographics.geographyNotes}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()
              )}

                {/* 7. Temporal Activity Patterns - Collapsible Panel with Option C Highlights */}
                {(!isShareView || !isTemporalHidden) && (
                  (() => {
                    const temporalSummary = getTemporalSummary(profileData.temporalPatterns);
                    return (
                      <div className={`group relative rounded-2xl border shadow-xs overflow-hidden transition-all duration-200 ${
                        isTemporalHidden
                          ? "border-dashed border-slate-300 bg-slate-100/70 opacity-40 hover:opacity-70"
                          : "border-slate-100 bg-white hover:border-slate-200"
                      }`}>
                        <div className="w-full p-4 md:p-5 flex flex-col md:flex-row md:items-center justify-between gap-3 text-left">
                          <button
                            type="button"
                            onClick={() => setIsTemporalExpanded(prev => !prev)}
                            className="flex items-center gap-3 shrink-0 cursor-pointer text-left focus:outline-none"
                            aria-expanded={isTemporalExpanded}
                          >
                            <div className="w-8 h-8 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 shrink-0">
                              <Clock className="w-4 h-4" />
                            </div>
                            <div>
                              <div className="flex items-center gap-1.5 text-indigo-600 text-[11px] font-bold uppercase tracking-wider">
                                <span>Temporal Activity Patterns</span>
                              </div>
                              <h3 className="text-base font-display font-bold text-slate-800">Daypart Scheduling & Activity Indices</h3>
                            </div>
                          </button>

                          {/* Option C Highlight: Tag + Key Metric Chips */}
                          <div
                            className="flex flex-wrap items-center gap-2 flex-1 md:justify-end md:mr-3 cursor-pointer"
                            onClick={() => setIsTemporalExpanded(prev => !prev)}
                          >
                            <span className="px-2.5 py-1 text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-100/80 rounded-lg">
                              {temporalSummary.tag}
                            </span>
                            {temporalSummary.chips.map((chip, idx) => (
                              <span key={idx} className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200/70 rounded-lg">
                                {chip.icon === "calendar" && <Calendar className="w-3.5 h-3.5 text-indigo-600 shrink-0" />}
                                {chip.icon === "clock" && <Clock className="w-3.5 h-3.5 text-indigo-600 shrink-0" />}
                                <span className="font-semibold text-slate-900">{chip.label}:</span>
                                <span>{chip.value}</span>
                              </span>
                            ))}
                          </div>

                          <div className="flex items-center gap-2 self-end md:self-center shrink-0">
                            {!isShareView && (
                              <SectionVisibilityButton
                                sectionKey="temporal"
                                isInactive={isTemporalHidden}
                                onToggle={handleToggleSectionActive}
                              />
                            )}
                            <button
                              type="button"
                              onClick={() => setIsTemporalExpanded(prev => !prev)}
                              className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 group-hover:text-indigo-600 hover:text-indigo-600 hover:bg-indigo-50 border border-slate-200/60 transition-colors shrink-0 cursor-pointer"
                              aria-label={isTemporalExpanded ? "Collapse Temporal Activity" : "Expand Temporal Activity"}
                            >
                              {isTemporalExpanded ? <ChevronUp className="w-4 h-4 text-indigo-600" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
                            </button>
                          </div>
                        </div>

                      {isTemporalExpanded && (
                        <div className="border-t border-slate-100 p-5 md:p-6 bg-slate-50/30">
                          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                            {/* Daypart Guidance & Activation Notes */}
                            <div className="lg:col-span-1 bg-white rounded-xl border border-slate-100 p-5 flex flex-col justify-between shadow-xs">
                              <div>
                                <span className="text-[10px] uppercase font-mono text-indigo-600 font-bold block mb-2">Daypart Guidance</span>
                                <h4 className="text-sm font-display font-bold text-slate-800 mb-2">Scheduling Strategy</h4>
                                <p className="text-xs text-slate-600 leading-relaxed mb-4">
                                  {profileData.temporalPatterns.overview}
                                </p>
                              </div>
                              <div className="bg-slate-50 rounded-xl border border-slate-100 p-3.5 text-[11px] text-slate-500">
                                <span className="text-[10px] uppercase font-mono text-indigo-600 font-bold block mb-1">Persona Activation Notes</span>
                                <p className="leading-relaxed">
                                  {profileData.temporalPatterns.activationNotes}
                                </p>
                              </div>
                            </div>

                            {/* Temporal Activity Charts */}
                            <div className="lg:col-span-2 bg-white rounded-xl border border-slate-100 p-5 shadow-xs flex flex-col justify-between">
                              <div>
                                <span className="text-[10px] uppercase font-mono text-indigo-600 font-bold block mb-3">Temporal Activity Indices</span>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                  <DayOfWeekChart
                                    data={profileData.temporalPatterns.dayOfWeekChartData}
                                    source={profileData.temporalPatterns.dayOfWeekChartData[0]?.source || ""}
                                  />
                                  <HourOfDayChart
                                    data={profileData.temporalPatterns.hourOfDayChartData}
                                    source={profileData.temporalPatterns.hourOfDayChartData[0]?.source || ""}
                                  />
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()
              )}

                {/* Channel Strategy & Activation Plan (when Media Plan Analysis is present) */}
                {profileData.channelStrategy && (!isShareView || !isChannelsHidden) && (
                  <ChannelStrategySection
                    data={profileData.channelStrategy}
                    ctvPublishers={profileData.ctvPublishers ?? []}
                    internalOnly={internalOnlyVisibility}
                    onToggleBudgetMode={handleToggleBudgetMode}
                    onManualMediaTypeChange={handleManualMediaTypeChange}
                    onSaveAllocations={handleSaveManualAllocations}
                    onResetAllocations={handleResetManualAllocations}
                    onUndoPlanChange={handleUndoChannelStrategyChange}
                    canUndoPlanChange={Boolean(channelStrategyUndo)}
                    onOpenSlideStudio={() => handleOpenSlideStudio('channels')}
                    readOnly={isShareView}
                    onUpdateChannelOverrides={handleUpdateChannelOverrides}
                    isInactive={isChannelsHidden}
                    onToggleActive={(inactive) => handleToggleSectionActive("channels", inactive)}
                    scoutPreview={!isShareView ? scoutPreview?.changes : null}
                  />
                )}

                {/* Executive Summary Blueprint (placed after Channel Strategy) */}
                {(!isShareView || !isExecutiveSummaryHidden) && (
                  <ExecutiveBriefSection
                    brief={profileData.executiveBrief}
                    legacySummary={profileData.executiveSummary}
                    status={briefStatus}
                    error={briefError}
                    isStale={isBriefStale}
                    readOnly={isShareView}
                    isHidden={isExecutiveSummaryHidden}
                    onToggleSection={handleToggleSectionActive}
                    onGenerate={(options) => requestExecutiveBrief(options)}
                    onUndo={handleUndoExecutiveBrief}
                    onChangeBrief={handleChangeExecutiveBrief}
                    glance={briefGlance}
                    livePercents={briefLivePercents}
                    advertiserName={advertiserName}
                    geography={geography}
                  />
                )}

              {/* Sourcing and Grounding List */}
              {(!isShareView || !isSourcesHidden) && (
                <div className={`group relative rounded-2xl border p-5 md:p-6 shadow-xs transition-all ${
                  isSourcesHidden
                    ? "border-dashed border-slate-300 bg-slate-100/70 opacity-40 hover:opacity-70"
                    : "bg-white border-slate-100"
                }`}>
                  <div className="w-full flex items-center justify-between text-left">
                    <button
                      type="button"
                      onClick={() => setIsCitationsExpanded((prev) => !prev)}
                      aria-expanded={isCitationsExpanded}
                      className="flex items-center gap-2 text-indigo-600 text-xs font-bold uppercase tracking-wider cursor-pointer group text-left flex-1"
                    >
                      <BookOpen className="w-4 h-4 text-indigo-600" />
                      <span className="text-slate-900 group-hover:text-indigo-600 transition-colors">
                        Citations
                      </span>
                    </button>
                    <div className="flex items-center gap-2">
                      {!isShareView && (
                        <SectionVisibilityButton
                          sectionKey="sources"
                          isInactive={isSourcesHidden}
                          onToggle={handleToggleSectionActive}
                        />
                      )}
                      <button
                        type="button"
                        onClick={() => setIsCitationsExpanded((prev) => !prev)}
                        className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 group-hover:text-slate-600 hover:bg-slate-50 transition-colors cursor-pointer"
                        aria-label={isCitationsExpanded ? "Collapse Citations" : "Expand Citations"}
                      >
                        <ChevronDown
                          className={`w-5 h-5 text-slate-400 group-hover:text-slate-600 transition-transform duration-200 ${
                            isCitationsExpanded ? "rotate-180" : ""
                          }`}
                        />
                      </button>
                    </div>
                  </div>

                {isCitationsExpanded && (
                  <div className="mt-4 pt-4 border-t border-slate-100 space-y-4">
                    <div className="space-y-3.5">
                      {profileData.sources.map((source, index) => (
                        <div key={index} className="border-b border-slate-50 pb-3.5 last:border-0 last:pb-0">
                          <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                            <div className="flex items-center gap-2">
                              <span className="w-5 h-5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-bold flex items-center justify-center font-mono">
                                {index + 1}
                              </span>
                              {source.url ? (
                                <a
                                  href={source.url}
                                  target="_blank"
                                  referrerPolicy="no-referrer"
                                  rel="noopener noreferrer"
                                  className="text-xs font-bold text-indigo-600 hover:text-indigo-800 hover:underline inline-flex items-center gap-1"
                                >
                                  <span>{source.name}</span>
                                  <ExternalLink className="w-3 h-3 shrink-0 text-indigo-400" />
                                </a>
                              ) : (
                                // Same treatment as a linked source, minus the affordances that
                                // would imply something to click.
                                <span className="text-xs font-bold text-indigo-600">{source.name}</span>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[9px] font-mono px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 font-semibold border border-indigo-100/30">
                                {source.tier}
                              </span>
                              <span className="text-[9px] font-mono px-2 py-0.5 rounded bg-slate-50 text-slate-600 font-semibold border border-slate-100">
                                {source.usageType}
                              </span>
                            </div>
                          </div>
                          <p className="text-[11px] text-slate-600 leading-relaxed pl-7">
                            <strong className="text-slate-700">Supported:</strong> {source.supportedClaims}
                          </p>
                        </div>
                      ))}
                    </div>

                    {/* Grounding Sources (from Search metadata) */}
                    {groundingSources && groundingSources.length > 0 && (
                      <div className="mt-5 pt-4 border-t border-slate-100/80">
                        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-500 mb-2">
                          <ShieldCheck className="w-4 h-4 text-emerald-500" />
                          <span>Google Search Grounding Verifications</span>
                        </div>
                        <p className="text-[10px] text-slate-400 mb-3 leading-normal">
                          The following web URLs were dynamically queried and analyzed during this session to confirm claim precision:
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {groundingSources.slice(0, 5).map((source, idx) => (
                            <a
                              key={idx}
                              href={source.uri}
                              target="_blank"
                              referrerPolicy="no-referrer"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 bg-slate-50 hover:bg-slate-100 text-slate-600 px-2.5 py-1 rounded-md text-[10px] border border-slate-100 font-mono transition-colors"
                            >
                              <span className="max-w-[120px] truncate">{source.title || "Search Verification"}</span>
                              <ExternalLink className="w-2.5 h-2.5 text-slate-400" />
                            </a>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Footer: Copy Sources button */}
                    <div className="pt-3 border-t border-slate-100 flex items-center justify-end">
                      <button
                        type="button"
                        onClick={handleCopySources}
                        className="inline-flex items-center gap-1.5 text-xs text-slate-600 bg-slate-50 hover:bg-slate-100 border border-slate-200 px-3 py-1.5 rounded-lg transition-colors cursor-pointer font-medium"
                      >
                        {copySourcesCopied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copySourcesCopied ? "Copied!" : "Copy Sources"}</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

              {/* AI QA Audit & Scoring Center */}
              {!isShareView && internalOnlyVisibility.qaAudit && profileData.auditResult && (
                <div className="bg-white rounded-2xl border border-slate-100 p-5 md:p-6 shadow-xs transition-all">
                  <button
                    type="button"
                    onClick={() => setIsAuditExpanded((prev) => !prev)}
                    aria-expanded={isAuditExpanded}
                    className="w-full flex items-center justify-between text-left cursor-pointer group"
                  >
                    <div className="flex items-center gap-2 text-indigo-600 text-xs font-bold uppercase tracking-wider">
                      <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span className="text-slate-900 group-hover:text-indigo-600 transition-colors">
                        Programmatic Media Buyer QA Audit
                      </span>
                      {profileData.generationAlerts && profileData.generationAlerts.length > 0 && (
                        <span className="ml-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-bold normal-case tracking-normal">
                          <AlertTriangle className="w-3 h-3" />
                          {profileData.generationAlerts.length} item{profileData.generationAlerts.length === 1 ? "" : "s"} did not complete
                        </span>
                      )}
                    </div>
                    <ChevronDown
                      className={`w-5 h-5 text-slate-400 group-hover:text-slate-600 transition-transform duration-200 ${
                        isAuditExpanded ? "rotate-180" : ""
                      }`}
                    />
                  </button>

                  {isAuditExpanded && (
                    <div className="mt-4 pt-4 border-t border-slate-100 space-y-6">
                      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-slate-100 pb-4">
                        <div>
                          <p className="text-[11px] text-slate-500">
                            Independent scoring and automated compliance check for client presentation readiness.
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {/* An unscored plan has no findings, which must not read as verified. */}
                          {profileData.auditResult.qaBypassed ? (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 text-amber-700 text-xs font-semibold border border-amber-200">
                              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                              {profileData.auditResult.quickMode ? "Quick Mode: Not Audited" : "Not Audited"}
                            </span>
                          ) : profileData.auditResult.findings?.some((f) => f.status !== "resolved" && f.severity !== "minor") ? (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 text-amber-700 text-xs font-semibold border border-amber-200">
                              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                              Open Issues to Review
                            </span>
                          ) : profileData.auditResult.autoFixes && profileData.auditResult.autoFixes.length > 0 ? (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 text-amber-700 text-xs font-semibold border border-amber-200">
                              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                              Auto-Corrected
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-semibold border border-emerald-200">
                              <Check className="w-3.5 h-3.5 shrink-0" />
                              Verified Client-Ready
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Generation alerts: what failed or was not found, instead of placeholder content */}
                      {profileData.generationAlerts && profileData.generationAlerts.length > 0 && (
                        <div role="status" className="bg-amber-50/80 border border-amber-200 rounded-xl p-4">
                          <div className="flex items-center gap-2 text-amber-800 text-xs font-bold uppercase tracking-wider mb-2.5">
                            <AlertTriangle className="w-4 h-4 text-amber-600" />
                            <span>{profileData.generationAlerts.length} item{profileData.generationAlerts.length === 1 ? "" : "s"} in this plan did not complete</span>
                          </div>
                          <ul className="space-y-1.5">
                            {profileData.generationAlerts.map((alert, idx) => (
                              <li key={idx} className="flex items-start gap-2 text-xs leading-relaxed text-slate-700">
                                <span className={`shrink-0 mt-px px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide ${alert.severity === "failed" ? "bg-rose-100 text-rose-700" : alert.severity === "not_found" ? "bg-slate-200 text-slate-600" : "bg-amber-100 text-amber-800"}`}>
                                  {alert.severity === "failed" ? "Failed" : alert.severity === "not_found" ? "Not found" : "Check"}
                                </span>
                                <span>{alert.message}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Executive Summary */}
                      <div className="bg-slate-50 border border-slate-100 rounded-xl p-4">
                        <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                          Executive QA Summary
                        </h4>
                        <p className="text-xs text-slate-600 leading-relaxed italic">
                          "{profileData.auditResult.executiveSummary}"
                        </p>
                      </div>

                      {/* Scorecard Layout */}
                      <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-center">
                        {/* Big Score Circle */}
                        <div className="md:col-span-4 flex flex-col items-center justify-center bg-slate-900 text-white rounded-xl p-5 border border-slate-800 text-center space-y-2">
                          <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-indigo-300">
                            Overall Media Score
                          </span>
                          <div className="relative flex items-center justify-center">
                            <div className={`w-24 h-24 rounded-full border-4 flex flex-col items-center justify-center ${profileData.auditResult.qaBypassed ? "border-amber-500/30" : "border-indigo-500/20"}`}>
                              {profileData.auditResult.qaBypassed ? (
                                <span className="text-[11px] font-mono font-bold text-amber-300 leading-tight px-2">
                                  Not
                                  <br />
                                  scored
                                </span>
                              ) : (
                                <>
                                  <span className="text-3xl font-mono font-extrabold text-indigo-400">
                                    {profileData.auditResult.finalScore}
                                  </span>
                                  <span className="text-[9px] font-mono text-indigo-300 tracking-wider">
                                    / 100
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                          {/* Verified plans are re-scored after fixes, so the score is the shipped plan's.
                              Otherwise it is the audit as issued, and this says what changed after it. */}
                          {!profileData.auditResult.qaBypassed && profileData.auditResult.verified && (
                            <p className="text-[10px] text-indigo-300/80 font-mono">
                              {profileData.auditResult.originalScore} before fixes · re-verified
                            </p>
                          )}
                          {!profileData.auditResult.qaBypassed && !profileData.auditResult.verified && profileData.auditResult.remediationApplied && (
                            <p className="text-[10px] text-indigo-300/80 font-mono">
                              {profileData.auditResult.autoFixes.length} fix{profileData.auditResult.autoFixes.length === 1 ? "" : "es"} applied after audit
                            </p>
                          )}
                          {profileData.auditResult.auditModel && (
                            <p className="text-[9px] text-slate-500 font-mono">Audited by {profileData.auditResult.auditModel}</p>
                          )}
                          <p className={`text-[11px] leading-relaxed px-2 font-medium ${profileData.auditResult.qaBypassed ? "text-amber-300" : "text-slate-300"}`}>
                            {profileData.auditResult.quickMode
                              ? "Quick mode — not audited. Run QA Audit before sharing with a client."
                              : profileData.auditResult.qaBypassed
                              ? "QA agent unavailable — profile is unverified. Review before presenting."
                              : (profileData.auditResult.finalScore >= 95
                                ? "Excellent (Presentation Approved)"
                                : profileData.auditResult.finalScore >= 70
                                  ? "Pass (Review Flag Details)"
                                  : "Below Standard (Review Before Presenting)")}
                          </p>
                        </div>

                        {/* Categories list */}
                        <div className="md:col-span-8 space-y-3.5">
                          <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                            Evaluation Scorecard
                          </h4>
                          <div className="space-y-3">
                            {profileData.auditResult.scorecard.map((item, idx) => {
                              // A bypassed audit has no scores. Render it as absent rather than
                              // as a row of zeroes, which would read as a failed evaluation.
                              const bypassed = Boolean(profileData.auditResult?.qaBypassed);
                              const scorePct = bypassed ? 0 : (item.score / 20) * 100;
                              let barColor = "bg-emerald-500";
                              if (item.score < 15) barColor = "bg-amber-500";
                              if (item.score < 10) barColor = "bg-rose-500";
                              if (bypassed) barColor = "bg-slate-300";

                              return (
                                <div key={idx} className="space-y-1">
                                  <div className="flex justify-between items-center text-xs">
                                    <span className="font-bold text-slate-700">{item.category}</span>
                                    <span className="font-mono font-bold text-slate-800 bg-slate-100 px-1.5 py-0.5 rounded">
                                      {bypassed ? "— / 20" : `${item.score} / 20`}
                                    </span>
                                  </div>
                                  <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                                    <div className={`h-full ${barColor} transition-all duration-500`} style={{ width: `${scorePct}%` }}></div>
                                  </div>
                                  <p className="text-[10px] text-slate-500 pl-1 leading-normal">
                                    {item.notes}
                                  </p>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>

                      {/* Highlights & Flags */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                        {/* Strategic Highlights */}
                        <div className="border border-emerald-100 bg-emerald-50/20 rounded-xl p-4 space-y-3">
                          <div className="flex items-center gap-1.5 text-emerald-800 border-b border-emerald-100 pb-2">
                            <Check className="w-4 h-4 text-emerald-600" />
                            <h4 className="text-xs font-bold uppercase tracking-wider">
                              🏆 Strategic Highlights
                            </h4>
                          </div>
                          <ul className="space-y-2">
                            {profileData.auditResult.strategicHighlights.map((hl, i) => (
                              <li key={i} className="text-xs text-slate-600 leading-relaxed flex items-start gap-2">
                                <span className="text-emerald-500 shrink-0 mt-0.5">✔</span>
                                <span>{hl}</span>
                              </li>
                            ))}
                          </ul>
                        </div>

                        {/* Red Flags & Auto-Fixes */}
                        <div className="border border-indigo-100 bg-indigo-50/10 rounded-xl p-4 space-y-3">
                          <div className="flex items-center gap-1.5 text-indigo-800 border-b border-indigo-100 pb-2">
                            <AlertTriangle className="w-4 h-4 text-indigo-500" />
                            <h4 className="text-xs font-bold uppercase tracking-wider">
                              🚨 Findings & Fixes
                            </h4>
                          </div>
                          <QaFindings audit={profileData.auditResult} />
                        </div>
                      </div>

                      <GenerationLog entries={profileData.generationLog} />
                    </div>
                  )}
                </div>
              )}

              {/* Additional RFP Requirements & Agency Capability Responses */}
              {!isShareView && profileData.additionalRfpRequirements && 
               (profileData.additionalRfpRequirements.isRfpDocument ||
                (profileData.additionalRfpRequirements.rfpAsksAndQuestions && profileData.additionalRfpRequirements.rfpAsksAndQuestions.length > 0) ||
                (profileData.additionalRfpRequirements.digitalRemedyCapabilityMatches && profileData.additionalRfpRequirements.digitalRemedyCapabilityMatches.length > 0) ||
                profileData.additionalRfpRequirements.rfpSummary ||
                profileData.additionalRfpRequirements.additionalNotes) && (
                <div className="bg-white rounded-2xl border border-indigo-100 p-5 md:p-6 shadow-xs space-y-6">
                  {/* Section Header */}
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-indigo-100/60 pb-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <FileText className="w-5 h-5 text-indigo-600" />
                        <h3 className="text-sm font-display font-bold text-slate-800 uppercase tracking-wider">
                          RFP Requirements & Agency Capability Responses
                        </h3>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Full alignment matrix addressing all custom RFP questions, operational guidelines, and agency execution capabilities.
                      </p>
                    </div>
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-50 text-indigo-700 text-xs font-semibold border border-indigo-200/60">
                      <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
                      Verified RFP Analysis
                    </span>
                  </div>

                  {/* RFP Executive Summary */}
                  {profileData.additionalRfpRequirements.rfpSummary && (
                    <div className="bg-indigo-50/40 border border-indigo-100/80 rounded-xl p-4 space-y-1.5">
                      <h4 className="text-xs font-bold text-indigo-900 uppercase tracking-wider flex items-center gap-1.5">
                        <Info className="w-3.5 h-3.5 text-indigo-600" />
                        RFP Scope & Executive Overview
                      </h4>
                      <p className="text-xs text-slate-700 leading-relaxed font-normal">
                        {profileData.additionalRfpRequirements.rfpSummary}
                      </p>
                    </div>
                  )}

                  {/* Operational Parameters Grid */}
                  {profileData.additionalRfpRequirements.extractedMetadata && (
                    <div className="space-y-2">
                      <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5 text-slate-500" />
                        RFP Operational & Administrative Specifications
                      </h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                        {profileData.additionalRfpRequirements.extractedMetadata.submissionDueDate && (
                          <div className="bg-slate-50 border border-slate-100 p-3 rounded-xl space-y-0.5">
                            <span className="text-[10px] font-mono font-bold uppercase text-slate-400 block">Submission Deadline</span>
                            <span className="text-xs font-bold text-slate-800">{profileData.additionalRfpRequirements.extractedMetadata.submissionDueDate}</span>
                          </div>
                        )}
                        {profileData.additionalRfpRequirements.extractedMetadata.flightDates && (
                          <div className="bg-slate-50 border border-slate-100 p-3 rounded-xl space-y-0.5">
                            <span className="text-[10px] font-mono font-bold uppercase text-slate-400 block">Campaign Flight Dates</span>
                            <span className="text-xs font-bold text-slate-800">{profileData.additionalRfpRequirements.extractedMetadata.flightDates}</span>
                          </div>
                        )}
                        {profileData.additionalRfpRequirements.extractedMetadata.paymentTerms && (
                          <div className="bg-slate-50 border border-slate-100 p-3 rounded-xl space-y-0.5">
                            <span className="text-[10px] font-mono font-bold uppercase text-slate-400 block">Payment / Invoicing Terms</span>
                            <span className="text-xs font-bold text-slate-800">{profileData.additionalRfpRequirements.extractedMetadata.paymentTerms}</span>
                          </div>
                        )}
                        {profileData.additionalRfpRequirements.extractedMetadata.budget ? (
                          <div className="bg-slate-50 border border-slate-100 p-3 rounded-xl space-y-0.5">
                            <span className="text-[10px] font-mono font-bold uppercase text-slate-400 block">Stated Budget</span>
                            <span className="text-xs font-bold text-emerald-700">${profileData.additionalRfpRequirements.extractedMetadata.budget.toLocaleString()}</span>
                          </div>
                        ) : null}
                        {profileData.additionalRfpRequirements.extractedMetadata.reportingRequirements && profileData.additionalRfpRequirements.extractedMetadata.reportingRequirements.length > 0 && (
                          <div className="bg-slate-50 border border-slate-100 p-3 rounded-xl space-y-0.5 col-span-1 sm:col-span-2">
                            <span className="text-[10px] font-mono font-bold uppercase text-slate-400 block">Reporting Cadence & Analytics</span>
                            <span className="text-xs font-semibold text-slate-700">{profileData.additionalRfpRequirements.extractedMetadata.reportingRequirements.join(" • ")}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Capability Matches / Question Responses */}
                  {profileData.additionalRfpRequirements.digitalRemedyCapabilityMatches && profileData.additionalRfpRequirements.digitalRemedyCapabilityMatches.length > 0 && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                        <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                          <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
                          Specific RFP Questions & Digital Remedy Solutions
                        </h4>
                        <span className="text-[10px] font-mono text-slate-500 font-semibold">
                          {profileData.additionalRfpRequirements.digitalRemedyCapabilityMatches.length} Asks Addressed
                        </span>
                      </div>

                      <div className="space-y-3">
                        {profileData.additionalRfpRequirements.digitalRemedyCapabilityMatches.map((match, idx) => (
                          <div key={idx} className="bg-slate-50/70 border border-slate-100 hover:border-indigo-200 rounded-xl p-4 transition-all space-y-2.5">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div className="flex items-start gap-2 max-w-2xl">
                                <span className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 font-mono text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                                  {idx + 1}
                                </span>
                                <div>
                                  <span className="text-[10px] font-mono font-bold uppercase text-slate-400 block">RFP Question / Ask</span>
                                  <h5 className="text-xs font-bold text-slate-900 leading-snug">{match.rfpAsk}</h5>
                                </div>
                              </div>
                              <span className={`inline-flex items-center gap-1 text-[10px] font-mono font-bold px-2.5 py-1 rounded-full border ${
                                match.isSupported !== false 
                                  ? "bg-emerald-50 text-emerald-700 border-emerald-200" 
                                  : "bg-amber-50 text-amber-700 border-amber-200"
                              }`}>
                                <Check className="w-3 h-3" />
                                {match.isSupported !== false ? "Capability Supported" : "Custom Configuration"}
                              </span>
                            </div>

                            <div className="pl-7 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                              <div className="bg-white border border-slate-100 rounded-lg p-3 space-y-1">
                                <span className="text-[10px] font-mono font-bold uppercase text-indigo-600 block">Digital Remedy Solution</span>
                                <p className="text-slate-800 font-semibold leading-relaxed">{match.digitalRemedySolution}</p>
                              </div>
                              <div className="bg-white border border-slate-100 rounded-lg p-3 space-y-1">
                                <span className="text-[10px] font-mono font-bold uppercase text-slate-500 block">Execution & Technology Details</span>
                                <p className="text-slate-600 leading-relaxed text-[11px]">{match.capabilityDetails}</p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Additional RFP Notes & Guidelines */}
                  {profileData.additionalRfpRequirements.additionalNotes && (
                    <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 space-y-1.5">
                      <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                        <BookOpen className="w-3.5 h-3.5 text-slate-500" />
                        Additional RFP Guidelines & Agency Workflows
                      </h4>
                      <p className="text-xs text-slate-600 leading-relaxed font-normal whitespace-pre-line">
                        {profileData.additionalRfpRequirements.additionalNotes}
                      </p>
                    </div>
                  )}
                </div>
              )}

            </div> {/* End of #profile-export-content wrapper */}

              {/* Advanced Regenerate Triggers */}
              {!isShareView && (
                <div className="bg-slate-50 border border-slate-100 rounded-2xl p-5 md:p-6 text-center space-y-4">
                  <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Advanced Strategy Tuning</h4>
                  <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
                    Tweak the planning assumptions by triggering the generation agent again with localized weighting configurations.
                  </p>
                  <div className="flex flex-wrap justify-center gap-3">
                    <button
                      onClick={() => setIsAuditModalOpen(true)}
                      disabled={!activeSavedId}
                      className="inline-flex items-center gap-1.5 text-xs bg-white hover:bg-indigo-50 text-indigo-700 border border-indigo-200 px-4 py-2 rounded-xl transition-all font-semibold shadow-xs hover:shadow-sm cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                      title={activeSavedId ? "Audit the saved plan and review proposed fixes before any are applied" : "Save the plan first to run a QA audit"}
                    >
                      <ShieldCheck className="w-3.5 h-3.5" />
                      <span>Run QA Audit</span>
                    </button>

                    <button
                      onClick={() => handleGenerate(undefined, "stricter_sourcing")}
                      disabled={loading}
                      className="inline-flex items-center gap-1.5 text-xs text-indigo-700 bg-white hover:bg-indigo-50 border border-indigo-100 px-4 py-2 rounded-xl transition-all font-semibold shadow-xs hover:shadow-sm cursor-pointer disabled:opacity-55"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Regenerate with Stricter Sourcing</span>
                    </button>

                    <button
                      onClick={() => handleGenerate(undefined, "more_strategic")}
                      disabled={loading}
                      className="inline-flex items-center gap-1.5 text-xs text-emerald-700 bg-white hover:bg-emerald-50 border border-emerald-100 px-4 py-2 rounded-xl transition-all font-semibold shadow-xs hover:shadow-sm cursor-pointer disabled:opacity-55"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Regenerate with Deeper Recommendations</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          </>)}</RenderBelow>
          </ErrorBoundary>
        </section>
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-100 py-6 px-6 mt-12">
        <div className="max-w-[1500px] mx-auto flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-slate-400">
          <div>
            <span>&copy; 2026 Digital Remedy Audience Profile Builder. All rights reserved.</span>
          </div>
        </div>
      </footer>

      {/* Wide Centered Modal for Media Plan Preview */}
      {isPreviewModalOpen && parsedSheetsData.length > 0 && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 md:p-6 z-[9999]">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-100 w-full max-w-[1200px] h-[85vh] flex flex-col overflow-hidden max-h-[85vh]">
            
            {/* Modal Header */}
            <div className="bg-slate-50 border-b border-slate-100 py-4 px-6 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                  <Layers className="w-4.5 h-4.5" />
                </div>
                <div>
                  <h3 className="font-display font-bold text-slate-800 text-sm md:text-base flex items-center gap-2">
                    Uploaded File Content & AI Analysis
                    <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
                      Parsed Successfully
                    </span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5 font-mono truncate max-w-[500px]">
                    {uploadedFileName || "Uploaded Document File"}
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setIsPreviewModalOpen(false);
                  setModalSearchQuery("");
                }}
                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer text-xs font-semibold flex items-center gap-1 border border-slate-200 bg-white"
              >
                Close Preview
              </button>
            </div>

            {/* Modal Main Grid */}
            <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden">
              
              {/* Left Sidebar: Tabs and Key-Value Insights */}
              <div className="w-full md:w-[280px] shrink-0 bg-slate-50/50 border-b md:border-b-0 md:border-r border-slate-100 p-4 overflow-y-auto custom-scrollbar flex flex-col gap-5">
                
                {/* Workbook Tabs Section */}
                {parsedSheetsData.length > 1 && (
                  <div className="space-y-1.5 shrink-0">
                    <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                      Workbook Tabs / Sheets
                    </h4>
                    <div className="flex md:flex-col gap-2 md:gap-1.5 overflow-x-auto md:overflow-x-visible pb-2 md:pb-0 snap-x">
                      {parsedSheetsData.map((sheet, index) => (
                        <button
                          key={index}
                          type="button"
                          onClick={() => {
                            setActiveSheetIndex(index);
                            setModalCurrentPage(1);
                            setModalSearchQuery("");
                          }}
                          className={`text-left text-xs font-semibold px-3 py-2 rounded-xl transition-all flex items-center justify-between shrink-0 md:shrink border cursor-pointer w-full ${
                            activeSheetIndex === index
                              ? "bg-white text-indigo-700 shadow-xs border-indigo-200 font-bold"
                              : "text-slate-600 hover:bg-slate-100/60 border-transparent hover:text-slate-900"
                          }`}
                        >
                          <span className="truncate max-w-[140px]">{sheet.name}</span>
                          <span className="text-[10px] bg-slate-100 text-slate-400 px-1.5 py-0.5 rounded-md font-mono shrink-0 ml-2">
                            {sheet.rows.length} rows
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Key-Value Extracted Metadata Section */}
                {(() => {
                  const meta = extractMetadata(parsedSheetsData[activeSheetIndex]?.rows || []);
                  return (
                    <div className="space-y-3">
                      <div className="flex items-center gap-1.5 border-b border-slate-200/60 pb-1.5">
                        <Info className="w-3.5 h-3.5 text-indigo-500" />
                        <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                          Extracted Key Insights
                        </h4>
                      </div>
                      
                      {meta.length > 0 ? (
                        <div className="space-y-2">
                          {meta.map((item, idx) => (
                            <div key={idx} className="bg-white p-2.5 rounded-xl border border-slate-100 shadow-xs">
                              <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">
                                {item.key}
                              </span>
                              <span className="block text-xs font-semibold text-slate-700 break-words">
                                {item.value}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="bg-white/40 border border-dashed border-slate-200 p-3 rounded-xl text-center">
                          <p className="text-[10px] text-slate-400 italic">
                            No standard metadata headers (such as Advertiser, Brand, Campaign, Planner) detected in the top rows of this sheet.
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Legend & Instructions */}
                <div className="bg-indigo-50/50 rounded-xl p-3 border border-indigo-100/40 text-[10px] text-indigo-800 leading-normal mt-auto">
                  <p className="font-bold flex items-center gap-1 mb-1 text-indigo-900">
                    <ShieldCheck className="w-3 h-3 text-indigo-600" />
                    <span>Privacy & Clean Analysis</span>
                  </p>
                  <span>This visual grid displays raw cell ranges with full integrity. Contact info can be safely ignored; only media targeting, publishers, placements, and buy models will be analyzed for the final plan.</span>
                </div>
              </div>

              {/* Right Main Table Area */}
              <div className="flex-1 flex flex-col min-h-0 overflow-hidden p-5 bg-white">
                
                {/* Modal Tab Switcher */}
                <div className="flex border-b border-slate-100 mb-4 gap-2 shrink-0">
                  <button
                    onClick={() => setModalTab("ai")}
                    className={`pb-2 px-3 text-xs font-semibold border-b-2 transition-all cursor-pointer flex items-center gap-1.5 ${
                      modalTab === "ai"
                        ? "border-indigo-600 text-indigo-700 font-bold"
                        : "border-transparent text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
                    <span>AI-Extracted Content</span>
                    {extractedPlacements.length > 0 && (
                      <span className="text-[10px] px-1.5 py-0.2 rounded-full font-mono bg-indigo-100 text-indigo-700 font-bold">
                        {extractedPlacements.length}
                      </span>
                    )}
                    {isParsingPlan && <Loader2 className="w-3 h-3 animate-spin text-indigo-500" />}
                  </button>
                  {!rfpAnalysis && parsedSheetsData.length > 0 && (
                    <button
                      onClick={() => setModalTab("raw")}
                      className={`pb-2 px-3 text-xs font-semibold border-b-2 transition-all cursor-pointer ${
                        modalTab === "raw"
                          ? "border-indigo-600 text-indigo-700 font-bold"
                          : "border-transparent text-slate-500 hover:text-slate-800"
                      }`}
                    >
                      Spreadsheet Data Grid
                    </button>
                  )}
                </div>

                {modalTab === "raw" && !rfpAnalysis ? (
                  <>
                    {/* Controls Bar */}
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4 shrink-0">
                      {/* Tab Diagnostics Info */}
                      <div className="space-y-1">
                        <h4 className="font-semibold text-sm text-slate-800 flex items-center gap-2">
                          {parsedSheetsData[activeSheetIndex]?.name}
                          {parsedSheetsData[activeSheetIndex]?.diagnostics && (
                            <span className="text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-100">
                              {parsedSheetsData[activeSheetIndex].diagnostics}
                            </span>
                          )}
                        </h4>
                        <p className="text-xs text-slate-400">
                          Total Rows: {parsedSheetsData[activeSheetIndex]?.rows?.length || 0} | Columns: {parsedSheetsData[activeSheetIndex]?.headers?.length || 0}
                        </p>
                      </div>

                      {/* In-Modal Filter / Search */}
                      <div className="relative w-full sm:w-[280px]">
                        <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-slate-400">
                          <Target className="w-3.5 h-3.5" />
                        </span>
                        <input
                          type="text"
                          placeholder="Search rows in this tab..."
                          value={modalSearchQuery}
                          onChange={(e) => {
                            setModalSearchQuery(e.target.value);
                            setModalCurrentPage(1); // Reset page on filter
                          }}
                          className="w-full pl-9 pr-8 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:border-indigo-500 text-slate-800 placeholder:text-slate-400"
                        />
                        {modalSearchQuery && (
                          <button
                            onClick={() => setModalSearchQuery("")}
                            className="absolute inset-y-0 right-0 flex items-center pr-2.5 text-slate-400 hover:text-slate-600 text-xs font-semibold"
                          >
                            Clear
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Tabular Grid Table */}
                    <div className="flex-1 min-h-0 overflow-auto border border-slate-100 rounded-xl custom-scrollbar relative">
                      {(() => {
                        const activeSheet = parsedSheetsData[activeSheetIndex];
                        if (!activeSheet || !activeSheet.rows || activeSheet.rows.length === 0) {
                          return (
                            <div className="text-center py-12 text-slate-400 text-xs">
                              No data found in this sheet.
                            </div>
                          );
                        }

                        // Helper to check if a row looks like a header row
                        const isHeaderRow = (r: any[]) => {
                          const headersKeywords = ["site", "network", "placement", "buy type", "ad type", "geography", "audience", "cpm", "budget", "impressions", "net cost", "cost model", "rate"];
                          let matchCount = 0;
                          r.forEach(cell => {
                            const val = String(cell).toLowerCase().trim();
                            if (headersKeywords.some(keyword => val === keyword || val.includes(keyword))) {
                              matchCount++;
                            }
                          });
                          return matchCount >= 2;
                        };

                        // Filter the rows based on search query
                        const filteredRows = activeSheet.rows.filter((row) => {
                          if (!modalSearchQuery) return true;
                          return row.some(cell => 
                            cell !== null && cell !== undefined && 
                            String(cell).toLowerCase().includes(modalSearchQuery.toLowerCase())
                          );
                        });

                        // Apply pagination
                        const totalRows = filteredRows.length;
                        const startIndex = (modalCurrentPage - 1) * rowsPerPage;
                        const paginatedRows = filteredRows.slice(startIndex, startIndex + rowsPerPage);
                        const totalPages = Math.ceil(totalRows / rowsPerPage) || 1;

                        return (
                          <div className="flex flex-col h-full justify-between">
                            <div className="overflow-x-auto">
                              <table className="w-full text-left border-collapse table-auto text-xs">
                                <thead className="bg-slate-50 text-slate-600 border-b border-slate-100 sticky top-0 z-20">
                                  <tr>
                                    <th className="py-2.5 px-3 font-semibold text-[10px] tracking-wider uppercase text-slate-400 w-12 text-center border-r border-slate-100 bg-slate-50">
                                      #
                                    </th>
                                    {activeSheet.headers.map((hdr, colIdx) => (
                                      <th 
                                        key={colIdx} 
                                        className="py-2.5 px-4 font-semibold text-[10px] tracking-wider uppercase border-r border-slate-100 bg-slate-50 truncate max-w-[200px]"
                                        title={hdr || `Column ${colIdx + 1}`}
                                      >
                                        {hdr || `Column ${colIdx + 1}`}
                                      </th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 text-slate-700 bg-white font-mono">
                                  {paginatedRows.map((row, rIdx) => {
                                    const originalRowIndex = startIndex + rIdx + 1;
                                    const isHeader = isHeaderRow(row);
                                    return (
                                      <tr 
                                        key={rIdx} 
                                        className={`transition-colors ${
                                          isHeader 
                                            ? "bg-indigo-50/40 font-semibold text-slate-900 border-y border-indigo-100/50" 
                                            : "hover:bg-slate-50/50"
                                        }`}
                                      >
                                        <td className="py-2 px-3 font-mono text-[10px] text-slate-400 text-center border-r border-slate-100 bg-slate-50/30">
                                          {originalRowIndex}
                                        </td>
                                        {activeSheet.headers.map((_, colIdx) => {
                                          const val = row[colIdx];
                                          const cellString = val !== null && val !== undefined ? String(val) : "";
                                          return (
                                            <td 
                                              key={colIdx} 
                                              className={`py-2 px-4 border-r border-slate-100 truncate max-w-[250px] whitespace-nowrap ${
                                                isHeader ? "font-bold text-indigo-950 font-sans" : "font-sans text-slate-700"
                                              }`}
                                              title={cellString}
                                            >
                                              {cellString || "-"}
                                            </td>
                                          );
                                        })}
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>

                            {/* Empty state for search results */}
                            {totalRows === 0 && (
                              <div className="text-center py-16 text-slate-400 text-xs">
                                No rows match your search query: <strong className="font-semibold text-slate-600">"{modalSearchQuery}"</strong>
                              </div>
                            )}

                            {/* Modal Table Footer for Pagination */}
                            <div className="bg-slate-50 border-t border-slate-100 py-3 px-4 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0 mt-auto">
                              <div className="text-xs text-slate-500 font-medium">
                                Showing <span className="font-bold text-slate-800">{totalRows > 0 ? startIndex + 1 : 0}</span> to{" "}
                                <span className="font-bold text-slate-800">
                                  {Math.min(startIndex + rowsPerPage, totalRows)}
                                </span>{" "}
                                of <span className="font-bold text-slate-800">{totalRows}</span> filtered rows
                                {modalSearchQuery && (
                                  <span> (filtered from {activeSheet?.rows?.length || 0} total)</span>
                                )}
                              </div>
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => setModalCurrentPage(prev => Math.max(1, prev - 1))}
                                  disabled={modalCurrentPage === 1}
                                  className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-600 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors cursor-pointer"
                                >
                                  Prev
                                </button>
                                <div className="text-xs text-slate-500 font-mono">
                                  Page <span className="font-bold text-slate-800">{modalCurrentPage}</span> of <span className="font-bold text-slate-800">{totalPages}</span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => setModalCurrentPage(prev => Math.min(totalPages, prev + 1))}
                                  disabled={modalCurrentPage === totalPages}
                                  className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-600 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors cursor-pointer"
                                >
                                  Next
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  </>
                ) : (
                  <div className="flex-1 flex flex-col min-h-0 overflow-y-auto space-y-4 pr-1 custom-scrollbar">
                    {isParsingPlan ? (
                      <div className="flex-1 flex flex-col items-center justify-center text-center p-8 space-y-4">
                        <Loader2 className="w-10 h-10 animate-spin text-indigo-600" />
                        <div className="space-y-1.5 max-w-md">
                          <h4 className="font-bold text-slate-800 text-sm">AI Pipeline Active</h4>
                          <p className="text-xs text-slate-500 leading-relaxed">
                            The AI pipeline is analyzing the document, running custom extraction scripts, and structuring brief parameters with precision...
                          </p>
                        </div>
                      </div>
                    ) : (
                      <>
                        {/* RFP Brief Analysis & Capability Section */}
                        {rfpAnalysis && (
                          <div className="space-y-4">
                            {/* Executive Summary */}
                            {rfpAnalysis.rfpSummary && (
                              <div className="bg-slate-900 text-white p-4 rounded-xl border border-slate-800 space-y-1.5 shadow-xs">
                                <div className="flex items-center gap-2 text-emerald-400 font-bold text-xs uppercase tracking-wider">
                                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                                  <span>RFP Executive Summary</span>
                                </div>
                                <p className="text-xs text-slate-300 leading-relaxed">
                                  {rfpAnalysis.rfpSummary}
                                </p>
                              </div>
                            )}

                            {/* Extracted Brief Specifications */}
                            {rfpAnalysis.extractedMetadata && (
                              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200/80 space-y-3">
                                <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider border-b border-slate-200 pb-2">
                                  Extracted Brief Specifications
                                </h4>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                                  {rfpAnalysis.extractedMetadata.flightDates && (
                                    <div className="bg-white p-2.5 rounded-lg border border-slate-200/60 shadow-2xs">
                                      <span className="text-slate-400 font-bold block text-[10px] uppercase mb-0.5">Flight Dates</span>
                                      <span className="font-mono text-slate-800 font-semibold">{rfpAnalysis.extractedMetadata.flightDates}</span>
                                    </div>
                                  )}
                                  {rfpAnalysis.extractedMetadata.submissionDueDate && (
                                    <div className="bg-white p-2.5 rounded-lg border border-slate-200/60 shadow-2xs">
                                      <span className="text-slate-400 font-bold block text-[10px] uppercase mb-0.5">Submission Due Date</span>
                                      <span className="font-mono text-amber-700 font-bold">{rfpAnalysis.extractedMetadata.submissionDueDate}</span>
                                    </div>
                                  )}
                                  {rfpAnalysis.extractedMetadata.targetAudiences && rfpAnalysis.extractedMetadata.targetAudiences.length > 0 && (
                                    <div className="bg-white p-2.5 rounded-lg border border-slate-200/60 md:col-span-2 shadow-2xs">
                                      <span className="text-slate-400 font-bold block text-[10px] uppercase mb-1">Target Audiences</span>
                                      <div className="flex flex-wrap gap-1.5">
                                        {rfpAnalysis.extractedMetadata.targetAudiences.map((aud, idx) => (
                                          <span key={idx} className="bg-indigo-50 text-indigo-700 border border-indigo-200 px-2 py-0.5 rounded text-xs font-medium">
                                            {aud}
                                          </span>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  {rfpAnalysis.extractedMetadata.geographies && rfpAnalysis.extractedMetadata.geographies.length > 0 && (
                                    <div className="bg-white p-2.5 rounded-lg border border-slate-200/60 md:col-span-2 shadow-2xs">
                                      <span className="text-slate-400 font-bold block text-[10px] uppercase mb-1">Geographic Targeting</span>
                                      <div className="flex flex-wrap gap-1.5">
                                        {rfpAnalysis.extractedMetadata.geographies.map((geo, idx) => (
                                          <span key={idx} className="bg-slate-100 text-slate-700 border border-slate-200 px-2 py-0.5 rounded text-xs">
                                            {geo}
                                          </span>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  {rfpAnalysis.extractedMetadata.paymentTerms && (
                                    <div className="bg-white p-2.5 rounded-lg border border-slate-200/60 shadow-2xs">
                                      <span className="text-slate-400 font-bold block text-[10px] uppercase mb-0.5">Payment Terms</span>
                                      <span className="text-slate-800 font-medium">{rfpAnalysis.extractedMetadata.paymentTerms}</span>
                                    </div>
                                  )}
                                  {rfpAnalysis.extractedMetadata.reportingRequirements && rfpAnalysis.extractedMetadata.reportingRequirements.length > 0 && (
                                    <div className="bg-white p-2.5 rounded-lg border border-slate-200/60 md:col-span-2 shadow-2xs">
                                      <span className="text-slate-400 font-bold block text-[10px] uppercase mb-1">Reporting & Measurement Asks</span>
                                      <ul className="list-disc list-inside text-xs text-slate-700 space-y-1 pl-1">
                                        {rfpAnalysis.extractedMetadata.reportingRequirements.map((rep, idx) => (
                                          <li key={idx}>{rep}</li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}

                            {/* Capability Matches */}
                            {rfpAnalysis.digitalRemedyCapabilityMatches && rfpAnalysis.digitalRemedyCapabilityMatches.length > 0 && (
                              <div className="space-y-3 pt-1">
                                <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                                  <CheckCircle className="w-4 h-4 text-emerald-600" />
                                  <span>Grounded Digital Remedy Capability Matches ({rfpAnalysis.digitalRemedyCapabilityMatches.length})</span>
                                </h4>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                  {rfpAnalysis.digitalRemedyCapabilityMatches.map((match, idx) => (
                                    <div key={idx} className="bg-white p-3.5 rounded-xl border border-slate-200/80 shadow-2xs space-y-2">
                                      <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-2">
                                        <span className="font-bold text-slate-900 text-xs leading-snug">
                                          Ask: {match.rfpAsk}
                                        </span>
                                        <span className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
                                          <Check className="w-3 h-3 text-emerald-600" />
                                          {match.digitalRemedySolution}
                                        </span>
                                      </div>
                                      <p className="text-xs text-slate-600 leading-relaxed">
                                        {match.capabilityDetails}
                                      </p>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Placements Section (if present) */}
                        {extractedPlacements.length > 0 ? (
                          <div className="space-y-3 pt-2">
                            <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                              <Sparkles className="w-4 h-4 text-indigo-600" />
                              <span>Extracted Media Plan Line Items ({extractedPlacements.length})</span>
                            </h4>

                            {/* Multi-Plan Sub-Tabs Bar */}
                            {uniquePlanNames.length > 1 && (
                              <div className="flex items-center gap-1.5 overflow-x-auto pb-1.5 custom-scrollbar border-b border-slate-100 shrink-0">
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mr-1">Plan / Option:</span>
                                <button
                                  type="button"
                                  onClick={() => setActivePlanSubTab("ALL")}
                                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                                    activePlanSubTab === "ALL"
                                      ? "bg-indigo-600 text-white shadow-sm"
                                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                                  }`}
                                >
                                  <span>All Plans Combined</span>
                                  <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                                    activePlanSubTab === "ALL" ? "bg-indigo-500/60 text-white" : "bg-slate-200 text-slate-700"
                                  }`}>
                                    {extractedPlacements.length}
                                  </span>
                                </button>
                                {uniquePlanNames.map((planName) => {
                                  const count = extractedPlacements.filter((p) => (p.planName || "").trim() === planName).length;
                                  const isActive = activePlanSubTab === planName;
                                  return (
                                    <button
                                      type="button"
                                      key={planName}
                                      onClick={() => setActivePlanSubTab(planName)}
                                      className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                                        isActive
                                          ? "bg-indigo-600 text-white shadow-sm"
                                          : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                                      }`}
                                    >
                                      <span>{planName}</span>
                                      <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                                        isActive ? "bg-indigo-500/60 text-white" : "bg-slate-200 text-slate-700"
                                      }`}>
                                        {count}
                                      </span>
                                    </button>
                                  );
                                })}
                              </div>
                            )}

                            {/* KPI Dashboard Grid */}
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 shrink-0">
                              <div className="bg-indigo-50/50 border border-indigo-100/40 p-3 rounded-xl flex flex-col">
                                <span className="text-[9px] font-bold text-indigo-500 uppercase tracking-wider">
                                  {uniquePlanNames.length > 1 && activePlanSubTab !== "ALL" ? `${activePlanSubTab} Placements` : "AI Parsed Placements"}
                                </span>
                                <span className="text-lg font-mono font-extrabold text-indigo-800 mt-1">{displayedPlacements.length} Lines</span>
                              </div>
                              <div className="bg-emerald-50/50 border border-emerald-100/40 p-3 rounded-xl flex flex-col">
                                <span className="text-[9px] font-bold text-emerald-500 uppercase tracking-wider">Aggregated Net Budget</span>
                                <span className="text-lg font-mono font-extrabold text-emerald-800 mt-1">
                                  ${displayedPlacements.reduce((sum, p) => sum + (Number(p.budget) || 0), 0).toLocaleString()}
                                </span>
                              </div>
                              <div className="bg-slate-50 border border-slate-200 p-3 rounded-xl flex flex-col">
                                <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">Total Impressions</span>
                                <span className="text-lg font-mono font-extrabold text-slate-800 mt-1">
                                  {displayedPlacements.reduce((sum, p) => sum + (Number(p.impressions) || 0), 0).toLocaleString()}
                                </span>
                              </div>
                            </div>

                            {/* AI Placements Table Grid */}
                            <div className="border border-slate-100 rounded-xl custom-scrollbar overflow-x-auto">
                              <table className="w-full text-left border-collapse table-auto text-xs min-w-[1600px]">
                                <thead className="bg-slate-50 text-slate-600 border-b border-slate-100 sticky top-0 z-20">
                                  <tr>
                                    {uniquePlanNames.length > 1 && activePlanSubTab === "ALL" && (
                                      <th className="py-2.5 px-4 font-semibold text-[10px] tracking-wider uppercase text-indigo-600 bg-indigo-50/60 sticky left-0 z-30">Plan / Option</th>
                                    )}
                                    <th className="py-2.5 px-3 font-semibold text-[10px] tracking-wider uppercase text-slate-400 bg-slate-50">Adv. Perf.</th>
                                    <th className="py-2.5 px-4 font-semibold text-[10px] tracking-wider uppercase bg-slate-50">Media Type</th>
                                    <th className="py-2.5 px-4 font-semibold text-[10px] tracking-wider uppercase bg-slate-50">Product Type</th>
                                    <th className="py-2.5 px-4 font-semibold text-[10px] tracking-wider uppercase bg-slate-50">Placement Name</th>
                                    <th className="py-2.5 px-4 font-semibold text-[10px] tracking-wider uppercase bg-slate-50">Publisher</th>
                                    <th className="py-2.5 px-4 font-semibold text-[10px] tracking-wider uppercase bg-slate-50">Audience</th>
                                    <th className="py-2.5 px-4 font-semibold text-[10px] tracking-wider uppercase bg-slate-50">Start Date</th>
                                    <th className="py-2.5 px-4 font-semibold text-[10px] tracking-wider uppercase bg-slate-50">End Date</th>
                                    <th className="py-2.5 px-4 font-semibold text-[10px] tracking-wider uppercase bg-slate-50">Loc Type</th>
                                    <th className="py-2.5 px-4 font-semibold text-[10px] tracking-wider uppercase bg-slate-50">Loc Details</th>
                                    <th className="py-2.5 px-4 font-semibold text-[10px] tracking-wider uppercase bg-slate-50">Pricing Type</th>
                                    <th className="py-2.5 px-4 font-semibold text-[10px] tracking-wider uppercase bg-slate-50">Pricing Details</th>
                                    <th className="py-2.5 px-4 font-semibold text-[10px] tracking-wider uppercase bg-slate-50 text-right">Budget ($)</th>
                                    <th className="py-2.5 px-4 font-semibold text-[10px] tracking-wider uppercase bg-slate-50 text-right">Impressions</th>
                                    <th className="py-2.5 px-4 font-semibold text-[10px] tracking-wider uppercase bg-slate-50">Ad Sizes</th>
                                    <th className="py-2.5 px-4 font-semibold text-[10px] tracking-wider uppercase bg-slate-50">Notes</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 text-slate-700 bg-white font-sans">
                                  {displayedPlacements.map((p, idx) => (
                                    <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                                      {uniquePlanNames.length > 1 && activePlanSubTab === "ALL" && (
                                        <td className="py-2.5 px-4 font-semibold text-indigo-900 bg-indigo-50/20 whitespace-nowrap sticky left-0 z-10 border-r border-indigo-100/50">
                                          {p.planName || "Main Plan"}
                                        </td>
                                      )}
                                      <td className="py-2.5 px-3">
                                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold ${p.advPerformance === 'Yes' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-slate-50 text-slate-500 border border-slate-100'}`}>
                                          {p.advPerformance || "No"}
                                        </span>
                                      </td>
                                      <td className="py-2.5 px-4 font-medium text-slate-800">{p.mediaType || "-"}</td>
                                      <td className="py-2.5 px-4 text-slate-500">{p.productType || "-"}</td>
                                      <td className="py-2.5 px-4 text-slate-600 truncate max-w-[200px]" title={p.placementName}>{p.placementName || "-"}</td>
                                      <td className="py-2.5 px-4 font-semibold text-slate-900">{p.publisher || "-"}</td>
                                      <td className="py-2.5 px-4 text-slate-500 truncate max-w-[150px]" title={p.audience}>{p.audience || "-"}</td>
                                      <td className="py-2.5 px-4 font-mono text-slate-500 whitespace-nowrap">{p.startDate || "-"}</td>
                                      <td className="py-2.5 px-4 font-mono text-slate-500 whitespace-nowrap">{p.endDate || "-"}</td>
                                      <td className="py-2.5 px-4 text-slate-600">
                                        <span className="bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold">{p.locationType || "-"}</span>
                                      </td>
                                      <td className="py-2.5 px-4 text-slate-500 truncate max-w-[150px]" title={p.locationDetails}>{p.locationDetails || "-"}</td>
                                      <td className="py-2.5 px-4 font-mono font-bold text-slate-600">{p.pricingStructureType || "-"}</td>
                                      <td className="py-2.5 px-4 text-slate-500">{p.pricingStructureDetails || "-"}</td>
                                      <td className="py-2.5 px-4 text-right font-mono font-semibold text-slate-950">
                                        {p.budget !== undefined && p.budget !== null ? `$${Number(p.budget).toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 2})}` : "-"}
                                      </td>
                                      <td className="py-2.5 px-4 text-right font-mono text-slate-600">
                                        {p.impressions !== undefined && p.impressions !== null ? Number(p.impressions).toLocaleString() : "-"}
                                      </td>
                                      <td className="py-2.5 px-4 text-slate-500 whitespace-nowrap">{p.adSizes || "-"}</td>
                                      <td className="py-2.5 px-4 text-slate-500 italic max-w-[250px] truncate" title={p.notes}>{p.notes || "-"}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        ) : rfpAnalysis ? (
                          <div className="bg-indigo-50/80 border border-indigo-200 p-3.5 rounded-xl text-xs text-indigo-900 flex items-start gap-3">
                            <Info className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                            <div className="space-y-1">
                              <span className="font-bold block">RFP Strategic Brief Detected</span>
                              <p className="text-slate-600 leading-relaxed">
                                No pre-existing publisher line item schedule was attached to this RFP. Digital Remedy's strategy engine will automatically synthesize custom channel allocations, tactics, and vendor line items when you submit this request.
                              </p>
                            </div>
                          </div>
                        ) : parsingError ? (
                          <div className="flex-1 flex flex-col items-center justify-center text-center p-8 space-y-3">
                            <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center border border-red-100 text-red-600">
                              <Target className="w-5 h-5" />
                            </div>
                            <div className="space-y-1 max-w-md">
                              <h4 className="font-bold text-red-800 text-sm">AI Extraction Failed</h4>
                              <p className="text-xs text-red-600 leading-relaxed font-mono whitespace-pre-wrap">
                                {parsingError}
                              </p>
                            </div>
                          </div>
                        ) : null}
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Taxonomy Mapping Verification Modal */}
      <TaxonomyVerificationBadge
        isOpen={isTaxonomyModalOpen}
        onClose={() => setIsTaxonomyModalOpen(false)}
        mappings={taxonomyMappings}
        onUpdateMapping={handleUpdateTaxonomyMapping}
      />

      {/* Save Plan Modal */}
      {isSaving && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white border border-slate-200 rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                  <Save className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-800">
                    {activeSavedId ? "Update Saved Plan" : "Save Media Plan"}
                  </h3>
                  <p className="text-[11px] text-slate-400">Save this profile and strategy to team history</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setIsSaving(false); setSaveError(null); }}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Plan Title
                </label>
                <input
                  type="text"
                  value={saveTitle}
                  onChange={(e) => setSaveTitle(e.target.value)}
                  placeholder="e.g. US Gamers Profile"
                  className="w-full text-sm text-slate-900 bg-white border border-slate-200 rounded-xl px-3.5 py-2 focus:outline-hidden focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 placeholder:text-slate-400"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !isPersistingPlan) handleSaveProfile();
                    if (e.key === "Escape") { setIsSaving(false); setSaveError(null); }
                  }}
                  autoFocus
                />
                <p className="text-[11px] text-slate-400 mt-1.5">
                  Saved plans are accessible to all planners on your team.
                </p>
              </div>

              {saveError && (
                <div className="flex items-start gap-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl p-3">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-rose-500 mt-0.5" />
                  <span>{saveError}</span>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => { setIsSaving(false); setSaveError(null); }}
                className="text-xs font-medium text-slate-600 hover:text-slate-800 px-4 py-2 rounded-xl hover:bg-slate-100 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveProfile}
                disabled={isPersistingPlan || !saveTitle.trim()}
                className="text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-600/50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-xl transition-colors cursor-pointer flex items-center gap-1.5 shadow-xs"
              >
                {isPersistingPlan && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>{isPersistingPlan ? "Saving..." : activeSavedId ? "Save Changes" : "Confirm Save"}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {isAuditModalOpen && activeSavedId && (
        <PlanAuditModal
          planId={activeSavedId}
          onClose={() => setIsAuditModalOpen(false)}
          onApplied={handleAuditApplied}
        />
      )}

      {/* Share Plan Modal for authenticated planners */}
      {shareModalPlan && (
        <SharePlanModal
          isOpen={isShareModalOpen}
          onClose={() => {
            setIsShareModalOpen(false);
            setShareModalPlan(null);
          }}
          planId={shareModalPlan.id}
          planTitle={shareModalPlan.title}
          isShared={shareModalPlan.isShared}
          shareToken={shareModalPlan.shareToken}
          onShareStatusChanged={(isShared, shareToken) => {
            setPlanSummaries((prev) =>
              prev.map((p) =>
                p.id === shareModalPlan.id
                  ? { ...p, isShared, shareToken: shareToken || undefined }
                  : p
              )
            );
            if (shareModalPlan) {
              setShareModalPlan((prev) =>
                prev ? { ...prev, isShared, shareToken } : null
              );
            }
          }}
        />
      )}

      {/* Clone Plan Modal */}
      {cloneModalPlan && (
        <ClonePlanModal
          isOpen={isCloneModalOpen}
          onClose={() => {
            setIsCloneModalOpen(false);
            setCloneModalPlan(null);
          }}
          plan={cloneModalPlan}
          existingTitles={planSummaries.map((p) => p.title)}
          onCloneSuccess={async (clonedPlan) => {
            await refreshPlans();
            if (clonedPlan) {
              handleLoadSavedProfile({
                id: clonedPlan.id,
                title: clonedPlan.title,
                advertiserName: clonedPlan.advertiserName,
                audienceDescription: clonedPlan.audienceDescription,
                updatedAt: clonedPlan.updatedAt,
              });
            }
          }}
        />
      )}

      {/* Delete Plan Confirmation Modal */}
      {deleteModalPlan && (
        <DeletePlanModal
          isOpen={isDeleteModalOpen}
          onClose={() => {
            setIsDeleteModalOpen(false);
            setDeleteModalPlan(null);
          }}
          plan={deleteModalPlan}
          onDeleteSuccess={async (deletedId) => {
            if (activeSavedId === deletedId) {
              setActiveSavedId(null);
              setActiveSavedTitle(null);
              setActivePlanRevision(null);
            }
            await refreshPlans();
          }}
        />
      )}
      {/* CTV Publishers Edit Modal */}
      {profileData && (
        <CtvPublishersModal
          isOpen={isCtvPublishersModalOpen}
          onClose={() => setIsCtvPublishersModalOpen(false)}
          selectedPublishers={profileData.ctvPublishers ?? []}
          onUpdatePublishers={handleUpdateCtvPublishers}
          onResetToDefault={handleResetCtvPublishers}
          catalogPublishers={ctvPublishers}
          readOnly={isShareView}
        />
      )}
      {/* Presentation AI Slide Studio (gpt-image-2.5-sunburst) Export Modal */}
      {profileData && (
        <PersonaSlideExportModal
          isOpen={isSlideStudioOpen}
          onClose={() => setIsSlideStudioOpen(false)}
          initialSection={slideStudioSection}
          personas={profileData.personas || []}
          segments={profileData.segmentRecommendations || []}
          channelStrategy={profileData.channelStrategy}
          mediaPlan={profileData.channelStrategy?.mediaPlan}
          advertiserName={advertiserName}
          campaignFocus={campaignFocus || ""}
          geography={geography}
          api={api}
        />
      )}
      {/* Persona Headshot Customizer & History Modal */}
      {profileData && profileData.personas && editingAvatarPersonaIndex !== null && profileData.personas[editingAvatarPersonaIndex] && (
        <PersonaAvatarModal
          isOpen={editingAvatarPersonaIndex !== null}
          onClose={handleCloseAvatarModal}
          persona={profileData.personas[editingAvatarPersonaIndex]}
          personaIndex={editingAvatarPersonaIndex}
          onSelectAvatar={handleSelectPersonaAvatar}
          onGenerateNew={handleGeneratePersonaAvatar}
          isGenerating={generatingAvatarIndices.includes(editingAvatarPersonaIndex)}
        />
      )}
      {/* Off-screen 16:9 Canvases for CTV Publishers & Insights Slide Export */}
      {profileData && (
        <div
          id="ctv-slide-export-offscreen-root"
          style={{
            position: "fixed",
            left: "-99999px",
            top: 0,
            overflow: "hidden",
            zIndex: -9999,
            pointerEvents: "none",
          }}
          aria-hidden="true"
        >
          {/* Detailed Export Canvas Container */}
          <div
            id="ctv-slide-export-container-detailed"
            style={{
              position: "fixed",
              left: "-99999px",
              top: 0,
              width: "1920px",
              height: "1080px",
              overflow: "hidden",
              zIndex: -9999,
              pointerEvents: "none",
            }}
          >
            <CtvSlideExportView
              ref={ctvSlideDetailedExportRef}
              layoutVariant="detailed"
              publishers={profileData.ctvPublishers ?? []}
              publisherInsights={summarizedPublisherInsights || profileData.publisherInsights}
              customPublishers={ctvPublishers}
            />
          </div>

          {/* Basic Export Canvas Container */}
          <div
            id="ctv-slide-export-container-basic"
            style={{
              position: "fixed",
              left: "-99999px",
              top: 0,
              width: "1920px",
              height: "1080px",
              overflow: "hidden",
              zIndex: -9999,
              pointerEvents: "none",
            }}
          >
            <CtvSlideExportView
              ref={ctvSlideBasicExportRef}
              layoutVariant="basic"
              publishers={profileData.ctvPublishers ?? []}
              publisherInsights={summarizedPublisherInsights || profileData.publisherInsights}
              customPublishers={ctvPublishers}
            />
          </div>
        </div>
      )}
    </div>
  );
}
