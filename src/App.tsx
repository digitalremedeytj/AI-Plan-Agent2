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
  Bookmark,
  Save,
  Trash2,
  Edit3,
  History,
  Calendar,
  Lock,
  Eye,
  EyeOff,
  Plus,
  X,
  Building2,
  DollarSign,
  Menu
} from "lucide-react";
import Markdown from "react-markdown";

import { AudienceProfile, ExtractedPlacement, GenerateProfileResponse, SavedProfile, ParsedPlanOption, TaxonomyMapping, CanonicalMediaType, RfpAnalysis, type ChannelStrategyData } from "./types";
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
import { ChannelStrategySection } from "./components/ChannelStrategySection";
import { OverviewMetricsTab } from "./components/OverviewMetricsTab";
import { SettingsDrawer } from "./components/SettingsDrawer";
import { groupPlacementsIntoPlanOptions } from "./utils/planPromptOptimizer";
import { normalizeRawChannel } from "./utils/mediaTaxonomy";
import {
  findBudgetChannelTier,
  loadPlanningSettings,
  normalizeCampaignBudget,
  parseCurrencyInput,
  type PlanningSettings,
  savePlanningSettings,
} from "./planning/settings";
import {
  addMediaTypeAndRebalance,
  allocationBasisPoints,
  allocationsEqual,
  applyBasisPointAllocations,
  removeMediaTypeAndRebalance,
  type AllocationBasisPoints,
} from "./planning/manualAllocations";

const getPublisherLogo = (name: string): string => {
  const normalized = name.toLowerCase().trim();
  
  if (normalized.includes("a&e")) return "/assets/pub-logos/a&e_80x80.png";
  if (normalized.includes("abc")) return "/assets/pub-logos/abc_80x80.png";
  if (normalized.includes("amazon") || normalized.includes("prime video") || normalized.includes("primevideo")) return "/assets/pub-logos/amazon-prime-video_80x80.png";
  if (normalized.includes("amc")) return "/assets/pub-logos/amc_80x80.png";
  if (normalized.includes("apple") || normalized.includes("apple tv")) return "/assets/pub-logos/apple-tv-plus_80x80.png";
  if (normalized.includes("bloomberg")) return "/assets/pub-logos/bloomberg_80x80.png";
  if (normalized.includes("cbs")) return "/assets/pub-logos/cbs_80x80.png";
  if (normalized.includes("cheddar")) return "/assets/pub-logos/cheddar_80x80.png";
  if (normalized.includes("cnbc")) return "/assets/pub-logos/cnbc_80x80.png";
  if (normalized.includes("cnn")) return "/assets/pub-logos/cnn_80x80.png";
  if (normalized.includes("crackle")) return "/assets/pub-logos/crackle_80x80.png";
  if (normalized.includes("directv")) return "/assets/pub-logos/directv_80x80.png";
  if (normalized.includes("discovery+")) return "/assets/pub-logos/discovery+_80x80.png";
  if (normalized.includes("discovery")) return "/assets/pub-logos/discovery_80x80.png";
  if (normalized.includes("disney")) return "/assets/pub-logos/disney_80x80.png";
  if (normalized.includes("espn")) return "/assets/pub-logos/espn_80x80.png";
  if (normalized.includes("fox")) return "/assets/pub-logos/fox_80x80.png";
  if (normalized.includes("freeform")) return "/assets/pub-logos/freeform_80x80.png";
  if (normalized.includes("fubo")) return "/assets/pub-logos/fubo_80x80.png";
  if (normalized.includes("fuse")) return "/assets/pub-logos/fuse+_80x80.png";
  if (normalized.includes("fx")) return "/assets/pub-logos/fx_80x80.png";
  if (normalized.includes("hallmark")) return "/assets/pub-logos/hallmark_80x80.png";
  if (normalized.includes("hulu")) return "/assets/pub-logos/hulu_80x80.png";
  if (normalized.includes("lg")) return "/assets/pub-logos/lg_80x80.png";
  if (normalized.includes("max") || normalized.includes("hbo")) return "/assets/pub-logos/max_80x80.png";
  if (normalized.includes("moonbug")) return "/assets/pub-logos/moonbug_80x80.png";
  if (normalized.includes("nbc")) return "/assets/pub-logos/nbc_80x80.png";
  if (normalized.includes("netflix")) return "/assets/pub-logos/netflix_80x80.png";
  if (normalized.includes("newson")) return "/assets/pub-logos/newson_80x80.png";
  if (normalized.includes("newsy")) return "/assets/pub-logos/newsy_80x80.png";
  if (normalized.includes("nfl")) return "/assets/pub-logos/nfl_80x80.png";
  if (normalized.includes("outside")) return "/assets/pub-logos/outside_80x80.png";
  if (normalized.includes("paramount")) return "/assets/pub-logos/paramount_80x80.png";
  if (normalized.includes("peacock")) return "/assets/pub-logos/peacock_80x80.png";
  if (normalized.includes("philo")) return "/assets/pub-logos/philo_80x80.png";
  if (normalized.includes("plex")) return "/assets/pub-logos/plex_80x80.png";
  if (normalized.includes("pluto")) return "/assets/pub-logos/pluto_80x80.png";
  if (normalized.includes("roku")) return "/assets/pub-logos/roku_80x80.png";
  if (normalized.includes("samsung")) return "/assets/pub-logos/samsung_80x80.png";
  if (normalized.includes("sci") || normalized.includes("science")) return "/assets/pub-logos/sci_80x80.png";
  if (normalized.includes("scripps")) return "/assets/pub-logos/scripps_80x80.png";
  if (normalized.includes("showtime")) return "/assets/pub-logos/showtime_80x80.png";
  if (normalized.includes("sling")) return "/assets/pub-logos/sling_80x80.png";
  if (normalized.includes("travel")) return "/assets/pub-logos/travel_80x80.png";
  if (normalized.includes("tubi")) return "/assets/pub-logos/tubi_80x80.png";
  if (normalized.includes("turner")) return "/assets/pub-logos/turner_80x80.png";
  if (normalized.includes("vevo")) return "/assets/pub-logos/vevo_80x80.png";
  if (normalized.includes("vizio")) return "/assets/pub-logos/vizio_80x80.png";
  if (normalized.includes("xumo")) return "/assets/pub-logos/xumo_80x80.png";
  
  return "/assets/pub-logos/placeholder_80x80.png";
};

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

const defaultCtvPublishers = [
  { publisher: "Hulu", category: "App", why: "High penetration among prime-time streaming audiences with premium ad-supported options." },
  { publisher: "Disney+", category: "App", why: "Co-viewing hub matching family oriented household profiles perfectly." },
  { publisher: "The Roku Channel", category: "OS", why: "Dominant CTV operating system offering native home screen high-impact display slots." },
  { publisher: "ESPN", category: "Network", why: "Essential for capturing live sports and highly engaged co-viewing audiences." }
];

const defaultPublisherInsights = "The recommended CTV publisher mix targets high-impact, ad-supported environments where our audience actively streams content. By combining premium subscription video-on-demand (SVOD) apps, free ad-supported streaming TV (FAST) platforms, and native Smart TV OS display banners, the campaign secures maximum reach and frequency while maintaining brand safety.";

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
  // Authentication State
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    try {
      const loginTime = localStorage.getItem("audience_builder_login_time");
      if (!loginTime) return false;
      const parsedTime = parseInt(loginTime, 10);
      if (isNaN(parsedTime)) return false;
      
      // 24 hours in milliseconds = 86,400,000
      const isExpired = Date.now() - parsedTime > 24 * 60 * 60 * 1000;
      if (isExpired) {
        localStorage.removeItem("audience_builder_login_time");
        return false;
      }
      return true;
    } catch (e) {
      return false;
    }
  });

  const [usernameInput, setUsernameInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!usernameInput || !passwordInput) {
      setLoginError("Please enter both username and password.");
      return;
    }

    setIsLoggingIn(true);
    setLoginError(null);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: usernameInput,
          password: passwordInput,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        try {
          localStorage.setItem("audience_builder_login_time", Date.now().toString());
        } catch (err) {
          console.error("Failed to save login session:", err);
        }
        setIsAuthenticated(true);
        setLoginError(null);
      } else {
        setLoginError(data.error || "Invalid username or password");
      }
    } catch (err: any) {
      console.error("Login request failed:", err);
      setLoginError("Connection error. Please try again.");
    } finally {
      setIsLoggingIn(false);
    }
  };

  // Input fields state
  const [advertiserName, setAdvertiserName] = useState("");
  const [budget, setBudget] = useState("$10,000");
  const [campaignLength, setCampaignLength] = useState("30");
  const [kpis, setKpis] = useState<string[]>([""]);
  const [audienceDescription, setAudienceDescription] = useState("");
  const [url, setUrl] = useState("");
  const [geography, setGeography] = useState("United States");
  const [campaignFocus, setCampaignFocus] = useState("CTV-first digital media plan");
  const [additionalContext, setAdditionalContext] = useState("");
  const [planningSettings, setPlanningSettings] = useState<PlanningSettings>(() =>
    loadPlanningSettings(typeof window === "undefined" ? null : window.localStorage),
  );
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isHeaderMenuOpen, setIsHeaderMenuOpen] = useState(false);

  const budgetNormalization = React.useMemo(
    () => normalizeCampaignBudget(parseCurrencyInput(budget), Number(campaignLength)),
    [budget, campaignLength],
  );
  const appliedBudgetTier = React.useMemo(
    () => findBudgetChannelTier(budgetNormalization.normalized30DayBudget, planningSettings),
    [budgetNormalization.normalized30DayBudget, planningSettings],
  );
  const availableGeographies = React.useMemo(
    () => {
      const configured = Array.from(new Set(
        planningSettings.products
          .filter((product) => product.digitalRemedyExecutable && product.recommendationEligible && product.status === "live")
          .flatMap((product) => product.supportedGeographies),
      )).sort();
      return configured.length > 0 ? configured : ["United States"];
    },
    [planningSettings],
  );

  React.useEffect(() => {
    if (!availableGeographies.includes(geography)) setGeography(availableGeographies[0]);
  }, [availableGeographies, geography]);

  const handleSavePlanningSettings = (nextSettings: PlanningSettings) => {
    const result = savePlanningSettings(window.localStorage, nextSettings);
    if (result.valid && result.settings) setPlanningSettings(result.settings);
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
  const [personaPage, setPersonaPage] = useState<number>(0);
  
  // Real-time research stream console logs
  const [researchLogs, setResearchLogs] = useState<Array<{
    id: string;
    timestamp: string;
    type: "status" | "research_result";
    message?: string;
    label?: string;
    sources?: Array<{ title: string; uri: string }>;
    blurb?: string;
  }>>([]);

  const logContainerRef = React.useRef<HTMLDivElement>(null);
  const isLogHoveredRef = React.useRef<boolean>(false);
  const [isLogHovered, setIsLogHovered] = useState<boolean>(false);
  const pendingLogsRef = React.useRef<any[]>([]);
  const [serverCompleteData, setServerCompleteData] = useState<{ profile: any; groundingSources: any } | null>(null);

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

  // Auto-scroll the live research feed on logs update (if not hovered)
  React.useEffect(() => {
    if (logContainerRef.current && !isLogHoveredRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [researchLogs]);

  // Queue and simulated thought ticker Effect
  React.useEffect(() => {
    if (!loading) return;

    const audienceLabel = audienceDescription
      ? `"${audienceDescription.slice(0, 35)}${audienceDescription.length > 35 ? '...' : ''}"`
      : (url ? `visitors of ${url.replace(/^https?:\/\/(www\.)?/, '')}` : 'target audience');
    const geoLabel = geography || 'United States';
    const focusLabel = campaignFocus || 'campaign objectives';

    const dynamicThoughts = [
      `Scoping age distribution & household income cohorts for ${audienceLabel} in ${geoLabel}...`,
      `Cross-referencing Comscore & Similarweb domain affinity clusters for ${focusLabel}...`,
      `Analyzing Connected TV (CTV) viewing share across Smart TV OS platforms & FAST channels...`,
      `Retrieving category search volumes, digital touchpoint indices, and brand affinity benchmarks...`,
      `Measuring daypart streaming peaks and hour-of-day engagement patterns in ${geoLabel}...`,
      `Evaluating publisher ad insertion feeds (DAI) and co-viewing multipliers for ${audienceLabel}...`,
      `Synthesizing temporal purchase frequency models with campaign goal: ${focusLabel}...`,
      `Validating source trust indexes and filtering deduplicated market research citations...`,
      `Auditing persona attributes and media consumption triggers against syndicated audience baselines...`,
      `Cross-checking Household Income (HHI) bounds and CTV completion benchmarks for audience plausibility...`
    ];

    if (planOptions && planOptions.some(p => p.selected)) {
      const selectedCount = planOptions.filter(p => p.selected).length;
      dynamicThoughts.push(`Auditing ${selectedCount} selected media plan scenario(s) against recommended CTV publisher mix...`);
      dynamicThoughts.push(`Evaluating CPM efficiency and channel reallocation potential across placement line items...`);
    }

    if (url) {
      dynamicThoughts.push(`Grounding brand value proposition and product positioning from ${url}...`);
    }

    let thoughtIndex = 0;

    const interval = setInterval(() => {
      // If there are real pending logs from the server stream, process the next one!
      if (pendingLogsRef.current.length > 0) {
        const nextLog = pendingLogsRef.current.shift();
        setResearchLogs(prev => [
          ...prev,
          {
            id: Math.random().toString(),
            timestamp: new Date().toLocaleTimeString(),
            ...nextLog
          }
        ]);
      } 
      // If server has sent the completion event, and all real logs are drained, finish up!
      else if (serverCompleteData) {
        const rawProfile = serverCompleteData.profile;
        if (rawProfile && rawProfile.personas) {
          Promise.all(
            rawProfile.personas.map(async (persona) => ({
              ...persona,
              avatarUrl: await compressAvatarUrl(persona.avatarUrl)
            }))
          ).then((compressedPersonas) => {
            setProfileData({ ...rawProfile, personas: compressedPersonas });
          });
        } else {
          setProfileData(rawProfile);
        }
        setGroundingSources(serverCompleteData.groundingSources);
        setPersonaPage(0);
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
      }
      // If the server is still working and we have no pending logs to show, inject a dynamic contextual thought!
      else {
        const thought = dynamicThoughts[thoughtIndex % dynamicThoughts.length];
        thoughtIndex++;
        setResearchLogs(prev => [
          ...prev,
          {
            id: Math.random().toString(),
            timestamp: new Date().toLocaleTimeString(),
            type: "status",
            message: thought
          }
        ]);
      }
    }, 1800); // Stagger every 1.8 seconds

    return () => clearInterval(interval);
  }, [loading, serverCompleteData, audienceDescription, url, geography, campaignFocus, planOptions]);
  
  // Feedback states for buttons
  const [copyProfileCopied, setCopyProfileCopied] = useState(false);
  const [copySourcesCopied, setCopySourcesCopied] = useState(false);
  const [regenType, setRegenType] = useState<string | null>(null);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [pdfGenerating, setPdfGenerating] = useState(false);
  const [generatingAvatarIndex, setGeneratingAvatarIndex] = useState<number | null>(null);

  const handleRegenerateAvatar = async (personaIndex: number) => {
    if (!profileData || !profileData.personas || !profileData.personas[personaIndex]) return;
    setGeneratingAvatarIndex(personaIndex);
    try {
      const targetPersona = profileData.personas[personaIndex];
      const res = await fetch("/api/generate-persona-avatar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ persona: targetPersona })
      });
      const data = await res.json();
      if (data.success && data.avatarUrl) {
        const compressed = await compressAvatarUrl(data.avatarUrl);
        const finalAvatar = compressed || data.avatarUrl;
        const updatedPersonas = [...profileData.personas];
        updatedPersonas[personaIndex] = {
          ...updatedPersonas[personaIndex],
          avatarUrl: finalAvatar
        };
        const updatedProfile = {
          ...profileData,
          personas: updatedPersonas
        };
        setProfileData(updatedProfile);

        // Also update saved profile if active
        if (activeSavedId) {
          setSavedProfiles(prev => prev.map(p => p.id === activeSavedId ? { ...p, profile: updatedProfile } : p));
        }
      }
    } catch (err) {
      console.error("Failed to regenerate persona headshot photo:", err);
    } finally {
      setGeneratingAvatarIndex(null);
    }
  };

  // Saved profiles state initialized from localStorage
  const [savedProfiles, setSavedProfiles] = useState<SavedProfile[]>(() => {
    try {
      const stored = localStorage.getItem("audience_builder_saved_profiles");
      return stored ? JSON.parse(stored) : [];
    } catch (e) {
      console.error("Error reading saved profiles from localStorage:", e);
      return [];
    }
  });

  // Sync savedProfiles to localStorage whenever it changes
  React.useEffect(() => {
    try {
      const lightweightProfiles = savedProfiles.map(p => ({
        ...p,
        profile: {
          ...p.profile,
          personas: p.profile.personas ? p.profile.personas.map(persona => ({
            ...persona,
            // Omit uncompressed raw base64 avatars (>100KB) if quota is constrained
            avatarUrl: persona.avatarUrl && persona.avatarUrl.startsWith("data:image/") && persona.avatarUrl.length > 100000
              ? undefined
              : persona.avatarUrl
          })) : []
        }
      }));

      try {
        localStorage.setItem("audience_builder_saved_profiles", JSON.stringify(savedProfiles));
      } catch (quotaErr) {
        // Fallback to lightweight profiles if full profiles exceed browser quota
        localStorage.setItem("audience_builder_saved_profiles", JSON.stringify(lightweightProfiles));
      }
    } catch (e) {
      console.error("Error writing saved profiles to localStorage:", e);
    }
  }, [savedProfiles]);

  // Saved profiles interaction states
  const [leftTab, setLeftTab] = useState<"brief" | "saved" | "overview">("brief");
  const prevProfileDataRef = React.useRef<AudienceProfile | null>(null);

  // Auto-switch to overview tab when output results arrive / update, fallback to brief if cleared
  React.useEffect(() => {
    if (!profileData) {
      if (leftTab === "overview") {
        setLeftTab("brief");
      }
    } else if (profileData !== prevProfileDataRef.current) {
      setLeftTab("overview");
    }
    prevProfileDataRef.current = profileData;
  }, [profileData]);
  const [isSaving, setIsSaving] = useState(false);
  const [saveTitle, setSaveTitle] = useState("");
  const [activeSavedId, setActiveSavedId] = useState<string | null>(null);
  
  // Renaming state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");

  // Handler to open Save Dialog with a suggested title based on user's brief or uploaded plan
  const handleOpenSaveDialog = () => {
    if (!profileData) return;
    const desc = audienceDescription.trim();
    const defaultTitle = desc 
      ? (desc.length > 50 ? desc.slice(0, 50) + "..." : desc)
      : uploadedFileName 
        ? uploadedFileName.replace(/\.[^/.]+$/, "") 
        : "Audience Profile";
    setSaveTitle(defaultTitle);
    setIsSaving(true);
  };

  // Handler to save the profile to history
  const handleSaveProfile = () => {
    if (!profileData) return;
    const titleToSave = saveTitle.trim() || "Untitled Audience Profile";
    
    // Check if we are updating an existing active profile
    if (activeSavedId) {
      setSavedProfiles((prev) =>
        prev.map((p) => {
          if (p.id === activeSavedId) {
            return {
              ...p,
              title: titleToSave,
              advertiserName,
              kpis: kpis.filter((k) => k.trim().length > 0),
              audienceDescription,
              url,
              geography,
              campaignFocus,
              additionalContext,
              budget,
              campaignLength,
              planningSettings,
              profile: profileData,
              groundingSources: groundingSources || undefined,
              savedAt: new Date().toLocaleString(),
            };
          }
          return p;
        })
      );
      setIsSaving(false);
      return;
    }

    // Create a new saved profile entry
    const newEntry: SavedProfile = {
      id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 9) + Date.now().toString(36),
      savedAt: new Date().toLocaleString(),
      title: titleToSave,
      advertiserName,
      kpis: kpis.filter((k) => k.trim().length > 0),
      audienceDescription,
      url,
      geography,
      campaignFocus,
      additionalContext,
      budget,
      campaignLength,
      planningSettings,
      profile: profileData,
      groundingSources: groundingSources || undefined,
    };

    setSavedProfiles((prev) => [newEntry, ...prev]);
    setActiveSavedId(newEntry.id);
    setIsSaving(false);
  };

  // Handler to load a saved profile
  const handleLoadSavedProfile = (saved: SavedProfile) => {
    setAdvertiserName(saved.advertiserName || "");
    setKpis(saved.kpis && saved.kpis.length > 0 ? saved.kpis : [""]);
    setAudienceDescription(saved.audienceDescription);
    setUrl(saved.url);
    setGeography(saved.geography);
    setCampaignFocus(saved.campaignFocus);
    setAdditionalContext(saved.additionalContext);
    setBudget(saved.budget || "$10,000");
    setCampaignLength(saved.campaignLength || "30");
    setProfileData(saved.profile);
    setGroundingSources(saved.groundingSources || null);
    setActiveSavedId(saved.id);
    setError(null);
    setPersonaPage(0);

    // Auto-generate missing headshots in background if saved profile lacks them
    if (saved.profile && saved.profile.personas) {
      saved.profile.personas.forEach((persona, index) => {
        if (!persona.avatarUrl || persona.avatarUrl.includes("example.com")) {
          fetch("/api/generate-persona-avatar", {
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
                    updated[index] = { ...updated[index], avatarUrl: finalAvatar };
                  }
                  return { ...prev, personas: updated };
                });
                setSavedProfiles(prevList => prevList.map(sp => {
                  if (sp.id === saved.id && sp.profile && sp.profile.personas) {
                    const updatedPersonas = [...sp.profile.personas];
                    if (updatedPersonas[index]) {
                      updatedPersonas[index] = { ...updatedPersonas[index], avatarUrl: finalAvatar };
                    }
                    return { ...sp, profile: { ...sp.profile, personas: updatedPersonas } };
                  }
                  return sp;
                }));
              }
            })
            .catch(err => console.error("Error generating missing persona headshot:", err));
        }
      });
    }

    // Scroll workspace into view
    const workspace = document.getElementById("profile-workspace");
    if (workspace) {
      workspace.scrollIntoView({ behavior: "smooth" });
    }
  };

  // Delete handler
  const handleDeleteSavedProfile = (id: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Avoid loading it
    if (confirm("Are you sure you want to delete this saved profile?")) {
      setSavedProfiles(prev => prev.filter(p => p.id !== id));
      if (activeSavedId === id) {
        setActiveSavedId(null);
      }
    }
  };

  // Start renaming
  const handleStartRename = (id: string, currentTitle: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(id);
    setEditingTitle(currentTitle);
  };

  // Save renamed title
  const handleSaveRename = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!editingTitle.trim()) return;
    setSavedProfiles(prev => prev.map(p => {
      if (p.id === id) {
        return { ...p, title: editingTitle.trim() };
      }
      return p;
    }));
    setEditingId(null);
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

    fetch("/api/parse-plan", {
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
  const handleGenerate = async (e?: React.FormEvent, typeOverride?: string) => {
    if (e) e.preventDefault();

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
    if (!typeOverride) {
      setActiveSavedId(null);
    }

    try {
      const selectedOpts = (planOptions && planOptions.length > 0) ? planOptions.filter(p => p.selected) : undefined;
      const response = await fetch("/api/generate-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          advertiserName,
          kpis: kpis.filter((k) => k.trim().length > 0),
          audienceDescription: briefMode === "upload" ? `[Media Plan / RFP: ${uploadedFileName || 'Uploaded File'}]\n\n${(uploadedFileText || '').slice(0, 1500)}` : audienceDescription,
          url,
          geography,
          campaignFocus,
          additionalContext,
          regenerateType: typeOverride,
          selectedPlanOptions: selectedOpts,
          budgetStrategyMode,
          rfpAnalysis,
          workingMediaBudget: budgetNormalization.workingMediaBudget,
          campaignFlightDays: budgetNormalization.campaignFlightDays,
          planningSettings,
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

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // Keep partial line

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          if (trimmed.startsWith("data: ")) {
            const rawJson = trimmed.slice(6).trim();
            if (!rawJson) continue;

            try {
              const event = JSON.parse(rawJson);

              if (event.type === "status") {
                pendingLogsRef.current.push({
                  type: "status",
                  message: event.message
                });
              } else if (event.type === "research_result") {
                pendingLogsRef.current.push({
                  type: "research_result",
                  label: event.label,
                  sources: event.sources,
                  blurb: event.blurb
                });
              } else if (event.type === "complete") {
                setServerCompleteData({
                  profile: event.profile,
                  groundingSources: event.groundingSources || null
                });
              } else if (event.type === "error") {
                throw new Error(event.details || event.error || "An error occurred during profile generation.");
              }
            } catch (err) {
              console.error("Error parsing streaming chunk:", err);
            }
          }
        }
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || "An unexpected error occurred during profile generation.");
      setLoading(false);
      setRegenType(null);
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
      const res = await fetch("/api/analyze-media-plan", {
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
        setProfileData(prev => prev ? { ...prev, channelStrategy: data.channelStrategy } : null);
      }
    } catch (err) {
      console.error("Failed to re-analyze channel strategy for budget mode toggle:", err);
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

  const handleSaveManualAllocations = async (basisPoints: AllocationBasisPoints, lockedChannelIds: string[]) => {
    const currentStrategy = profileData?.channelStrategy;
    if (!profileData || !currentStrategy?.mediaPlan) throw new Error("No active media plan is available to update.");
    const baseline = currentStrategy.allocationBaselineBasisPoints || allocationBasisPoints(currentStrategy.mediaPlan);
    const nextPlan = applyBasisPointAllocations(
      currentStrategy.mediaPlan,
      basisPoints,
      "Planner saved manual allocation changes; unlocked media types were proportionally rebalanced within the fixed working-media budget.",
    );
    const nextStrategy: ChannelStrategyData = {
      ...currentStrategy,
      generatedAt: new Date().toISOString(),
      allocationBaselineBasisPoints: baseline,
      lockedAllocationChannelIds: lockedChannelIds.filter((id) => nextPlan.channels.some((channel) => channel.channelId === id)),
      hasManualAllocationChanges: !allocationsEqual(baseline, basisPoints),
      mediaPlan: nextPlan,
    };
    setChannelStrategyUndo(currentStrategy);
    setProfileData((previous) => previous ? { ...previous, channelStrategy: nextStrategy } : null);
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

  // Download Profile Markdown file
  const handleDownloadMarkdown = () => {
    if (!profileData) return;
    const md = exportProfileToMarkdown(profileData);
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8;" });
    const fileUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = fileUrl;
    
    // Clean name for filename
    const sanitizedName = (profileData.personas[0]?.name || "audience_profile")
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
    const md = exportProfileToMarkdown(profileData);
    const blob = new Blob([md], { type: "text/plain;charset=utf-8;" });
    const fileUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = fileUrl;
    
    // Clean name for filename
    const sanitizedName = (profileData.personas[0]?.name || "audience_profile")
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

      const sanitizedName = (profileData.personas[0]?.name || "audience_profile")
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
                <button className="fixed inset-0 z-0 cursor-default" aria-label="Close application menu" onClick={() => setIsHeaderMenuOpen(false)} />
                <div className="absolute right-0 z-10 mt-2 w-44 overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">
                  <button
                    type="button"
                    onClick={() => { setIsHeaderMenuOpen(false); setIsSettingsOpen(true); }}
                    className="w-full rounded-lg px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-indigo-50 hover:text-indigo-700"
                  >
                    Settings
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      <SettingsDrawer
        open={isSettingsOpen}
        settings={planningSettings}
        onClose={() => setIsSettingsOpen(false)}
        onSave={handleSavePlanningSettings}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-[1500px] w-full mx-auto p-4 md:p-6 flex flex-col lg:flex-row gap-6 items-start">
        {/* Left Column: Media Planner Inputs (350px fixed on lg) */}
        <section className="w-full lg:w-[350px] shrink-0 bg-white border border-slate-100 rounded-2xl shadow-xs sticky lg:top-24 max-h-[calc(100vh-120px)] flex flex-col overflow-hidden">
          {/* Tabs header */}
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
          </div>

          {leftTab === "brief" ? (
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
                      placeholder="$10,000"
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
                  {budgetNormalization.assumptions.map((assumption) => (
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
                      value={geography}
                      onChange={(e) => setGeography(e.target.value)}
                      className="w-full text-xs px-2 py-2 border border-slate-200 bg-white rounded-xl focus:outline-hidden focus:border-indigo-500 cursor-pointer"
                    >
                      {availableGeographies.map((market) => <option key={market} value={market}>{market}</option>)}
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
                      className="w-full text-xs px-2 py-2 border border-slate-200 bg-white rounded-xl focus:outline-hidden focus:border-indigo-500 cursor-pointer"
                    >
                      <option value="CTV-first digital media plan">CTV-First</option>
                      <option value="Full-funnel digital media plan">Full-Funnel</option>
                      <option value="Display/social/video plan">Display & Social</option>
                    </select>
                  </div>
                </div>

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
                          : "Generate Audience Profile"}
                      </span>
                    </>
                  )}
                </button>
              </div>
            </form>
          ) : leftTab === "saved" ? (
            <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Previously Done Profiles</h3>
                {savedProfiles.length > 0 && (
                  <button
                    onClick={() => {
                      if (confirm("Clear all saved profiles?")) {
                        setSavedProfiles([]);
                        setActiveSavedId(null);
                      }
                    }}
                    className="text-[10px] text-rose-600 hover:text-rose-800 font-medium hover:underline cursor-pointer"
                  >
                    Clear All
                  </button>
                )}
              </div>

              {savedProfiles.length === 0 ? (
                <div className="text-center py-8 px-4 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                  <Bookmark className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                  <p className="text-xs font-semibold text-slate-600">No Saved Profiles Yet</p>
                  <p className="text-[11px] text-slate-400 mt-1 max-w-[200px] mx-auto leading-normal">
                    Generate an audience profile, then click <strong className="text-indigo-600 font-semibold">Save Profile</strong> in the actions bar.
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
                  {savedProfiles.map((saved) => (
                    <div
                      key={saved.id}
                      onClick={() => handleLoadSavedProfile(saved)}
                      className={`group p-3.5 rounded-xl border transition-all cursor-pointer text-left relative ${
                        activeSavedId === saved.id
                          ? "bg-indigo-50/40 border-indigo-200 ring-2 ring-indigo-50"
                          : "bg-white border-slate-100 hover:border-slate-200 hover:shadow-xs"
                      }`}
                    >
                      {/* Saved Header with Renaming Option */}
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        {editingId === saved.id ? (
                          <div className="flex items-center gap-1.5 w-full mr-6" onClick={(e) => e.stopPropagation()}>
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
                              onClick={(e) => handleSaveRename(saved.id, e)}
                              className="text-emerald-600 hover:text-emerald-800 p-0.5 shrink-0"
                              title="Save Title"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <div className="pr-12">
                            <h4 className="text-xs font-bold text-slate-800 group-hover:text-indigo-900 leading-snug line-clamp-2">
                              {saved.title}
                            </h4>
                          </div>
                        )}

                        {/* Top-Right Action Row (Rename / Delete) */}
                        <div className="absolute top-3 right-3 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {editingId !== saved.id && (
                            <button
                              onClick={(e) => handleStartRename(saved.id, saved.title, e)}
                              className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-slate-50 rounded-md transition-colors"
                              title="Rename Profile"
                            >
                              <Edit3 className="w-3 h-3" />
                            </button>
                          )}
                          <button
                            onClick={(e) => handleDeleteSavedProfile(saved.id, e)}
                            className="p-1 text-slate-400 hover:text-rose-600 hover:bg-slate-50 rounded-md transition-colors"
                            title="Delete Profile"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Audience brief snippets */}
                      <p className="text-[10px] text-slate-400 line-clamp-2 leading-relaxed mb-2">
                        {saved.audienceDescription || "No description brief"}
                      </p>

                      {/* Metadata badges */}
                      <div className="flex flex-wrap items-center gap-1.5 text-[9px] font-semibold text-slate-500">
                        <span className="bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded uppercase font-mono">
                          {saved.geography}
                        </span>
                        <span className="bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded truncate max-w-[110px]">
                          {saved.campaignFocus.split(" ")[0]}
                        </span>
                        {saved.url && (
                          <span className="bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded truncate max-w-[100px]" title={saved.url}>
                            {saved.url.replace(/^https?:\/\/(www\.)?/, "")}
                          </span>
                        )}
                      </div>

                      {/* Saved Timestamp */}
                      <div className="mt-2 pt-2 border-t border-slate-50 flex items-center justify-between text-[8px] text-slate-400 font-mono">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-2.5 h-2.5" />
                          {saved.savedAt}
                        </span>
                        {activeSavedId === saved.id && (
                          <span className="text-indigo-600 font-bold uppercase tracking-wider">Active</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : leftTab === "overview" && profileData ? (
            <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
              <OverviewMetricsTab
                extractedPlacements={extractedPlacements}
                planOptions={planOptions}
                rfpAnalysis={rfpAnalysis}
                profileData={profileData}
                metricSettings={planningSettings.overviewMetrics}
              />
            </div>
          ) : null}
        </section>

        {/* Right Column: Output / Workspace Workspace (fluid width) */}
        <section id="profile-workspace" className="flex-1 w-full min-w-0 space-y-6">
          {/* Loading Overlay State */}
          {loading && (
            <div className="bg-slate-950 border border-slate-800 text-slate-100 rounded-2xl p-6 md:p-8 shadow-2xl flex flex-col gap-6 min-h-[500px]">
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
                      {researchLogs[researchLogs.length - 1]?.message || "Analyzing target..."}
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
                  researchLogs.some(log => log.message?.toLowerCase().includes("validation") || log.message?.toLowerCase().includes("qa audit") || log.message?.toLowerCase().includes("sanity check")) 
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
                    logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
                  }
                }}
                className="relative flex-1 bg-slate-900/60 border border-slate-800/80 rounded-xl p-4 md:p-5 font-mono text-xs overflow-y-auto max-h-[360px] space-y-4 custom-scrollbar"
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
                
                {researchLogs.map((log) => (
                  <div 
                    key={log.id} 
                    className="space-y-2 border-b border-slate-800/40 pb-3 last:border-0 last:pb-0"
                  >
                    {/* Timestamp & Type header */}
                    <div className="flex items-center justify-between text-[10px] text-slate-500">
                      <span className="flex items-center gap-1.5 font-bold">
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-600"></span>
                        {log.timestamp}
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
                      <div className="space-y-2.5 pl-3 border-l border-emerald-500/40">
                        <p className="text-emerald-400 font-bold">
                          Successfully analyzed sector parameters for: {log.label}
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
            <div className="bg-white rounded-2xl border border-slate-100 p-8 md:p-12 text-center shadow-xs flex flex-col items-center justify-center gap-5 min-h-[400px]">
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
              {/* Document Actions Bar Container */}
              <div className="bg-slate-900 text-white rounded-2xl p-4 md:p-5 shadow-md space-y-4">
                <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Bookmark className="w-5 h-5 text-indigo-400" />
                    <div>
                      <span className="text-[10px] uppercase tracking-widest font-mono text-indigo-300 block font-semibold">Media Plan Blueprint Ready</span>
                      <h3 className="text-sm font-display font-bold text-white">
                        {profileData.personas[0]?.name ? `${profileData.personas[0].name} & Segments` : "Strategy Document"}
                      </h3>
                    </div>
                  </div>
                  
                  <div className="flex flex-wrap gap-2 w-full sm:w-auto">
                    {/* Save to History Button */}
                    <button
                      onClick={handleOpenSaveDialog}
                      className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 py-2 rounded-lg transition-colors cursor-pointer font-semibold"
                      title="Save this profile to history list"
                    >
                      <Save className="w-3.5 h-3.5" />
                      <span>{activeSavedId ? "Update Save" : "Save Profile"}</span>
                    </button>

                    <button
                      onClick={handleCopyProfile}
                      className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-white px-3.5 py-2 rounded-lg transition-colors cursor-pointer"
                      title="Copy full report as Markdown"
                    >
                      {copyProfileCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copyProfileCopied ? "Copied!" : "Copy Report"}</span>
                    </button>

                    {/* Export Dropdown */}
                    <div className="relative flex-1 sm:flex-none">
                      <button
                        onClick={() => setIsExportOpen(!isExportOpen)}
                        className="w-full inline-flex items-center justify-center gap-1.5 text-xs bg-indigo-600 hover:bg-indigo-700 text-white px-3.5 py-2 rounded-lg transition-colors cursor-pointer font-semibold"
                        title="Export this profile to PDF or Markdown formats"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Export Plan</span>
                        <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${isExportOpen ? 'rotate-180' : ''}`} />
                      </button>
                      
                      {isExportOpen && (
                        <>
                          <div className="fixed inset-0 z-45" onClick={() => setIsExportOpen(false)} />
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
                            <button
                              onClick={async () => {
                                setIsExportOpen(false);
                                await handleDownloadPDF();
                              }}
                              disabled={pdfGenerating}
                              className="w-full text-left px-4 py-2 text-xs text-slate-200 hover:bg-slate-700 flex items-center gap-2 cursor-pointer transition-colors disabled:opacity-50"
                            >
                              {pdfGenerating ? (
                                <Loader2 className="w-4 h-4 text-indigo-400 animate-spin shrink-0" />
                              ) : (
                                <BookOpen className="w-4 h-4 text-slate-400 shrink-0" />
                              )}
                              <div>
                                <span className="block font-semibold">{pdfGenerating ? "Generating..." : "Download PDF"}</span>
                                <span className="block text-[9px] text-slate-400 font-mono">High-fidelity visual (.pdf)</span>
                              </div>
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Inline Save Drawer */}
                {isSaving && (
                  <div className="pt-3 border-t border-slate-800 flex flex-col sm:flex-row items-end sm:items-center justify-between gap-3 bg-slate-950/45 p-3 rounded-xl">
                    <div className="w-full">
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                        Profile Save Title
                      </label>
                      <input
                        type="text"
                        value={saveTitle}
                        onChange={(e) => setSaveTitle(e.target.value)}
                        placeholder="e.g. US Gamers Profile"
                        className="w-full text-xs text-slate-100 bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 focus:outline-hidden focus:border-indigo-500 placeholder:text-slate-500"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSaveProfile();
                          if (e.key === "Escape") setIsSaving(false);
                        }}
                        autoFocus
                      />
                    </div>
                    <div className="flex gap-2 w-full sm:w-auto justify-end shrink-0">
                      <button
                        onClick={() => setIsSaving(false)}
                        className="text-xs text-slate-400 hover:text-slate-200 px-3 py-1.5 rounded-lg"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleSaveProfile}
                        className="text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-1.5 rounded-lg transition-colors cursor-pointer"
                      >
                        {activeSavedId ? "Save Changes" : "Confirm Save"}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* PDF Printable Wrapper and Cover Card */}
              <div id="profile-export-content" className="space-y-6">
                {/* Strategy Report Cover Card */}
                <div className="bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 text-white rounded-2xl p-5 md:p-6 shadow-sm border border-slate-800 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                  <div className="space-y-1">
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-indigo-500/15 border border-indigo-500/20 text-indigo-300 text-[10px] font-semibold font-mono uppercase tracking-wider">
                      <Sparkles className="w-3 h-3" />
                      Research Strategy Blueprint
                    </div>
                    <h2 className="text-lg md:text-xl font-display font-bold tracking-tight">
                      {profileData.personas[0]?.name ? `${profileData.personas[0].name} Target Audience Plan` : "Strategic Audience Profile"}
                    </h2>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 mt-2 font-medium">
                      <span className="bg-slate-800/60 px-2 py-0.5 rounded border border-slate-700/50 text-[10px] uppercase font-semibold">
                        {geography}
                      </span>
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
                    <div>Ref: {profileData.personas[0]?.name ? profileData.personas[0].name.slice(0, 3).toUpperCase() : "GEN"}-{Math.floor(1000 + Math.random() * 9000)}</div>
                  </div>
                </div>

                {/* 1. Introduction Summary */}
                <div className="bg-white rounded-2xl border border-slate-100 p-5 md:p-6 shadow-xs">
                  <div className="flex items-center gap-2 text-indigo-600 text-xs font-bold uppercase tracking-wider mb-2">
                    <Tv className="w-4 h-4" />
                    <span>1. Strategic Introduction</span>
                  </div>
                  <h3 className="text-lg font-display font-bold text-slate-900 leading-snug mb-3">Audience Overview</h3>
                  <p className="text-slate-600 text-sm leading-relaxed font-medium">
                    {profileData.intro}
                  </p>

                  {profileData.audienceAnalysis && profileData.audienceAnalysis.trim() && (
                    <div className="mt-5 pt-5 border-t border-slate-100">
                      <h3 className="text-lg font-display font-bold text-slate-900 leading-snug mb-3">Audience Analysis</h3>
                      <p className="text-slate-600 text-sm leading-relaxed font-medium">
                        {profileData.audienceAnalysis}
                      </p>
                    </div>
                  )}
                </div>

                {/* 2. Key Personas (Grid of cards) */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2 text-indigo-600 text-xs font-bold uppercase tracking-wider">
                      <User className="w-4 h-4" />
                      <span>2. Consumer Segments & Personas</span>
                    </div>
                  </div>

                  {(() => {
                    const personas = profileData.personas || [];
                    const hasRfpPersonas = personas.some(p => p.sourceType === 'RFP');
                    const isUploadedPlanMode = briefMode === "upload" || hasRfpPersonas || (planOptions && planOptions.length > 0 && planOptions.some(p => p.selected));
                    const reachBoost = profileData.expansionReachPercent || 35;

                    return (
                      <div className="space-y-4">
                        {/* ScoutAI Expansion Audience Note when Media Plan is uploaded */}
                        {isUploadedPlanMode && (
                          <div className="bg-indigo-50/90 border border-indigo-200/80 rounded-xl p-3.5 flex items-start sm:items-center gap-3 text-xs text-indigo-950 font-medium shadow-2xs">
                            <Sparkles className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5 sm:mt-0 animate-pulse" />
                            <div className="leading-relaxed">
                              <span className="font-bold text-indigo-900 mr-1">Audience Expansion Note:</span>
                              ScoutAI are recommended expansion audiences increases addressable reach by approximately {reachBoost}%.
                            </div>
                          </div>
                        )}

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                          {personas.map((persona, globalIndex) => {
                            const isRegeneratingThis = generatingAvatarIndex === globalIndex;
                            const hasValidAvatar = Boolean(persona.avatarUrl && !persona.avatarUrl.includes("example.com"));
                            const isRfp = persona.sourceType === 'RFP';

                            return (
                              <div key={globalIndex} className="bg-white rounded-2xl border border-slate-100 p-5 shadow-xs flex flex-col justify-between hover:shadow-md transition-all duration-200">
                                <div>
                                  {/* Headshot Photo & Name Header */}
                                  <div className="flex items-center gap-3.5 mb-4">
                                    {/* Round Headshot Frame */}
                                    <div className="relative group shrink-0">
                                      <div className="w-16 h-16 md:w-20 md:h-20 rounded-full overflow-hidden bg-slate-100 ring-2 ring-indigo-100 border border-slate-200/80 shadow-xs flex items-center justify-center relative shrink-0 aspect-square">
                                        {isRegeneratingThis ? (
                                          <div className="flex flex-col items-center justify-center text-center p-1 text-indigo-600 bg-white/90 absolute inset-0">
                                            <Loader2 className="w-5 h-5 animate-spin mb-1 text-indigo-600" />
                                            <span className="text-[9px] font-bold">Creating...</span>
                                          </div>
                                        ) : hasValidAvatar ? (
                                          <img
                                            src={persona.avatarUrl}
                                            alt={persona.name}
                                            className="w-full h-full object-cover object-center aspect-square transition-transform duration-300 group-hover:scale-105"
                                            onError={(e) => {
                                              (e.currentTarget as HTMLImageElement).style.display = "none";
                                            }}
                                          />
                                        ) : (
                                          <div className="flex flex-col items-center justify-center text-slate-400 p-2 text-center">
                                            <User className="w-7 h-7 mb-0.5 text-slate-300" />
                                            <button
                                              onClick={() => handleRegenerateAvatar(globalIndex)}
                                              className="text-[9px] font-bold text-indigo-600 hover:underline cursor-pointer"
                                            >
                                              + Photo
                                            </button>
                                          </div>
                                        )}
                                      </div>

                                      {!isRegeneratingThis && hasValidAvatar && (
                                        <button
                                          onClick={() => handleRegenerateAvatar(globalIndex)}
                                          title="Regenerate headshot"
                                          className="absolute bottom-0 right-0 bg-white hover:bg-indigo-50 text-indigo-600 hover:text-indigo-700 p-1.5 rounded-full border border-slate-200 shadow-xs transition-colors cursor-pointer"
                                        >
                                          <RefreshCw className="w-3 h-3" />
                                        </button>
                                      )}
                                    </div>

                                    {/* Archetype & Persona Name */}
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-1.5 flex-wrap mb-1">
                                        <span className="inline-block text-[10px] uppercase font-mono bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-md font-bold border border-indigo-100">
                                          Archetype 0{globalIndex + 1}
                                        </span>
                                        {isUploadedPlanMode && (
                                          isRfp ? (
                                            <span className="inline-flex items-center gap-1 text-[10px] font-mono font-bold bg-amber-100/90 text-amber-900 border border-amber-200 px-2 py-0.5 rounded-md uppercase tracking-wider">
                                              <FileText className="w-2.5 h-2.5 text-amber-700" /> RFP
                                            </span>
                                          ) : (
                                            <span className="inline-flex items-center gap-1 text-[10px] font-mono font-bold bg-indigo-100/90 text-indigo-900 border border-indigo-200 px-2 py-0.5 rounded-md uppercase tracking-wider">
                                              <Sparkles className="w-2.5 h-2.5 text-indigo-600" /> ScoutAI
                                            </span>
                                          )
                                        )}
                                      </div>
                                      <h4 className="text-base font-display font-bold text-slate-800 leading-snug">{persona.name}</h4>
                                    </div>
                                  </div>
                                  
                                  {/* Age, Gender & Household Income Demographics */}
                                  <div className="mb-4 bg-slate-50/80 p-3 rounded-xl border border-slate-100 space-y-2">
                                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                                      <div>
                                        <span className="text-slate-400 block font-medium text-[10px] uppercase tracking-wider">Age Group</span>
                                        <span className="font-bold text-slate-700">{persona.age}</span>
                                      </div>
                                      <div>
                                        <span className="text-slate-400 block font-medium text-[10px] uppercase tracking-wider">Gender Skew</span>
                                        <span className="font-bold text-slate-700">{persona.gender}</span>
                                      </div>
                                    </div>
                                    <div className="pt-2 border-t border-slate-200/60 flex items-center justify-between text-[11px]">
                                      <span className="text-slate-400 font-medium text-[10px] uppercase tracking-wider">Household Income (HHI)</span>
                                      <span className="font-bold font-mono text-indigo-900 bg-indigo-50/80 px-2 py-0.5 rounded border border-indigo-100/50">{persona.income}</span>
                                    </div>
                                  </div>

                                  {/* Media & Shopping Habits */}
                                  <div className="space-y-2.5 text-xs mb-4">
                                    <div className="leading-relaxed bg-slate-50/50 p-2.5 rounded-lg border border-slate-100/50">
                                      <strong className="text-slate-700 block text-[11px] font-semibold mb-0.5">📺 Watch Profile:</strong>
                                      <span className="text-slate-600">{persona.watch}</span>
                                    </div>
                                    <div className="leading-relaxed bg-slate-50/50 p-2.5 rounded-lg border border-slate-100/50">
                                      <strong className="text-slate-700 block text-[11px] font-semibold mb-0.5">🌐 Digital Browsing:</strong>
                                      <span className="text-slate-600">{persona.browse}</span>
                                    </div>
                                    <div className="leading-relaxed bg-slate-50/50 p-2.5 rounded-lg border border-slate-100/50">
                                      <strong className="text-slate-700 block text-[11px] font-semibold mb-0.5">🛒 Purchasing Focus:</strong>
                                      <span className="text-slate-600">{persona.buy}</span>
                                    </div>
                                  </div>
                                </div>

                                {/* Narrative Quote */}
                                <div className="pt-3 border-t border-slate-100 text-xs text-slate-600 italic bg-slate-50/40 -mx-5 -mb-5 p-4 rounded-b-2xl">
                                  "{persona.narrative}"
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {/* 3. Core Takeaways */}
                <div className="bg-white rounded-2xl border border-slate-100 p-5 md:p-6 shadow-xs">
                  <div className="flex items-center gap-2 text-emerald-600 text-xs font-bold uppercase tracking-wider mb-2">
                    <CheckCircle className="w-4 h-4" />
                    <span>3. Core Takeaways</span>
                  </div>
                  <h3 className="text-base font-display font-bold text-slate-800 mb-3">Key Consumer Facts</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {profileData.takeaways.map((takeaway, idx) => (
                      <div key={idx} className="flex gap-2.5 items-start bg-slate-50/50 border border-slate-100/50 p-3.5 rounded-xl">
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

                {/* 4. Recommendations */}
                <div className="bg-white rounded-2xl border border-slate-100 p-5 md:p-6 shadow-xs">
                  <div>
                    <div className="flex items-center gap-2 text-indigo-600 text-xs font-bold uppercase tracking-wider mb-2">
                      <Layers className="w-4 h-4" />
                      <span>4. Recommendations</span>
                    </div>
                    <h3 className="text-base font-display font-bold text-slate-800 mb-3">Tactical Media Guide</h3>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {profileData.recommendations.map((rec, idx) => (
                        <div key={idx} className="bg-slate-50/40 border border-slate-100 p-3.5 rounded-xl space-y-1.5 hover:bg-indigo-50/10 transition-colors flex flex-col justify-between">
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

                {/* Dynamic 5. Domain Affinity & CTV Publishers Bento Rows */}
                {/* Case 1: CTV-First - SHOW CTV Publishers and REPLACE Domains */}
                {campaignFocus === "CTV-first digital media plan" && (
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* CTV Publishers to Target */}
                    <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-100 p-5 md:p-6 shadow-xs space-y-4">
                      <div className="flex items-center gap-2 text-indigo-600 text-xs font-bold uppercase tracking-wider">
                        <Tv className="w-4 h-4" />
                        <span>5. Recommended CTV Publishers</span>
                      </div>
                      <h3 className="text-base font-display font-bold text-slate-800">CTV Publishers to Target</h3>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {(profileData.ctvPublishers || defaultCtvPublishers).map((pub, idx) => (
                          <div key={idx} className="bg-slate-50/50 border border-slate-100 p-4 rounded-xl flex items-start gap-3 hover:bg-indigo-50/10 transition-colors">
                            <div className="w-12 h-12 rounded-full border border-slate-100 bg-white shadow-xs flex items-center justify-center p-[2px] overflow-hidden shrink-0">
                              <img
                                src={getPublisherLogo(pub.publisher)}
                                alt={pub.publisher}
                                className="w-full h-full object-cover rounded-full"
                                referrerPolicy="no-referrer"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).src = "/assets/pub-logos/placeholder_80x80.png";
                                }}
                              />
                            </div>
                            <div className="space-y-1">
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-bold text-slate-800">{pub.publisher}</span>
                                <span className={`text-[8px] font-mono font-bold uppercase px-1.5 py-0.5 rounded ${
                                  pub.category === "App" ? "bg-indigo-50 text-indigo-700 border border-indigo-100/30" :
                                  pub.category === "Network" ? "bg-sky-50 text-sky-700 border border-sky-100/30" :
                                  "bg-emerald-50 text-emerald-700 border border-emerald-100/30"
                                }`}>
                                  {pub.category}
                                </span>
                              </div>
                              <p className="text-[11px] text-slate-600 leading-normal">{pub.why}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* CTV Publisher Insights */}
                    <div className="lg:col-span-1 bg-white rounded-2xl border border-slate-100 p-5 md:p-6 shadow-xs flex flex-col justify-between">
                      <div>
                        <div className="flex items-center gap-2 text-indigo-600 text-xs font-bold uppercase tracking-wider mb-2">
                          <TrendingUp className="w-4 h-4" />
                          <span>5. Publisher Insights</span>
                        </div>
                        <h3 className="text-base font-display font-bold text-slate-800 mb-3">Publisher Alignment</h3>
                        <p className="text-xs text-slate-600 leading-relaxed mb-4">
                          {profileData.publisherInsights || defaultPublisherInsights}
                        </p>
                      </div>
                      <div className="p-4 bg-slate-50 rounded-xl border border-slate-100/50 text-[11px] text-slate-500">
                        <span className="font-bold text-slate-700 block mb-1">💡 Media Planning Tip</span>
                        Maximize reach by distributing spots evenly across SVOD apps, FAST channels, and high-impact smart TV OS home banners.
                      </div>
                    </div>
                  </div>
                )}

                {/* Case 2: Full-Funnel - SHOW BOTH Domain Affinity AND CTV Publishers */}
                {campaignFocus === "Full-funnel digital media plan" && (
                  <div className="space-y-6">
                    {/* Domain Affinity Grid */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                      <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-100 p-5 md:p-6 shadow-xs">
                        <div className="flex items-center gap-2 text-indigo-600 text-xs font-bold uppercase tracking-wider mb-2">
                          <TrendingUp className="w-4 h-4" />
                          <span>5a. Domain Affinity Index</span>
                        </div>
                        <h3 className="text-base font-display font-bold text-slate-800 mb-3">Top Domain Affinity Index</h3>
                        <DomainsChart
                          data={profileData.browserAndReach.chartData}
                          source={profileData.browserAndReach.chartSource}
                        />
                      </div>

                      <div className="lg:col-span-1 bg-white rounded-2xl border border-slate-100 p-5 md:p-6 shadow-xs flex flex-col justify-between">
                        <div>
                          <div className="flex items-center gap-2 text-indigo-600 text-xs font-bold uppercase tracking-wider mb-2">
                            <TrendingUp className="w-4 h-4" />
                            <span>5a. Domain Insights</span>
                          </div>
                          <h3 className="text-base font-display font-bold text-slate-800 mb-3">Domain Affinity Insights</h3>
                          <p className="text-xs text-slate-600 leading-relaxed mb-4">
                            {profileData.browserAndReach.overview}
                          </p>
                        </div>
                        <div className="p-4 bg-slate-50 rounded-xl border border-slate-100/50 text-[11px] text-slate-500">
                          <span className="font-bold text-slate-700 block mb-1">💡 Media Planning Tip</span>
                          Contextual web alignments on these index affinity domains can serve as direct lower-funnel retargeting environments.
                        </div>
                      </div>
                    </div>

                    {/* CTV Publishers Grid */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                      {/* CTV Publishers to Target */}
                      <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-100 p-5 md:p-6 shadow-xs space-y-4">
                        <div className="flex items-center gap-2 text-indigo-600 text-xs font-bold uppercase tracking-wider">
                          <Tv className="w-4 h-4" />
                          <span>5b. Recommended CTV Publishers</span>
                        </div>
                        <h3 className="text-base font-display font-bold text-slate-800">CTV Publishers to Target</h3>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {(profileData.ctvPublishers || defaultCtvPublishers).map((pub, idx) => (
                            <div key={idx} className="bg-slate-50/50 border border-slate-100 p-4 rounded-xl flex items-start gap-3 hover:bg-indigo-50/10 transition-colors">
                              <div className="w-12 h-12 rounded-full border border-slate-100 bg-white shadow-xs flex items-center justify-center p-[2px] overflow-hidden shrink-0">
                                <img
                                  src={getPublisherLogo(pub.publisher)}
                                  alt={pub.publisher}
                                  className="w-full h-full object-cover rounded-full"
                                  referrerPolicy="no-referrer"
                                  onError={(e) => {
                                    (e.target as HTMLImageElement).src = "/assets/pub-logos/placeholder_80x80.png";
                                  }}
                                />
                              </div>
                              <div className="space-y-1">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-xs font-bold text-slate-800">{pub.publisher}</span>
                                  <span className={`text-[8px] font-mono font-bold uppercase px-1.5 py-0.5 rounded ${
                                    pub.category === "App" ? "bg-indigo-50 text-indigo-700 border border-indigo-100/30" :
                                    pub.category === "Network" ? "bg-sky-50 text-sky-700 border border-sky-100/30" :
                                    "bg-emerald-50 text-emerald-700 border border-emerald-100/30"
                                  }`}>
                                    {pub.category}
                                  </span>
                                </div>
                                <p className="text-[11px] text-slate-600 leading-normal">{pub.why}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* CTV Publisher Insights */}
                      <div className="lg:col-span-1 bg-white rounded-2xl border border-slate-100 p-5 md:p-6 shadow-xs flex flex-col justify-between">
                        <div>
                          <div className="flex items-center gap-2 text-indigo-600 text-xs font-bold uppercase tracking-wider mb-2">
                            <TrendingUp className="w-4 h-4" />
                            <span>5b. Publisher Insights</span>
                          </div>
                          <h3 className="text-base font-display font-bold text-slate-800 mb-3">Publisher Alignment</h3>
                          <p className="text-xs text-slate-600 leading-relaxed mb-4">
                            {profileData.publisherInsights || defaultPublisherInsights}
                          </p>
                        </div>
                        <div className="p-4 bg-slate-50 rounded-xl border border-slate-100/50 text-[11px] text-slate-500">
                          <span className="font-bold text-slate-700 block mb-1">💡 Media Planning Tip</span>
                          Maximize reach by distributing spots evenly across SVOD apps, FAST channels, and high-impact smart TV OS home banners.
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Case 3: Display & Social - SHOW ONLY Domain Affinity */}
                {campaignFocus === "Display/social/video plan" && (
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-100 p-5 md:p-6 shadow-xs">
                      <div className="flex items-center gap-2 text-indigo-600 text-xs font-bold uppercase tracking-wider mb-2">
                        <TrendingUp className="w-4 h-4" />
                        <span>5. Domain Affinity Index</span>
                      </div>
                      <h3 className="text-base font-display font-bold text-slate-800 mb-3">Top Domain Affinity Index</h3>
                      <DomainsChart
                        data={profileData.browserAndReach.chartData}
                        source={profileData.browserAndReach.chartSource}
                      />
                    </div>

                    <div className="lg:col-span-1 bg-white rounded-2xl border border-slate-100 p-5 md:p-6 shadow-xs flex flex-col justify-between">
                      <div>
                        <div className="flex items-center gap-2 text-indigo-600 text-xs font-bold uppercase tracking-wider mb-2">
                          <TrendingUp className="w-4 h-4" />
                          <span>5. Domain Insights</span>
                        </div>
                        <h3 className="text-base font-display font-bold text-slate-800 mb-3">Domain Affinity Insights</h3>
                        <p className="text-xs text-slate-600 leading-relaxed mb-4">
                          {profileData.browserAndReach.overview}
                        </p>
                      </div>
                      <div className="p-4 bg-slate-50 rounded-xl border border-slate-100/50 text-[11px] text-slate-500">
                        <span className="font-bold text-slate-700 block mb-1">💡 Media Planning Tip</span>
                        Contextual web alignments on these index affinity domains can serve as direct lower-funnel retargeting environments.
                      </div>
                    </div>
                  </div>
                )}

                {/* 6. Device Share - Full Width 2 Column 50/50 Layout */}
                <div className="bg-white rounded-2xl border border-slate-100 p-5 md:p-6 shadow-xs">
                  <div className="flex items-center gap-2 text-indigo-600 text-xs font-bold uppercase tracking-wider mb-2">
                    <Smartphone className="w-4 h-4" />
                    <span>6. Device Share</span>
                  </div>
                  <h3 className="text-base font-display font-bold text-slate-800 mb-3">Multi-Screen Habits</h3>
                  
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
                      <div className="p-4 bg-slate-50 rounded-xl border border-slate-100/50 text-[11px] text-slate-500">
                        <span className="font-bold text-slate-700 block mb-1">📺 Multi-Screen Activation</span>
                        Coordinate CTV spots with simultaneous, real-time mobile app push/display placements on related publishers for elevated purchase recall.
                      </div>
                    </div>
                  </div>
                </div>

                {/* 7. Demographics - Full Width Panel */}
                <div className="bg-white rounded-2xl border border-slate-100 p-5 md:p-6 shadow-xs">
                  <div className="flex items-center gap-2 text-indigo-600 text-xs font-bold uppercase tracking-wider mb-2">
                    <User className="w-4 h-4" />
                    <span>7. Demographics</span>
                  </div>
                  <h3 className="text-base font-display font-bold text-slate-800 mb-2">Strategic Demographic Overview</h3>
                  
                  {/* Strategic Demographic Overview Text - Full Width */}
                  <p className="text-xs text-slate-600 leading-relaxed mb-6">
                    {profileData.demographics.overview}
                  </p>

                  {/* 3 Columns with 3 Charts */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-6">
                    <AgeChart
                      data={profileData.demographics.ageChartData}
                      source={profileData.demographics.ageChartData[0]?.source || "Syndicated Sources"}
                    />
                    <GenderChart
                      data={profileData.demographics.genderChartData}
                      source={profileData.demographics.genderChartData[0]?.source || "Syndicated Sources"}
                    />
                    <IncomeChart
                      data={profileData.demographics.incomeChartData}
                      source={profileData.demographics.incomeChartData[0]?.source || "Syndicated Sources"}
                    />
                  </div>

                  {/* Geographic Concentration Notes - Full Width under charts */}
                  {profileData.demographics.geographyNotes && (
                    <div className="bg-slate-50 rounded-xl border border-slate-100/50 p-4 text-[11px] text-slate-500">
                      <span className="text-[10px] uppercase font-mono text-indigo-600 font-bold block mb-1">Geographic Concentration Notes</span>
                      <p className="leading-relaxed">
                        {profileData.demographics.geographyNotes}
                      </p>
                    </div>
                  )}
                </div>

                {/* 8. Temporal Activity Patterns Bento Row */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Daypart Guidance & Activation Notes */}
                  <div className="lg:col-span-1 bg-white rounded-2xl border border-slate-100 p-5 md:p-6 shadow-xs flex flex-col justify-between">
                    <div>
                      <div className="flex items-center gap-2 text-indigo-600 text-xs font-bold uppercase tracking-wider mb-2">
                        <Clock className="w-4 h-4" />
                        <span>8. Temporal Activity Patterns</span>
                      </div>
                      <h3 className="text-base font-display font-bold text-slate-800 mb-2">Daypart Scheduling Guidance</h3>
                      <p className="text-xs text-slate-600 leading-relaxed mb-4">
                        {profileData.temporalPatterns.overview}
                      </p>
                    </div>
                    <div className="bg-slate-50 rounded-xl border border-slate-100/50 p-4 text-[11px] text-slate-500">
                      <span className="text-[10px] uppercase font-mono text-indigo-600 font-bold block mb-1">Persona Activation Notes</span>
                      <p className="leading-relaxed">
                        {profileData.temporalPatterns.activationNotes}
                      </p>
                    </div>
                  </div>

                  {/* Temporal Activity Charts */}
                  <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-100 p-5 md:p-6 shadow-xs flex flex-col justify-between">
                    <div>
                      <span className="text-[10px] uppercase font-mono text-indigo-600 font-bold block mb-3">Temporal Activity Indices</span>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <DayOfWeekChart
                          data={profileData.temporalPatterns.dayOfWeekChartData}
                          source={profileData.temporalPatterns.dayOfWeekChartData[0]?.source || "Modeled planning indices"}
                        />
                        <HourOfDayChart
                          data={profileData.temporalPatterns.hourOfDayChartData}
                          source={profileData.temporalPatterns.hourOfDayChartData[0]?.source || "Modeled planning indices"}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* 9. Executive summary */}
                <div className="bg-indigo-50/50 border border-indigo-100/80 rounded-2xl p-5 md:p-6 shadow-xs">
                  <div className="flex items-center gap-2 text-indigo-700 text-xs font-bold uppercase tracking-wider mb-2">
                    <Award className="w-4 h-4" />
                    <span>9. Executive Summary Blueprint</span>
                  </div>
                  <h3 className="text-base font-display font-bold text-indigo-900 mb-2">Audience Opportunity & Core Alignment</h3>
                  <p className="text-xs text-indigo-950 leading-relaxed font-medium">
                    {profileData.executiveSummary}
                  </p>
                </div>

                {/* 10. Channel Strategy & Activation Plan (when Media Plan Analysis is present) */}
                {profileData.channelStrategy && (
                  <ChannelStrategySection
                    data={profileData.channelStrategy}
                    onToggleBudgetMode={handleToggleBudgetMode}
                    onManualMediaTypeChange={handleManualMediaTypeChange}
                    onSaveAllocations={handleSaveManualAllocations}
                    onResetAllocations={handleResetManualAllocations}
                    onUndoPlanChange={handleUndoChannelStrategyChange}
                    canUndoPlanChange={Boolean(channelStrategyUndo)}
                  />
                )}

              {/* Sourcing and Grounding List */}
              <div className="bg-white rounded-2xl border border-slate-100 p-5 md:p-6 shadow-xs space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-indigo-600 text-xs font-bold uppercase tracking-wider">
                    <BookOpen className="w-4 h-4" />
                    <span>{profileData.channelStrategy ? "11" : "10"}. Citations & Media Sourcing Registry</span>
                  </div>
                  <button
                    onClick={handleCopySources}
                    className="inline-flex items-center gap-1.5 text-xs text-slate-500 bg-slate-50 hover:bg-slate-100 border border-slate-100 px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
                  >
                    {copySourcesCopied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copySourcesCopied ? "Copied!" : "Copy Sources"}</span>
                  </button>
                </div>

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
                            <span className="text-xs font-bold text-slate-800">{source.name}</span>
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

              </div>

              {/* AI QA Audit & Scoring Center */}
              {profileData.auditResult && (
                <div className="bg-white rounded-2xl border border-slate-100 p-5 md:p-6 shadow-xs space-y-6">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-slate-100 pb-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <ShieldCheck className="w-5 h-5 text-emerald-500" />
                        <h3 className="text-sm font-display font-bold text-slate-800 uppercase tracking-wider">
                          {profileData.channelStrategy ? "12" : "11"}. Programmatic Media Buyer QA Audit
                        </h3>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Independent scoring and automated compliance check for client presentation readiness.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {profileData.auditResult.autoFixes && profileData.auditResult.autoFixes.length > 0 ? (
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
                        <div className="w-24 h-24 rounded-full border-4 border-indigo-500/20 flex flex-col items-center justify-center">
                          <span className="text-3xl font-mono font-extrabold text-indigo-400">
                            {profileData.auditResult.finalScore}
                          </span>
                          <span className="text-[9px] font-mono text-indigo-300 tracking-wider">
                            / 100
                          </span>
                        </div>
                      </div>
                      {profileData.auditResult.originalScore !== profileData.auditResult.finalScore && (
                        <p className="text-[10px] text-indigo-300/80 font-mono">
                          Auto-remediated from {profileData.auditResult.originalScore}/100
                        </p>
                      )}
                      <p className="text-[11px] text-slate-300 leading-relaxed px-2 font-medium">
                        {profileData.auditResult.finalScore >= 95 ? "Excellent (Presentation Approved)" : "Pass (Review Flag Details)"}
                      </p>
                    </div>

                    {/* Categories list */}
                    <div className="md:col-span-8 space-y-3.5">
                      <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                        Evaluation Scorecard
                      </h4>
                      <div className="space-y-3">
                        {profileData.auditResult.scorecard.map((item, idx) => {
                          const scorePct = (item.score / 20) * 100;
                          // Dynamic bar color
                          let barColor = "bg-emerald-500";
                          if (item.score < 15) barColor = "bg-amber-500";
                          if (item.score < 10) barColor = "bg-rose-500";

                          return (
                            <div key={idx} className="space-y-1">
                              <div className="flex justify-between items-center text-xs">
                                <span className="font-bold text-slate-700">{item.category}</span>
                                <span className="font-mono font-bold text-slate-800 bg-slate-100 px-1.5 py-0.5 rounded">
                                  {item.score} / 20
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
                          🚨 Critical Red Flags & Auto-Fixes
                        </h4>
                      </div>
                      <div className="space-y-3">
                        {profileData.auditResult.autoFixes && profileData.auditResult.autoFixes.length > 0 ? (
                          <div className="space-y-2.5 max-h-[160px] overflow-y-auto custom-scrollbar">
                            {profileData.auditResult.autoFixes.map((fix, i) => (
                              <div key={i} className="text-xs border-b border-indigo-100/30 pb-2.5 last:border-0 last:pb-0 space-y-1">
                                <p className="text-indigo-900 font-bold flex items-start gap-1">
                                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-indigo-400 shrink-0 mt-1"></span>
                                  <span><strong>Issue:</strong> {fix.issue}</span>
                                </p>
                                <p className="text-slate-600 pl-3 leading-normal italic">
                                  <strong>AI Fix:</strong> {fix.resolution}
                                </p>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-slate-500 italic pl-1">
                            Clean - No major data hallucinations or metric contradictions detected. Verified perfect alignment.
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Additional RFP Requirements & Agency Capability Responses */}
              {profileData.additionalRfpRequirements && (
                <div className="bg-white rounded-2xl border border-indigo-100 p-5 md:p-6 shadow-xs space-y-6">
                  {/* Section Header */}
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-indigo-100/60 pb-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <FileText className="w-5 h-5 text-indigo-600" />
                        <h3 className="text-sm font-display font-bold text-slate-800 uppercase tracking-wider">
                          {(profileData.channelStrategy ? 1 : 0) + (profileData.auditResult ? 1 : 0) + 11}. RFP Requirements & Agency Capability Responses
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
              <div className="bg-slate-50 border border-slate-100 rounded-2xl p-5 md:p-6 text-center space-y-4">
                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Advanced Strategy Tuning</h4>
                <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
                  Tweak the planning assumptions by triggering the generation agent again with localized weighting configurations.
                </p>
                <div className="flex flex-wrap justify-center gap-3">
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
            </div>
          )}
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
                          Total Rows: {parsedSheetsData[activeSheetIndex]?.rows.length || 0} | Columns: {parsedSheetsData[activeSheetIndex]?.headers.length || 0}
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
                        if (!activeSheet || activeSheet.rows.length === 0) {
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
                                  <span> (filtered from {activeSheet.rows.length} total)</span>
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
    </div>
  );
}
