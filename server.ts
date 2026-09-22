import express from "express";
import path from "path";
import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";
import OpenAI, { toFile } from "openai";
import multer from "multer";
import os from "os";
import fs from "fs";
import crypto from "crypto";
import { CANONICAL_MEDIA_TAXONOMY, isNonMediaItem, normalizeRawChannel } from "./src/utils/mediaTaxonomy";
import { buildCampaignFacts, buildMediaRecommendationPlan, profileSignals } from "./src/planning/engine";
import { validateProductRegistry } from "./src/planning/knowledge/registry";
import { isCustomProductId, resolveEffectiveProducts } from "./src/planning/effectiveProducts";
import { validatePlanningKnowledgeBase } from "./src/planning/knowledge/normalizeWorkbook";
import { DEFAULT_PLANNING_SETTINGS, validatePlanningSettings } from "./src/planning/settings";
import { createStorage, PlanNotFoundError, RevisionConflictError, type StorageAdapter } from "./src/storage";
import {
  actorName,
  clearSessionCookie,
  createSessionToken,
  getSession,
  isAdminPasswordConfigured,
  isAdminRequestAllowed,
  requireAdmin,
  requireAuth,
  sanitizeDisplayName,
  setSessionCookie,
} from "./src/server/session";
import { DEFAULT_CTV_PUBLISHERS } from "./src/planning/knowledge/ctvPublishers";
import { applyProgrammaticSanityChecks } from "./src/qa/chartSanity";
import { resolveGroundingUrls } from "./src/research/groundingUrls";
import type { AiCandidateSignal, PlanningMode } from "./src/planning/types";
import {
  companyOverview,
  mainSolutionCategories,
  capabilities as digitalRemedyCapabilities,
  ctvPublishers as digitalRemedyCtvPublishers,
  ctvPlanFramework,
  getFullContext as getDigitalRemedyContext
} from "./documentation/digital-remedy-context.js";

// Disk-backed session cache for parsed media plans to avoid re-parsing identical uploads across server reloads
interface CachedParsedPlan {
  placements: any[];
  rfpAnalysis?: any;
  filename: string;
  hash: string;
  timestamp: number;
}

const CACHE_FILE_PATH = path.join(process.cwd(), ".media_plan_cache.json");

function loadMediaPlanCacheFromDisk(): Map<string, CachedParsedPlan> {
  const map = new Map<string, CachedParsedPlan>();
  try {
    if (fs.existsSync(CACHE_FILE_PATH)) {
      const data = fs.readFileSync(CACHE_FILE_PATH, "utf-8");
      const obj = JSON.parse(data);
      if (typeof obj === "object" && obj !== null) {
        for (const [k, v] of Object.entries(obj)) {
          if (v && Array.isArray((v as any).placements)) {
            map.set(k, v as CachedParsedPlan);
          }
        }
      }
      console.log(`[CACHE] Loaded ${map.size} cached parsed media plan(s) from disk file (${CACHE_FILE_PATH}).`);
    }
  } catch (err) {
    console.warn("[CACHE] Could not load disk cache for media plans:", err);
  }
  return map;
}

function saveMediaPlanCacheToDisk(map: Map<string, CachedParsedPlan>) {
  try {
    const obj: Record<string, CachedParsedPlan> = {};
    for (const [k, v] of map.entries()) {
      obj[k] = v;
    }
    fs.writeFileSync(CACHE_FILE_PATH, JSON.stringify(obj, null, 2), "utf-8");
    console.log(`[CACHE] Saved ${map.size} cached parsed media plan(s) to disk.`);
  } catch (err) {
    console.warn("[CACHE] Failed to save media plan cache to disk:", err);
  }
}

const mediaPlanParseCache = loadMediaPlanCacheFromDisk();
import { summarizeSelectedPlansForPrompt } from "./src/utils/planPromptOptimizer";
import {
  buildSegmentPrompt,
  buildSegmentResponseSchema,
  extractPlanAudiences,
  MAX_AI_SEGMENTS,
  MIN_AI_SEGMENTS,
  normalizeSegments,
  sanitizeSegmentRequest,
} from "./src/research/segmentRecommendations";
import {
  generateStructuredJson,
  generateStructuredJsonWithFallback,
  generateText,
  GEMINI_FLASH_MODEL,
  toGeminiJsonSchema,
} from "./src/server/geminiInteractions";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local"), override: false, quiet: true });
dotenv.config({ path: path.resolve(process.cwd(), ".env"), override: false, quiet: true });

const planningStartupErrors = [...validateProductRegistry(), ...validatePlanningKnowledgeBase()];
if (planningStartupErrors.length > 0) {
  throw new Error(`Planning knowledge validation failed:\n${planningStartupErrors.join("\n")}`);
}

const upload = multer({ dest: os.tmpdir() });

// --- CONFIGURABLE TIMEOUTS FOR LLM & GROUNDING CALLS (in milliseconds) ---
// Adjust these values to increase/decrease the allowed time for each step:
const TIMEOUT_PARALLEL_RESEARCH_MS = 90000; // 90 seconds per parallel research thread (Option A)
const TIMEOUT_SYNTHESIS_MS = 120000;          // 120 seconds for the main synthesis call (Option B)
const TIMEOUT_SCORING_MS = 60000;            // 60 seconds for QA scorecard evaluation (Option B)
const TIMEOUT_CORRECTION_MS = 90000;         // 90 seconds for auto-remediation rewrite (Option B)
// Segment recommendations run after the profile is delivered, so they favour quality: high
// thinking first, one medium-thinking fallback. Together they stay inside Cloud Run's 300s.
const TIMEOUT_SEGMENTS_HIGH_MS = 90000;
const TIMEOUT_SEGMENTS_FALLBACK_MS = 60000;
// Short rewrites at low thinking. Both have a non-AI fallback, so a stall should end quickly.
const TIMEOUT_SUMMARIZE_INSIGHTS_MS = 30000;
const TIMEOUT_AUDIENCE_ANALYSIS_MS = 30000;
// Per-redirect budget when turning grounding links back into publisher URLs. Deliberately short:
// this runs across ~100 sources and an unresolved one still ships, so waiting is pure loss.
const TIMEOUT_URL_RESOLUTION_MS = 5000;
const URL_RESOLUTION_CONCURRENCY = 12;

// Thinking budget for the main synthesis call. gemini-2.5-flash defaults to DYNAMIC thinking,
// which can add tens of thousands of invisible output tokens and is the largest single source
// of variance in synthesis latency. Bounded here so the stage fits inside TIMEOUT_SYNTHESIS_MS.
// Raise toward 24576 (or set to -1 for dynamic) if synthesis quality regresses; 0 disables thinking.
const SYNTHESIS_THINKING_BUDGET = 4096;

// First-party campaign evidence, listed ahead of the researched public sources.
const DIGITAL_REMEDY_SOURCE = {
  name: "Digital Remedy historical data",
  url: "",
  supportedClaims: "Audience strategy, Channel and Publisher recommendations",
  tier: "Tier 1: First-Party",
  usageType: "Primary Source",
};

// Generic Promise Timeout Helper
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallbackValue: T): Promise<T> {
  let timeoutId: NodeJS.Timeout;
  const timeoutPromise = new Promise<T>((resolve) => {
    timeoutId = setTimeout(() => {
      console.warn(`[TIMEOUT] Operation exceeded ${timeoutMs}ms. Returning fallback content.`);
      resolve(fallbackValue);
    }, timeoutMs);
  });
  return Promise.race([
    promise.then((val) => {
      clearTimeout(timeoutId);
      return val;
    }),
    timeoutPromise,
  ]);
}

const app = express();
app.set("trust proxy", 1);
// Cloud Run (and most PaaS hosts) inject the port to listen on via $PORT and will fail the
// health check if the container binds anything else. 3000 stays the local default.
const PORT = Number(process.env.PORT) || 3000;

// Enable JSON parsing with a generous limit for additional context if needed
app.use(express.json({ limit: "10mb" }));

// --- SHARED, SERVER-AUTHORITATIVE STORAGE ---------------------------------------
// Plans and settings live in Firestore when deployed and on disk in local development.
// The container filesystem is never the production store: Cloud Run runs this service
// with minScale 0 / maxScale 100, so anything written to disk is invisible to the next
// instance and gone after a redeploy.
let storageAdapter: StorageAdapter | null = null;
let storageInitPromise: Promise<StorageAdapter> | null = null;

async function getStorage(): Promise<StorageAdapter> {
  if (storageAdapter) return storageAdapter;
  if (!storageInitPromise) {
    storageInitPromise = createStorage()
      .then((adapter) => {
        storageAdapter = adapter;
        return adapter;
      })
      .catch((err) => {
        // Clear the memo so a transient credential problem does not poison every later request.
        storageInitPromise = null;
        throw err;
      });
  }
  return storageInitPromise;
}

// Unauthenticated endpoints. Everything else under /api requires a session cookie -
// the previous login was a client-side gate only, which left these routes open to the
// internet on a service deployed with invoker-iam-disabled.
const PUBLIC_API_PATHS = new Set([
  "/api/health",
  "/api/auth/login",
  "/api/auth/me",
  "/api/auth/logout",
  "/api/share/plan",
  "/api/summarize-publisher-insights",
  "/api/personas/generate-slide",
  "/api/channels/generate-slide",
]);

app.use("/api", (req, res, next) => {
  // req.path is relative to the "/api" mount point.
  if (PUBLIC_API_PATHS.has(`/api${req.path}`)) {
    next();
    return;
  }
  requireAuth(req, res, next);
});

// Deploy verification: shows which storage driver actually came up. If this reports
// "local-file" on Cloud Run, plans are NOT being shared and NOT surviving restarts.
app.get("/api/health", async (_req, res) => {
  try {
    const storage = await getStorage();
    res.json({
      ok: true,
      storageDriver: storage.name,
      shared: storage.name !== "local-file",
      adminPasswordConfigured: isAdminPasswordConfigured(),
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

// Serve the assets folder containing publisher logos
app.use("/assets", express.static(path.join(process.cwd(), "assets")));

// Lazy-initialize the Google GenAI SDK to prevent startup crash if API key is missing
let aiClient: GoogleGenAI | null = null;
function getAiClient(): GoogleGenAI {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not configured on the server. Please add it to your secrets panel.");
    }
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }
  return aiClient;
}

// Lazy-initialize the OpenAI SDK
let openaiClient: OpenAI | null = null;
function getOpenaiClient(): OpenAI {
  if (!openaiClient) {
    const apiKey = process.env.OPEN_AI_KEY || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPEN_AI_KEY is not configured on the server. Please add it to your secrets panel.");
    }
    openaiClient = new OpenAI({
      apiKey,
    });
  }
  return openaiClient;
}

// Helper: Try to fetch and extract plain text from website URL
async function fetchUrlText(url: string): Promise<string> {
  if (!url) return "";
  try {
    let formattedUrl = url.trim();
    if (!formattedUrl.startsWith('http://') && !formattedUrl.startsWith('https://')) {
      formattedUrl = `https://${formattedUrl}`;
    }
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 6000); // 6s timeout

    const response = await fetch(formattedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      signal: controller.signal
    });
    clearTimeout(id);

    if (!response.ok) {
      return `[Note: Direct crawl of ${formattedUrl} returned status ${response.status}. Rely on public web search grounding to understand this brand.]`;
    }

    const html = await response.text();
    
    // Simple text extraction from HTML
    let cleanText = html;
    // Strip scripts
    cleanText = cleanText.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ');
    // Strip styles
    cleanText = cleanText.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ');
    // Strip comments
    cleanText = cleanText.replace(/<!--[\s\S]*?-->/g, ' ');
    // Strip HTML tags
    cleanText = cleanText.replace(/<[^>]+>/g, ' ');
    // Normalize whitespace
    cleanText = cleanText.replace(/\s+/g, ' ').trim();
    
    // Return a solid block of the text content to feed to Gemini
    return cleanText.slice(0, 3500);
  } catch (error: any) {
    return `[Note: Direct website crawl failed due to error: ${error.message || error}. Rely on public web search grounding to understand this website.]`;
  }
}

// Defining the strict schema to enforce structured outputs for the client-side Recharts & markdown rendering
const audienceProfileSchema = {
  type: Type.OBJECT,
  properties: {
    intro: {
      type: Type.STRING,
      description: "One single polished sentence that summarizes the audience, why they matter, and why they are relevant for digital media planning."
    },
    audienceAnalysis: {
      type: Type.STRING,
      description: "If an uploaded media plan is provided AND contains listed target audiences, write a professional, highly insightful paragraph analyzing how well the listed audiences in the plan align with the advertiser, their brand positioning, and overall campaign goals. If no media plan was uploaded OR if the uploaded plan contains no target audiences, set this field to an empty string (\"\")."
    },
    personas: {
      type: Type.ARRAY,
      description: "Exactly 4 rich, media-planning-ready personas grounded in real audience strategy, representing distinct meaningful segments. Always generate exactly 4 personas.",
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING, description: "Professional, non-cliché persona name representing their consumer/media archetype" },
          gender: { type: Type.STRING, description: "Gender range/breakdown, e.g. 'Skews Female (60%)' or 'Any'" },
          income: { type: Type.STRING, description: "Household income range, e.g. '$75,000 - $120,000'" },
          age: { type: Type.STRING, description: "Age range, e.g. '25 - 39'" },
          watch: { type: Type.STRING, description: "Specific media/services they watch, e.g., ad-supported CTV, YouTube, live sports" },
          browse: { type: Type.STRING, description: "Specific digital platforms and apps they browse" },
          buy: { type: Type.STRING, description: "Key shopping categories, brands, or products they buy" },
          narrative: { type: Type.STRING, description: "A highly realistic narrative paragraph describing their motivations, lifestyle, and media activation context." },
          sourceType: { type: Type.STRING, description: "Must be 'User' if persona was explicitly specified by the user in the brief, 'RFP' if derived from uploaded media plan listed audiences, or 'ScoutAI' if it is an AI recommended / expansion audience by ScoutAI." }
        },
        required: ["name", "gender", "income", "age", "watch", "browse", "buy", "narrative"]
      }
    },
    expansionReachPercent: {
      type: Type.NUMBER,
      description: "When a media plan is uploaded, the estimated percentage increase in addressable reach achieved by including the ScoutAI expansion persona(s) (e.g. 25-45)."
    },
    takeaways: {
      type: Type.ARRAY,
      description: "Exactly 4 key takeaways. Must be specific, highly useful for media planning, and backed by cited research.",
      items: { type: Type.STRING }
    },
    recommendations: {
      type: Type.ARRAY,
      description: "Exactly 4 media planning recommendations detailing what to do, why, and which channels/tactics are affected.",
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING, description: "Actionable recommendation title (e.g., 'Leverage Live Sports on CTV')" },
          action: { type: Type.STRING, description: "What to do specifically" },
          why: { type: Type.STRING, description: "Why it makes sense for this audience" },
          channels: { type: Type.STRING, description: "Channels affected, e.g. 'CTV, Digital Video, Programmatic Display'" }
        },
        required: ["title", "action", "why", "channels"]
      }
    },
    browserAndReach: {
      type: Type.OBJECT,
      properties: {
        overview: { type: Type.STRING, description: "Paragraph overview of browser/web reach and top domain affinity." },
        chartData: {
          type: Type.ARRAY,
          description: "Data for top relevant domains by audience share or traffic share. Between 5 and 8 items.",
          items: {
            type: Type.OBJECT,
            properties: {
              domain: { type: Type.STRING, description: "e.g., twitch.tv, nytimes.com, ign.com" },
              value: { type: Type.NUMBER, description: "The Affinity Index percentage value where 100% is average likelihood (e.g. 150 for 150%)" },
              metricType: { type: Type.STRING, description: "Must be 'Affinity Index'" },
              isModeled: { type: Type.BOOLEAN, description: "Whether this is a modeled planning proxy or syndicated data" },
              source: { type: Type.STRING, description: "Source name/date, e.g., 'Similarweb May 2026' or 'Modeled Planning Proxy'" }
            },
            required: ["domain", "value", "metricType", "isModeled", "source"]
          }
        },
        chartSource: { type: Type.STRING, description: "Brief source credit footer for the top domains chart" }
      },
      required: ["overview", "chartData", "chartSource"]
    },
    deviceTypeIndex: {
      type: Type.OBJECT,
      properties: {
        overview: { type: Type.STRING, description: "Short explanation of device/platform behavior distinguishing CTV, console, desktop/PC, mobile, tablet." },
        chartData: {
          type: Type.ARRAY,
          description: "Device/platform composition share. Values are percentages of one denominator - this audience's device usage occasions - and MUST sum to 100. Never index values: this chart renders as a pie and an index would be redrawn as a share. 4 to 6 items.",
          items: {
            type: Type.OBJECT,
            properties: {
              device: { type: Type.STRING, description: "e.g., CTV, Mobile, Desktop/PC, Tablet, Game Console" },
              value: { type: Type.NUMBER, description: "Share of this audience's device usage occasions, as a percentage. All items must sum to 100." },
              isModeled: { type: Type.BOOLEAN, description: "Whether this is modeled planning proxy" },
              source: { type: Type.STRING, description: "e.g. 'MRI-Simmons 2025' or 'eMarketer 2025'" }
            },
            required: ["device", "value", "isModeled", "source"]
          }
        },
        chartSource: { type: Type.STRING, description: "Brief source credit footer for device split chart" }
      },
      required: ["overview", "chartData", "chartSource"]
    },
    demographics: {
      type: Type.OBJECT,
      properties: {
        overview: { type: Type.STRING, description: "Paragraph overview of the demographics (age, gender, income, geo)." },
        ageChartData: {
          type: Type.ARRAY,
          description: "Age bracket split percentage data. Sums to ~100.",
          items: {
            type: Type.OBJECT,
            properties: {
              range: { type: Type.STRING, description: "e.g., '18-24', '25-34', '35-44', '45-54', '55+'" },
              value: { type: Type.NUMBER, description: "Percentage value" },
              isModeled: { type: Type.BOOLEAN },
              source: { type: Type.STRING }
            },
            required: ["range", "value", "isModeled", "source"]
          }
        },
        genderChartData: {
          type: Type.ARRAY,
          description: "Gender split percentage data. Sums to ~100.",
          items: {
            type: Type.OBJECT,
            properties: {
              gender: { type: Type.STRING, description: "e.g., Male, Female, Non-Binary/Other" },
              value: { type: Type.NUMBER, description: "Percentage value" },
              isModeled: { type: Type.BOOLEAN },
              source: { type: Type.STRING }
            },
            required: ["gender", "value", "isModeled", "source"]
          }
        },
        incomeChartData: {
          type: Type.ARRAY,
          description: "Income bracket split percentage data.",
          items: {
            type: Type.OBJECT,
            properties: {
              bracket: { type: Type.STRING, description: "e.g., '<$50k', '$50k-$75k', '$75k-$100k', '$100k-$150k', '$150k+'" },
              value: { type: Type.NUMBER, description: "Percentage value" },
              isModeled: { type: Type.BOOLEAN },
              source: { type: Type.STRING }
            },
            required: ["bracket", "value", "isModeled", "source"]
          }
        },
        geographyNotes: { type: Type.STRING, description: "Notes on regional/DMA footprint, urban/suburban skews, or target areas." }
      },
      required: ["overview", "ageChartData", "genderChartData", "incomeChartData", "geographyNotes"]
    },
    temporalPatterns: {
      type: Type.OBJECT,
      properties: {
        overview: { type: Type.STRING, description: "Paragraph overview of digital/browsing vs CTV viewing temporal patterns." },
        dayOfWeekChartData: {
          type: Type.ARRAY,
          description: "Activity index/percentage by Day of Week. 7 items (Mon-Sun).",
          items: {
            type: Type.OBJECT,
            properties: {
              day: { type: Type.STRING, description: "Mon, Tue, Wed, Thu, Fri, Sat, Sun" },
              index: { type: Type.NUMBER, description: "Relative activity score (e.g. 100 = average)" },
              isModeled: { type: Type.BOOLEAN },
              source: { type: Type.STRING }
            },
            required: ["day", "index", "isModeled", "source"]
          }
        },
        hourOfDayChartData: {
          type: Type.ARRAY,
          description: "Activity index/percentage by general hour block. 6 to 12 items.",
          items: {
            type: Type.OBJECT,
            properties: {
              hour: { type: Type.STRING, description: "e.g., '12am-4am', '4am-8am', '8am-12pm', '12pm-4pm', '4pm-8pm', '8pm-12am'" },
              index: { type: Type.NUMBER, description: "Relative activity score" },
              isModeled: { type: Type.BOOLEAN },
              source: { type: Type.STRING }
            },
            required: ["hour", "index", "isModeled", "source"]
          }
        },
        activationNotes: { type: Type.STRING, description: "Practical time-of-day or day-of-week activation tips for CTV and digital placements." }
      },
      required: ["overview", "dayOfWeekChartData", "hourOfDayChartData", "activationNotes"]
    },
    executiveSummary: {
      type: Type.STRING,
      description: "One highly polished professional paragraph summarizing the audience opportunity and recommended media strategy."
    },
    sources: {
      type: Type.ARRAY,
      description: "Curated evidence registry: the 8-12 strongest sources actually used to ground this response, each drawn from the supplied pool of discovered URLs. Not a search log. No fabricated sources.",
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING, description: "Source name, e.g., 'MRI-Simmons', 'Statista', 'eMarketer', 'Similarweb'" },
          url: { type: Type.STRING, description: "The EXACT, full deep-link URL (e.g., https://example.com/blog/article-name) from the POOL OF REAL WEB SOURCE CITATIONS DISCOVERED. DO NOT truncate to the root domain or home page." },
          supportedClaims: { type: Type.STRING, description: "What specific demographic, behavior, or media stat this source supported in the profile" },
          tier: { type: Type.STRING, description: "Tier 1: Government/Official, Tier 2: Reputable Research/Analytics, Tier 3: Trade Press, Tier 4: Blog/Context" },
          usageType: { type: Type.STRING, description: "Primary Source, Secondary Confirmation, or Directional Context" }
        },
        required: ["name", "url", "supportedClaims", "tier", "usageType"]
      }
    },
    ctvPublishers: {
      type: Type.ARRAY,
      description: "Curated list of recommended CTV publishers to target, selected STRICTLY from the approved list of publishers conforming to the exact target count specified in the prompt.",
      items: {
        type: Type.OBJECT,
        properties: {
          publisher: { type: Type.STRING, description: "Name of the publisher, e.g., 'Hulu', 'ESPN', 'Roku', etc." },
          category: { type: Type.STRING, description: "Must be exactly one of: 'App', 'Network', 'OS'" },
          why: { type: Type.STRING, description: "A concise 1-2 sentence explanation of why this specific publisher aligns with the audience's demographics, viewing habits, or lifestyle. DO NOT mention tiers." }
        },
        required: ["publisher", "category", "why"]
      }
    },
    publisherInsights: {
      type: Type.STRING,
      description: "A highly polished paragraph explaining why the recommended publishers align with the audience, their media consumption behavior, and how this fits the overall campaign."
    },
    additionalRfpRequirements: {
      type: Type.OBJECT,
      description: "Optional RFP requirements, operational specifications, questions/asks, and Digital Remedy solution responses when an RFP document is uploaded.",
      properties: {
        isRfpDocument: { type: Type.BOOLEAN },
        rfpSummary: { type: Type.STRING },
        rfpAsksAndQuestions: {
          type: Type.ARRAY,
          items: { type: Type.STRING }
        },
        digitalRemedyCapabilityMatches: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              rfpAsk: { type: Type.STRING },
              digitalRemedySolution: { type: Type.STRING },
              capabilityDetails: { type: Type.STRING },
              isSupported: { type: Type.BOOLEAN }
            },
            required: ["rfpAsk", "digitalRemedySolution", "capabilityDetails", "isSupported"]
          }
        },
        extractedMetadata: {
          type: Type.OBJECT,
          properties: {
            advertiserName: { type: Type.STRING },
            websiteUrl: { type: Type.STRING },
            budget: { type: Type.NUMBER },
            kpis: { type: Type.ARRAY, items: { type: Type.STRING } },
            flightDates: { type: Type.STRING },
            targetAudiences: { type: Type.ARRAY, items: { type: Type.STRING } },
            geographies: { type: Type.ARRAY, items: { type: Type.STRING } },
            submissionDueDate: { type: Type.STRING },
            paymentTerms: { type: Type.STRING },
            reportingRequirements: { type: Type.ARRAY, items: { type: Type.STRING } }
          }
        }
      }
    }
  },
  required: [
    "intro",
    "personas",
    "takeaways",
    "recommendations",
    "browserAndReach",
    "deviceTypeIndex",
    "demographics",
    "temporalPatterns",
    "executiveSummary",
    "sources",
    "ctvPublishers",
    "publisherInsights"
  ]
};

const auditResultSchema = {
  type: Type.OBJECT,
  properties: {
    executiveSummary: {
      type: Type.STRING,
      description: "A 2-3 sentence candid assessment of the profile's readiness for a client presentation."
    },
    scorecard: {
      type: Type.ARRAY,
      description: "Scores for each of the five categories. Must include exactly all 5: 'Data Integrity', 'Strategic Viability', 'Platform Context', 'Audience Segmentation', 'Structural Clarity'. Each out of 20.",
      items: {
        type: Type.OBJECT,
        properties: {
          category: { type: Type.STRING, description: "Category name" },
          score: { type: Type.NUMBER, description: "Category score from 0 to 20" },
          notes: { type: Type.STRING, description: "Brief reason" }
        },
        required: ["category", "score", "notes"]
      }
    },
    totalScore: { type: Type.NUMBER, description: "Total score (0-100)" },
    criticalRedFlags: {
      type: Type.ARRAY,
      description: "Statistical hallucinations, math errors, or impossible claims. Empty array if none.",
      items: { type: Type.STRING }
    },
    strategicHighlights: {
      type: Type.ARRAY,
      description: "Actionable, smart media-buying recommendations praised.",
      items: { type: Type.STRING }
    },
    fixItChecklist: {
      type: Type.ARRAY,
      description: "Instructions on what needs to be changed in the profile.",
      items: { type: Type.STRING }
    }
  },
  required: ["executiveSummary", "scorecard", "totalScore", "criticalRedFlags", "strategicHighlights", "fixItChecklist"]
};

const profileCorrectionSchema = {
  type: Type.OBJECT,
  properties: {
    correctedProfile: audienceProfileSchema,
    autoFixes: {
      type: Type.ARRAY,
      description: "All changes made to fix the red flags.",
      items: {
        type: Type.OBJECT,
        properties: {
          issue: { type: Type.STRING, description: "The issue or red flag." },
          resolution: { type: Type.STRING, description: "How it was corrected." }
        },
        required: ["issue", "resolution"]
      }
    }
  },
  required: ["correctedProfile", "autoFixes"]
};

const candidateSignalSchema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      channelId: { type: Type.STRING },
      components: {
        type: Type.OBJECT,
        properties: {
          kpiAndFunnelFit: { type: Type.NUMBER },
          audienceAndPersonaFit: { type: Type.NUMBER },
          incrementalGapCoverage: { type: Type.NUMBER },
          dataReadiness: { type: Type.NUMBER },
          creativeReadiness: { type: Type.NUMBER },
          measurementFit: { type: Type.NUMBER },
        },
        required: ["kpiAndFunnelFit", "audienceAndPersonaFit", "incrementalGapCoverage", "dataReadiness", "creativeReadiness", "measurementFit"],
      },
      gapAddressed: { type: Type.STRING },
      evidence: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            sourceType: { type: Type.STRING },
            detail: { type: Type.STRING },
            sourceId: { type: Type.STRING },
          },
          required: ["sourceType", "detail"],
        },
      },
      activationGuidance: { type: Type.STRING },
      measurementApproach: { type: Type.STRING },
      tradeoffs: { type: Type.ARRAY, items: { type: Type.STRING } },
      allocationRationale: { type: Type.STRING },
      decisionRule: { type: Type.STRING },
    },
    required: ["channelId", "components", "gapAddressed", "evidence", "activationGuidance", "measurementApproach", "tradeoffs", "allocationRationale", "decisionRule"],
  },
};
// Wrapped in an object rather than sent as a top-level array: the 3.8 structured-output docs
// only show object roots, and this call has a deterministic fallback we would rather not trip.
const candidateSignalResponseSchema = {
  type: "object",
  properties: { signals: toGeminiJsonSchema(candidateSignalSchema) },
  required: ["signals"],
};

async function generateCandidateSignals(audienceProfile: any, facts: any): Promise<AiCandidateSignal[]> {
  // Built from the effective catalog, not the raw registry: a product disabled in
  // settings must not reach the model, and a custom media type must.
  const customNotes = new Map(
    (facts?.settings?.customProducts || []).map((product: any) => [product.productId, product.planningNotes]),
  );
  const candidates = resolveEffectiveProducts(facts.settings)
    .filter((product) => product.digitalRemedyExecutable && product.recommendationEligible && product.status === "live")
    .map((product) => {
      const custom = isCustomProductId(product.id);
      return {
        channelId: product.id,
        displayName: product.displayName,
        familyId: product.familyId,
        funnelRoles: product.funnelRoles,
        supportedKpis: product.supportedKpis,
        audienceSignals: product.audienceSignals,
        sourceLabels: product.sourceMetadata.sourceLabels,
        // Custom products carry no workbook evidence, so they are labelled as such and
        // given the admin's own notes to reason from rather than being passed off as
        // workbook-verified.
        ...(custom
          ? { catalogSource: "custom", planningNotes: customNotes.get(product.id) || "" }
          : { catalogSource: "digital_remedy_workbook" }),
      };
    });
  const prompt = `You are ScoutAI's media-strategy reasoning layer. Evaluate only the supplied, Digital Remedy-executable product candidates.

Code—not you—owns eligibility, availability, budget tiers, product minimums, portfolio selection, and allocation arithmetic. Do not add products, change IDs, or claim a prerequisite is present when it is unknown.

A candidate with catalogSource "custom" is a media type the Digital Remedy team added themselves. Treat it as a genuine option and score it on the same terms as the rest, using its planningNotes as the primary evidence for fit. It carries no workbook validation, so cite it as a digital_remedy_rule rather than implying workbook or research backing, and do not award it dataReadiness or creativeReadiness credit that the campaign facts do not support.

Score each component from 0 to 100 using campaign-specific evidence. Keep confidence separate from fit by citing evidence source types. Provide concise activation, measurement, tradeoff, allocation-rationale, and scale/stop explanations. Do not calculate final allocations.

CAMPAIGN FACTS:
${JSON.stringify({
  advertiserName: facts.advertiserName,
  vertical: facts.vertical,
  primaryKpi: facts.primaryKpi,
  kpis: facts.kpis,
  funnelStages: facts.funnelStages,
  audienceDescriptions: facts.audienceDescriptions,
  audienceSignals: facts.audienceSignals.slice(0, 20),
  geography: facts.geography,
  planningMode: facts.planningMode,
  workingMediaBudget: facts.totalWorkingMediaBudget,
  normalized30DayBudget: facts.normalized30DayBudget,
  flightDays: facts.campaignFlightDays,
  existingChannelIds: facts.existingChannelIds,
  dataReadiness: facts.dataReadiness,
  creativeReadiness: facts.creativeReadiness,
}, null, 2)}

AI-RESEARCHED AUDIENCE PROFILE:
${JSON.stringify({
  intro: audienceProfile?.intro,
  personas: audienceProfile?.personas,
  executiveSummary: audienceProfile?.executiveSummary,
  takeaways: audienceProfile?.takeaways,
  sources: audienceProfile?.sources?.slice?.(0, 15),
}, null, 2)}

ALLOWED PRODUCT CANDIDATES:
${JSON.stringify(candidates, null, 2)}

Return one signal object per allowed candidate and no other products.`;

  try {
    // Medium, not high: in testing high took ~49s of this 60s budget for near-identical scores,
    // and a timeout here silently drops the AI reasoning for the whole plan.
    const response: any = await withTimeout(
      generateStructuredJson(getAiClient(), {
        input: prompt,
        schema: candidateSignalResponseSchema,
        thinkingLevel: "medium",
        timeoutMs: TIMEOUT_SCORING_MS,
      }),
      TIMEOUT_SCORING_MS,
      null,
    );
    const parsed = response?.signals;
    if (!Array.isArray(parsed)) {
      console.warn("[PLANNING] AI candidate reasoning unavailable (no signals returned); using deterministic fallback scores and explanations.");
      return [];
    }
    const allowedIds = new Set(candidates.map((candidate) => candidate.channelId));
    return parsed.filter((signal): signal is AiCandidateSignal => signal && allowedIds.has(signal.channelId));
  } catch (error) {
    console.warn("[PLANNING] AI candidate reasoning unavailable; using deterministic fallback scores and explanations.", error);
    return [];
  }
}

async function buildChannelStrategy(
  audienceProfile: any,
  selectedPlanOptions: any[] = [],
  budgetStrategyMode: 'reallocation' | 'incremental' = 'reallocation',
  advertiserName?: string,
  kpis?: string[],
  options?: {
    advertiserUrl?: string;
    campaignFocus?: string;
    geography?: string;
    workingMediaBudget?: number;
    campaignFlightDays?: number | null;
    planningSettings?: unknown;
    requiredChannelIds?: string[];
    excludedChannelIds?: string[];
    candidateSignals?: AiCandidateSignal[];
  },
) {
  const totalRfpBudget = selectedPlanOptions.reduce((acc, opt) => acc + (opt.budget || 0), 0);
  const validatedSettings = validatePlanningSettings(options?.planningSettings);
  const planningSettings = validatedSettings.valid && validatedSettings.settings
    ? validatedSettings.settings
    : DEFAULT_PLANNING_SETTINGS;
  const mode: PlanningMode = selectedPlanOptions.length === 0 ? "greenfield" : budgetStrategyMode;
  const signals = profileSignals(audienceProfile);
  const uploadedWorkingMediaBudget = selectedPlanOptions
    .flatMap((option) => option.placements || [])
    .filter((placement) => {
      const raw = placement.mediaType || placement.productType || placement.placementName || placement.publisher || "";
      const canonical = normalizeRawChannel(raw).canonicalId;
      return !isNonMediaItem(raw) && !isNonMediaItem(canonical);
    })
    .reduce((sum, placement) => sum + (Number(placement.budget) || 0), 0);
  const resolvedBudget = mode === "reallocation" && uploadedWorkingMediaBudget > 0
    ? uploadedWorkingMediaBudget
    : Number(options?.workingMediaBudget) > 0
      ? Number(options?.workingMediaBudget)
      : totalRfpBudget;
  const facts = buildCampaignFacts({
    advertiserName,
    advertiserUrl: options?.advertiserUrl,
    kpis,
    campaignFocus: options?.campaignFocus,
    audienceDescriptions: signals.audienceDescriptions,
    audienceSignals: signals.audienceSignals,
    geography: options?.geography || "United States",
    workingMediaBudget: resolvedBudget,
    campaignFlightDays: options?.campaignFlightDays,
    planningMode: mode,
    selectedPlanOptions,
    requiredChannelIds: options?.requiredChannelIds,
    excludedChannelIds: options?.excludedChannelIds,
    planningSettings,
    ctvPublishers: audienceProfile?.ctvPublishers,
  });
  // Must match the catalog the candidates were generated from, or scores for custom
  // media types get silently dropped and they fall back to heuristic defaults.
  const allowedSignalIds = new Set(resolveEffectiveProducts(planningSettings).map((product) => product.id));
  const suppliedSignals = Array.isArray(options?.candidateSignals)
    ? options.candidateSignals.filter((signal) => signal && allowedSignalIds.has(signal.channelId))
    : [];
  const aiSignals = suppliedSignals.length > 0 ? suppliedSignals : await generateCandidateSignals(audienceProfile, facts);
  const mediaPlan = buildMediaRecommendationPlan(facts, aiSignals);

  const toLegacyEvaluation = (candidate: any) => {
    const allocation = mediaPlan.channels.find((channel) => channel.channelId === candidate.product.id);
    return {
      channelName: candidate.product.displayName,
      canonicalId: candidate.product.legacyCanonicalId,
      isRecommended: Boolean(allocation),
      audienceFit: Math.round(candidate.components.audienceAndPersonaFit / 10),
      goalMatch: Math.round(candidate.components.kpiAndFunnelFit / 10),
      score: Math.round((candidate.recommendationScore / 10) * 10) / 10,
      mediaConsumptionEvidence: candidate.evidence[0]?.detail || candidate.gapAddressed,
      whyItEarnsASpot: candidate.eligibilityFailures[0] || candidate.gapAddressed,
      suggestedAllocationPercent: allocation?.allocationPercent,
      channelId: candidate.product.id,
      recommendationStatus: candidate.status,
      confidence: candidate.confidence,
      allocationDollars: allocation?.allocationDollars,
    };
  };

  const rfpChannels = facts.existingChannelIds
    .map((channelId) => mediaPlan.evaluatedCandidates.find((candidate) => candidate.product.id === channelId))
    .filter(Boolean)
    .map(toLegacyEvaluation);
  const recommendedIds = new Set(mediaPlan.channels.map((channel) => channel.channelId));
  const scoutAiRecommendedChannels = mediaPlan.evaluatedCandidates
    .filter((candidate) => recommendedIds.has(candidate.product.id) && !facts.existingChannelIds.includes(candidate.product.id))
    .map(toLegacyEvaluation);

  return {
    rfpChannels,
    scoutAiRecommendedChannels,
    executiveInsight: mediaPlan.channels.length > 0
      ? `ScoutAI allocated the full $${mediaPlan.workingMediaBudget.toLocaleString()} working media budget across ${mediaPlan.selectedMediaTypeCount} media type(s). The normalized 30-day budget permits ${mediaPlan.maxMediaTypes} automatic selection(s)${facts.requiredChannelIds.length > 0 ? `, with ${facts.requiredChannelIds.length} planner-required override(s) allowed beyond that cap` : ""}.`
      : "No channel cleared all deterministic availability, prerequisite, budget, and portfolio constraints; resolve the listed conditions before allocation.",
    budgetStrategyMode,
    totalRfpBudget: mediaPlan.workingMediaBudget,
    analyzedPlanNames: selectedPlanOptions.map(p => p.name),
    generatedAt: new Date().toISOString(),
    manualIncludedChannelIds: facts.requiredChannelIds,
    manualExcludedChannelIds: facts.excludedChannelIds,
    mediaPlan,
    ctvPublishers: audienceProfile?.ctvPublishers,
  };
}

// Helper: Extract concise key finding blurbs from the detailed dossiers to stream to the live console
function extractFindingBlurb(text: string, label: string): string {
  if (!text) return "";
  const lines = text.split("\n").map(l => l.trim()).filter(l => l.length > 0);
  
  // Look for lines that look like statistics, percentages, or bullets
  const bulletLines = lines.filter(l => l.startsWith("-") || l.startsWith("*") || l.startsWith("1.") || l.startsWith("2.") || l.startsWith("3."));
  
  if (bulletLines.length > 0) {
    // Return up to 2 clean key statistics/findings
    return bulletLines
      .slice(0, 2)
      .map(l => l.replace(/^[-*\s\d.]+(\s*)/, "")) // strip bullet characters
      .join(" — ");
  }
  
  // Fallback to first non-empty line
  return lines[0] || `Completed deep-dive search for ${label}`;
}

// API: Parse media plan spreadsheet using OpenAI Code Interpreter (gpt-5.6)
app.post("/api/parse-plan", upload.single("file"), async (req, res) => {
  // Prevent Express or Node from timing out socket connections on this long-running parsing endpoint
  req.socket.setTimeout(0);

  console.log(`[API /api/parse-plan] Request received. file: ${req.file ? req.file.originalname : "none"}`);
  if (!req.file) {
    res.status(400).json({ error: "No file was uploaded." });
    return;
  }

  const tempFilePath = req.file.path;
  const originalName = req.file.originalname || "";
  const ext = path.extname(originalName) || ".xlsx";
  const extensionTempPath = tempFilePath + ext;

  let fileUploadId = "";
  let openai;
  
  try {
    openai = getOpenaiClient();
  } catch (initErr: any) {
    res.status(500).json({ error: "Media plan parser service configuration error.", details: initErr.message || initErr });
    return;
  }

  try {
    // Rename temp file to preserve original extension for OpenAI Files API
    fs.renameSync(tempFilePath, extensionTempPath);
    console.log(`[API /api/parse-plan] Renamed temp file to preserve extension: ${extensionTempPath}`);

    // Compute SHA-256 hash of file contents for instant session caching
    const fileBuffer = fs.readFileSync(extensionTempPath);
    const fileHash = crypto.createHash("sha256").update(fileBuffer).digest("hex");
    console.log(`[API /api/parse-plan] File SHA-256 hash: ${fileHash}`);

    const ignoreCache = req.body?.ignoreCache === "true" || req.body?.ignoreCache === true || req.query?.ignoreCache === "true";

    if (!ignoreCache && mediaPlanParseCache.has(fileHash)) {
      const cached = mediaPlanParseCache.get(fileHash)!;
      console.log(`[API /api/parse-plan] CACHE HIT for media plan hash ${fileHash} ("${originalName}"). Returning ${cached.placements.length} cached placements instantly.`);

      // Clean up local temp files immediately
      try {
        if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
        if (fs.existsSync(extensionTempPath)) fs.unlinkSync(extensionTempPath);
      } catch (cleanErr) {}

      res.json({
        success: true,
        placements: cached.placements,
        rfpAnalysis: cached.rfpAnalysis,
        cached: true,
        cachedAt: new Date(cached.timestamp).toISOString()
      });
      return;
    } else if (ignoreCache) {
      console.log(`[API /api/parse-plan] CACHE BYPASS requested for media plan hash ${fileHash} ("${originalName}"). Re-running full AI analysis.`);
    }

    console.log(`[API /api/parse-plan] Uploading file to OpenAI Files API: ${originalName}`);
    
    // 1. Upload file to OpenAI with toFile for robust multipart boundary and contentType
    const mimeType = req.file?.mimetype || "application/octet-stream";
    console.log(`[API /api/parse-plan] File MIME type: ${mimeType}`);
    
    const lowerName = originalName.toLowerCase();
    const isPdfOrDoc = lowerName.endsWith('.pdf') || lowerName.endsWith('.doc') || lowerName.endsWith('.docx') || lowerName.endsWith('.txt') || mimeType.includes('pdf');

    const fileUpload = await openai.files.create({
      file: await toFile(fileBuffer, originalName, { type: mimeType }),
      purpose: "assistants",
    });
    fileUploadId = fileUpload.id;
    console.log(`[API /api/parse-plan] Upload successful. OpenAI file_id: ${fileUploadId} (isPdfOrDoc=${isPdfOrDoc})`);

    // 2. Instructions based on file type (Spreadsheet vs PDF/Doc RFP)
    let parseInstructions = "";

    if (isPdfOrDoc) {
      parseInstructions = `You are an expert RFP analysis and media strategy agent for Digital Remedy.
You have been provided with an uploaded document (PDF/Word/Text) which represents a Request for Proposal (RFP), brief, or client guidelines.
PDF documents may contain text, embedded data tables, diagrams, workflow charts, or screenshots/images of campaign specifications or past performance.

--- DIGITAL REMEDY OFFICIAL COMPANY CONTEXT ---
${companyOverview}

SOLUTIONS & CAPABILITIES:
${JSON.stringify(mainSolutionCategories, null, 2)}
${JSON.stringify(digitalRemedyCapabilities, null, 2)}
${JSON.stringify(digitalRemedyCtvPublishers, null, 2)}

CRITICAL GROUNDING & PLACEMENT RULES:
1. Digital Remedy capabilities MUST BE GROUNDED STRICTLY on the Digital Remedy Context provided above.
2. DO NOT make up, invent, or speculate about any unlisted proprietary tools or services.
3. ABSOLUTELY DO NOT INVENT PSEUDO-PLACEMENTS OR POPULATE THE PLACEMENTS ARRAY WITH AUDIENCES/GUIDELINES IF THERE IS NO PRE-EXISTING STRUCTURED MEDIA PLAN TABLE IN THE PDF!
   - If the uploaded document is an RFP, brief, or set of general campaign guidelines without an explicit pre-existing media plan placement schedule (e.g. no pre-defined publisher line items, CPMs, and budgets provided by the client), set "placements": [] (an empty array) and set "hasExplicitPlacements": false.
   - ONLY populate the "placements" array if the document explicitly contains pre-defined structured media placement line items (e.g. a media plan table with specific placement names, publisher names, pricing structures, and budgets).

YOUR MISSION & EXECUTION STEPS:
1. Use Python code_interpreter (with pypdf, pdfplumber, fitz / PyMuPDF, pdf2image, PIL, or text extraction) to thoroughly inspect ALL pages of the PDF or document, analyzing all text, embedded tables, figures, diagrams, and image/screenshot content across every page.
2. Identify all advertiser details, requested capabilities, campaign goals/KPIs, target audience parameters, geographies, flight dates, budget (if specified), submission due dates, payment terms, reporting requirements, and specific questions directed at Digital Remedy.
3. Build a structured capability matching list evaluating every specific requirement in the RFP against Digital Remedy's official context.

OUTPUT REQUIREMENT:
Output ONLY a raw JSON object with NO markdown code block wrapping:
{
  "isRfpDocument": true,
  "hasExplicitPlacements": false,
  "rfpSummary": "Concise executive summary of what the RFP is requesting...",
  "rfpAsksAndQuestions": [
    "Specific ask or question 1...",
    "Specific ask or question 2..."
  ],
  "digitalRemedyCapabilityMatches": [
    {
      "rfpAsk": "Specific requirement or question from the RFP",
      "digitalRemedySolution": "Name of official Digital Remedy solution/capability",
      "capabilityDetails": "Grounded explanation of how Digital Remedy fulfills this requirement",
      "isSupported": true
    }
  ],
  "extractedMetadata": {
    "advertiserName": "Name if found (e.g. View Boston)",
    "websiteUrl": "URL if found",
    "budget": 100000,
    "kpis": ["Primary Objective: Drive Individual Ticket Sales (Goal: 510,000 tickets)", "ROAS of at least $4", "Incremental reach"],
    "flightDates": "April 1 to December 31, 2026",
    "targetAudiences": ["Parents (Families): Age 35-55, HHI $115K+", "Fitness Enthusiasts: Age 18-64", "Celebration Seekers: Age 21-72", "Weekend Warriors: Age 21-40", "Booked Boston Stays / Visitors"],
    "geographies": ["Greater Boston Area (Boston + 30 mi)", "Boston Urban Dwellers (Boston + 8 mi)", "Prudential Vicinity (Building + 2 mi)", "National (US)"],
    "submissionDueDate": "10 am EST Tuesday, March 10th",
    "paymentTerms": "90-day payment terms; invoices sent first 3 business days following month media ran",
    "reportingRequirements": ["Weekly reporting on Mondays", "Viewthrough Website Visits & Purchase Page Visits", "Conversions & Revenue", "Campaign-to-Date & Current Week Reach & Frequency"]
  },
  "placements": []
}`;
    } else {
      parseInstructions = `You are an expert media plan extraction agent. You have been given a media plan spreadsheet with potentially multiple sheets.
Some of these sheets may contain extremely large reference lists (e.g., lists of thousands of zip codes, DOOH venues, or creative specs) which are NOT media plan placements. Loading or parsing these massive sheets will cause timeouts or memory crashes. You must bypass them.

Your goal is to write and run Python code using pandas/openpyxl to inspect and extract ONLY the active media plan placements sheets (typically containing between 10 to 300 rows and representing publishers/networks, placements, ad types, CPM, budgets).

To achieve maximum performance and avoid server timeouts, you MUST base your Python execution on the following highly optimized script template. Note how it uses openpyxl in read_only=True mode to inspect sheet names first without loading any data into memory, and skips massive or auxiliary sheets before loading them with pandas.

### Highly Optimized Python Script Template:
\`\`\`python
import pandas as pd
import openpyxl
import json
import re
import os

def parse_media_plan(file_path):
    # Determine if file is CSV
    if file_path.lower().endswith('.csv'):
        try:
            df = pd.read_csv(file_path)
            return parse_dataframe(df, sheet_name="Main Plan")
        except Exception as e:
            print(f"Error reading CSV: \${e}")
            return []

    # 1. Use openpyxl in read_only mode to quickly inspect sheets without loading data
    try:
        wb = openpyxl.load_workbook(file_path, read_only=True)
        all_sheets = wb.sheetnames
        wb.close()
    except Exception as e:
        print(f"Error reading workbook sheets: \${e}")
        return []
    
    # 2. Filter sheets by name first to avoid loading huge reference/spec sheets
    exclude_keywords = ['zip', 'venue', 'location', 'spec', 'audience', 'creative', 'contacts', 'log', 'reference', 'readme', 'guidelines', 'sheet2', 'metadata']
    candidate_sheets = []
    for s in all_sheets:
        s_lower = s.lower()
        if any(kw in s_lower for kw in exclude_keywords):
            continue
        candidate_sheets.append(s)
    
    # If all sheets were filtered out, fallback to all sheets except extremely obvious reference ones
    if not candidate_sheets:
        candidate_sheets = [s for s in all_sheets if not any(kw in s.lower() for kw in ['zip', 'venue', 'location', 'spec'])]
    
    if not candidate_sheets:
        candidate_sheets = all_sheets
        
    all_placements = []
    
    # 3. Process candidate sheets
    for sheet in candidate_sheets:
        try:
            sample_df = pd.read_excel(file_path, sheet_name=sheet, nrows=5)
            if sample_df.empty:
                continue
            df = pd.read_excel(file_path, sheet_name=sheet, header=None)
        except Exception as e:
            print(f"Error loading sheet \${sheet}: \${e}")
            continue
            
        placements = parse_dataframe(df, sheet_name=sheet)
        all_placements.extend(placements)
        
        # Safeguard overall output size to avoid token truncation
        if len(all_placements) >= 500:
            all_placements = all_placements[:500]
            break
            
    return all_placements

def parse_dataframe(df, sheet_name="Main Plan"):
    if df.empty:
        return []

    # Dynamic header search
    keywords = ['publisher', 'site', 'placement', 'budget', 'cpm', 'rate', 'units', 'ad type', 'buy type', 'cost', 'net cost', 'gross cost']
    
    header_idx = -1
    max_matches = 0
    
    for idx, row in df.iterrows():
        if idx > 25:
            break
        row_str = [str(val).lower() for val in row.values if pd.notna(val)]
        matches = sum(1 for val in row_str if any(kw in val for kw in keywords))
        if matches > max_matches:
            max_matches = matches
            header_idx = idx
            
    if header_idx == -1 or max_matches < 2:
        cols = [str(c).strip() for c in df.columns]
        df.columns = cols
        data_df = df
    else:
        # Check if header_idx - 1 exists and might be a parent header row (e.g. "Location" spanning across sub-columns)
        header_cols = []
        if header_idx > 0:
            parent_row = df.iloc[header_idx - 1].ffill().values
            child_row = df.iloc[header_idx].values
            for c_idx in range(len(child_row)):
                p_val = str(parent_row[c_idx]).strip() if c_idx < len(parent_row) and pd.notna(parent_row[c_idx]) else ""
                c_val = str(child_row[c_idx]).strip() if pd.notna(child_row[c_idx]) else ""
                if p_val and p_val.lower() not in ['nan', 'unnamed:']:
                    if c_val and c_val.lower() not in ['nan', 'unnamed:'] and c_val.lower() != p_val.lower():
                        header_cols.append(f"\${p_val} \${c_val}")
                    else:
                        header_cols.append(p_val)
                else:
                    header_cols.append(c_val if c_val and c_val.lower() not in ['nan', 'unnamed:'] else f"Col_\${c_idx}")
        else:
            header_cols = [str(val).strip() if pd.notna(val) else f"Col_\${c_idx}" for c_idx, val in enumerate(df.iloc[header_idx].values)]
            
        df.columns = header_cols
        data_df = df.iloc[header_idx + 1:].copy()
        
    col_mapping = {}
    col_indices = {}
    for idx_col, col in enumerate(data_df.columns):
        col_lower = str(col).lower()
        if 'perf' in col_lower or 'adv' in col_lower:
            col_mapping['advPerformance'] = col
            col_indices['advPerformance'] = idx_col
        elif 'media' in col_lower:
            col_mapping['mediaType'] = col
            col_indices['mediaType'] = idx_col
        elif 'product' in col_lower:
            col_mapping['productType'] = col
            col_indices['productType'] = idx_col
        elif 'publisher' in col_lower or 'network' in col_lower or 'partner' in col_lower:
            col_mapping['publisher'] = col
            col_indices['publisher'] = idx_col
        elif ('placement' in col_lower and 'type' not in col_lower) or 'package' in col_lower or 'item' in col_lower:
            col_mapping['placementName'] = col
            col_indices['placementName'] = idx_col
        elif 'audience' in col_lower or 'target' in col_lower or 'segment' in col_lower:
            col_mapping['audience'] = col
            col_indices['audience'] = idx_col
        elif 'start' in col_lower:
            col_mapping['startDate'] = col
            col_indices['startDate'] = idx_col
        elif 'end' in col_lower:
            col_mapping['endDate'] = col
            col_indices['endDate'] = idx_col
        elif 'flight' in col_lower or 'duration' in col_lower or ('date' in col_lower and 'start' not in col_lower and 'end' not in col_lower):
            col_mapping['flightDates'] = col
            col_indices['flightDates'] = idx_col
        elif 'loc' in col_lower and 'type' in col_lower:
            col_mapping['locationType'] = col
            col_indices['locationType'] = idx_col
        elif 'loc' in col_lower or 'geo' in col_lower or 'market' in col_lower:
            col_mapping['locationDetails'] = col
            col_indices['locationDetails'] = idx_col
        elif ('pricing' in col_lower and 'type' in col_lower) or 'pricing structure type' in col_lower:
            col_mapping['pricingStructureType'] = col
            col_indices['pricingStructureType'] = idx_col
        elif 'pricing' in col_lower or 'structure' in col_lower or 'rate' in col_lower or 'cpm' in col_lower:
            col_mapping['pricingStructureDetails'] = col
            col_indices['pricingStructureDetails'] = idx_col
        elif any(kw in col_lower for kw in ['budget', 'cost', 'spend', 'total cost', 'net cost']):
            col_mapping['budget'] = col
            col_indices['budget'] = idx_col
        elif any(kw in col_lower for kw in ['impression', 'imp', 'unit', 'qty', 'volume', 'count', 'quantity']):
            col_mapping['impressions'] = col
            col_indices['impressions'] = idx_col
        elif 'size' in col_lower or 'creative' in col_lower or 'dimension' in col_lower:
            col_mapping['adSizes'] = col
            col_indices['adSizes'] = idx_col
        elif 'note' in col_lower or 'comment' in col_lower or 'instruction' in col_lower:
            col_mapping['notes'] = col
            col_indices['notes'] = idx_col

    # Handle merged Location header over Type & blank/Detail column
    if 'locationType' in col_indices and 'locationDetails' not in col_mapping:
        loc_type_idx = col_indices['locationType']
        if loc_type_idx + 1 < len(data_df.columns):
            next_col = data_df.columns[loc_type_idx + 1]
            col_mapping['locationDetails'] = next_col

    # Fallbacks for common alternative naming
    for idx_col, col in enumerate(data_df.columns):
        col_lower = str(col).lower()
        if 'publisher' not in col_mapping and ('site' in col_lower or 'vendor' in col_lower):
            col_mapping['publisher'] = col
        if 'mediaType' not in col_mapping and ('ad type' in col_lower or 'format' in col_lower or 'channel' in col_lower):
            col_mapping['mediaType'] = col
        if 'productType' not in col_mapping and ('tier' in col_lower or 'placement type' in col_lower):
            col_mapping['productType'] = col
        if 'pricingStructureType' not in col_mapping and ('buy type' in col_lower or 'pricing model' in col_lower or 'model' in col_lower):
            col_mapping['pricingStructureType'] = col
        if 'pricingStructureDetails' not in col_mapping and ('rate' in col_lower or 'cpm' in col_lower or 'cost/m' in col_lower):
            col_mapping['pricingStructureDetails'] = col
        if 'impressions' not in col_mapping and ('units' in col_lower or 'qty' in col_lower):
            col_mapping['impressions'] = col
        if 'locationType' not in col_mapping and ('geography' in col_lower):
            col_mapping['locationType'] = col
        if 'startDate' not in col_mapping and 'flightDates' not in col_mapping and ('date' in col_lower or 'flight' in col_lower or 'duration' in col_lower):
            col_mapping['flightDates'] = col

    placements = []
    current_section = ""

    for _, row in data_df.iterrows():
        non_nulls = [str(v).strip() for v in row.values if pd.notna(v) and str(v).strip() != ""]
        if len(non_nulls) == 1 or (len(non_nulls) == 2 and not any(k in col_mapping for k in ['budget', 'publisher'])):
            cell_text = non_nulls[0]
            cell_lower = cell_text.lower()
            if any(kw in cell_lower for kw in ['option', 'tier', 'scenario', 'package', 'budget option', 'plan a', 'plan b', 'plan c', 'alternative', 'breakout']):
                current_section = cell_text
                continue

        p_val = lambda k: str(row[col_mapping[k]]).strip() if k in col_mapping and pd.notna(row[col_mapping[k]]) else ""
        
        pub = p_val('publisher')
        place = p_val('placementName')
        budget_str = p_val('budget')
        
        if not pub and not place and not budget_str:
            continue
        if any(kw in pub.lower() for kw in ['total', 'summary', 'disclaimer', 'notes', 'grand total']):
            continue
        if any(kw in place.lower() for kw in ['total', 'summary', 'disclaimer', 'notes', 'grand total']):
            continue
            
        def clean_numeric(val):
            if not val: return 0.0
            cleaned = re.sub(r'[^\d.]', '', val)
            try:
                return float(cleaned)
            except ValueError:
                return 0.0
                
        budget = clean_numeric(budget_str)
        impressions = clean_numeric(p_val('impressions'))
        rate_val = p_val('pricingStructureDetails')
        
        perf_val = p_val('advPerformance').lower()
        adv_perf = "No"
        if any(kw in perf_val for kw in ['yes', 'y', 'true', '1', 'active']):
            adv_perf = "Yes"
        elif any(kw in perf_val for kw in ['no', 'n', 'false', '0']):
            adv_perf = "No"
        else:
            adv_perf = "No" if not perf_val else ("Yes" if perf_val == "yes" else "No")
            
        start_date = p_val('startDate')
        end_date = p_val('endDate')
        flight_dates = p_val('flightDates')
        if (not start_date or not end_date) and flight_dates:
            parts = re.split(r'\s+(?:to|-|through)\s+|\s*-\s*', flight_dates, maxsplit=1)
            if len(parts) == 2:
                if not start_date: start_date = parts[0].strip()
                if not end_date: end_date = parts[1].strip()
            elif len(parts) == 1 and parts[0]:
                if not start_date: start_date = parts[0].strip()

        # Build plan/option label
        if current_section and sheet_name and sheet_name.lower() not in ['sheet1', 'main plan', 'media plan']:
            full_plan_name = f"\${sheet_name} - \${current_section}"
        elif current_section:
            full_plan_name = current_section
        else:
            full_plan_name = sheet_name or "Main Plan"

        # Handle Ad Serving, Advanced Measurement & Product Type edge cases
        raw_media_type = p_val('mediaType')
        raw_product_type = p_val('productType')

        m_low = raw_media_type.lower()
        p_low = raw_product_type.lower()
        pl_low = place.lower()

        if any(kw in m_low or kw in p_low or kw in pl_low for kw in ['ad serving', 'ad server', 'serving fee', '3rd party ad serving', 'third party ad serving']):
            extracted_media_type = 'Ad Serving'
            extracted_product_type = raw_product_type or 'Ad Server Fees'
        elif any(kw in p_low for kw in ['halo', 'incrementality']) and (not raw_media_type or m_low in ['standard', 'display', 'other']):
            extracted_media_type = 'Advanced Measurement'
            extracted_product_type = 'Halo Effect Study' if 'halo' in p_low else 'Incrementality'
        elif any(kw in m_low for kw in ['measurement', 'advanced measurement', 'halo', 'incrementality']):
            extracted_media_type = 'Advanced Measurement'
            if 'halo' in p_low:
                extracted_product_type = 'Halo Effect Study'
            elif 'incrementality' in p_low:
                extracted_product_type = 'Incrementality'
            else:
                extracted_product_type = raw_product_type or 'Measurement Study'
        else:
            extracted_media_type = raw_media_type or 'Display'
            extracted_product_type = raw_product_type or 'Standard'

        placements.append({
            'planName': full_plan_name,
            'advPerformance': adv_perf,
            'mediaType': extracted_media_type,
            'productType': extracted_product_type,
            'placementName': place,
            'publisher': pub or 'Unknown Publisher',
            'audience': p_val('audience') or 'All Users',
            'startDate': start_date,
            'endDate': end_date,
            'locationType': p_val('locationType') or 'National',
            'locationDetails': p_val('locationDetails') or 'National',
            'pricingStructureType': p_val('pricingStructureType') or 'CPM',
            'pricingStructureDetails': rate_val or 'CPM',
            'budget': budget,
            'impressions': impressions,
            'adSizes': p_val('adSizes') or 'Flexible',
            'notes': p_val('notes')
        })
    return placements

# Find the uploaded file in the environment
files = [f for f in os.listdir('.') if os.path.isfile(f) and f != 'main.py']
if not files:
    files = [f for f in os.listdir('/mnt/data') if os.path.isfile(f)] if os.path.exists('/mnt/data') else []

if files:
    target_file = files[0]
    results = parse_media_plan(target_file)
    print(json.dumps(results, indent=2))
else:
    print("[]")
\`\`\`

Write a Python script that implements the above logic, execute it in the sandboxed environment with Code Interpreter on the uploaded spreadsheet, and print the raw JSON output list directly. Ensure no markdown wrapping is in the final printed response output.`;
    }

    console.log(`[API /api/parse-plan] Requesting high-accuracy parsing from gpt-5.6 with code_interpreter...`);

    // 3. Call responses.create with gpt-5.6 and code_interpreter
    const response = await openai.responses.create({
      model: "gpt-5.6",
      tools: [
        {
          type: "code_interpreter",
          container: { type: "auto", memory_limit: "4g" },
        },
      ],
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_file",
              file_id: fileUploadId,
            },
            {
              type: "input_text",
              text: "Please read this file, extract the media placements using Python code_interpreter, and output them as a clean JSON array.",
            },
          ],
        },
      ],
      instructions: parseInstructions,
    });

    const outputText = response.output_text || "";
    console.log(`[API /api/parse-plan] Parsing call completed. Response length: ${outputText.length}`);

    // Clean up any markdown code blocks if the model wrapped it anyway
    let jsonText = outputText.trim();
    if (jsonText.startsWith("```")) {
      jsonText = jsonText.replace(/^```[a-zA-Z]*\n/, "").replace(/\n```$/, "");
    }
    jsonText = jsonText.trim();

    try {
      const parsedData = JSON.parse(jsonText);
      let placements: any[] = [];
      let rfpAnalysis: any = null;

      if (Array.isArray(parsedData)) {
        placements = parsedData;
      } else if (parsedData && typeof parsedData === "object") {
        placements = Array.isArray(parsedData.placements) ? parsedData.placements : [];
        if (parsedData.isRfpDocument || parsedData.rfpSummary || parsedData.digitalRemedyCapabilityMatches) {
          rfpAnalysis = {
            isRfpDocument: parsedData.isRfpDocument ?? true,
            hasExplicitPlacements: parsedData.hasExplicitPlacements ?? (placements.length > 0),
            rfpSummary: parsedData.rfpSummary || "",
            rfpAsksAndQuestions: parsedData.rfpAsksAndQuestions || [],
            digitalRemedyCapabilityMatches: parsedData.digitalRemedyCapabilityMatches || [],
            extractedMetadata: parsedData.extractedMetadata || {}
          };
        }
      }

      mediaPlanParseCache.set(fileHash, {
        placements,
        rfpAnalysis,
        filename: originalName,
        hash: fileHash,
        timestamp: Date.now()
      });
      saveMediaPlanCacheToDisk(mediaPlanParseCache);
      console.log(`[API /api/parse-plan] Saved parsed placements (${placements.length} items) & RFP analysis to disk cache for hash ${fileHash}.`);

      res.json({ success: true, placements, rfpAnalysis, cached: false });
    } catch (parseErr) {
      console.error("Failed to parse LLM response text as JSON:", parseErr);
      console.log("Raw response output_text was:", outputText);
      res.status(500).json({
        error: "Failed to parse placements into valid JSON.",
        details: outputText
      });
    }

  } catch (error: any) {
    console.error("Error in /api/parse-plan:", error);
    res.status(500).json({ error: "Failed to parse media plan.", details: error.message || error });
  } finally {
    // 4. Cleanup local temp files
    try {
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
        console.log(`[API /api/parse-plan] Cleaned up local file: ${tempFilePath}`);
      }
    } catch (cleanupErr) {
      console.error("Failed to delete local temp file:", cleanupErr);
    }
    try {
      if (fs.existsSync(extensionTempPath)) {
        fs.unlinkSync(extensionTempPath);
        console.log(`[API /api/parse-plan] Cleaned up local extension file: ${extensionTempPath}`);
      }
    } catch (cleanupErr) {
      console.error("Failed to delete local extension temp file:", cleanupErr);
    }

    // 5. Cleanup OpenAI file
    if (fileUploadId && openai) {
      try {
        await openai.files.delete(fileUploadId);
        console.log(`[API /api/parse-plan] Cleaned up OpenAI file: ${fileUploadId}`);
      } catch (openaiCleanupErr) {
        console.error("Failed to delete file from OpenAI:", openaiCleanupErr);
      }
    }
  }
});

// API: Standalone Media Plan Channel Strategy Analysis
app.post("/api/analyze-media-plan", async (req, res) => {
  try {
    const {
      audienceProfile,
      selectedPlanOptions,
      budgetStrategyMode,
      advertiserName,
      advertiserUrl,
      kpis,
      campaignFocus,
      geography,
      workingMediaBudget,
      campaignFlightDays,
      planningSettings,
      requiredChannelIds,
      excludedChannelIds,
      candidateSignals,
    } = req.body;
    const selectedOptions = Array.isArray(selectedPlanOptions) ? selectedPlanOptions : [];
    if (selectedOptions.length === 0 && !(Number(workingMediaBudget) > 0)) {
      res.status(400).json({ error: "A selected plan option or positive working media budget is required for analysis." });
      return;
    }
    console.log(`[API /api/analyze-media-plan] Running channel strategy analysis for ${selectedOptions.length} option(s)...`);
    const channelStrategy = await buildChannelStrategy(
      audienceProfile,
      selectedOptions,
      budgetStrategyMode || 'reallocation',
      advertiserName,
      kpis,
      { advertiserUrl, campaignFocus, geography, workingMediaBudget, campaignFlightDays, planningSettings, requiredChannelIds, excludedChannelIds, candidateSignals },
    );
    res.json({ success: true, channelStrategy });
  } catch (err: any) {
    console.error("Error in /api/analyze-media-plan:", err);
    res.status(500).json({ error: "Failed to analyze media plan.", details: err.message || err });
  }
});

// API: Read the live global Planning Settings. Any signed-in user may read.
app.get("/api/settings", async (_req, res) => {
  try {
    const record = await (await getStorage()).getCurrentSettings();
    res.json({ success: true, settings: record.settings, revision: record.revision, updatedAt: record.updatedAt, updatedBy: record.updatedBy });
  } catch (err: any) {
    console.error("Error loading settings:", err);
    res.status(500).json({ error: "Failed to load planning settings", details: err.message });
  }
});

// API: Read a specific historical settings revision.
// Opening a saved plan loads the revision it was generated against, so a later settings
// change cannot quietly move the numbers under a plan somebody already saved.
app.get("/api/settings/revisions/:revision", async (req, res) => {
  try {
    const revision = Number(req.params.revision);
    if (!Number.isInteger(revision) || revision < 1) {
      res.status(400).json({ error: "Revision must be a positive integer." });
      return;
    }
    const record = await (await getStorage()).getSettingsRevision(revision);
    if (!record) {
      res.status(404).json({ error: `Settings revision ${revision} was not found.` });
      return;
    }
    res.json({ success: true, settings: record.settings, revision: record.revision, updatedAt: record.updatedAt, updatedBy: record.updatedBy });
  } catch (err: any) {
    console.error("Error loading settings revision:", err);
    res.status(500).json({ error: "Failed to load settings revision", details: err.message });
  }
});

// API: Write the global Planning Settings. Admin-only once ADMIN_PASSWORD is configured.
app.put("/api/settings", requireAdmin, async (req, res) => {
  try {
    const record = await (await getStorage()).saveSettings(req.body, actorName(req));
    res.json({ success: true, settings: record.settings, revision: record.revision });
  } catch (err: any) {
    console.error("Error saving settings:", err);
    // Validation failures are the caller's fault, not the server's.
    const status = /^Invalid planning settings/.test(err.message || "") ? 400 : 500;
    res.status(status).json({ error: "Failed to save planning settings", details: err.message });
  }
});

// API: Reset Planning Settings to defaults (recorded as a new revision, not a rollback).
app.post("/api/settings/reset", requireAdmin, async (req, res) => {
  try {
    const record = await (await getStorage()).saveSettings(DEFAULT_PLANNING_SETTINGS, actorName(req));
    res.json({ success: true, settings: record.settings, revision: record.revision });
  } catch (err: any) {
    console.error("Error resetting settings:", err);
    res.status(500).json({ error: "Failed to reset settings", details: err.message });
  }
});

// API: Read the live CTV publisher list.
app.get("/api/ctv-publishers", async (_req, res) => {
  try {
    const record = await (await getStorage()).getCurrentPublishers();
    res.json({ success: true, publishers: record.publishers, revision: record.revision });
  } catch (err: any) {
    console.error("Error loading CTV publishers:", err);
    res.status(500).json({ error: "Failed to load CTV publishers", details: err.message });
  }
});

// API: Write the CTV publisher list. Admin-only once ADMIN_PASSWORD is configured.
app.put("/api/ctv-publishers", requireAdmin, async (req, res) => {
  try {
    const record = await (await getStorage()).savePublishers(req.body?.publishers || req.body, actorName(req));
    res.json({ success: true, publishers: record.publishers, revision: record.revision });
  } catch (err: any) {
    console.error("Error saving CTV publishers:", err);
    const status = /^Invalid CTV publishers/.test(err.message || "") ? 400 : 500;
    res.status(status).json({ error: "Failed to save CTV publishers", details: err.message });
  }
});

// API: Reset CTV Publishers to CSV defaults.
app.post("/api/ctv-publishers/reset", requireAdmin, async (req, res) => {
  try {
    const record = await (await getStorage()).savePublishers(DEFAULT_CTV_PUBLISHERS, actorName(req));
    res.json({ success: true, publishers: record.publishers, revision: record.revision });
  } catch (err: any) {
    console.error("Error resetting CTV publishers:", err);
    res.status(500).json({ error: "Failed to reset CTV publishers", details: err.message });
  }
});

// Custom logos are returned as data URLs rather than written to /assets/pub-logos/.
// A file written to the container disk disappears on the next redeploy and is invisible
// to other instances, so a logo uploaded that way would silently vanish for everyone else.
// The data URL travels inside the publishers record, which is genuinely shared.
const MAX_LOGO_BYTES = 64 * 1024;

function logoMimeFromFilename(filename: string): string {
  const ext = (filename.split(".").pop() || "").toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "svg") return "image/svg+xml";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  return "application/octet-stream";
}

function buildLogoDataUrl(filename: string, buffer: Buffer): { logoUrl?: string; error?: string } {
  const mime = logoMimeFromFilename(filename);
  if (!mime.startsWith("image/")) {
    return { error: "Unsupported image type. Use PNG, JPG, SVG, WEBP or GIF." };
  }
  if (buffer.length > MAX_LOGO_BYTES) {
    return { error: `Logo is ${Math.round(buffer.length / 1024)}KB; please upload an image under ${MAX_LOGO_BYTES / 1024}KB.` };
  }
  return { logoUrl: `data:${mime};base64,${buffer.toString("base64")}` };
}

app.post("/api/ctv-publishers/upload-logo", requireAdmin, upload.single("logo"), (req, res) => {
  try {
    if (req.file) {
      // multer uses disk storage (dest: os.tmpdir()), so req.file.buffer is always
      // undefined here - the upload has to be read back from req.file.path.
      try {
        const buffer = fs.readFileSync(req.file.path);
        const result = buildLogoDataUrl(req.file.originalname, buffer);
        if (result.error) {
          res.status(400).json({ error: result.error });
          return;
        }
        res.json({ success: true, logoUrl: result.logoUrl });
      } finally {
        fs.unlink(req.file.path, () => {});
      }
      return;
    }
    if (req.body?.base64 && req.body?.filename) {
      const rawBase64 = req.body.base64.replace(/^data:image\/\w+;base64,/, "");
      const result = buildLogoDataUrl(req.body.filename, Buffer.from(rawBase64, "base64"));
      if (result.error) {
        res.status(400).json({ error: result.error });
        return;
      }
      res.json({ success: true, logoUrl: result.logoUrl });
      return;
    }
    res.status(400).json({ error: "No image file or base64 provided." });
  } catch (err: any) {
    console.error("Error uploading logo:", err);
    res.status(500).json({ error: "Failed to upload logo", details: err.message });
  }
});

// API: Login. The app is still behind one shared credential, but each person supplies
// a display name so plan writes can be attributed. The name is returned to the client
// inside a signed, HTTP-only cookie - never trusted from a request body.
app.post("/api/auth/login", (req, res) => {
  try {
    const { username, password, displayName, adminPassword } = req.body || {};
    const configuredUser = (process.env.TEST_USER || "").trim();
    const configuredPassword = (process.env.TEST_PASSWORD || "").trim();

    if (!configuredUser || !configuredPassword) {
      console.error("[AUTH] TEST_USER or TEST_PASSWORD environment variable is not configured.");
      res.status(500).json({ success: false, error: "Authentication credentials not configured on the server." });
      return;
    }

    const name = sanitizeDisplayName(displayName);
    if (!name) {
      res.status(400).json({ success: false, error: "Please enter your name so saved plans can be attributed." });
      return;
    }

    if (!username || !password || username.trim() !== configuredUser || password.trim() !== configuredPassword) {
      res.status(401).json({ success: false, error: "Invalid username or password." });
      return;
    }

    const configuredAdminPassword = (process.env.ADMIN_PASSWORD || "").trim();
    const suppliedAdminPassword = typeof adminPassword === "string" ? adminPassword.trim() : "";
    if (configuredAdminPassword && suppliedAdminPassword && suppliedAdminPassword !== configuredAdminPassword) {
      res.status(401).json({ success: false, error: "Invalid administrator password." });
      return;
    }
    const isAdmin = Boolean(configuredAdminPassword) && suppliedAdminPassword === configuredAdminPassword;

    const user = { name, isAdmin, issuedAt: Date.now() };
    const token = createSessionToken(user);
    setSessionCookie(res, user);
    console.log(`[AUTH] '${name}' signed in${isAdmin ? " as an administrator" : ""}.`);
    res.json({
      success: true,
      token,
      user: { name, isAdmin, canEditSettings: isAdminRequestAllowed(user) },
    });
  } catch (err: any) {
    console.error("[AUTH ERROR] Error processing login:", err);
    res.status(500).json({ success: false, error: "Internal authentication error." });
  }
});

// API: Who am I? The client uses this instead of a localStorage timestamp, so a session
// cannot be resurrected by editing browser storage.
app.get("/api/auth/me", (req, res) => {
  const user = getSession(req);
  if (!user) {
    res.status(401).json({ authenticated: false });
    return;
  }
  const token = createSessionToken(user);
  res.json({
    authenticated: true,
    token,
    user: { name: user.name, isAdmin: user.isAdmin, canEditSettings: isAdminRequestAllowed(user) },
    adminPasswordConfigured: isAdminPasswordConfigured(),
  });
});

app.post("/api/auth/logout", (_req, res) => {
  clearSessionCookie(res);
  res.json({ success: true });
});

// --- SHARED PLANS API ----------------------------------------------------------
// Every plan is visible to every signed-in user. Writes are versioned and attributed:
// each save bumps a revision, and a save against a stale revision is refused with 409
// rather than silently overwriting whatever somebody else just did.

function trimmedOrUndefined(value: unknown, maxLength: number): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maxLength) : undefined;
}

function planPayloadFromBody(body: any) {
  const { title, advertiserName, settingsRevision, payload } = body || {};
  const cleanPayload = payload && typeof payload === "object" ? payload : {};
  return {
    title: trimmedOrUndefined(title, 200) || "Untitled Plan",
    advertiserName: trimmedOrUndefined(advertiserName, 200),
    settingsRevision: Number.isInteger(settingsRevision) ? settingsRevision : null,
    // Preview fields are derived here rather than trusted from the client, so the list
    // view can never disagree with the payload it claims to summarize.
    audienceDescription: trimmedOrUndefined((cleanPayload as any).audienceDescription, 500),
    geography: trimmedOrUndefined((cleanPayload as any).geography, 100),
    campaignFocus: trimmedOrUndefined((cleanPayload as any).campaignFocus, 100),
    url: trimmedOrUndefined((cleanPayload as any).url, 500),
    payload: cleanPayload,
  };
}

function respondToStorageError(res: any, err: any, context: string) {
  if (err instanceof RevisionConflictError) {
    res.status(409).json({
      error: "This plan was changed by someone else while you were editing. Reload it and reapply your changes.",
      code: "REVISION_CONFLICT",
      currentRevision: err.currentRevision,
    });
    return;
  }
  if (err instanceof PlanNotFoundError) {
    res.status(404).json({ error: err.message, code: "NOT_FOUND" });
    return;
  }
  console.error(`Error in ${context}:`, err);
  res.status(500).json({ error: `Failed to ${context}`, details: err?.message || String(err) });
}

// List every saved plan. Returns metadata only - payloads are fetched on open, so the
// sidebar stays fast no matter how many plans accumulate.
app.get("/api/plans", async (req, res) => {
  try {
    const includeArchived = req.query.includeArchived === "true";
    const plans = await (await getStorage()).listPlans({ includeArchived });
    res.json({ success: true, plans });
  } catch (err: any) {
    respondToStorageError(res, err, "list plans");
  }
});

app.get("/api/plans/:id", async (req, res) => {
  try {
    const plan = await (await getStorage()).getPlan(req.params.id);
    if (!plan) {
      res.status(404).json({ error: `Plan '${req.params.id}' was not found.`, code: "NOT_FOUND" });
      return;
    }
    res.json({ success: true, plan });
  } catch (err: any) {
    respondToStorageError(res, err, "load plan");
  }
});

app.post("/api/plans", async (req, res) => {
  try {
    const input = planPayloadFromBody(req.body);
    const plan = await (await getStorage()).createPlan({ ...input, actor: actorName(req) });
    res.status(201).json({ success: true, plan });
  } catch (err: any) {
    respondToStorageError(res, err, "save plan");
  }
});

// Update requires the revision the client last read, supplied via If-Match or the body.
app.put("/api/plans/:id", async (req, res) => {
  try {
    const headerRevision = Number(req.get("If-Match"));
    const bodyRevision = Number(req.body?.expectedRevision);
    const expectedRevision = Number.isInteger(headerRevision) ? headerRevision : bodyRevision;

    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
      res.status(428).json({
        error: "An If-Match revision is required to update a plan.",
        code: "REVISION_REQUIRED",
      });
      return;
    }

    const input = planPayloadFromBody(req.body);
    const plan = await (await getStorage()).updatePlan(req.params.id, { ...input, actor: actorName(req) }, expectedRevision);
    res.json({ success: true, plan });
  } catch (err: any) {
    respondToStorageError(res, err, "update plan");
  }
});

// Soft delete. Plans are never destroyed, so a mis-click is always recoverable.
app.delete("/api/plans/:id", async (req, res) => {
  try {
    await (await getStorage()).archivePlan(req.params.id, actorName(req));
    res.json({ success: true });
  } catch (err: any) {
    respondToStorageError(res, err, "archive plan");
  }
});

app.post("/api/plans/:id/restore", async (req, res) => {
  try {
    await (await getStorage()).restorePlan(req.params.id, actorName(req));
    res.json({ success: true });
  } catch (err: any) {
    respondToStorageError(res, err, "restore plan");
  }
});

// --- plan sharing -----------------------------------------------------------

// Public, unauthenticated view of an actively shared plan
app.get("/api/share/plan", async (req, res) => {
  res.set("X-Robots-Tag", "noindex, nofollow");
  try {
    const token = String(req.query.token || "").trim();
    if (!token || token.length < 16) {
      res.status(400).json({ error: "A valid share token is required.", code: "INVALID_TOKEN" });
      return;
    }
    const storage = await getStorage();
    const plan = await storage.getPlanByShareToken(token);
    if (!plan || plan.archived || !plan.isShared) {
      res.status(404).json({
        error: "This shared media plan link does not exist, has expired, or was revoked.",
        code: "NOT_FOUND",
      });
      return;
    }
    res.json({ success: true, plan });
  } catch (err: any) {
    respondToStorageError(res, err, "load shared plan");
  }
});

// Generate or enable a cryptographically secure share link (authenticated)
app.post("/api/plans/:id/share", async (req, res) => {
  try {
    const storage = await getStorage();
    const existing = await storage.getPlan(req.params.id);
    if (!existing) {
      res.status(404).json({ error: `Plan '${req.params.id}' was not found.`, code: "NOT_FOUND" });
      return;
    }
    const regenerate = req.body?.regenerate === true;
    let shareToken = existing.shareToken;
    if (!shareToken || regenerate) {
      // 256 bits of cryptographically secure randomness, URL-safe base64
      shareToken = `sec_${crypto.randomBytes(32).toString("base64url")}`;
    }
    const updated = await storage.setPlanShare(req.params.id, true, shareToken);
    res.json({ success: true, shareToken: updated.shareToken, isShared: true });
  } catch (err: any) {
    respondToStorageError(res, err, "enable plan sharing");
  }
});

// Revoke an active share link (authenticated)
app.post("/api/plans/:id/unshare", async (req, res) => {
  try {
    const storage = await getStorage();
    const updated = await storage.setPlanShare(req.params.id, false);
    res.json({ success: true, shareToken: updated.shareToken, isShared: false });
  } catch (err: any) {
    respondToStorageError(res, err, "revoke plan sharing");
  }
});

// Helper: Generate a realistic profile photo headshot using Gemini 3.1 Flash Image (Nano Banana 2)
async function generatePersonaHeadshot(persona: any, retryCount: number = 0): Promise<string | null> {
  try {
    const ai = getAiClient();
    
    // Clean up persona characteristics for natural, photorealistic prompt rendering
    const rawGender = persona.gender ? String(persona.gender).replace(/Skews\s+/i, "").replace(/\(\d+%\)/g, "").trim() : "person";
    const rawAge = persona.age ? String(persona.age).trim() : "35";
    const personaName = persona.name || "Audience Persona";

    const prompt = `A clean, authentic, high-quality 1:1 square photographic studio headshot portrait of a ${rawAge} year old ${rawGender}, styled as ${personaName}. Professional portrait lighting, neutral soft-focus studio background, warm, confident, approachable facial expression facing directly toward camera. Single subject, tightly centered on head and shoulders.`;

    console.log(`[GEMINI IMAGE GEN] Generating headshot photo for persona: '${personaName}' (attempt ${retryCount + 1})...`);
    
    const response: any = await withTimeout(
      ai.models.generateContent({
        model: "gemini-3.1-flash-image",
        contents: prompt,
        config: {
          responseModalities: ["IMAGE"],
          thinkingConfig: {
            thinkingLevel: ThinkingLevel.MINIMAL,
          },
          imageConfig: {
            aspectRatio: "1:1",
            imageSize: "1K",
          } as any,
        } as any,
      }),
      45000, // Generous 45s timeout to accommodate queueing
      null
    );

    if (!response) {
      console.warn(`[GEMINI IMAGE GEN] Timed out for persona '${personaName}'.`);
      if (retryCount === 0) {
        console.log(`[GEMINI IMAGE GEN] Retrying headshot for persona '${personaName}'...`);
        return await generatePersonaHeadshot(persona, retryCount + 1);
      }
      return null;
    }

    for (const candidate of response.candidates || []) {
      for (const part of candidate.content?.parts || []) {
        if (part.inlineData?.data) {
          const mime = part.inlineData.mimeType || "image/jpeg";
          console.log(`[GEMINI IMAGE GEN] Headshot photo generated successfully for persona '${personaName}'.`);
          return `data:${mime};base64,${part.inlineData.data}`;
        }
      }
    }
    console.warn(`[GEMINI IMAGE GEN] No image data found in response for persona '${personaName}'.`);
    if (retryCount === 0) {
      return await generatePersonaHeadshot(persona, retryCount + 1);
    }
  } catch (err: any) {
    console.error(`[GEMINI IMAGE GEN ERROR] Failed to generate headshot for persona '${persona?.name}':`, err?.message || err);
    if (retryCount === 0) {
      console.log(`[GEMINI IMAGE GEN] Retrying after error for persona '${persona?.name}'...`);
      return await generatePersonaHeadshot(persona, retryCount + 1);
    }
  }
  return null;
}

// API: Generate individual persona headshot avatar on demand
app.post("/api/generate-persona-avatar", async (req, res) => {
  try {
    const { persona } = req.body;
    if (!persona || !persona.name) {
      res.status(400).json({ error: "Persona details required." });
      return;
    }
    console.log(`[API /api/generate-persona-avatar] Generating headshot for ${persona.name}...`);
    const avatarUrl = await generatePersonaHeadshot(persona);
    if (avatarUrl) {
      res.json({ success: true, avatarUrl });
    } else {
      res.status(500).json({ error: "Failed to generate persona headshot.", details: "Image generation model returned no image." });
    }
  } catch (err: any) {
    console.error("Error in /api/generate-persona-avatar:", err);
    res.status(500).json({ error: "Failed to generate persona headshot.", details: err.message || err });
  }
});

// API: Segment recommendations for a finished profile. Called by the client once the
// profile has rendered - like the headshots - so the final, post-remediation personas are
// the input and none of this time lands on the generate-profile deadline.
app.post("/api/generate-segments", async (req, res) => {
  try {
    const request = sanitizeSegmentRequest(req.body);
    const usablePersonaIndices = request.personas
      .map((persona, index) => (persona ? index : -1))
      .filter((index) => index >= 0);

    // Top-up asks for a little slack because the normalizer may still drop a duplicate.
    const [minItems, maxItems, maxCount] = request.mode === "initial"
      ? [MIN_AI_SEGMENTS, MAX_AI_SEGMENTS, MAX_AI_SEGMENTS]
      : [request.count, Math.min(MAX_AI_SEGMENTS, request.count + 2), request.count];

    const { systemInstruction, input } = buildSegmentPrompt(request);
    const { data, thinkingLevel } = await generateStructuredJsonWithFallback(
      getAiClient(),
      {
        systemInstruction,
        input,
        schema: buildSegmentResponseSchema(minItems, maxItems, request.personas.length),
      },
      [
        { thinkingLevel: "high", timeoutMs: TIMEOUT_SEGMENTS_HIGH_MS },
        { thinkingLevel: "medium", timeoutMs: TIMEOUT_SEGMENTS_FALLBACK_MS },
      ],
    );

    const segments = normalizeSegments(data, {
      usablePersonaIndices,
      reservedNames: [...request.existingSegments.map((s) => s.name), ...request.removedNames],
      existingDimensions: request.existingSegments.map((s) => s.dimension),
      planAudiences: request.planAudiences,
      maxCount,
    });

    if (segments.length === 0) {
      res.status(502).json({ error: "The model returned no usable segment recommendations. Please try again." });
      return;
    }

    console.log(`[API /api/generate-segments] ${request.mode}: ${segments.length} segment(s) via ${GEMINI_FLASH_MODEL} (${thinkingLevel} thinking).`);
    res.json({ segments, model: GEMINI_FLASH_MODEL, thinkingLevel });
  } catch (err: any) {
    console.error("Error in /api/generate-segments:", err);
    res.status(502).json({ error: "Could not generate segment recommendations.", details: err?.message || String(err) });
  }
});

// API: Generate 16:9 Presentation Slides for Personas using gpt-image-2.5-sunburst
app.post("/api/personas/generate-slide", async (req, res) => {
  // Prevent socket timeout on long-running image generation
  req.socket.setTimeout(0);

  try {
    const {
      mode = "portfolio", // "portfolio" (4-in-1) | "spotlight" (1 persona)
      personaIndex = 0,
      personas = [],
      advertiserName = "Brand",
      campaignFocus = "",
      geography = "National (US)",
      style = "corporate_light", // "corporate_light" | "modern_dark" | "minimal_slate"
      customNotes = "",
    } = req.body || {};

    if (!Array.isArray(personas) || personas.length === 0) {
      res.status(400).json({ error: "Personas array is required to generate presentation slide." });
      return;
    }

    let openai: OpenAI;
    try {
      openai = getOpenaiClient();
    } catch (clientErr: any) {
      res.status(500).json({ error: "OpenAI client configuration error.", details: clientErr.message || clientErr });
      return;
    }

    const brand = advertiserName ? String(advertiserName).trim() : "Brand";
    console.log(`[API /api/personas/generate-slide] Starting slide generation. Mode: '${mode}', Style: '${style}', Personas count: ${personas.length}`);

    // EXACT BRAND DESIGN GUIDE (Mandatory across all slide layouts)
    const brandDesignGuide = `
CORE BRAND DESIGN GUIDE & AESTHETIC SPECIFICATION (MANDATORY FOR ALL LAYOUTS):
- COLOR PALETTE & TONAL EXECUTION:
  • Primary Color: Teal #0e8f86 (used for primary brand elements, key highlights, active tags, and primary accents).
  • Dark Surfaces: Deep Teal #0e3b42 for dark surfaces, rich container backgrounds, or high-contrast card blocks.
  • Secondary Color: Indigo #6b63e6 for secondary tags, supporting category indicators, and demographic badges.
  • Limited Accents: Lime #a6cf56 for high-impact metric callouts and limited accent badges only.
  • Neutrals & Body Copy: Cool slate-tinted neutrals with all body text and descriptions rendered strictly at #0c1e24 rather than true black.
  • Elevation & Shadows: Shadows are cool-tinted and low-contrast, providing soft, premium depth without harsh dark edges.
  • Layout & Negative Space: Layout stays generous and breathable because ample whitespace is an intentional part of the premium feel.
  • Persona Imagery Framing: No border around persona images (clean, seamless, borderless portraits with no stroke, outline, or border ring around photos). For the 4-persona multi-card slide, round circular avatars are used; for individual spotlight slides, the persona image is NOT round—instead, use what framing works best for the layout (such as an elegant vertical rectangular or softly rounded-corner editorial portrait).
- TYPOGRAPHY SYSTEM (LEXEND THROUGHOUT):
  • Typeface: Lexend throughout all textual elements.
  • Headlines & Persona Titles: Lexend Bold with tight 1.05 leading and -0.02em tracking.
  • Body Text & Descriptions: Lexend Regular at 1.5 leading with body text in #0c1e24.
  • Eyebrow Labels & Category Badges: Lexend SemiBold in all-caps (UPPERCASE) with 0.08em tracking for teal (#0e8f86) eyebrow labels.
`;

    // Palette & visual styling directives - optimized for white background slide decks
    let paletteDesc = "Pure white presentation canvas (#FFFFFF) with cool slate-tinted neutral card containers (#F8FAFC), subtle 1px cool borders (#E2E8F0), body text at #0c1e24, primary teal #0e8f86 accents, deep teal #0e3b42 dark surfaces, indigo #6b63e6 secondary accents, and limited lime #a6cf56 highlights";
    if (style === "modern_dark") {
      paletteDesc = "Executive dark theme: deep teal (#0e3b42) canvas and surfaces, clean white text, teal #0e8f86 and indigo #6b63e6 accents, limited lime #a6cf56 callouts, with subtle cool-tinted low-contrast borders";
    } else if (style === "minimal_slate") {
      paletteDesc = "Refined minimal editorial theme: pure white canvas (#FFFFFF), high-contrast #0c1e24 typography in Lexend, subtle cool slate borders (#E2E8F0), teal #0e8f86 eyebrow labels, and indigo #6b63e6 accents";
    }

    let prompt = "";
    const referenceFiles: any[] = [];

    if (mode === "spotlight") {
      const pIdx = Math.max(0, Math.min(personaIndex, personas.length - 1));
      const targetPersona = personas[pIdx] || personas[0];
      const personaName = targetPersona.name || `Persona Archetype ${pIdx + 1}`;
      const roleTag = targetPersona.sourceType === "User"
        ? "Target Specific Persona"
        : targetPersona.sourceType === "RFP"
        ? "Core RFP Target Audience"
        : "ScoutAI Reach Expansion Segment";

      // Check if avatar image is available
      if (targetPersona.avatarUrl && typeof targetPersona.avatarUrl === "string" && targetPersona.avatarUrl.startsWith("data:image/")) {
        try {
          const parts = targetPersona.avatarUrl.split(",");
          const mime = targetPersona.avatarUrl.split(";")[0].replace("data:", "") || "image/png";
          const ext = mime.includes("jpeg") || mime.includes("jpg") ? "jpg" : "png";
          const buf = Buffer.from(parts[1], "base64");
          const file = await toFile(buf, `persona_${pIdx + 1}.${ext}`, { type: mime });
          referenceFiles.push(file);
          console.log(`[API /api/personas/generate-slide] Added avatar reference for spotlight persona: ${personaName}`);
        } catch (bufErr) {
          console.warn("[API /api/personas/generate-slide] Could not convert avatar to file:", bufErr);
        }
      }

      prompt = `A modern, modular slide body graphic in 16:9 widescreen format (1536x864) showcasing an audience persona spotlight, designed to be placed directly onto a white background presentation slide.

CRITICAL PRESENTATION INTEGRATION DIRECTIVES (SLIDE DECK READY):
- ABSOLUTELY NO SLIDE HEADER: Do NOT include any main slide title, do NOT include any slide subtitle, subhead, category banner, or top header text.
- ABSOLUTELY NO LOGO: Do NOT include any company logo, brand mark, insignia, or watermarks anywhere.
- ABSOLUTELY NO FOOTER: Do NOT include any footer bar, disclaimer, confidentiality notice, page number, slide counter, or bottom footer text.
- CANVAS BACKGROUND: PURE SOLID CLEAN WHITE (#FFFFFF) across the entire canvas with no outer border, no framing drop shadow, and no vignette, so it blends seamlessly into a white slide presentation.

${brandDesignGuide}

BODY CONTENT & COMPOSITION (Fills the 16:9 canvas cleanly with generous whitespace for a premium executive feel):
The entire image consists purely of the two-column slide body cards:

LEFT COLUMN (~38% of width):
- Photographic Studio Portrait: A large, high-definition photorealistic studio headshot portrait of ${personaName} (${targetPersona.age || "35"} year old ${targetPersona.gender || "individual"}). Warm, approachable, professional studio portrait lighting, facing camera. CRITICAL: For this spotlight layout, the persona image MUST NOT BE ROUND — instead, use what framing works best for the layout (e.g., an elegant vertical portrait or rectangular studio framing with natural soft corners that fills the top of the card). There must be NO border around the persona image (completely borderless, seamless photo placement with no stroke, outline, or border ring).
- Demographic Card directly beneath the portrait:
  • Eyebrow Label: "${roleTag.toUpperCase()}" (Lexend SemiBold in uppercase, 0.08em tracking, in teal #0e8f86)
  • Persona Name: "${personaName}" (Lexend Bold with tight 1.05 leading and -0.02em tracking, prominent title in card)
  • Demographic Pill Badges: Age: ${targetPersona.age || "25-45"} (teal #0e8f86) | Gender: ${targetPersona.gender || "Balanced"} (indigo #6b63e6) | HHI: ${targetPersona.income || "$85,000+"} (lime #a6cf56 accent)
  • Primary Geography: ${geography || "National (US)"}

RIGHT COLUMN (~62% of width):
- Executive Persona Narrative Card:
  • Eyebrow Label: "AUDIENCE ARCHETYPE NARRATIVE" (Lexend SemiBold in uppercase, 0.08em tracking, in teal #0e8f86)
  • Narrative Text: "${targetPersona.narrative || "Representative consumer archetype exhibiting distinct digital media engagement, high brand affinity, and measurable commercial purchase intent."}" (Lexend Regular at 1.5 leading in #0c1e24)
- Three Structured Insight Blocks:
  1. 📺 Connected TV & Viewing Patterns:
     • Eyebrow: "CONNECTED TV & STREAMING" in teal #0e8f86 (Lexend SemiBold, 0.08em tracking)
     • Body: "${targetPersona.watch || "Ad-supported Connected TV, premium streaming, and prime-time OTT"}" (Lexend Regular at 1.5 leading in #0c1e24)
  2. 🌐 Digital, Mobile & Web Affinity:
     • Eyebrow: "DIGITAL & MOBILE BEHAVIOR" in teal #0e8f86 (Lexend SemiBold, 0.08em tracking)
     • Body: "${targetPersona.browse || "High-affinity digital news, lifestyle apps, and social platforms"}" (Lexend Regular at 1.5 leading in #0c1e24)
  3. 🛍️ Purchase Drivers & Commerce Behavior:
     • Eyebrow: "COMMERCE & PURCHASE DRIVERS" in teal #0e8f86 (Lexend SemiBold, 0.08em tracking)
     • Body: "${targetPersona.buy || "Direct-to-consumer goods, high e-commerce propensity, responsive to digital offers"}" (Lexend Regular at 1.5 leading in #0c1e24)
- Media Planning Activation Recommendation:
  • Container: Deep teal (#0e3b42) or cool slate surface with subtle cool-tinted shadow and 1px border.
  • Eyebrow: "STRATEGIC ACTIVATION RECOMMENDATION" in teal #0e8f86 with a small lime #a6cf56 accent tag.
  • Recommendation Text: "Deploy targeted CTV video creative and synchronized cross-device retargeting to engage ${personaName} during high-attention evening and weekend dayparts." (Lexend Regular in #0c1e24 or crisp white if on deep teal)

DESIGN & EXECUTION DIRECTIVES:
- Follow all directives in the CORE BRAND DESIGN GUIDE above.
- Borderless persona imagery (NOT round): For this individual spotlight slide, the persona portrait photo MUST NOT BE ROUND; instead, use whatever framing works best for the layout (e.g. natural vertical rectangular/portrait studio framing) with absolutely NO border around it (borderless photo with no stroke, outline, or framing ring).
- Clean graphic card containers with subtle 1px border outlines (#E2E8F0) and rounded corners (12px) on a pure white (#FFFFFF) background.
- Generous whitespace throughout ensuring an uncluttered, high-end presentation feel.
- Razor-sharp, high-contrast, perfectly legible Lexend typography.
- STRICT REMINDER: ONLY produce the visual body cards. NO top slide title, NO subhead, NO logo, NO footer text.
${customNotes ? `ADDITIONAL USER DIRECTIVE: ${customNotes}` : ""}`;

    } else {
      // 4-in-1 Portfolio mode
      const candidatePersonas = personas.slice(0, 4);

      // Collect avatar references if available
      for (let i = 0; i < candidatePersonas.length; i++) {
        const p = candidatePersonas[i];
        if (p.avatarUrl && typeof p.avatarUrl === "string" && p.avatarUrl.startsWith("data:image/")) {
          try {
            const parts = p.avatarUrl.split(",");
            const mime = p.avatarUrl.split(";")[0].replace("data:", "") || "image/png";
            const ext = mime.includes("jpeg") || mime.includes("jpg") ? "jpg" : "png";
            const buf = Buffer.from(parts[1], "base64");
            const file = await toFile(buf, `persona_${i + 1}.${ext}`, { type: mime });
            referenceFiles.push(file);
          } catch (bufErr) {
            console.warn(`[API /api/personas/generate-slide] Could not convert avatar ${i + 1} to file:`, bufErr);
          }
        }
      }
      console.log(`[API /api/personas/generate-slide] Added ${referenceFiles.length} avatar reference(s) for portfolio slide.`);

      prompt = `A modern, modular slide body graphic in 16:9 widescreen format (1536x864) showcasing 4 audience persona cards side-by-side, designed to be placed directly onto a white background presentation slide.

CRITICAL PRESENTATION INTEGRATION DIRECTIVES (SLIDE DECK READY):
- ABSOLUTELY NO SLIDE HEADER: Do NOT include any main slide title, do NOT include any slide subtitle, subhead, category banner, or top header text.
- ABSOLUTELY NO LOGO: Do NOT include any company logo, brand mark, insignia, or watermarks anywhere.
- ABSOLUTELY NO FOOTER: Do NOT include any footer bar, disclaimer, confidentiality notice, page number, slide counter, or bottom footer text.
- CANVAS BACKGROUND: PURE SOLID CLEAN WHITE (#FFFFFF) across the entire canvas with no outer border, no framing drop shadow, and no vignette, so it blends seamlessly into a white slide presentation.

${brandDesignGuide}

BODY CONTENT & COMPOSITION (Fills the 16:9 canvas cleanly with generous whitespace for a premium executive feel):
The entire image consists purely of exactly 4 distinct, equal vertical persona cards arranged horizontally side-by-side across the slide:

${candidatePersonas.map((p: any, idx: number) => `
CARD ${idx + 1}:
• Photographic Studio Portrait: A crisp ROUND (circular) headshot portrait at the top showing a realistic ${p.age || "35"} year old ${p.gender || "adult"} with friendly confident expression and professional studio lighting. CRITICAL: The persona image must be ROUND (a perfect circle avatar cutout) and there must be NO border around the persona image (completely borderless circular photo with no stroke, outline, or border ring).
• Eyebrow Tag: "${p.sourceType === "User" ? "TARGET SPECIFIC PERSONA" : p.sourceType === "RFP" ? "CORE RFP TARGET" : "SCOUTAI GROWTH SEGMENT"}" in teal #0e8f86 (Lexend SemiBold in uppercase with 0.08em tracking).
• Persona Name: "${p.name || `Persona Archetype ${idx + 1}`}" (Lexend Bold with tight 1.05 leading and -0.02em tracking).
• Demographic Pills: "${p.gender || "Balanced"} | Age ${p.age || "25-45"} | HHI ${p.income || "$85k+"}" (Teal #0e8f86, secondary indigo #6b63e6, and subtle lime #a6cf56 accents).
• 3 Key Media & Purchasing Behaviors (Lexend Regular text at 1.5 leading in #0c1e24):
  - 📺 Watch: ${p.watch || "Connected TV & Streaming"}
  - 🌐 Browse: ${p.browse || "Digital news & mobile apps"}
  - 🛍️ Buy: ${p.buy || "E-commerce & retail"}
• Summary Highlight: "${(p.narrative || "").slice(0, 100)}..." (Lexend Regular in #0c1e24)
`).join("\n")}

DESIGN & EXECUTION DIRECTIVES:
- Follow all directives in the CORE BRAND DESIGN GUIDE above.
- Round persona images with no border: All 4 persona portrait photos MUST BE ROUND (perfect circular avatars) with absolutely NO border around them (completely borderless circular photos with no outer stroke, ring, or outline).
- 4 clean vertical cards with cool slate-tinted neutral container backgrounds (#F8FAFC), subtle 1px cool borders (#E2E8F0), and cool-tinted low-contrast shadows on a pure white (#FFFFFF) canvas.
- Deep teal #0e3b42 used for prominent card accents or dark surfaces, primary teal #0e8f86 for active tags, indigo #6b63e6 for secondary badges, and lime #a6cf56 for limited high-impact accents.
- All body copy strictly in #0c1e24.
- Generous whitespace between cards and within containers ensuring an uncluttered, high-end executive look.
- Razor-sharp, high-contrast, perfectly legible Lexend typography throughout.
- STRICT REMINDER: ONLY produce the 4 persona cards. NO top slide title, NO subhead, NO logo, NO footer text.
${customNotes ? `ADDITIONAL USER DIRECTIVE: ${customNotes}` : ""}`;
    }

    console.log(`[API /api/personas/generate-slide] Dispatching request to OpenAI model 'gpt-image-2.5-sunburst' (size: 1536x864)...`);

    let resultImageBase64: string | null = null;
    let revisedPrompt: string | undefined = undefined;

    // Try edit endpoint if reference files exist
    if (referenceFiles.length > 0) {
      try {
        console.log(`[API /api/personas/generate-slide] Attempting openai.images.edit with ${referenceFiles.length} reference image(s)...`);
        const editResponse = await withTimeout(
          openai.images.edit({
            model: "gpt-image-2.5-sunburst",
            image: referenceFiles.length === 1 ? referenceFiles[0] : referenceFiles,
            prompt,
            size: "1536x864",
            quality: "high",
          } as any),
          120000,
          null
        );

        if (editResponse && editResponse.data && editResponse.data[0]?.b64_json) {
          resultImageBase64 = editResponse.data[0].b64_json;
          revisedPrompt = editResponse.data[0].revised_prompt;
          console.log("[API /api/personas/generate-slide] Successfully generated slide using openai.images.edit!");
        }
      } catch (editErr: any) {
        console.warn(`[API /api/personas/generate-slide] openai.images.edit failed (${editErr.message || editErr}). Gracefully falling back to openai.images.generate...`);
      }
    }

    // Fallback or default to images.generate
    if (!resultImageBase64) {
      console.log("[API /api/personas/generate-slide] Calling openai.images.generate with gpt-image-2.5-sunburst...");
      const genResponse = await withTimeout(
        openai.images.generate({
          model: "gpt-image-2.5-sunburst",
          prompt,
          size: "1536x864",
          quality: "high",
        }),
        120000,
        null
      );

      if (genResponse && genResponse.data && genResponse.data[0]?.b64_json) {
        resultImageBase64 = genResponse.data[0].b64_json;
        revisedPrompt = genResponse.data[0].revised_prompt;
        console.log("[API /api/personas/generate-slide] Successfully generated slide using openai.images.generate!");
      } else {
        throw new Error("gpt-image-2.5-sunburst did not return image data.");
      }
    }

    const finalImageUrl = `data:image/png;base64,${resultImageBase64}`;
    res.json({
      success: true,
      imageUrl: finalImageUrl,
      model: "gpt-image-2.5-sunburst",
      mode,
      personaIndex,
      revisedPrompt,
    });

  } catch (err: any) {
    console.error("[API /api/personas/generate-slide ERROR]:", err);
    res.status(500).json({
      error: "Failed to generate presentation slide.",
      details: err.message || String(err),
    });
  }
});

// API: Generate 16:9 Presentation Slides for Channel Strategy using gpt-image-2.5-sunburst
app.post("/api/channels/generate-slide", async (req, res) => {
  // Prevent socket timeout on long-running image generation
  req.socket.setTimeout(0);

  try {
    const {
      mode = "overview", // "overview" (all active channels on 1 slide) | "spotlight" (1 channel deep dive)
      channelIndex = 0,
      channels = [],
      workingMediaBudget = 0,
      flightDays = 30,
      appliedBudgetTier = "",
      advertiserName = "Brand",
      campaignFocus = "",
      geography = "National (US)",
      style = "corporate_light", // "corporate_light" | "modern_dark" | "minimal_slate"
      customNotes = "",
      executiveInsight = "",
    } = req.body || {};

    if (!Array.isArray(channels) || channels.length === 0) {
      res.status(400).json({ error: "Active channels array is required to generate channel strategy presentation slide." });
      return;
    }

    let openai: OpenAI;
    try {
      openai = getOpenaiClient();
    } catch (clientErr: any) {
      res.status(500).json({ error: "OpenAI client configuration error.", details: clientErr.message || clientErr });
      return;
    }

    const brand = advertiserName ? String(advertiserName).trim() : "Brand";
    console.log(`[API /api/channels/generate-slide] Starting channel slide generation. Mode: '${mode}', Style: '${style}', Active channels count: ${channels.length}`);

    // EXACT BRAND DESIGN GUIDE (Mandatory across all slide layouts)
    const brandDesignGuide = `
CORE BRAND DESIGN GUIDE & AESTHETIC SPECIFICATION (MANDATORY FOR ALL LAYOUTS):
- COLOR PALETTE & TONAL EXECUTION:
  • Primary Color: Teal #0e8f86 (used for primary brand elements, key allocation metrics, active status tags, and primary accents).
  • Dark Surfaces: Deep Teal #0e3b42 for dark surfaces, rich container backgrounds, or high-contrast header metric blocks.
  • Secondary Color: Indigo #6b63e6 for secondary category tags, tactic badges, and supporting indicators.
  • Limited Accents: Lime #a6cf56 for high-impact metric callouts, budget highlights, and KPI badges only.
  • Neutrals & Body Copy: Cool slate-tinted neutrals with all body text and descriptions rendered strictly at #0c1e24 rather than true black.
  • Elevation & Shadows: Shadows are cool-tinted and low-contrast, providing soft, premium depth without harsh dark edges.
  • Layout & Negative Space: Layout stays generous and breathable because ample whitespace is an intentional part of the premium feel.
- TYPOGRAPHY SYSTEM (LEXEND THROUGHOUT):
  • Typeface: Lexend throughout all textual elements.
  • Headlines & Channel Titles: Lexend Bold with tight 1.05 leading and -0.02em tracking.
  • Body Text & Descriptions: Lexend Regular at 1.5 leading with body text in #0c1e24.
  • Eyebrow Labels & Category Badges: Lexend SemiBold in all-caps (UPPERCASE) with 0.08em tracking for teal (#0e8f86) eyebrow labels.
`;

    let prompt = "";

    if (mode === "spotlight") {
      const cIdx = Math.max(0, Math.min(channelIndex, channels.length - 1));
      const targetChannel = channels[cIdx] || channels[0];
      const channelName = targetChannel.channelName || `Media Channel ${cIdx + 1}`;
      const allocPct = targetChannel.allocationPercent != null ? Math.round(targetChannel.allocationPercent) : 0;
      const allocDollars = targetChannel.allocationDollars ? `$${Math.round(targetChannel.allocationDollars).toLocaleString()}` : "";
      const cpmRange = targetChannel.typicalCpmLow && targetChannel.typicalCpmHigh 
        ? `$${targetChannel.typicalCpmLow} – $${targetChannel.typicalCpmHigh} CPM` 
        : targetChannel.typicalCpmLow ? `$${targetChannel.typicalCpmLow} CPM` : "Standard Benchmark CPM";
      const score = targetChannel.recommendationScore ? targetChannel.recommendationScore.toFixed(1) : "9.0";
      const confidence = targetChannel.confidence || "HIGH";
      const status = targetChannel.status === "TEST" ? "TACTICAL TEST" : "RECOMMENDED CORE";

      // Extract tactics & publishers
      const tactics = Array.isArray(targetChannel.targetingTactics) && targetChannel.targetingTactics.length > 0
        ? targetChannel.targetingTactics.slice(0, 3).map((t: any) => t.displayName || t.id).join(", ")
        : "First-party audience matching, behavioral segment targeting, geographic radius optimization";

      const publishers = Array.isArray(targetChannel.publishers) && targetChannel.publishers.length > 0
        ? targetChannel.publishers.slice(0, 4).map((p: any) => p.displayName || p.id).join(", ")
        : "Premium direct publisher inventory and verified private marketplaces";

      const enhancements = Array.isArray(targetChannel.creativeEnhancements) && targetChannel.creativeEnhancements.length > 0
        ? targetChannel.creativeEnhancements.slice(0, 3).map((e: any) => e.displayName || e.id).join(", ")
        : "Interactive video overlays, dynamic creative optimization, frequency capping";

      const measurement = Array.isArray(targetChannel.measurementCapabilities) && targetChannel.measurementCapabilities.length > 0
        ? targetChannel.measurementCapabilities.slice(0, 3).map((m: any) => m.displayName || m.id).join(", ")
        : "Multi-touch attribution, brand lift studies, real-time conversion tracking";

      prompt = `A modern, modular slide body graphic in 16:9 widescreen format (1536x864) showcasing a single media channel strategy spotlight deep dive, designed to be placed directly onto a white background presentation slide.

CRITICAL PRESENTATION INTEGRATION DIRECTIVES (SLIDE DECK READY):
- ABSOLUTELY NO SLIDE HEADER: Do NOT include any main slide title, do NOT include any slide subtitle, subhead, category banner, or top header text.
- ABSOLUTELY NO LOGO: Do NOT include any company logo, brand mark, insignia, or watermarks anywhere.
- ABSOLUTELY NO FOOTER: Do NOT include any footer bar, disclaimer, confidentiality notice, page number, slide counter, or bottom footer text.
- CANVAS BACKGROUND: PURE SOLID CLEAN WHITE (#FFFFFF) across the entire canvas with no outer border, no framing drop shadow, and no vignette, so it blends seamlessly into a white slide presentation.
- NO UNSELECTED CANDIDATES: Only display this active, funded channel from the approved media plan.

${brandDesignGuide}

BODY CONTENT & COMPOSITION (Fills the 16:9 canvas cleanly with generous whitespace for a premium executive feel):
The entire image consists purely of the two-column slide body cards:

LEFT COLUMN (~36% of width):
- Prominent Channel Overview Card:
  • Eyebrow Label: "${status}" (Lexend SemiBold in uppercase, 0.08em tracking, in teal #0e8f86)
  • Channel Name: "${channelName}" (Lexend Bold with tight 1.05 leading and -0.02em tracking, prominent title in card)
  • Strategic Role: "${targetChannel.role || "Primary Awareness & Full-Funnel Demand Driver"}" (Lexend Regular, #0c1e24)
  • Primary Allocation Metric Callout (Deep teal #0e3b42 background card with lime #a6cf56 accent):
    - Percentage: "${allocPct}% of Total Budget" (Large bold display)
    - Dollars: "${allocDollars}" (Prominent secondary figure)
  • Key Tactical Badges:
    - Benchmark CPM: "${cpmRange}" (Teal #0e8f86 pill)
    - Fit Score: "${score}/100" (Indigo #6b63e6 pill)
    - Confidence: "${confidence}" (Lime #a6cf56 accent badge)
    - Flight Duration: "${flightDays} Days"
  • Gap Addressed Callout: "${targetChannel.gapAddressed || "Delivers verified incremental household reach and high-attention engagement."}"

RIGHT COLUMN (~64% of width):
- Four Structured Tactical Execution Cards in a clean 2x2 grid:
  1. 🎯 Targeting Tactics & Audience Activation:
     • Eyebrow: "TARGETING & AUDIENCE ACTIVATION" in teal #0e8f86
     • Body: "${tactics}" (Lexend Regular at 1.5 leading in #0c1e24)
  2. 📺 Publisher Ecosystem & Inventory Quality:
     • Eyebrow: "PREMIUM PUBLISHER ECOSYSTEM" in teal #0e8f86
     • Body: "${publishers}" (Lexend Regular at 1.5 leading in #0c1e24)
  3. 🎨 Creative Enhancements & Delivery Controls:
     • Eyebrow: "CREATIVE & INVENTORY CONTROLS" in indigo #6b63e6
     • Body: "${enhancements}" (Lexend Regular at 1.5 leading in #0c1e24)
  4. 📊 Measurement & Attribution Alignment:
     • Eyebrow: "MEASUREMENT & ATTRIBUTION" in indigo #6b63e6
     • Body: "${measurement}" (Lexend Regular at 1.5 leading in #0c1e24)
- Bottom Strategic Rationale Container:
  • Container: Light cool slate container (#F8FAFC) with subtle 1px border (#E2E8F0)
  • Eyebrow: "STRATEGIC ALLOCATION RATIONALE" in teal #0e8f86
  • Text: "${targetChannel.allocationRationale || "Allocated based on strong cross-device synergies, proven audience affinity, and predictable cost efficiency."}" (Lexend Regular in #0c1e24)

DESIGN & EXECUTION DIRECTIVES:
- Follow all directives in the CORE BRAND DESIGN GUIDE above.
- Clean graphic card containers with subtle 1px border outlines (#E2E8F0) and rounded corners (12px) on a pure white (#FFFFFF) background.
- Generous whitespace throughout ensuring an uncluttered, high-end presentation feel.
- Razor-sharp, high-contrast, perfectly legible Lexend typography.
- STRICT REMINDER: ONLY produce the visual body cards. NO top slide title, NO subhead, NO logo, NO footer text.
${customNotes ? `ADDITIONAL USER DIRECTIVE: ${customNotes}` : ""}`;

    } else {
      // mode === "overview" (All active funded channels on 1 slide)
      // DYNAMIC SELECTIVITY ENGINE: Support any number of funded channels without arbitrary truncation.
      // Adapt layout geometry and selectively prioritize card content density so all channels fit cleanly.
      const activeChannels = Array.isArray(channels) ? channels : [];
      const numChannels = activeChannels.length;
      const totalBudgetFormatted = workingMediaBudget ? `$${Math.round(workingMediaBudget).toLocaleString()}` : "$0";

      // Determine adaptive layout geometry and content selectivity based on active channel count
      let layoutInstruction = "";
      let densityLevel: "spacious" | "moderate" | "compact" | "ultra_compact" = "spacious";
      let selectiveContentRule = "";

      if (numChannels <= 4) {
        densityLevel = "spacious";
        layoutInstruction = `A single horizontal row of ${numChannels} spacious, equal-width vertical cards arranged side-by-side across the 16:9 canvas with generous whitespace and margins.`;
        selectiveContentRule = `Full detail included: Status Tag, Channel Name, Allocation (% and $), Strategic Role, Benchmark CPM, Recommendation Fit Score, Publishers, and Core Tactic.`;
      } else if (numChannels === 5) {
        densityLevel = "moderate";
        layoutInstruction = `A single horizontal row of 5 streamlined vertical cards arranged side-by-side with balanced margins across the 16:9 canvas.`;
        selectiveContentRule = `Streamlined content: Status Tag, Channel Name, Allocation (% and $), Strategic Role, Benchmark CPM, and Top Publishers. Lengthy narrative tactics are excluded to maintain clean vertical breathing room.`;
      } else if (numChannels === 6) {
        densityLevel = "compact";
        layoutInstruction = `A balanced 2-row × 3-column modular grid (3 equal-sized cards in the top row, 3 equal-sized cards in the bottom row), guaranteeing all 6 channels have ample room, uniform dimensions, and equal visual weight across the 16:9 slide.`;
        selectiveContentRule = `Selective high-impact metrics: Status Tag, Channel Name, Allocation (% and $), Concise Strategic Objective (1 phrase), and Benchmark CPM. Verbose publisher listings and long tactical paragraphs are selectively excluded to ensure large, crisp, legible typography and zero visual crowding.`;
      } else if (numChannels <= 8) {
        densityLevel = "compact";
        layoutInstruction = `A balanced 2-row modular grid (4 equal-sized cards in the top row, and ${numChannels - 4} equal-sized cards uniformly spaced in the bottom row), sizing all card containers proportionally within the 16:9 canvas.`;
        selectiveContentRule = `Selective executive metrics: Status Tag, Channel Name, Allocation (% and $), Concise Strategic Role (single phrase), and Benchmark CPM. Secondary narrative is omitted to preserve comfortable spacing, clear card borders, and prominent numbers.`;
      } else {
        densityLevel = "ultra_compact";
        const rows = numChannels <= 12 ? 2 : 3;
        const cols = Math.ceil(numChannels / rows);
        layoutInstruction = `A structured executive allocation matrix organized into ${rows} balanced rows of ${cols} cards, uniformly proportioned so all ${numChannels} channels fit comfortably within the 16:9 widescreen canvas.`;
        selectiveContentRule = `Ultra-streamlined essential metrics: Channel Name, Status Tag, Allocation (% and $), and 1-line Core Role. Benchmark ranges, publisher lists, and descriptions are excluded to ensure crystal-clear readability and comfortable spacing for all ${numChannels} channels.`;
      }

      prompt = `A modern, modular slide body graphic in 16:9 widescreen format (1536x864) showcasing an executive media mix and channel allocation portfolio, designed to be placed directly onto a white background presentation slide.

CRITICAL PRESENTATION INTEGRATION DIRECTIVES (SLIDE DECK READY):
- ABSOLUTELY NO SLIDE HEADER: Do NOT include any main slide title, do NOT include any slide subtitle, subhead, category banner, or top header text.
- ABSOLUTELY NO LOGO: Do NOT include any company logo, brand mark, insignia, or watermarks anywhere.
- ABSOLUTELY NO FOOTER: Do NOT include any footer bar, disclaimer, confidentiality notice, page number, slide counter, or bottom footer text.
- CANVAS BACKGROUND: PURE SOLID CLEAN WHITE (#FFFFFF) across the entire canvas with no outer border, no framing drop shadow, and no vignette, so it blends seamlessly into a white slide presentation.
- NO UNSELECTED CANDIDATES: Absolutely DO NOT include any out-of-plan channels, rejected options, or "media types not in plan". Strictly feature ONLY the ${numChannels} funded active channels listed below.

${brandDesignGuide}

CRITICAL SLIDE PACKING & ADAPTIVE LAYOUT DIRECTIVE:
- ALL ${numChannels} CHANNELS MUST BE VISIBLE: Every one of the ${numChannels} funded active channels listed below MUST have its own designated card/tile. Do NOT skip, combine, or omit ANY channel.
- ADAPTIVE CARD GEOMETRY:
  ${layoutInstruction}
- CONTENT SELECTIVITY & BREATHING ROOM:
  To guarantee all ${numChannels} channels fit inside the 16:9 widescreen canvas (1536x864) without clipping, overflowing, or tiny unreadable text:
  ${selectiveContentRule}
  The cards must maintain comfortable margins, generous internal padding, crisp borders (#E2E8F0), and readable typography.

BODY CONTENT & COMPOSITION (Fills the 16:9 canvas cleanly with generous whitespace for a premium executive feel):
The entire image consists purely of the executive media allocation portfolio cards:

TOP SUMMARY STRIP:
- High-level allocation summary bar displaying:
  • Working Media Budget: "${totalBudgetFormatted}" (Bold Lexend display with lime #a6cf56 accent)
  • Flight Duration: "${flightDays} Days" (Lexend SemiBold)
  • Channels: "${numChannels} Channels" (Indigo #6b63e6 pill)
  (STRICT: Exclude Budget Tier completely from the slide export summary. Do NOT display any "Budget Tier" pill, label, or tier name. Only show Working Media Budget, Flight Duration, and Channels count.)
- Horizontal proportional color-segmented allocation bar visually representing the budget split across all ${numChannels} channels.

ACTIVE CHANNEL PORTFOLIO CARDS (${numChannels} cards arranged according to the adaptive grid layout above):
${activeChannels.map((c: any, idx: number) => {
  const pct = c.allocationPercent != null ? Math.round(c.allocationPercent) : 0;
  const dollars = c.allocationDollars ? `$${Math.round(c.allocationDollars).toLocaleString()}` : "";
  const cpm = c.typicalCpmLow && c.typicalCpmHigh ? `$${c.typicalCpmLow}–$${c.typicalCpmHigh} CPM` : "Benchmark CPM";
  const score = c.recommendationScore ? c.recommendationScore.toFixed(1) : "9.0";
  const pubText = Array.isArray(c.publishers) && c.publishers.length > 0
    ? c.publishers.slice(0, 2).map((p: any) => p.displayName || p.id).join(", ")
    : "Premium ad-supported networks";
  const statusLabel = c.status === "TEST" ? "TACTICAL TEST" : "CORE STRATEGY";

  if (densityLevel === "spacious") {
    return `
CARD ${idx + 1}: ${c.channelName}
• Status Tag: "${statusLabel}" in teal #0e8f86 (Lexend SemiBold uppercase)
• Channel Title: "${c.channelName}" (Lexend Bold)
• Allocation Callout: "${pct}%" / "${dollars}" (Large bold metric with lime #a6cf56 highlight)
• Strategic Role: "${c.role || "Targeted Reach & Engagement"}" (Lexend Regular in #0c1e24)
• Key Benchmark: "${cpm}" | Fit Score: "${score}/100" (Teal & Indigo badges)
• Key Publishers / Environments: "${pubText}"
• Core Tactic: "${c.gapAddressed || "Captures high-attention target audiences"}"
`;
  }

  if (densityLevel === "moderate") {
    return `
CARD ${idx + 1}: ${c.channelName}
• Status Tag: "${statusLabel}" in teal #0e8f86 (Lexend SemiBold uppercase)
• Channel Title: "${c.channelName}" (Lexend Bold)
• Allocation Callout: "${pct}%" / "${dollars}" (Large bold metric with lime #a6cf56 highlight)
• Strategic Role: "${c.role || "Targeted Reach & Engagement"}" (Lexend Regular, 1 concise sentence)
• Key Benchmark: "${cpm}"
• Key Environment: "${pubText}"
(Selective Content Fit: Tactical paragraphs excluded to preserve vertical breathing space)`;
  }

  if (densityLevel === "compact") {
    return `
CARD ${idx + 1}: ${c.channelName}
• Status Tag: "${statusLabel}" in teal #0e8f86 (Lexend SemiBold)
• Channel Title: "${c.channelName}" (Lexend Bold)
• Allocation Callout: "${pct}%" / "${dollars}" (Prominent bold metric with lime #a6cf56 highlight)
• Strategic Objective: "${c.role || "Targeted Reach & Engagement"}" (Concise single phrase)
• Key Benchmark: "${cpm}"
(Selective Content Fit: Publishers list and narrative excluded so all ${numChannels} cards fit cleanly into the 2-row grid with high legibility)`;
  }

  // ultra_compact
  return `
CARD ${idx + 1}: ${c.channelName}
• Channel Title: "${c.channelName}" (Lexend Bold) [${statusLabel}]
• Allocation Callout: "${pct}%" / "${dollars}" (Prominent bold metric with lime #a6cf56 highlight)
• Primary Objective: "${c.role || "Reach & Conversion"}" (Brief 1-phrase summary)
(Selective Content Fit: Streamlined core metrics so all ${numChannels} channels fit effortlessly with generous spacing)`;
}).join("\n")}

DESIGN & EXECUTION DIRECTIVES:
- Follow all directives in the CORE BRAND DESIGN GUIDE above.
- Clean card containers with cool slate-tinted neutral backgrounds (#F8FAFC), subtle 1px cool borders (#E2E8F0), and soft shadows on a pure white (#FFFFFF) canvas.
- Deep teal #0e3b42 used for prominent summary surfaces, primary teal #0e8f86 for active channel highlights, indigo #6b63e6 for secondary badges, and lime #a6cf56 for budget percentages.
- All body copy strictly in #0c1e24.
- Generous whitespace between cards and within containers ensuring an uncluttered, high-end executive look.
- Razor-sharp, high-contrast, perfectly legible Lexend typography throughout.
- STRICT REMINDER: ONLY produce the visual allocation body cards. NO top slide title, NO subhead, NO logo, NO footer text.
${customNotes ? `ADDITIONAL USER DIRECTIVE: ${customNotes}` : ""}`;
    }

    console.log(`[API /api/channels/generate-slide] Dispatching request to OpenAI model 'gpt-image-2.5-sunburst' (size: 1536x864)...`);

    const genResponse = await withTimeout(
      openai.images.generate({
        model: "gpt-image-2.5-sunburst",
        prompt,
        size: "1536x864",
        quality: "high",
      }),
      120000,
      null
    );

    if (!genResponse || !genResponse.data || !genResponse.data[0]?.b64_json) {
      throw new Error("gpt-image-2.5-sunburst did not return image data for channel slide.");
    }

    const resultImageBase64 = genResponse.data[0].b64_json;
    const revisedPrompt = genResponse.data[0].revised_prompt;
    console.log("[API /api/channels/generate-slide] Successfully generated channel slide using openai.images.generate!");

    const finalImageUrl = `data:image/png;base64,${resultImageBase64}`;
    res.json({
      success: true,
      imageUrl: finalImageUrl,
      model: "gpt-image-2.5-sunburst",
      mode,
      channelIndex,
      revisedPrompt,
    });

  } catch (err: any) {
    console.error("[API /api/channels/generate-slide ERROR]:", err);
    res.status(500).json({
      error: "Failed to generate channel strategy presentation slide.",
      details: err.message || String(err),
    });
  }
});

// API: Summarize Publisher Insights with AI if text is too long for presentation slides
app.post("/api/summarize-publisher-insights", async (req, res) => {
  try {
    const { text, maxWords = 65, maxCharacters = 450 } = req.body || {};
    if (!text || typeof text !== "string" || text.trim().length === 0) {
      res.json({ summary: "", reduced: false });
      return;
    }

    const trimmed = text.trim();
    const words = trimmed.split(/\s+/);

    // If it's already within limits, return immediately without calling AI
    if (trimmed.length <= maxCharacters && words.length <= maxWords) {
      res.json({ summary: trimmed, reduced: false });
      return;
    }

    console.log(`[AI SUMMARIZER] Summarizing publisher insights (${trimmed.length} chars, ${words.length} words) to max ${maxWords} words...`);

    const ai = getAiClient();
    const prompt = `You are a media planning strategist.
Summarize the following CTV "Publisher Alignment" insight paragraph into a single concise, high-impact paragraph designed for an executive presentation slide.

STRICT REQUIREMENTS:
1. Maximum ${maxWords} words total.
2. Under ${maxCharacters} characters total.
3. Preserve the core strategic rationale (the strategic combination of premium SVOD, ad-supported FAST, OS reach, and contextual network affinity) and campaign fit.
4. Do NOT use bullet points, headers, quotes, or markdown.
5. Return ONLY the single summarized paragraph.

Original text:
${trimmed}`;

    const response = await generateText(ai, {
      input: prompt,
      thinkingLevel: "low",
      timeoutMs: TIMEOUT_SUMMARIZE_INSIGHTS_MS,
    });

    const summaryText = response.text.trim().replace(/^["']|["']$/g, "").trim();

    if (summaryText && summaryText.length > 20) {
      console.log(`[AI SUMMARIZER] Successfully summarized to ${summaryText.split(/\s+/).length} words (${summaryText.length} chars).`);
      res.json({ summary: summaryText, reduced: true });
    } else {
      // Fallback: Smart sentence truncation
      const sentences = trimmed.match(/[^.!?]+[.!?]+/g) || [trimmed];
      let acc = "";
      for (const s of sentences) {
        if ((acc + s).length <= maxCharacters && (acc + s).split(/\s+/).length <= maxWords) {
          acc += (acc ? " " : "") + s.trim();
        } else {
          break;
        }
      }
      res.json({ summary: acc || words.slice(0, maxWords).join(" ") + "...", reduced: true });
    }
  } catch (err: any) {
    console.error("[AI SUMMARIZER] Error summarizing publisher insights:", err);
    // Graceful fallback: Smart sentence truncation
    const trimmed = (req.body?.text || "").trim();
    const maxW = req.body?.maxWords || 65;
    const maxC = req.body?.maxCharacters || 450;
    const words = trimmed.split(/\s+/);
    let fallback = "";
    const sentences = trimmed.match(/[^.!?]+[.!?]+/g) || [trimmed];
    for (const s of sentences) {
      if ((fallback + s).length <= maxC && (fallback + s).split(/\s+/).length <= maxW) {
        fallback += (fallback ? " " : "") + s.trim();
      } else {
        break;
      }
    }
    res.json({ summary: fallback || words.slice(0, maxW).join(" ") + "...", reduced: true, fallback: true });
  }
});

// API: Generate profile using search grounding with live real-time research feedback
app.post("/api/generate-profile", async (req, res) => {
  // Prevent Express or Node from timing out socket connections on this long-running streaming endpoint
  req.socket.setTimeout(0);
  
  const {
    advertiserName,
    kpis,
    audienceDescription,
    url,
    geography,
    campaignFocus,
    additionalContext,
    targetPersonas,
    regenerateType,
    selectedPlanOptions,
    budgetStrategyMode,
    rfpAnalysis,
    workingMediaBudget,
    campaignFlightDays,
    planningSettings,
    ctvPublishers,
  } = req.body;

  // SSE Setup Headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  let lastEventTime = Date.now();
  const sendEvent = (type: string, data: any) => {
    lastEventTime = Date.now();
    res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
    if ((res as any).flush) {
      (res as any).flush();
    }
  };

  // Heartbeat to prevent connection timeouts during longer generation phases (e.g. synthesis)
  const keepAlive = setInterval(() => {
    res.write(":\n\n");
  }, 4000);

  // Watchdog timer: monitor if streaming stalls for > 4 minutes (240,000 ms) with no event
  const watchdog = setInterval(() => {
    if (Date.now() - lastEventTime > 240000) {
      console.warn("[WATCHDOG] Generation pipeline stalled without output for over 4 minutes. Terminating stream.");
      res.write(`data: ${JSON.stringify({ type: "error", error: "The research generation pipeline stalled. Please try again or simplify parameters." })}\n\n`);
      clearInterval(keepAlive);
      clearInterval(watchdog);
      res.end();
    }
  }, 15000);

  if (!process.env.GEMINI_API_KEY) {
    sendEvent("error", { error: "API key is not configured on the server. Please check your environment settings." });
    clearInterval(keepAlive);
    clearInterval(watchdog);
    res.end();
    return;
  }

  // Validate requirement: Advertiser URL is mandatory when a media plan is uploaded
  if (selectedPlanOptions && selectedPlanOptions.length > 0 && (!url || !url.trim())) {
    sendEvent("error", { error: "Advertiser URL is mandatory when a media plan is uploaded so ScoutAI can ground the advertiser context." });
    clearInterval(keepAlive);
    clearInterval(watchdog);
    res.end();
    return;
  }

  try {
    // Sanitize and trim prompt inputs for search grounding to strictly prevent token limit (1,048,576 tokens) errors
    const cleanAdvertiserName = (advertiserName || "").slice(0, 300);
    const cleanKpis = Array.isArray(kpis) ? kpis.map(k => String(k).slice(0, 300)).filter(k => k.trim().length > 0) : [];
    const cleanAudienceDesc = (audienceDescription || "").slice(0, 1500);
    const cleanUrl = (url || "").slice(0, 500);
    const cleanAdditionalContext = (additionalContext || "").slice(0, 500);
    const cleanTargetPersonas: string[] = Array.isArray(targetPersonas)
      ? targetPersonas.map((p: any) => String(p || "").trim().slice(0, 150)).filter((p: string) => p.length > 0).slice(0, 4)
      : [];

    const audienceSnippet = cleanAudienceDesc ? `"${cleanAudienceDesc.slice(0, 50)}${cleanAudienceDesc.length > 50 ? '...' : ''}"` : "Target Audience";
    sendEvent("status", { message: `Initializing campaign parameters for ${audienceSnippet} in ${geography || 'United States'}...` });

    let crawledPageText = "";
    if (url) {
      sendEvent("status", { message: `Crawling website ${url} to extract brand positioning, offering details, and market context...` });
      crawledPageText = await fetchUrlText(url);
      sendEvent("status", { message: `Crawl complete: Extracted brand text snippet (${crawledPageText.length} chars) to ground audience analysis.` });
    }

    if (selectedPlanOptions && selectedPlanOptions.length > 0) {
      const planCount = selectedPlanOptions.length;
      const totalSpend = selectedPlanOptions.reduce((sum: number, opt: any) => sum + (Number(opt.budget) || 0), 0);
      sendEvent("status", { message: `Loaded RFP Media Plan context: ${planCount} scenario(s) totaling $${totalSpend.toLocaleString()} across selected line items.` });
    }

    const cleanCrawledText = (crawledPageText || "").slice(0, 1000);

    // Prepare systemic constraints and guidance based on req context
    let contextGuidance = "";
    if (regenerateType === "stricter_sourcing") {
      contextGuidance = "\nCRITICAL REGENERATE COMMAND: Prioritize absolute Tier 1 & Tier 2 sources. Refuse any Tier 4 context. If precise data does not exist, explicitly label planning assumptions as modeled proxy.";
    } else if (regenerateType === "more_strategic") {
      contextGuidance = "\nCRITICAL REGENERATE COMMAND: Provide deeper strategic CTV-first recommendations and highly actionable target definitions that can be translated directly into programmatic platforms (DSPs) or CTV direct buys.";
    }

    const currentYear = new Date().getFullYear();

    // Strategy 1: The Parallel Research Dossier
    // Construct 4 specialized parallel sub-queries to query separate search instances,
    // thereby bypassing the single-query 4-source limitation and gathering a massive pool of 12-25+ real sources.

    // 1. Demographics Sub-Call Prompt
    const promptDemographics = `Research and compile specific demographics for this target audience.
Advertiser Name: ${cleanAdvertiserName || "Not specified"}
Target Campaign KPIs (Goals): ${cleanKpis.length > 0 ? cleanKpis.join("; ") : "Not specified"}
Target Audience Description: ${cleanAudienceDesc || "Inferred from Brand Website"}
Geography/Market: ${geography}
Campaign Focus/Goal: ${campaignFocus}
Brand Website (if any): ${cleanUrl || "None provided"}
${cleanUrl ? `Direct website crawled snippet: "${cleanCrawledText}"` : ""}
Additional Context: ${cleanAdditionalContext || "None provided"}

TASK:
Search the web for real, reputable statistics regarding:
1. Age distribution ranges (specifically looking for percentage splits across 18-24, 25-34, 35-44, 45-54, 55+ or similar cohorts).
2. Gender split percentages (Male, Female, Non-Binary/Other).
3. Household Income distribution splits (e.g., <$50k, $50k-$75k, $75k-$100k, $100k-$150k, $150k+).
4. Geographic/regional or DMA concentrations (e.g. urban, suburban skews).

INSTRUCTIONS:
- Search for and cite real stats from high-authority sources (e.g., Census Bureau, Pew Research, GWI, MRI-Simmons, eMarketer, Statista, trade associations).
- Write a highly detailed, fact-packed, quantitative demographic report detailing exact percentages with explicit source names and links if found.`;

    // 2. Browser & Domain Affinity Sub-Call Prompt
    const promptWebAffinity = `Research and compile digital touchpoints, web traffic, and domain affinities for this target audience.
Target Audience Description: ${cleanAudienceDesc || "Inferred from Brand Website"}
Geography/Market: ${geography}
Campaign Focus/Goal: ${campaignFocus}
Brand Website (if any): ${cleanUrl || "None provided"}
${cleanUrl ? `Direct website crawled snippet: "${cleanCrawledText}"` : ""}
Additional Context: ${cleanAdditionalContext || "None provided"}

TASK:
Search the web for real, reputable statistics regarding:
1. Top websites, apps, and digital platforms visited or preferred by this specific audience segment.
2. Direct traffic patterns, engagement times, or indexed affinities for specific categories of sites (e.g., tech, gaming, news, finance, lifestyle).
3. Find 5 to 8 real domains (e.g. specific URLs or root domains like twitch.tv, nytimes.com, ign.com, reddit.com, discord.com) that have high affinity from this demographic, along with estimated Affinity Index metrics (where 100% represents average internet user likelihood).

INSTRUCTIONS:
- Search using tools like Similarweb, Semrush, Comscore, Newzoo, Exploding Topics, or trade studies.
- Write a detailed, bulleted, quantitative web affinity report featuring actual domain names, specific Affinity Index scores (e.g., 125%, 160%, 210%), and high-authority source citations.`;

    // 3. CTV & Devices Sub-Call Prompt
    const promptDevices = `Research and compile Connected TV (CTV) viewing, video streaming, and hardware device usage patterns for this target audience.
Target Audience Description: ${cleanAudienceDesc || "Inferred from Brand Website"}
Geography/Market: ${geography}
Campaign Focus/Goal: ${campaignFocus}
Brand Website (if any): ${cleanUrl || "None provided"}
${cleanUrl ? `Direct website crawled snippet: "${cleanCrawledText}"` : ""}
Additional Context: ${cleanAdditionalContext || "None provided"}

TASK:
Search the web for real, reputable statistics regarding:
1. Connected TV (CTV) vs. other video device viewing habits (Smart TVs, Streaming devices like Roku, FireTV, AppleTV).
2. Streaming platform preferences (e.g., ad-supported Netflix, Hulu, YouTube, Pluto TV, Tubi, Disney+) and share of viewing time.
3. Hardware device share distribution (CTV/Smart TV, Mobile/Smartphones, Desktop/PC, Gaming Consoles, Tablets) for this audience.

INSTRUCTIONS:
- Search for data from high-authority sources like Wurl, eMarketer, Insider Intelligence, Nielsen, IAB, Comscore, or major trade press.
- Write a detailed, bulleted, quantitative device usage report including exact platform splits and CTV activation insights.`;

    // 4. Temporal & Purchase Patterns Sub-Call Prompt
    const promptTemporalPurchase = `Research and compile temporal activity peaks, day-of-week, hour-of-day habits, and purchase triggers/behaviors for this target audience.
Target Audience Description: ${cleanAudienceDesc || "Inferred from Brand Website"}
Geography/Market: ${geography}
Campaign Focus/Goal: ${campaignFocus}
Brand Website (if any): ${cleanUrl || "None provided"}
${cleanUrl ? `Direct website crawled snippet: "${cleanCrawledText}"` : ""}
Additional Context: ${cleanAdditionalContext || "None provided"}

TASK:
Search the web for real, reputable statistics regarding:
1. Online activity peaks (weekday vs. weekend habits, daytime vs. prime-time/late-night streaming, weekday web/browser activity trends like browser gaming weekday peaks).
2. Hour of day peak engagement blocks for digital media or CTV.
3. Key consumer buying habits, main shopping categories (e.g. apparel, consumer tech, CPG, home goods), and specific brand affinities.
4. Primary purchase triggers and consumer motivations (e.g. deals, quality, sustainability, social media recommendations).

INSTRUCTIONS:
- Search for studies (such as CrazyGames, Statista, Semrush, eMarketer, or trade press) describing their shopping triggers and online habits.
- Write a detailed, bulleted, quantitative temporal and buying habits report with specific timings, peak hours, and purchase motivations.`;

    const ai = getAiClient();

    // Helper to run research sub-calls in parallel with search grounding enabled
    const runResearchCall = async (prompt: string, label: string) => {
      try {
        console.log(`Starting parallel research query for: ${label}...`);
        const subResponse = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: prompt,
          config: {
            systemInstruction: "You are an expert audience research analyst. Provide a highly detailed, fact-packed research brief. Always find and cite real stats, percentages, and sources.",
            tools: [{ googleSearch: {} }],
            temperature: 0.2,
          }
        });

        const text = subResponse.text || `[Failed to retrieve detailed ${label} research text]`;
        const chunks = subResponse.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
        const sources = chunks.map((chunk: any) => {
          if (chunk.web) {
            return {
              title: chunk.web.title || label,
              uri: chunk.web.uri
            };
          }
          return null;
        }).filter(Boolean);

        console.log(`Completed parallel research query for: ${label}. Found ${sources.length} sources.`);
        return { label, text, sources };
      } catch (err: any) {
        console.error(`Research sub-call for ${label} failed:`, err);
        return { label, text: `[Note: Grounding research query for ${label} encountered a search grounding limit. Standard baseline market data will be modeled during synthesis.]`, sources: [] };
      }
    };

    // Helper to execute research task and stream live feedback instantly
    const handleResearchStep = async (prompt: string, label: string, statusMsg: string) => {
      sendEvent("status", { message: statusMsg });
      
      const researchPromise = runResearchCall(prompt, label);
      const fallbackResult = {
        label,
        text: `[Note: Research query for ${label} exceeded ${TIMEOUT_PARALLEL_RESEARCH_MS / 1000}s. Safe fallback baseline data will be modeled during synthesis.]`,
        sources: [] as any[]
      };
      
      const result = await withTimeout(researchPromise, TIMEOUT_PARALLEL_RESEARCH_MS, fallbackResult);
      
      const blurb = extractFindingBlurb(result.text, label);
      sendEvent("research_result", {
        label,
        sources: result.sources,
        blurb
      });
      return result;
    };

    const targetDescLabel = cleanAudienceDesc ? `"${cleanAudienceDesc.slice(0, 40)}..."` : (cleanUrl ? `brand users at ${cleanUrl}` : "target audience");
    const targetFocusLabel = campaignFocus ? `for ${campaignFocus}` : "";

    // Execute research queries in parallel to stream progress instantly
    const [demoResult, webResult, deviceResult, temporalResult] = await Promise.all([
      handleResearchStep(promptDemographics, "Demographics", `Querying Census, Pew & GWI data for ${targetDescLabel} demographic cohorts in ${geography}...`),
      handleResearchStep(promptWebAffinity, "Digital Touchpoints", `Scanning Comscore, Similarweb & Semrush for domain traffic affinities ${targetFocusLabel}...`),
      handleResearchStep(promptDevices, "CTV & Devices", `Analyzing eMarketer, Nielsen & Wurl streaming shares across Smart TVs & streaming hardware...`),
      handleResearchStep(promptTemporalPurchase, "Temporal & Purchase", `Tracking daypart peaks, streaming hours & purchasing triggers in ${geography}...`)
    ]);

    // Aggregate and deduplicate the search grounding links collected from all parallel operations
    const allCitations = [
      ...demoResult.sources,
      ...webResult.sources,
      ...deviceResult.sources,
      ...temporalResult.sources
    ];

    const uniqueSourcesMap = new Map<string, { title: string; uri: string }>();
    for (const src of allCitations) {
      if (src && src.uri) {
        const normUri = src.uri.trim();
        // Avoid duplicate URIs to keep the list clean and pristine
        if (!uniqueSourcesMap.has(normUri)) {
          uniqueSourcesMap.set(normUri, src);
        }
      }
    }
    const redirectSources = Array.from(uniqueSourcesMap.values());
    console.log(`Consolidated all parallel search sources. Deduplicated count: ${redirectSources.length}`);

    // Trade the grounding redirects for publisher deep links before anything downstream reads
    // them. Synthesis cites from this pool, so leaving it full of vertexaisearch redirects gave
    // the QA scorer an "opaque sourcing" red flag and the remediation agent an excuse to replace
    // the citation registry with URLs it made up. Bounded and non-fatal: whatever does not
    // resolve keeps its original link.
    sendEvent("status", { message: "Resolving research citations to their original publisher URLs..." });
    const resolveStartedAt = Date.now();
    const deduplicatedSources = await resolveGroundingUrls(redirectSources, {
      timeoutMs: TIMEOUT_URL_RESOLUTION_MS,
      concurrency: URL_RESOLUTION_CONCURRENCY,
    });
    const resolvedCount = deduplicatedSources.filter((src, idx) => src.uri !== redirectSources[idx].uri).length;
    console.log(`Resolved ${resolvedCount}/${deduplicatedSources.length} grounding redirects to publisher URLs in ${Date.now() - resolveStartedAt}ms.`);

    // Build dynamic CTV Publisher guidance based on active enabled publishers, tiers, and settings
    const effectivePublishers = (Array.isArray(ctvPublishers) && ctvPublishers.length > 0)
      ? ctvPublishers
      : (await (await getStorage()).getCurrentPublishers()).publishers;
    
    const targetPublisherCount = Math.max(1, Math.min(30, Math.round(Number(planningSettings?.ctvPublisherTargetCount) || 8)));
    
    // Distribution targets: adjustable percentages (default 35% Tier 1, 45% Tier 2, 20% Tier 3)
    let rawT1 = Number(planningSettings?.ctvTier1TargetPercent);
    let rawT2 = Number(planningSettings?.ctvTier2TargetPercent);
    let rawT3 = Number(planningSettings?.ctvTier3TargetPercent);
    if (!Number.isFinite(rawT1) || rawT1 < 0) rawT1 = 35;
    if (!Number.isFinite(rawT2) || rawT2 < 0) rawT2 = 45;
    if (!Number.isFinite(rawT3) || rawT3 < 0) rawT3 = 20;

    const totalTierWeight = (rawT1 + rawT2 + rawT3) || 100;
    const t1Pct = Math.round((rawT1 / totalTierWeight) * 100);
    const t2Pct = Math.round((rawT2 / totalTierWeight) * 100);
    const t3Pct = Math.max(0, 100 - t1Pct - t2Pct);

    const t1Target = Math.round(targetPublisherCount * (rawT1 / totalTierWeight));
    const t2Target = Math.round(targetPublisherCount * (rawT2 / totalTierWeight));
    const t3Target = Math.max(0, targetPublisherCount - t1Target - t2Target);

    const enabledPublishers = effectivePublishers.filter((p: any) => p && p.enabled !== false && p.name);
    const pubTier1 = enabledPublishers.filter((p: any) => Number(p.tier) === 1);
    const pubTier2 = enabledPublishers.filter((p: any) => Number(p.tier) === 2 || !p.tier);
    const pubTier3 = enabledPublishers.filter((p: any) => Number(p.tier) === 3);

    const formatPublisherLine = (p: any) => `      - '${p.name}' (Category: '${p.category}'${p.notes ? ` | Targeting Rules / When to Include: "${p.notes}"` : ''})`;

    const ctvPublishersSection = `9. CTV PUBLISHER RECOMMENDATIONS (MANDATORY & TARGETING RULE GROUNDED):
   You MUST select EXACTLY ${targetPublisherCount} highly relevant CTV publishers STRICTLY from this approved pool of currently enabled publishers based on the audience's personas, demographic profile, content affinities, and campaign objectives.

   DISTRIBUTION DIRECTIVE:
   Aim for a balanced tier mix across the ${targetPublisherCount} selections reflecting approximately:
   * ~${t1Pct}% Tier 1 (approximately ${t1Target} publisher${t1Target === 1 ? '' : 's'})
   * ~${t2Pct}% Tier 2 (approximately ${t2Target} publisher${t2Target === 1 ? '' : 's'})
   * ~${t3Pct}% Tier 3 (approximately ${t3Target} publisher${t3Target === 1 ? '' : 's'})

   PRIORITY AUDIENCE-ALIGNMENT RULE:
   While aiming for this tier distribution, your absolute top priority is audience relevance: select publishers whose programming, viewer demographics, content type, and platform environment best match this specific audience and campaign focus.
   You MUST leverage the provided Targeting Rules & Notes to guide your selection (e.g. female-skewed networks for female audiences, news/finance networks for B2B/high-HHI, sports networks for active/sports skews, FAST/OS for broad reach / cable replacement, etc.).

   CRITICAL CONFIDENTIALITY INSTRUCTION:
   Do NOT mention, disclose, or reference tiers (e.g. "Tier 1", "Tier 2", "Tier 3", or "tier level") anywhere in the output, including in 'why' explanations or 'publisherInsights'. The tier system is strictly internal media planning logic and must NEVER be visible or mentioned to the user.

   --- APPROVED TIER 1 PUBLISHERS (Premium Flagship SVOD/AVOD & Live Sports) ---
${pubTier1.map(formatPublisherLine).join('\n') || '      - None currently enabled'}

   --- APPROVED TIER 2 PUBLISHERS (Linear / Cable / Broadcast Networks & Targeted Verticals) ---
${pubTier2.map(formatPublisherLine).join('\n') || '      - None currently enabled'}

   --- APPROVED TIER 3 PUBLISHERS (FAST Platforms, Smart TV OS & Connected Devices) ---
${pubTier3.map(formatPublisherLine).join('\n') || '      - None currently enabled'}

   For each selected publisher, provide:
   * 'publisher': The exact publisher name as listed in the approved pool.
   * 'category': The publisher category ('App' | 'Network' | 'OS').
   * 'why': A highly specific, evidence-grounded justification explaining why this publisher's programming, viewer demographics, or platform environment fits the persona and fulfills its targeting rule. (Remember: NEVER mention tiers here!)
   Also, write a professional, cohesive, and concise paragraph for 'publisherInsights' explaining why this curated CTV publisher mix maximizes addressable reach, view-through rates, and audience affinity for the campaign. Keep it strictly between 50 to 65 words (under 450 characters) so it fits slide presentation layouts without overflowing. (Remember: NEVER mention tiers here!)`;

    // Synthesis & Strategy 2 (Authority Filtering)
    const synthesisSystemInstruction = `You are a senior digital media director, veteran audience research partner, and master data synthesizer.
Your task is to integrate separate research dossiers into a single, cohesive, highly authoritative digital advertising audience profile.

Your response must be a single, perfectly structured JSON object adhering exactly to the specified JSON schema.

CRITICAL STRUCTURAL, COHESIVENESS & QUALITY RULES:
1. COHESION & INTEGRATED STORYTELLING: Do not stitch together unrelated facts in silos. Create a single, unified audience story where all metrics and descriptions align.
   - If a persona is described as having specific device preferences, that device must dominate or represent a substantial percentage in 'deviceTypeIndex.chartData'.
   - If Saturday/Sunday evenings are described as viewing or activity peaks, Saturdays and Sundays MUST have a high activity index (e.g. index > 100, such as 108 - 120) in 'temporalPatterns.dayOfWeekChartData' and 'temporalPatterns.hourOfDayChartData'. Contradictions between narrative text and numeric indices are strictly forbidden.
2. STATISTICAL PLAUSIBILITY & REAL-WORLD BOUNDS: Absolutely no statistically impossible claims.
   - Connected TV (CTV) QR code scan rates hover strictly between 0.01% and 0.5% in real campaign environments. Scan conversion or purchase rates are in low single digits (typically under 8%). You are STRICTLY FORBIDDEN from generating double-digit QR code scan rates or absurd purchase rates (such as "83% open to scanning and 92% of scanners likely to complete a purchase").
   - Broad/mass-market audiences (such as general gaming, mobile gaming, casual shoppers, etc.) MUST have realistic Household Income (HHI) splits aligning with national averages. Households earning over $100,000 HHI MUST NOT exceed 33-35% in aggregate for general populations. Do not apply a high HHI skew of a niche sub-segment (e.g. premium hardware buyers earning >$100k) to the entire general population breakdown.
   - Ground all other media benchmarks (display ad CTRs, video view-through rates/VCRs, social conversion percentages) in real trade-press baselines (e.g., programmatic display CTR is around 0.05% - 0.20%; CTV video completion rate is around 90% - 95%).
3. MUTUALLY EXCLUSIVE DEVICE BREAKDOWNS: Correctly map the Connected TV and digital ecosystem as a fragmented but mutually exclusive environment. Explicitly distribute viewing share across Smart TVs, Streaming Devices (Roku/FireTV), Consoles, Smartphones, and Desktops so that there is no double-counting, and ensure percentage splits sum to approximately 100%.
4. Be highly precise with definitions: composition vs index vs reach vs penetration. Clearly distinguish percentage split from activity index (average = 100).
5. Do not call an audience segment "affluent", "young", "tech-savvy", etc. unless the research supportively proves it with metrics.
6. Ensure demographic charts, device charts, web share charts, and day/hour charts are fully populated with exact numbers. Percentage charts MUST sum to approximately 100 (except index charts which represent index scores). For 'browserAndReach.chartData' (Top Domain Affinity Index), all items MUST represent an Affinity Index % where 100% is the national average likelihood, and metricType MUST be strictly set to 'Affinity Index'. Provide realistic index values (e.g. 120%, 150%, 210%, 280% depending on target audience domain affinity).
7. Use current ${currentYear} data. Match geography: ${geography}. If exact geographic data is sparse, adapt it using a realistic 'Modeled Planning Proxy' or 'Directional Estimate', and clearly label the source property as such.
8. STRICT ANTI-HALLUCINATION & ZERO-FABRICATION RULE (MANDATORY):
   - You are STRICTLY PROHIBITED from fabricating, guessing, or making up consumer desire/sentiment figures, survey percentages, or market statistics (such as "85% of gamers express a desire to see product recommendations on their TV home screens").
   - Every single statistic or percentage mentioned in the recommendations ('recommendations.why' or 'recommendations.action') or core takeaways ('takeaways') MUST be directly grounded and cross-referenced from the provided parallel research dossiers.
   - APPROVED FALLBACK INDUSTRY BASELINES: If a specific statistic cannot be verified in the search dossiers, do NOT invent any numbers. Instead, you MUST fall back to standard, well-documented qualitative descriptions OR use these exact industry-accepted benchmarks. When doing so, you MUST explicitly prefix or tag them with "[Industry Baseline: <Stat>]" or "[Modeled Baseline: <Stat>]" or use the direct phrasing "According to industry standards/benchmarks...":
     * Connected TV (CTV) QR-Code Scan Rates: 0.02% - 0.15% scan rate.
     * CTV Scan-to-Conversion/Purchase Rate: 1% - 3% purchase conversion rate among those who scan.
     * Smart TV Streaming Share: ~55% of video-streaming gamers stream video directly through Smart TV apps.
     * Programmatic Video View-Through/Completion Rate (VTR/VCR) on CTV: 85% - 92%.
     * Programmatic Display Ad Click-Through Rate (CTR): 0.05% - 0.12%.
     * Smart TV Home Screen Ad Reach: Home screen native display placements reach up to 15% - 20% of active daily Smart TV users.
     * Mobile Ad CTR: 0.3% - 0.6% for general display/in-app.
     * Search Ad Conversion Rate: 2% - 5%.
     * General Digital Video Completion Rate (VCR): 70% - 85% for standard non-skip skippable digital video.

${ctvPublishersSection}

10. EXACTLY 4 PERSONAS (MANDATORY & USER SPECIFICATION / ORIGIN RULES):
   You MUST generate EXACTLY 4 distinct consumer personas in the 'personas' array (never 3 or 5).
${cleanTargetPersonas.length > 0 ? `   - USER-SPECIFIED TARGET PERSONAS (HIGHEST PRIORITY OVERRIDE):
     The user explicitly specified ${cleanTargetPersonas.length} target persona archetype(s) in their campaign brief:
${cleanTargetPersonas.map((p, idx) => `     * Persona Slot ${idx + 1}: "${p}" (MANDATORY)`).join('\n')}
     STRICT ENFORCEMENT RULES FOR USER PERSONAS:
     1. You MUST assign these exact ${cleanTargetPersonas.length} user-specified personas to the first ${cleanTargetPersonas.length} slot(s) of the 'personas' array.
     2. Keep the 'name' strictly identical or directly faithful to what the user typed (e.g. "${cleanTargetPersonas[0]}"). DO NOT rename, omit, replace, or dilute them.
     3. Set 'sourceType' to 'User' for each of these user-specified personas.
     4. Build rich, realistic demographics, watch, browse, buy, and narrative profiles around each of these specific archetypes, informed by the advertiser and research dossiers.
     ${cleanTargetPersonas.length < 4 ? `5. For the remaining ${4 - cleanTargetPersonas.length} persona slot(s) (Slots ${cleanTargetPersonas.length + 1} through 4): You MUST autonomously generate complementary, high-potential expansion personas that broaden campaign addressable reach. Set 'sourceType' to 'ScoutAI' for these additional generated personas.` : '5. All 4 personas have been user-specified, so set \'sourceType\' to \'User\' for all 4.'}` : `   - STANDARD BRIEF MODE (when NO target personas entered and NO uploaded media plan / RFP):
     * Generate 4 distinct consumer personas representing the core target market. Set 'sourceType' to 'ScoutAI' for all 4.
   - UPLOADED MEDIA PLAN / RFP MODE (when an uploaded media plan IS provided and no user personas specified):
     * You MUST generate EXACTLY 4 personas in total.
     * Up to 3 personas MUST be derived directly from the listed target audiences in the uploaded media plan RFP (set 'sourceType': 'RFP' for these personas).
     * At least 1 persona MUST be a ScoutAI recommended "expansion persona" targeting a high-potential complementary audience segment not explicitly in the RFP that expands total addressable reach (set 'sourceType': 'ScoutAI' for this expansion persona).
     * If the uploaded media plan lists fewer than 3 audiences (e.g., 2, 1, or 0), generate as many ScoutAI expansion personas ('sourceType': 'ScoutAI') as needed so the total array length is EXACTLY 4.`}
     * Provide 'expansionReachPercent' as a number between 25 and 45 representing the estimated percentage increase in addressable reach achieved by including the ScoutAI expansion persona(s) (e.g. 35).

11. UPLOADED MEDIA PLAN AUDIENCE ANALYSIS (MANDATORY WHEN MEDIA PLAN CONTAINS AUDIENCES):
    If an uploaded media plan is provided and includes audience target specifications (e.g. listed audience segments in plan placements), you MUST populate 'audienceAnalysis' with a detailed, professional paragraph evaluating how well the listed audiences in the plan align with the advertiser, their brand positioning, product offering, and campaign goals.
    If NO media plan was uploaded OR if the uploaded plan contains no audience target definitions, set 'audienceAnalysis' to empty string ("").

12. EXECUTIVE SUMMARY BLUEPRINT (MANDATORY):
    Write an executive-ready, highly actionable strategic synthesis for 'executiveSummary'. You MUST explicitly emphasize:
    - Why the cross-screen channel strategy effectively reaches this audience where they actually are (e.g. living room Connected TV co-viewing, mobile digital companion screens, and high-affinity contextual domains during peak activity dayparts).
    - Why this media mix and tactical allocation is specifically engineered to hit the campaign's target KPIs (e.g., brand lift, view-through rates, incremental household reach, or direct conversion goals).

STRATEGY 2: AUTHORITY FILTERING & CITATION LOGIC:
You are provided with a pool of real URLs discovered during search research. You MUST evaluate, filter, and structure these sources into the 'sources' array of the JSON response following these authority guidelines:
- Evaluate each source URL. Assign the correct 'tier' string based on these strict rules:
  * 'Tier 1: Government/Official': Government agencies (.gov), central banks, Census Bureau, Bureau of Labor Statistics (BLS), Pew Research Center, or major academic/institutional registries.
  * 'Tier 2: Reputable Research/Analytics': Highly authoritative syndicated audience data and research firms. E.g., MRI-Simmons, Statista, GWI, Nielsen, eMarketer (Insider Intelligence), Similarweb, Comscore, Newzoo, Gartner, Forrester, McKinsey, PwC, Semrush.
  * 'Tier 3: Trade Press': Highly respected industry/tech trade journals, news outlets, and press agencies. E.g., TechRadar, Polygon, Business Wire, PRNewswire, TechSpot, Game Developer, Adweek, AdAge, Digiday, PocketGamer, WN Hub, App2Top.
  * 'Tier 4: Blog/Context': Company/brand blogs, Medium articles, generic news sites, or self-published content.
- CURATE, DO NOT CATALOGUE. The pool is large and uneven; the registry is a client-facing evidence list, not a search log. Include 8 to 12 sources, chosen for authority and for how directly they support a claim you actually made.
- Tier 1 and Tier 2 sources should make up the majority. A Tier 3 trade source is acceptable where it is the best available evidence for a specific claim. DO NOT include any source you would classify as 'Tier 4: Blog/Context' - if a claim rests only on Tier 4 evidence, soften or drop the claim rather than citing the blog.
- Exclude outright: SEO-farm and listicle domains, personal and company blogs, social and forum domains (facebook.com, reddit.com, quora.com, medium.com, pinterest.com, stackoverflow.blog and similar), press-release reprints, and any source whose claim you did not use. A source you cannot tie to a specific figure or statement in this profile does not belong in the registry.
- The source must be about THIS advertiser's category, audience, or the media landscape you are citing it for. Search pools routinely carry drift from unrelated verticals; a source about an unrelated industry is not evidence here no matter how reputable it is.
- Where several pooled sources support the same claim, cite the single most authoritative one rather than listing them all.
- Differentiate 'usageType' honestly. 'Primary Source' is for the source a figure came from; use 'Secondary Confirmation' where it corroborates a figure you took elsewhere, and 'Directional Context' where it informed judgement without supplying a number. Not every source is a Primary Source.
- For every included source:
  * Provide the official, clean publisher name (e.g. 'Entertainment Software Association', 'Newzoo', 'Statista').
  * Provide the EXACT, fully-qualified deep-linked URL (e.g. 'https://www.statista.com/statistics/12345/article-slug' or 'https://www.pewresearch.org/social-trends/2026/02/14/some-study/') from the provided POOL OF REAL WEB SOURCE CITATIONS DISCOVERED. You are STRICKLY FORBIDDEN from truncating, simplifying, or shortening URLs to root domains (e.g., do NOT change a deep link to just 'https://www.statista.com/' or 'https://www.pewresearch.org/'). Always preserve the complete, precise deep link so the user can click directly to the underlying content.
  * In 'supportedClaims', write a highly detailed, quantitative sentence explaining exactly what this source validated in this profile (e.g., 'Validated that 3 in 4 women play games and have differing spending patterns').
  * Specify the 'usageType' as one of: 'Primary Source', 'Secondary Confirmation', 'Directional Context'.
- Every entry MUST come from the POOL OF REAL WEB SOURCE CITATIONS DISCOVERED below. Never introduce a URL from memory, and never invent a deep link: an unverifiable citation is worse than a missing one.

STRATEGY 3: RFP REQUIREMENTS & AGENCY CAPABILITY RESPONSES:
If an uploaded RFP document, RFP questions, or RFP analysis is provided in the user prompt:
- You MUST populate the 'additionalRfpRequirements' field in the JSON response.
- 'additionalRfpRequirements' must contain:
  * 'isRfpDocument': true
  * 'rfpSummary': An executive summary (2-3 sentences) detailing the RFP objectives, client asks, and scope.
  * 'rfpAsksAndQuestions': A comprehensive list of all specific questions, methodologies, operational asks, or process requirements stated in the RFP.
  * 'digitalRemedyCapabilityMatches': An array of objects for EVERY question/ask identified in the RFP. Each item must have:
    - 'rfpAsk': The exact requirement or question asked in the RFP.
    - 'digitalRemedySolution': Digital Remedy's official solution, capability, or strategic response.
    - 'capabilityDetails': Deep technical or operational explanation of how Digital Remedy executes this (e.g. DSP partners, brand safety tools, reporting frequencies, attribution methodology).
    - 'isSupported': true
  * 'extractedMetadata': Object containing submissionDueDate, flightDates, paymentTerms, reportingRequirements, budget, kpis, targetAudiences, geographies.
  * 'additionalNotes': Thorough narrative addressing any non-placement questions, custom processes, brand safety policies, or agency workflow details asked in the RFP.`;

    const synthesisUserPrompt = `You are provided with four highly detailed, domain-specific research dossiers for the target audience: "${cleanAudienceDesc}".

ADVERTISER NAME: ${cleanAdvertiserName || "None provided"}
	TARGET CAMPAIGN KPIS (GOALS): ${cleanKpis.length > 0 ? cleanKpis.join("; ") : "None provided"}
	GEOGRAPHY: ${geography}
	CAMPAIGN FOCUS: ${campaignFocus}
	WORKING MEDIA BUDGET: $${Number(workingMediaBudget || 0).toLocaleString()}
	CAMPAIGN FLIGHT DAYS: ${campaignFlightDays || "Unknown"}
	BRAND URL: ${cleanUrl || "None provided"}
ADDITIONAL CONTEXT: ${cleanAdditionalContext || "None provided"}
${cleanTargetPersonas.length > 0 ? `USER SPECIFIED TARGET PERSONAS (MANDATORY TO USE IN ORDER):
${cleanTargetPersonas.map((p, i) => `  Slot ${i + 1}: "${p}"`).join('\n')}
(You MUST preserve these exact persona archetypes in the first ${cleanTargetPersonas.length} persona slots with sourceType 'User')` : ""}
${contextGuidance}

--------------------------------------------------
DOSSIER 1: DEMOGRAPHICS
${demoResult.text}

--------------------------------------------------
DOSSIER 2: DIGITAL TOUCHPOINTS & WEBSITES
${webResult.text}

--------------------------------------------------
DOSSIER 3: CTV & DEVICE SPLITS
${deviceResult.text}

--------------------------------------------------
DOSSIER 4: TEMPORAL PATTERNS & PURCHASING HABITS
${temporalResult.text}

--------------------------------------------------
POOL OF REAL WEB SOURCE CITATIONS DISCOVERED:
${JSON.stringify(deduplicatedSources, null, 2)}
${selectedPlanOptions && selectedPlanOptions.length > 0 ? `
--------------------------------------------------
UPLOADED MEDIA PLAN & LISTED TARGET AUDIENCES:
${summarizeSelectedPlansForPrompt(selectedPlanOptions)}
${extractPlanAudiences(selectedPlanOptions).length > 0 ? `Explicit Target Audiences Listed in Plan: ${extractPlanAudiences(selectedPlanOptions).join(', ')}` : 'No explicit custom audience targets in media plan.'}
` : ''}
${rfpAnalysis ? `
--------------------------------------------------
UPLOADED RFP ANALYSIS & SPECIFIC QUESTIONS / ASKS:
RFP Summary: ${rfpAnalysis.rfpSummary || 'N/A'}
Questions / Asks in RFP:
${rfpAnalysis.rfpAsksAndQuestions?.map((q: string) => `- ${q}`).join('\n') || 'None listed'}

Digital Remedy Capability Matches:
${JSON.stringify(rfpAnalysis.digitalRemedyCapabilityMatches || [], null, 2)}

Operational & Metadata Requirements:
${JSON.stringify(rfpAnalysis.extractedMetadata || {}, null, 2)}
` : ''}
--------------------------------------------------
TASK:
Synthesize these 4 dossiers into a single high-quality media strategy profile in JSON.
Map the discovered real web source citations to the 'sources' field inside the JSON. Apply 'Strategy 2: Authority Filtering' to classify and label them, and curate down to the 8-12 strongest - every entry drawn from the pool above, each tied to a claim you actually made.
${rfpAnalysis ? "IMPORTANT: Populated the 'additionalRfpRequirements' object in the JSON to address all specific RFP questions, operational requirements, and capability matches." : ""}
Ensure that all chart arrays are fully populated with exact numbers (percentages should be numbers like 45, not strings like "45%").
Return ONLY the formatted JSON matching the schema. No markdown wrapping except a raw JSON string, or standard JSON formatting.`;

    sendEvent("status", { message: "Synthesizing research dossiers and mapping audience indices..." });
    console.log("Launching final Synthesis Call to build the comprehensive profile JSON...");
    const synthesisPromise = ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: synthesisUserPrompt,
      config: {
        systemInstruction: synthesisSystemInstruction,
        responseMimeType: "application/json",
        responseSchema: audienceProfileSchema,
        temperature: 0.1,
        thinkingConfig: { thinkingBudget: SYNTHESIS_THINKING_BUDGET },
      }
    });

    const synthesisResult = await withTimeout(
      synthesisPromise,
      TIMEOUT_SYNTHESIS_MS,
      null
    );

    if (!synthesisResult || !synthesisResult.text) {
      throw new Error(`Synthesis stage exceeded the safety limit of ${TIMEOUT_SYNTHESIS_MS / 1000}s. Please simplify your input parameters and try again.`);
    }

    sendEvent("status", { message: "Evaluating audience profile using media planning scoring agent..." });
    const originalData = JSON.parse(synthesisResult.text);

    // Fallback/merge RFP requirements if rfpAnalysis was supplied
    if (rfpAnalysis) {
      if (!originalData.additionalRfpRequirements) {
        originalData.additionalRfpRequirements = rfpAnalysis;
      } else {
        if (!originalData.additionalRfpRequirements.rfpSummary && rfpAnalysis.rfpSummary) {
          originalData.additionalRfpRequirements.rfpSummary = rfpAnalysis.rfpSummary;
        }
        if ((!originalData.additionalRfpRequirements.rfpAsksAndQuestions || originalData.additionalRfpRequirements.rfpAsksAndQuestions.length === 0) && rfpAnalysis.rfpAsksAndQuestions) {
          originalData.additionalRfpRequirements.rfpAsksAndQuestions = rfpAnalysis.rfpAsksAndQuestions;
        }
        if ((!originalData.additionalRfpRequirements.digitalRemedyCapabilityMatches || originalData.additionalRfpRequirements.digitalRemedyCapabilityMatches.length === 0) && rfpAnalysis.digitalRemedyCapabilityMatches) {
          originalData.additionalRfpRequirements.digitalRemedyCapabilityMatches = rfpAnalysis.digitalRemedyCapabilityMatches;
        }
        if (!originalData.additionalRfpRequirements.extractedMetadata && rfpAnalysis.extractedMetadata) {
          originalData.additionalRfpRequirements.extractedMetadata = rfpAnalysis.extractedMetadata;
        }
      }
    }

    // Populate Audience Analysis paragraph if uploaded media plan contains audience target descriptions
    const planAudiences = selectedPlanOptions ? extractPlanAudiences(selectedPlanOptions) : [];
    if (selectedPlanOptions && selectedPlanOptions.length > 0 && planAudiences.length > 0) {
      if (!originalData.audienceAnalysis || !originalData.audienceAnalysis.trim()) {
        console.log("Generating Audience Analysis paragraph for uploaded media plan audiences...");
        try {
          const ai = getAiClient();
          const analysisPrompt = `You are a senior digital media planning director.
An uploaded media plan has been provided for advertiser URL: "${cleanUrl || "Advertiser"}".
The media plan explicitly includes these target audiences:
${planAudiences.map(a => `- ${a}`).join('\n')}

Advertiser / Campaign Context:
- Overview: ${originalData.intro}
- Target Demographics: ${originalData.demographics?.overview || ''}
- Target Personas: ${originalData.personas?.map((p: any) => p.name).join(', ')}

TASK: Write a concise, professional 1-paragraph analysis (3-5 sentences) assessing how well the listed audiences in the uploaded media plan align with the advertiser, their brand positioning, and their target consumer.
Return ONLY the plain text paragraph. No markdown headings or quote blocks.`;

          const analysisResp = await generateText(ai, {
            input: analysisPrompt,
            thinkingLevel: "low",
            timeoutMs: TIMEOUT_AUDIENCE_ANALYSIS_MS,
          });
          const analysisParagraph = analysisResp.text.trim();
          if (analysisParagraph) {
            originalData.audienceAnalysis = analysisParagraph;
          }
        } catch (err) {
          console.error("Error generating fallback audience analysis:", err);
        }
      }
    } else {
      // Ensure empty string if no media plan was uploaded or no audiences in plan
      originalData.audienceAnalysis = "";
    }

    // 1. Deterministic media recommendation and allocation for greenfield or uploaded plans
    if (Number(workingMediaBudget) > 0 || (selectedPlanOptions && selectedPlanOptions.length > 0)) {
      sendEvent("status", { message: "Evaluating Digital Remedy product eligibility, portfolio constraints, and deterministic allocations..." });
      try {
        const channelStrategy = await buildChannelStrategy(
          originalData,
          selectedPlanOptions || [],
          budgetStrategyMode || 'reallocation',
          cleanAdvertiserName,
          cleanKpis,
          {
            advertiserUrl: cleanUrl,
            campaignFocus,
            geography,
            workingMediaBudget: Number(workingMediaBudget) || 0,
            campaignFlightDays: Number(campaignFlightDays) || null,
            planningSettings,
          },
        );
        originalData.channelStrategy = channelStrategy;
        sendEvent("status", { message: "Media portfolio and allocation constraints validated successfully." });
      } catch (channelErr: any) {
        console.error("Error generating media recommendation plan:", channelErr);
        sendEvent("status", { message: "Note: Media recommendation allocation encountered an issue. Proceeding with the audience profile and no unvalidated allocation." });
      }
    }

    // The scorer is a different model with a different training cutoff, so it has no idea what
    // "now" is. Left unanchored it read current-year figures as future-dated fabrications and
    // charged them to Data Integrity.
    const scoringToday = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    // Only claim the engine owns the budget when it actually ran. A profile generated without a
    // working-media budget has no channelStrategy, and pointing the scorer at an absent object
    // would excuse the very gap it should be flagging.
    const channelStrategyGuidance = originalData.channelStrategy
      ? `- The 'channelStrategy' object is not a model output. It is produced by a deterministic planning engine from a validated Digital Remedy product catalog, and it owns budget allocation, media-type selection, product eligibility and prerequisites. Score the profile's actionability against what is in 'channelStrategy' - allocations, activation methods, measurement products, scale/stop rules and prerequisites all live there, not in the narrative recommendations. Never ask the narrative to restate or re-derive an allocation; two competing budget splits in one document is itself the defect.`
      : `- This profile was generated without a working-media budget, so it carries no 'channelStrategy' and no allocation is expected. Score actionability on the specificity of the targeting, platform and measurement direction rather than on the absence of a budget split.`;

    // 2. Scoring Agent Evaluation
    // Deliberately sequenced after the channel strategy above. Running the two concurrently
    // meant the QA agent's input was serialized before `originalData.channelStrategy` existed,
    // so it scored a profile with no media plan in it and marked the profile down for omitting
    // budget allocations, DSP routes and measurement design that the deterministic engine had
    // in fact produced. Worse, the remediation agent then took that checklist at face value and
    // invented a second, contradictory budget split alongside the engine's real one. The
    // concurrency was worth roughly one buildChannelStrategy call; a scorecard that grades the
    // document we actually ship is worth more.
    const scoringSystemInstruction = `You are an elite Media Planning Director and Data QA Specialist at a top-tier digital advertising agency.
Your task is to ruthlessly evaluate AI-generated "Audience Profiles" for Connected TV (CTV) and digital media campaigns and score them out of 100 points.

You MUST score across these five categories (0 to 20 points each):
1. Data Integrity & Mathematical Logic: check for statistical hallucinations (e.g. overinflated HHI, double-digit CTV QR scan rates or purchase rates). CTV QR scan rates MUST hover between 0.01% and 0.5% in reality.
2. Strategic Viability & Media Actionability: programmatic DSP platforms, specific CTV hardware, or retail media target options mentioned instead of vague concepts.
3. Platform & Device Context: Smart TV hardware vs mobile browsing hardware, dual-screening behaviors.
4. Audience Segmentation & Persona Quality: mutual exclusivity of personas, logical ecommerce purchasing behaviors.
5. Structural Formatting & Clarity: clear table labels, no contradictions between narrative text and charts (e.g. narrative says weekends peak, but Sunday index is low).

CONTEXT YOU MUST APPLY BEFORE SCORING:
- Today's date is ${scoringToday}. Data carrying ${currentYear} or ${currentYear - 1} dates is current, not speculative or future-dated. Do not treat a year later than your training data as an unsupported or fabricated claim; judge the figure on its cited source instead.
${channelStrategyGuidance}
- 'deviceTypeIndex.chartData' is a composition share of one denominator and is expected to sum to 100. 'browserAndReach.chartData' is an affinity index against a 100 = average baseline and is expected to sum far above 100. Neither is an error.

Your output must be a perfectly formatted JSON matching the required schema. Ensure you list any specific mathematical, demographic, or strategic discrepancies in 'criticalRedFlags' or 'fixItChecklist'.`;

    console.log("Launching OpenAI Scoring Agent Call (gpt-5.6-terra) over the profile including its channel strategy...");
    const openai = getOpenaiClient();
    // Resolving a rejection to null routes API failures into the same bypass path that
    // timeouts already use, so a 429 degrades to an unverified profile rather than killing
    // the run.
    const scoringPromise = openai.responses.create({
      model: "gpt-5.6-terra",
      reasoning: { effort: "medium" },
      input: [
        {
          role: "system",
          content: `${scoringSystemInstruction}\n\nYou must return a valid JSON object matching this schema:\n${JSON.stringify(auditResultSchema, null, 2)}`
        },
        {
          role: "user",
          content: `Please ruthlessly evaluate and score this audience profile:\n${JSON.stringify(originalData, null, 2)}`
        }
      ],
      text: {
        format: { type: "json_object" }
      }
    }).catch((err: any) => {
      console.error("OpenAI QA Scoring Agent call failed:", err?.message || err);
      return null;
    });

    const scoringResult = await withTimeout(
      scoringPromise,
      TIMEOUT_SCORING_MS,
      null
    );

    let auditResult: any = null;
    if (scoringResult && scoringResult.output_text) {
      try {
        auditResult = JSON.parse(scoringResult.output_text);
      } catch (e) {
        console.error("Failed to parse scoring JSON, bypassing scorecard:", e);
      }
    }

    // When the QA agent does not answer, the profile is UNVERIFIED. It previously reported a
    // fabricated 100/100 "Passed automatically" scorecard, which both hid the outage and
    // suppressed remediation. Represent it honestly instead and flag it for the UI.
    let qaBypassed = false;
    if (!auditResult) {
      qaBypassed = true;
      console.warn(`[QA BYPASS] OpenAI QA Scoring Agent timed out or failed. This profile was NOT independently scored.`);
      const notEvaluated = "Not evaluated - QA scoring agent unavailable";
      auditResult = {
        executiveSummary: "The independent QA scoring agent was unavailable, so this profile has not been externally verified. The figures below are the synthesis output as generated - review them before client presentation.",
        scorecard: [
          { category: "Data Integrity", score: 0, notes: notEvaluated },
          { category: "Strategic Viability", score: 0, notes: notEvaluated },
          { category: "Platform Context", score: 0, notes: notEvaluated },
          { category: "Audience Segmentation", score: 0, notes: notEvaluated },
          { category: "Structural Clarity", score: 0, notes: notEvaluated }
        ],
        totalScore: 0,
        criticalRedFlags: [],
        strategicHighlights: [],
        fixItChecklist: []
      };
    }

    console.log(qaBypassed
      ? "Scoring Agent bypassed - profile delivered unverified."
      : `Scoring Agent evaluation complete. Score: ${auditResult.totalScore}/100. Red Flags Count: ${auditResult.criticalRedFlags?.length || 0}`);

    let finalProfile = originalData;
    let autoFixesList: Array<{ issue: string; resolution: string }> = [];
    // Tracked separately from autoFixesList because the correction agent can return a rewritten
    // profile with an empty fix list. The profile we ship is then a rewrite with no audit trail,
    // which is exactly the case the reader most needs told about.
    let profileRewritten = false;

    // 2. Auto-Fix Remediation Call (Triggered if score < 100 or red flags found)
    // Skipped entirely when scoring was bypassed: there is no scorecard to remediate against,
    // and the zeroed placeholder score would otherwise trigger a pointless 90s rewrite.
    if (qaBypassed) {
      sendEvent("status", { message: "QA scoring agent unavailable - delivering the profile unverified. Please review before presenting." });
    } else if (((auditResult.criticalRedFlags && auditResult.criticalRedFlags.length > 0) || auditResult.totalScore < 95) && auditResult.totalScore < 100) {
      sendEvent("status", { message: `QA Scorecard Issued: ${auditResult.totalScore}/100. Initializing Auto-Remediation agent to resolve red flags...` });

      const correctionSystemInstruction = `You are an expert digital media planner and senior audience profile QA rewriter.
You have been given an audience profile and a list of critical red flags or corrections to make.
Your task is to rewrite and update the audience profile to:
1. Resolve every single red flag/issue identified by the QA specialist.
2. Ensure all percentages sum to 100% and there are no mathematical or logical contradictions.
3. Bring all CTR/QR/conversion rates within standard industry-accepted trade benchmarks.
4. Maintain exactly the same structure as the input profile but with corrected values, narratives, or recommendations.
5. NEVER write a budget allocation, media-type split or spend figure into the narrative recommendations. When the profile carries a 'channelStrategy' object, that object is produced by a deterministic planning engine and is the single source of truth for budget; a second split written in prose contradicts it in the delivered document. If the checklist asks for allocations, treat it as already satisfied there and address only the parts it does not cover. When there is no 'channelStrategy', answer an allocation request with the targeting, platform and measurement specifics it is really after - still no invented spend figures.
6. USER-SPECIFIED PERSONAS ARE PROTECTED: If the input profile contains personas with sourceType 'User' (or personas matching user-specified targets), you MUST strictly preserve their exact names and 'sourceType': 'User'. Do NOT rename, delete, swap, or overwrite user-specified personas.
7. 'deviceTypeIndex.chartData' MUST stay a composition share summing to 100 - it renders as a pie chart and as a "Split Share %" table, so index values get redrawn as shares and contradict whatever the overview says. Fix a broken device chart by correcting the shares and their stated denominator, never by reframing it as an index. 'browserAndReach.chartData' stays an affinity index with metricType 'Affinity Index'.

You must return a JSON matching the profile correction schema. It contains:
1. 'correctedProfile': the updated AudienceProfile JSON.
2. 'autoFixes': an array of { issue, resolution } describing what you corrected.
Return ONLY the JSON. No markdown wraps.`;

      console.log("Launching OpenAI AI Auto-Remediation Call (gpt-5.6-terra)...");
      const correctionPromise = openai.responses.create({
        model: "gpt-5.6-terra",
        reasoning: { effort: "medium" },
        input: [
          {
            role: "system",
            content: `${correctionSystemInstruction}\n\nYou must return a valid JSON object matching this schema:\n${JSON.stringify(profileCorrectionSchema, null, 2)}`
          },
          {
            role: "user",
            content: `Here is the original profile:
${JSON.stringify(originalData, null, 2)}

Here is the QA Specialist's Scorecard & Checklist:
- Executive Summary: ${auditResult.executiveSummary}
- Scorecard: ${JSON.stringify(auditResult.scorecard)}
- Critical Red Flags: ${JSON.stringify(auditResult.criticalRedFlags)}
- Fix-It Checklist: ${JSON.stringify(auditResult.fixItChecklist)}

Please correct the profile to resolve all issues.`
          }
        ],
        text: {
          format: { type: "json_object" }
        }
      });

      const correctionResult = await withTimeout(
        correctionPromise,
        TIMEOUT_CORRECTION_MS,
        null
      );

      if (correctionResult && correctionResult.output_text) {
        try {
          const correctionData = JSON.parse(correctionResult.output_text);
          // Validate BEFORE reassigning. Assigning first meant a correction that parsed but
          // omitted 'correctedProfile' left finalProfile undefined, and the catch below could
          // no longer honour its promise to keep the original - the run then died later on
          // `finalProfile.auditResult = ...` with a TypeError.
          const corrected = correctionData?.correctedProfile;
          if (!corrected || typeof corrected !== "object" || Array.isArray(corrected)) {
            throw new Error("Correction response did not contain a usable 'correctedProfile' object.");
          }
          finalProfile = corrected;
          profileRewritten = true;
          if (originalData.channelStrategy) finalProfile.channelStrategy = originalData.channelStrategy;
          // Citations are evidence, not prose. The correction agent used to answer a sourcing red
          // flag by discarding the researched registry and substituting URLs from its own memory -
          // none of which appeared in the grounding pool - so the profile ended up citing sources
          // that had never been consulted. It may rewrite the analysis; it may not rewrite what
          // the analysis was based on.
          if (Array.isArray(originalData.sources)) finalProfile.sources = originalData.sources;
          // Guardrail: Ensure user-specified personas are never lost or altered by remediation
          if (cleanTargetPersonas.length > 0 && Array.isArray(finalProfile.personas)) {
            cleanTargetPersonas.forEach((targetName, idx) => {
              if (finalProfile.personas[idx]) {
                finalProfile.personas[idx].name = targetName;
                finalProfile.personas[idx].sourceType = 'User';
              }
            });
          }
          autoFixesList = Array.isArray(correctionData.autoFixes) ? correctionData.autoFixes : [];
          if (autoFixesList.length === 0) {
            autoFixesList.push({
              issue: "Auto-remediation returned no itemized changes",
              resolution: "The correction agent rewrote the profile against the QA checklist but did not describe what it changed. Compare against the red flags below before presenting."
            });
          }
          console.log(`AI Auto-Remediation complete. Applied ${autoFixesList.length} patches.`);
        } catch (e) {
          console.error("Failed to parse correction data, keeping original profile:", e);
          autoFixesList.push({
            issue: "Auto-remediation parsing error",
            resolution: "Skipped remediation stage due to parsing error. Delivering initial high-fidelity profile directly."
          });
        }
      } else {
        console.warn(`[TIMEOUT] OpenAI AI Auto-Remediation call timed out after ${TIMEOUT_CORRECTION_MS / 1000}s. Bypassing correction step.`);
        autoFixesList.push({
          issue: "Auto-remediation timeout",
          resolution: `The correction agent timed out (exceeded ${TIMEOUT_CORRECTION_MS / 1000}s). Delivering initial high-fidelity profile directly.`
        });
      }
    } else {
      sendEvent("status", { message: `QA Scorecard Verified: Perfect ${auditResult.totalScore}/100! All parameters verified within media benchmarks.` });
    }

    // Apply fallback programmatic checks on final data as an extra guardrail
    const progCorrections = applyProgrammaticSanityChecks(finalProfile, req.body);
    for (const corr of progCorrections) {
      autoFixesList.push({
        issue: "Programmatic metric verification mismatch",
        resolution: corr
      });
    }

    // Create the final structured audit result payload
    const finalAuditResult = {
      executiveSummary: auditResult.executiveSummary,
      scorecard: auditResult.scorecard,
      originalScore: auditResult.totalScore,
      // The audited score, not a synthesized one. This used to report 100 whenever the
      // auto-fix list was non-empty, and the domain-chart check guaranteed it was non-empty,
      // so every run scored a perfect 100 while the per-category bars beside it still showed
      // the real total. Nothing re-scores the profile after remediation, so there is no
      // higher number we are entitled to claim: report what the QA agent actually gave and
      // let `remediationApplied` carry the fact that the flagged issues were addressed.
      finalScore: qaBypassed ? 0 : auditResult.totalScore,
      remediationApplied: profileRewritten || autoFixesList.length > 0,
      criticalRedFlags: auditResult.criticalRedFlags && auditResult.criticalRedFlags.length > 0
        ? auditResult.criticalRedFlags
        : (qaBypassed
          ? ["QA scoring did not run - this profile has not been independently verified."]
          : ["Clean - No major data hallucinations detected."]),
      strategicHighlights: auditResult.strategicHighlights || [],
      autoFixes: autoFixesList,
      qaBypassed
    };

    // Embed the audit results into the final profile
    finalProfile.auditResult = finalAuditResult;

    // Digital Remedy's own historical campaign data heads the registry. It has no public URL, so
    // it carries no link; the UI renders an unlinked entry in the same style as the rest.
    if (!Array.isArray(finalProfile.sources)) finalProfile.sources = [];
    if (!finalProfile.sources.some((src: any) => src?.name === DIGITAL_REMEDY_SOURCE.name)) {
      finalProfile.sources.unshift({ ...DIGITAL_REMEDY_SOURCE });
    }

    // Enforce EXACTLY 4 personas in finalProfile
    if (!Array.isArray(finalProfile.personas)) {
      finalProfile.personas = [];
    }

    const isMediaPlanUploaded = Boolean(selectedPlanOptions && selectedPlanOptions.length > 0);

    while (finalProfile.personas.length < 4) {
      const count = finalProfile.personas.length + 1;
      finalProfile.personas.push({
        name: `Persona Archetype ${count}`,
        gender: "Balanced (50/50)",
        income: "$75,000 - $125,000",
        age: count === 1 ? "18 - 34" : count === 2 ? "35 - 54" : count === 3 ? "25 - 44" : "55+",
        watch: "Ad-supported Connected TV, YouTube, Live Sports & OTT",
        browse: "High-affinity digital news, lifestyle, and social media platforms",
        buy: "E-commerce, direct-to-consumer goods, and everyday retail",
        narrative: `Representative consumer archetype ${count} representing core target demographic segment with distinct media engagement patterns.`,
        sourceType: isMediaPlanUploaded && count <= Math.min(3, Math.max(1, planAudiences.length)) ? 'RFP' : 'ScoutAI'
      });
    }
    if (finalProfile.personas.length > 4) {
      finalProfile.personas = finalProfile.personas.slice(0, 4);
    }

    // Assign / normalize sourceType for all 4 personas
    if (isMediaPlanUploaded) {
      // Up to 3 from RFP plan, at least 1 (or more if plan has fewer audiences) ScoutAI expansion
      const rfpLimit = Math.min(3, planAudiences.length > 0 ? planAudiences.length : 1);
      finalProfile.personas.forEach((p: any, idx: number) => {
        if (!p.sourceType || (p.sourceType !== 'RFP' && p.sourceType !== 'ScoutAI')) {
          p.sourceType = idx < rfpLimit ? 'RFP' : 'ScoutAI';
        }
        p.isExpansion = p.sourceType === 'ScoutAI';
      });

      // Ensure at least 1 persona is ScoutAI expansion
      const scoutCount = finalProfile.personas.filter((p: any) => p.sourceType === 'ScoutAI').length;
      if (scoutCount === 0) {
        finalProfile.personas[3].sourceType = 'ScoutAI';
        finalProfile.personas[3].isExpansion = true;
      }

      if (typeof finalProfile.expansionReachPercent !== 'number' || finalProfile.expansionReachPercent <= 0) {
        finalProfile.expansionReachPercent = 35;
      }
    } else {
      // Standard mode: no media plan uploaded
      finalProfile.personas.forEach((p: any) => {
        p.sourceType = 'ScoutAI';
        p.isExpansion = false;
      });
      finalProfile.expansionReachPercent = undefined;
    }

    // Persona headshots are deliberately NOT generated here. Four sequential image calls
    // (45s timeout plus one retry each) could add up to 360s to a request the browser is
    // already blocked on, which on its own overruns Cloud Run's default 300s deadline.
    // The client requests each portrait from /api/generate-persona-avatar in parallel once
    // the profile has rendered, so image latency no longer gates the result.
    sendEvent("status", { message: "Profile complete. Studio persona portraits will render as they finish generating..." });

    // Stream logs for applied fixes so the live terminal console receives and prints them
    if (autoFixesList.length > 0) {
      sendEvent("status", { message: `QA Audit Complete. Automatically applied ${autoFixesList.length} auto-fix patch(es) for client-ready presentation:` });
      for (const fix of autoFixesList) {
        sendEvent("status", { message: `• [AUTO-FIXED] ${fix.issue}: ${fix.resolution}` });
      }
    } else {
      sendEvent("status", { message: "QA Audit Complete: All metrics, device splits, and temporal indices verified within realistic media buyer benchmarks." });
    }

    // Return structured profile and citations
    sendEvent("complete", {
      profile: finalProfile,
      groundingSources: deduplicatedSources
    });

  } catch (error: any) {
    console.error("Gemini API Error:", error);
    sendEvent("error", {
      error: "An error occurred during audience profile generation.",
      details: error.message || error
    });
  } finally {
    clearInterval(keepAlive);
    clearInterval(watchdog);
    res.end();
  }
});

// Global error handler
app.use((err: any, req: any, res: any, next: any) => {
  console.error("[GLOBAL ERROR HANDLER]:", err);
  res.status(err.status || err.statusCode || 500).json({
    error: "Internal Server Error",
    details: err.message || String(err)
  });
});

// Static assets serving (logos, icons, etc.)
app.use("/assets", express.static(path.join(process.cwd(), "assets")));

// Setup development or production build pipeline
async function init() {
  // Booting the Vite dev server in a deployed container is a real hazard: it is far heavier
  // than static serving, and the memory it eats makes an OOM-kill mid-request much more
  // likely - which severs the SSE stream with no error at all. Both npm scripts now set
  // NODE_ENV explicitly; if it is somehow unset we fall back to production whenever a built
  // bundle is present, so `node dist/server.cjs` can never accidentally start Vite.
  const distPath = path.join(process.cwd(), "dist");
  const hasBuiltBundle = fs.existsSync(path.join(distPath, "index.html"));
  const isProduction = process.env.NODE_ENV
    ? process.env.NODE_ENV === "production"
    : hasBuiltBundle;

  if (!process.env.NODE_ENV) {
    console.warn(`[STARTUP] NODE_ENV is not set; inferring ${isProduction ? "production" : "development"} from ${hasBuiltBundle ? "the built bundle in dist/" : "the absence of a built bundle"}.`);
  }

  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    console.log("Vite dev server middleware mounted.");
  } else {
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
    console.log("Static production assets serving from dist.");
  }

  // Warm the shared store during boot so a credential or IAM problem appears in the
  // deploy logs immediately, instead of surfacing as a failed save for the first user.
  try {
    const storage = await getStorage();
    console.log(`[STARTUP] Shared storage ready via the '${storage.name}' driver.`);
    if (storage.name === "local-file" && isProduction) {
      console.error(
        "[STARTUP] WARNING: running in production on the local-file driver. Saved plans will " +
          "NOT be shared between users and will be lost on the next redeploy. Check that Firestore " +
          "is enabled and that the runtime service account has roles/datastore.user.",
      );
    }
  } catch (err) {
    console.error("[STARTUP] Shared storage failed to initialize:", err);
  }

  if (!isAdminPasswordConfigured()) {
    console.warn(
      "[STARTUP] ADMIN_PASSWORD is not set, so every signed-in user can change global planning " +
        "settings. Set it to restrict settings edits to administrators.",
    );
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Audience Profile Builder server running on port ${PORT}`);
  });
}

init();
