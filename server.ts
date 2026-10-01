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
import { CampaignNotFoundError, CampaignTooLargeError, createStorage, PlanNotFoundError, RevisionConflictError, toAdvertiserKey, type PerformanceCampaign, type StorageAdapter } from "./src/storage";
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
import { crawlSite, type CrawlResult } from "./src/research/crawl";
import {
  BRIEF_OF_RECORD_SYSTEM_INSTRUCTION,
  briefOfRecordSchema,
  buildAdvertiserSearchPrompt,
  buildBriefOfRecordInput,
  formatBriefOfRecord,
  normalizeBriefOfRecord,
  type BriefOfRecord,
} from "./src/research/briefOfRecord";
import { filterCitationPool, RESEARCH_SOURCE_GUIDANCE } from "./src/research/sourceFilter";
import { settlePublisherSelection } from "./src/qa/publisherSelection";
import { describeChannelPlan, describeCharts, describePersonas, researchForPrompt } from "./src/qa/planContext";
import { PROSE_OWNERS, normalizeAudit, openFindingsAsFlags, type NormalizedAudit, type NormalizedVerify } from "./src/qa/planAudit";
import { applyPatches, describeAppliedFixes, getAtPath, type AppliedPatch } from "./src/qa/planRemediation";
import {
  buildAuditResult,
  campaignLineFrom,
  ledgerFor,
  mergeFindings,
  proposeFixes,
  publishersLine,
  runAudit,
  runVerify,
  type AuditInputs,
} from "./src/qa/auditRunner";
import { NARRATIVE_SYSTEM_INSTRUCTION, applyNarrative, buildNarrativeInput, currentNarrative, narrativeSchema } from "./src/research/planNarrative";
import { buildBriefPrompt, buildBriefResponseSchema, normalizeBrief, sanitizeBriefSnapshot } from "./src/research/executiveBrief";
import { PROOFREAD_SYSTEM_INSTRUCTION, buildSlideImagePrompt, normalizeProofread, proofreadSchema, type BriefSlideLayout, type BriefSlideStyle, type ProofreadResult } from "./src/research/executiveBriefSlides";
import { openAiJson, type OpenAiEffort } from "./src/server/openaiJson";
import { applyOps, parseOps } from "./src/assistant/operations";
import { detectFollowUps } from "./src/assistant/followUps";
import { advertiserMismatch, analyzeFiles, mergeFiles, publicCampaign, readCampaignDetails, readUploadedFiles, reviewFingerprint, suggestedDetails } from "./src/performance/library";
import { CAMPAIGN_GOALS } from "./src/performance/constants";
import { figureReference, unverifiedFigures } from "./src/performance/figureCheck";
import { renderDigest } from "./src/performance/digest";
import { buildReviewInput, normalizeReview, readStoredReview, REVIEW_SYSTEM_INSTRUCTION, reviewSchema } from "./src/performance/review";
import { buildPerformanceContext, PERFORMANCE_INSTRUCTION, toLearningCampaign, type LinkedCampaign } from "./src/assistant/performanceContext";
import { buildGenerationHistory, type GenerationHistory } from "./src/research/pastPerformance";
import { SCOUT_SYSTEM_INSTRUCTION, buildPlanContext, buildScoutInput, normalizeScoutResponse, sanitizeTurns, scoutResponseSchema } from "./src/assistant/scoutChat";
import { throttledProgress } from "./src/server/thoughtProgress";
import { EVIDENCE_RULES } from "./src/qa/evidenceRules";
import type { ResearchDossierText } from "./src/qa/claimLedger";
import { extractFindingBlurb } from "./src/research/findingBlurb";
import type { GenerationLogEntry } from "./src/types";
import { CHART_SHAPE_GUIDANCE, chartRealismProblems, findUnrealisticCharts, labelEstimatedPoints, realismFixes } from "./src/qa/chartRealism";
import { applyAudienceSkews, audienceSkewSchema, chartsNeedingBaselineEstimates, describeBaselines } from "./src/qa/baselineEstimates";
import { NATIONAL_BASELINES } from "./src/planning/knowledge/nationalBaselines";
import {
  PROFILE_CHARTS,
  checkPersonas,
  clearSectionsForFailedDossiers,
  pushAlert,
  reportChartsNotFound,
  type GenerationAlert,
} from "./src/qa/generationIntegrity";
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
import { hasPlanTextList, normalizePlanText } from "./src/utils/planText";
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
  generateGroundedText,
  generateStructuredJsonWithFallback,
  generateText,
  GEMINI_FLASH_MODEL,
  toGeminiJsonSchema,
  type GeminiThinkingLevel,
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
// Synthesis gets 120s at high thinking plus one 60s medium-thinking fallback (see SYNTHESIS_ATTEMPTS).
const TIMEOUT_SYNTHESIS_HIGH_MS = 120000;
const TIMEOUT_SYNTHESIS_FALLBACK_MS = 60000;
const TIMEOUT_SYNTHESIS_MS = TIMEOUT_SYNTHESIS_HIGH_MS + TIMEOUT_SYNTHESIS_FALLBACK_MS;
const TIMEOUT_SCORING_MS = 60000;            // candidate-signal reasoning
// QA runs on a different provider from the writer so the two do not share blind spots. Chosen
// from a side-by-side run on a saved PetSmart plan (2026-09-23): Sol at high found real issues
// medium missed in 92-123s; xhigh took 142-183s for no clearly better findings.
const AUDIT_MODEL = "gpt-6-sol";
const AUDIT_EFFORT: OpenAiEffort = "high";
// Verify re-scores a plan it has already reviewed; medium scored in the same range at ~40s.
const VERIFY_EFFORT: OpenAiEffort = "medium";
// High-effort audits ran 144-180s in live runs (output-bound: ~8k tokens, most of it reasoning),
// so 180s timed some out and shipped the plan unscored. The run budget has room: the audit
// starts ~2.5 minutes in, and audit + fix + verify at these limits still ends inside it.
const TIMEOUT_AUDIT_MS = 300000;
const TIMEOUT_FIX_MS = 90000;
const TIMEOUT_VERIFY_MS = 120000;
const NARRATIVE_ATTEMPTS: Array<{ thinkingLevel: "high" | "medium"; timeoutMs: number }> = [
  { thinkingLevel: "high", timeoutMs: 100000 },
  { thinkingLevel: "medium", timeoutMs: 50000 },
];
const TIMEOUT_NARRATIVE_MS = NARRATIVE_ATTEMPTS.reduce((sum, attempt) => sum + attempt.timeoutMs, 0);
// Quick mode (live demos) skips the QA audit, fix and verify, which are 4-6 minutes of a run,
// and writes the narrative at medium. Synthesis and research stay at high: medium synthesis
// mis-copied citation URLs and medium research returned about half the sources (see below).
const QUICK_NARRATIVE_ATTEMPTS: Array<{ thinkingLevel: "high" | "medium"; timeoutMs: number }> = [
  { thinkingLevel: "medium", timeoutMs: 60000 },
];
// The whole generation must finish inside Cloud Run's 900s request timeout. Late stages check
// what is left and step aside (with an alert) rather than be cut off mid-response.
const RUN_BUDGET_MS = 870000;
// Segment recommendations run after the profile is delivered, so they favour quality: high
// thinking first, one medium-thinking fallback. Together they stay inside Cloud Run's 300s.
const TIMEOUT_SEGMENTS_HIGH_MS = 90000;
const TIMEOUT_SEGMENTS_FALLBACK_MS = 60000;
// The executive brief is written after the profile is delivered, from the plan as the planner
// sees it. High thinking first, one medium fallback, inside Cloud Run's 300s.
// Proofreading a rendered slide: read its text back and compare. Medium thinking reads small
// type more reliably; the low fallback keeps a slow read from costing the slide.
const PROOFREAD_ATTEMPTS: Array<{ thinkingLevel: "medium" | "low"; timeoutMs: number }> = [
  { thinkingLevel: "medium", timeoutMs: 45000 },
  { thinkingLevel: "low", timeoutMs: 30000 },
];
const BRIEF_ATTEMPTS: Array<{ thinkingLevel: "high" | "medium"; timeoutMs: number }> = [
  { thinkingLevel: "high", timeoutMs: 90000 },
  { thinkingLevel: "medium", timeoutMs: 60000 },
];
// ScoutAI chat turns. The planner is waiting in a chat, so medium thinking with a quick low
// fallback: a slow answer is worse than a slightly less considered one.
const SCOUT_ATTEMPTS: Array<{ thinkingLevel: "medium" | "low"; timeoutMs: number }> = [
  { thinkingLevel: "medium", timeoutMs: 60000 },
  { thinkingLevel: "low", timeoutMs: 40000 },
];
// Reading past performance against the plan is the one chat task that is real analysis
// (attribution, sample size, what maps to what), so it gets high thinking and a longer wait.
const SCOUT_ANALYSIS_ATTEMPTS: Array<{ thinkingLevel: "high" | "medium"; timeoutMs: number }> = [
  { thinkingLevel: "high", timeoutMs: 100000 },
  { thinkingLevel: "medium", timeoutMs: 60000 },
];
const PERFORMANCE_QUESTION = /\b(perform|past|previous|last|prior|historic|campaign|report|results?|data|worked|analy[sz]|learn|cpa|roas|pm|conversions?|checkouts?)/i;
// Short rewrites at low thinking. Both have a non-AI fallback, so a stall should end quickly.
const TIMEOUT_SUMMARIZE_INSIGHTS_MS = 30000;
const TIMEOUT_AUDIENCE_ANALYSIS_MS = 30000;
// Per-dossier cap on the research text saved with a plan. Four at this size is ~100KB.
const RESEARCH_SNAPSHOT_MAX_CHARS = 25000;
// The console steps saved with a plan. A run sends well under this; the caps only guard the
// plan's Firestore document (1MB) against a runaway loop or an unusually long source list.
const GENERATION_LOG_MAX_ENTRIES = 400;
const GENERATION_LOG_MAX_SOURCES = 25;
// Brief of record: one optional grounded search plus one structured call, each on this budget.
const TIMEOUT_BRIEF_OF_RECORD_MS = 45000;
// One revision per chart that looked generated (straight-line dayparts, evenly spaced indices).
// The revisions run in parallel, so the stage costs one call's time.
// Low thinking: reshaping one small array needs little reasoning, and at medium the domain
// chart revision timed out at 30s in live runs.
const TIMEOUT_CHART_REVISION_MS = 40000;
// One call returning audience skews for every chart built from a national baseline.
const TIMEOUT_BASELINE_SKEWS_MS = 45000;
// Per-redirect budget when turning grounding links back into publisher URLs. Deliberately short:
// this runs across ~100 sources and an unresolved one still ships, so waiting is pure loss.
const TIMEOUT_URL_RESOLUTION_MS = 5000;
const URL_RESOLUTION_CONCURRENCY = 12;

// Research dossiers run at high thinking. In the spike, high returned roughly twice as many
// unique cited sources as medium (144 vs ~75 across the four dossiers, against 84 on 2.5) with
// longer, more specific briefs, in ~50s of the 90s budget. Medium had short-changed the
// Digital Touchpoints dossier in particular.
const RESEARCH_THINKING_LEVEL: GeminiThinkingLevel = "high";

// Synthesis runs at high thinking. On gemini-3.8-flash, medium reported zero thinking tokens
// for this call in every spike run, and with raw grounding links it mis-copied most of the
// citation URLs it chose; high thought for 8-14K tokens and copied them exactly. High took
// 55-78s, so 120s leaves headroom, and a medium retry means a slow run still ships a profile
// instead of an error. Cloud Run allows 900s per request; the binding limits are the client's
// 600s cap and the 240s SSE watchdog, and 180s here stays inside both.
const SYNTHESIS_ATTEMPTS: Array<{ thinkingLevel: GeminiThinkingLevel; timeoutMs: number }> = [
  { thinkingLevel: "high", timeoutMs: TIMEOUT_SYNTHESIS_HIGH_MS },
  { thinkingLevel: "medium", timeoutMs: TIMEOUT_SYNTHESIS_FALLBACK_MS },
];

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
  "/api/segments/generate-slide",
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
          buy: { type: Type.STRING, description: "How and where they shop the category: what they look for, where they buy (online, in store) and why. A buying habit, not an advertiser program. Name the advertiser's products, offers or retailers only if they are in the brief of record's verified advertiser facts." },
          narrative: { type: Type.STRING, description: "A highly realistic narrative paragraph describing their motivations, lifestyle, and media activation context." },
          sourceType: { type: Type.STRING, description: "Must be 'User' if persona was explicitly specified by the user in the brief, 'RFP' if derived from uploaded media plan listed audiences, or 'ScoutAI' if it is an AI recommended / expansion audience by ScoutAI." }
        },
        required: ["name", "gender", "income", "age", "watch", "browse", "buy", "narrative", "sourceType"]
      }
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
          description: "Age bracket split percentage data. Sums to ~100. Empty array if no dossier reports this audience's split (the server then estimates it from Census baselines).",
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
          description: "Gender split percentage data. Sums to ~100. Empty array if no dossier reports this audience's split.",
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
          description: "Income bracket split percentage data. Empty array if no dossier reports this audience's split.",
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
          description: "Activity index/percentage by Day of Week. 7 items (Mon-Sun), or an empty array if no dossier reports it for this audience.",
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
          description: "Activity index/percentage by general hour block. 6 to 12 items, or an empty array if no dossier reports it for this audience.",
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

// 3.8 takes standard lowercase JSON Schema. Converted once at startup so a schema the converter
// cannot map fails the boot, not the first generation.
const audienceProfileJsonSchema = toGeminiJsonSchema(audienceProfileSchema);

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

// The products the AI reasoning layer must score. Built from the effective catalog, not the raw
// registry: a product disabled in settings must not reach the model, and a custom media type must.
function aiCandidateProducts(settings: any) {
  return resolveEffectiveProducts(settings)
    .filter((product) => product.digitalRemedyExecutable && product.recommendationEligible && product.status === "live");
}

async function generateCandidateSignals(audienceProfile: any, facts: any, research: Array<ResearchDossierText & { failed?: boolean }> = [], history = ""): Promise<AiCandidateSignal[]> {
  const customNotes = new Map(
    (facts?.settings?.customProducts || []).map((product: any) => [product.productId, product.planningNotes]),
  );
  const candidates = aiCandidateProducts(facts.settings)
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

Your gapAddressed, evidence, tradeoff and allocation-rationale text is shown to the client and audited against the research below. An 'audience_research' evidence line must carry a finding from the RESEARCH DOSSIERS, with its figure and population as reported and the study it came from; if the dossiers do not support a point, leave it out rather than citing a study from memory. A cost, rate or benchmark the research does not report is an 'industry_benchmark' and must be worded as a planning assumption.

${EVIDENCE_RULES}

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

${audienceProfile?.briefOfRecord ? `${formatBriefOfRecord(audienceProfile.briefOfRecord)}\nEvery rationale, evidence line and activation note must describe this audience; do not reason about groups outside it.\n\n` : ""}AI-RESEARCHED AUDIENCE PROFILE:
${JSON.stringify({
  intro: audienceProfile?.intro,
  personas: audienceProfile?.personas,
  executiveSummary: audienceProfile?.executiveSummary,
  takeaways: audienceProfile?.takeaways,
  sources: audienceProfile?.sources?.slice?.(0, 15),
}, null, 2)}

${research.length > 0 ? `RESEARCH DOSSIERS (the evidence your rationale may cite):\n${researchForPrompt(research)}\n\n` : ""}${history ? `${history}\n\n` : ""}ALLOWED PRODUCT CANDIDATES:
${JSON.stringify(candidates, null, 2)}

Return one signal object per allowed candidate and no other products.`;

  // Medium, not high: in testing high took ~49s of this 60s budget for near-identical scores.
  // A failure throws: the channel strategy is then reported as failed rather than built from
  // formula scores that would read as AI analysis.
  {
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
      throw new Error(`AI candidate reasoning returned no signals (timed out after ${TIMEOUT_SCORING_MS / 1000}s or failed).`);
    }
    const allowedIds = new Set(candidates.map((candidate) => candidate.channelId));
    return parsed.filter((signal): signal is AiCandidateSignal => signal && allowedIds.has(signal.channelId));
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
    /** The research dossiers, so the channel reasoning cites findings instead of recalling studies. */
    research?: Array<ResearchDossierText & { failed?: boolean }>;
    /** Past campaigns the planner chose, for the channel reasoning (see src/research/pastPerformance). */
    history?: string;
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
    // Plans generated before the brief of record existed fall back to inference in the engine.
    audienceType: audienceProfile?.briefOfRecord?.audienceType,
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
  const candidateIds = aiCandidateProducts(planningSettings).map((product) => product.id);
  const allowedSignalIds = new Set(candidateIds);
  const suppliedSignals = Array.isArray(options?.candidateSignals)
    ? options.candidateSignals.filter((signal) => signal && allowedSignalIds.has(signal.channelId))
    : [];
  const aiSignals = suppliedSignals.length > 0 ? suppliedSignals : await generateCandidateSignals(audienceProfile, facts, options?.research ?? audienceProfile?.researchSnapshot?.dossiers ?? [], options?.history ?? "");
  // Every candidate must carry real AI reasoning. The engine can score a product without one,
  // but those formula scores and stock rationales would be shown as analysis.
  const signalled = new Set(aiSignals.map((signal) => signal.channelId));
  const unscored = candidateIds.filter((id) => !signalled.has(id));
  if (unscored.length > 0) {
    throw new Error(`AI candidate reasoning is missing for ${unscored.length} of ${candidateIds.length} media types (${unscored.join(", ")}).`);
  }
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

// ---- Manual QA audit of a saved plan ----
// The same audit, fix and verify steps a generation runs, on demand. Nothing changes until a
// planner approves it: the audit returns the fixes Gemini proposes, and only the ones sent back
// to /apply are written, re-verified and saved against the revision that was audited.

function auditInputsFromPlan(plan: any): { profile: any; inputs: AuditInputs } {
  const payload = (plan?.payload || {}) as any;
  const profile = payload.profile;
  if (!profile || typeof profile !== "object") throw Object.assign(new Error("This plan has no profile to audit."), { status: 422 });
  const mediaPlan = profile.channelStrategy?.mediaPlan;
  const dossiers = Array.isArray(profile.researchSnapshot?.dossiers) ? profile.researchSnapshot.dossiers : [];
  const budget = Number(mediaPlan?.workingMediaBudget) || Number(String(payload.budget || "").replace(/[^0-9.]/g, "")) || 0;
  const flightDays = Number(mediaPlan?.flightDays) || Number(payload.campaignLength) || null;
  return {
    profile,
    inputs: {
      briefBlock: formatBriefOfRecord(profile.briefOfRecord),
      campaignLine: campaignLineFrom({
        advertiser: plan.advertiserName || payload.url || "",
        kpis: Array.isArray(payload.kpis) ? payload.kpis : [],
        campaignFocus: payload.campaignFocus || "",
        geography: payload.geography || "United States",
        workingMediaBudget: budget,
        flightDays,
        targetPersonas: Array.isArray(payload.targetPersonas) ? payload.targetPersonas : [],
        uploadedPlan: Boolean(profile.channelStrategy?.analyzedPlanNames?.length),
        rfp: Boolean(profile.additionalRfpRequirements?.isRfpDocument),
      }),
      research: dossiers.map((d: any) => ({ label: String(d?.label || ""), text: String(d?.text || ""), failed: Boolean(d?.failed) })),
      planInputs: { workingMediaBudget: budget, flightDays },
      alerts: Array.isArray(profile.generationAlerts) ? profile.generationAlerts : [],
      researchNote: dossiers.length === 0
        ? "NOTE: this plan was generated before research was saved with plans, so its figures cannot be checked against the research. Do not treat a figure as unsupported only because the NUMBER CHECK could not find it."
        : undefined,
    },
  };
}

const manualAuditOptions = (effort: OpenAiEffort, timeoutMs: number) => ({
  model: AUDIT_MODEL,
  effort,
  timeoutMs,
  today: new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
  currentYear: new Date().getFullYear(),
});

app.post("/api/plans/:id/audit", async (req, res) => {
  req.socket.setTimeout(0);
  try {
    const plan = await (await getStorage()).getPlan(req.params.id);
    if (!plan || plan.archived) {
      res.status(404).json({ error: `Plan '${req.params.id}' was not found.`, code: "NOT_FOUND" });
      return;
    }
    const { profile, inputs } = auditInputsFromPlan(plan);
    const audit = await runAudit(getOpenaiClient(), profile, inputs, manualAuditOptions(AUDIT_EFFORT, TIMEOUT_AUDIT_MS));

    // Proposals are validated on a copy, so the planner is only offered fixes that would apply.
    let proposals: Array<{ findingId: string; path: string; before: string; after: string }> = [];
    let notes: unknown = [];
    let fixError: string | null = null;
    try {
      const fix = await proposeFixes(getAiClient(), audit.findings, profile, inputs, TIMEOUT_FIX_MS);
      notes = fix.notes;
      const { applied } = applyPatches(JSON.parse(JSON.stringify(profile)), fix.patches, audit.findings);
      proposals = applied.map(({ findingId, path, before, value }) => ({ findingId, path, before, after: value }));
    } catch (err: any) {
      fixError = err?.message || String(err);
      console.error("[MANUAL AUDIT] Proposing fixes failed:", fixError);
    }
    console.log(`[MANUAL AUDIT] Plan ${plan.id} r${plan.revision}: ${audit.totalScore}/100, ${audit.findings.length} finding(s), ${proposals.length} proposed fix(es).`);
    res.json({ success: true, planId: plan.id, revision: plan.revision, audit, proposals, notes, fixError, auditModel: `${AUDIT_MODEL} (${AUDIT_EFFORT})` });
  } catch (err: any) {
    console.error("[MANUAL AUDIT] Failed:", err);
    res.status(err?.status || 502).json({ error: "The QA audit could not be completed.", details: err?.message || String(err) });
  }
});

app.post("/api/plans/:id/audit/apply", async (req, res) => {
  req.socket.setTimeout(0);
  try {
    const expectedRevision = Number(req.body?.expectedRevision);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
      res.status(428).json({ error: "The revision that was audited is required.", code: "REVISION_REQUIRED" });
      return;
    }
    const storage = await getStorage();
    const plan = await storage.getPlan(req.params.id);
    if (!plan || plan.archived) {
      res.status(404).json({ error: `Plan '${req.params.id}' was not found.`, code: "NOT_FOUND" });
      return;
    }
    if (plan.revision !== expectedRevision) {
      res.status(409).json({ error: "This plan changed after it was audited. Run the audit again.", code: "REVISION_CONFLICT", currentRevision: plan.revision });
      return;
    }
    const audit = normalizeAudit(req.body?.audit);
    if (!audit) {
      res.status(400).json({ error: "The audit to apply is missing or unreadable." });
      return;
    }
    const { profile, inputs } = auditInputsFromPlan(plan);

    // A fix is applied only if the field still reads what the planner saw when approving it.
    const accepted: any[] = Array.isArray(req.body?.accepted) ? req.body.accepted : [];
    const current = accepted.filter((a) => typeof a?.before === "string" && getAtPath(profile, String(a?.path || "")) === a.before);
    const { applied, rejected } = applyPatches(profile, current.map((a) => ({ findingId: a.findingId, path: a.path, value: a.after })), audit.findings);

    let verify: NormalizedVerify | null = null;
    let verifyError: string | null = null;
    if (applied.length > 0) {
      try {
        verify = await runVerify(getOpenaiClient(), profile, inputs, audit, applied, manualAuditOptions(VERIFY_EFFORT, TIMEOUT_VERIFY_MS));
      } catch (err: any) {
        verifyError = err?.message || String(err);
        console.error("[MANUAL AUDIT] Verify failed:", verifyError);
      }
    }
    const findings = mergeFindings(audit, verify);
    profile.auditResult = {
      ...buildAuditResult({
        audit,
        verify,
        findings,
        autoFixes: describeAppliedFixes(audit.findings, applied, req.body?.notes),
        qaBypassed: false,
        auditModel: `${AUDIT_MODEL} (${AUDIT_EFFORT})`,
      }),
      manualAudit: { at: new Date().toISOString(), by: actorName(req), proposed: accepted.length, applied: applied.length },
    };

    const updated = await storage.updatePlan(plan.id, {
      ...planPayloadFromBody({ title: plan.title, advertiserName: plan.advertiserName, settingsRevision: plan.settingsRevision, payload: { ...plan.payload, profile } }),
      actor: actorName(req),
    }, expectedRevision);
    console.log(`[MANUAL AUDIT] Plan ${plan.id}: applied ${applied.length} of ${accepted.length} approved fix(es), ${accepted.length - current.length} stale, ${rejected.length} rejected; ${verify ? `verified ${verify.totalScore}/100` : "not re-verified"}.`);
    res.json({ success: true, plan: updated, applied: applied.length, stale: accepted.length - current.length, verifyError });
  } catch (err: any) {
    if (err instanceof RevisionConflictError) {
      respondToStorageError(res, err, "apply audit fixes");
      return;
    }
    console.error("[MANUAL AUDIT] Apply failed:", err);
    res.status(err?.status || 502).json({ error: "The approved fixes could not be applied.", details: err?.message || String(err) });
  }
});

// ---- ScoutAI plan assistant ----
// Chat answers questions about the saved plan and may propose edits as operations. A proposal is
// dry-run here, so the planner approves the computed result, not the model's description of it.
// Nothing is written until /apply, which re-runs the same operations against the revision the
// proposal was built from and saves with compare-and-swap.

app.post("/api/plans/:id/assistant/chat", async (req, res) => {
  req.socket.setTimeout(0);
  let streaming = false;
  try {
    const turns = sanitizeTurns(req.body?.messages);
    if (turns.length === 0 || turns[turns.length - 1].role !== "user") {
      res.status(400).json({ error: "Send the planner's message to answer." });
      return;
    }
    const storage = await getStorage();
    const plan = await storage.getPlan(req.params.id);
    if (!plan || plan.archived) {
      res.status(404).json({ error: `Plan '${req.params.id}' was not found.`, code: "NOT_FOUND" });
      return;
    }
    const context = await scoutApplyContext(storage, plan);
    const linked = context.linked;
    const performance = buildPerformanceContext(linked, {
      planAdvertiser: plan.advertiserName || "",
      plan: (plan.payload as any)?.profile?.channelStrategy?.mediaPlan,
      planPublishers: ((plan.payload as any)?.profile?.ctvPublishers || []).map((p: any) => String(p?.publisher ?? "")).filter(Boolean),
      catalog: context.publisherCatalog,
      profile: (plan.payload as any)?.profile,
    });
    const analysisTurn = Boolean(performance) && PERFORMANCE_QUESTION.test(turns[turns.length - 1].text);
    const planContext = buildPlanContext(plan, context);
    // Figures about past performance must come from its data or the plan; anything else is flagged.
    // Checked against each campaign's whole digest, not the part that fit in the prompt: a row
    // cut for length is still a real figure.
    const knownFigures = performance ? [performance, planContext, ...linked.map((l) => renderDigest(l.analysis, { maxChars: 1_000_000 }))] : null;

    // Newline-delimited JSON: thought headlines while the model works, then one result line.
    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    streaming = true;
    const send = (event: Record<string, unknown>) => res.write(`${JSON.stringify(event)}\n`);

    const { data, thinkingLevel } = await generateStructuredJsonWithFallback(
      getAiClient(),
      {
        systemInstruction: performance ? `${SCOUT_SYSTEM_INSTRUCTION}\n\n${PERFORMANCE_INSTRUCTION}` : SCOUT_SYSTEM_INSTRUCTION,
        input: buildScoutInput(planContext, turns, performance),
        schema: scoutResponseSchema,
        onThought: (text) => send({ type: "thought", text }),
      },
      analysisTurn ? SCOUT_ANALYSIS_ATTEMPTS : SCOUT_ATTEMPTS,
    );
    const response = normalizeScoutResponse(data);
    let reply = response.reply;
    let proposal: Record<string, unknown> | null = null;
    // Each item is dry-run on its own, so the planner sees what each recommendation does, and
    // then together, which is what Apply saves when every item is kept.
    const dropped: string[] = [];
    const items = response.items.flatMap((item, index) => {
      const dryRun = item.ops.length > 0 ? applyOps(plan.payload, item.ops, context) : null;
      const reasons = [...item.rejected, ...(dryRun?.rejected ?? [])].map((r) => r.reason);
      if (!dryRun || dryRun.changes.length === 0) {
        if (item.ops.length > 0 || item.rejected.length > 0) dropped.push(`${item.title}: ${reasons.join("; ") || "it would not change anything"}`);
        return [];
      }
      return [{ id: `item-${index}`, title: item.title, why: item.why, evidence: item.evidence, unverifiedFigures: [] as string[], ops: dryRun.ops, changes: dryRun.changes, rejected: reasons }];
    });
    if (items.length > 0) {
      const combined = applyOps(plan.payload, items.flatMap((item) => item.ops), context);
      proposal = { summary: response.summary, items, changes: combined.changes, rejected: combined.rejected.map((r) => r.reason), baseRevision: plan.revision };
    }
    if (dropped.length > 0) reply += `\n\n_Left out because the plan doesn't allow it: ${dropped.join(" · ")}._`;
    // The proposal's own results ("OLV 25% · $62,500") are known figures too: the card computed them.
    const proposed = items.flatMap((item) => item.changes.map((c) => `${c.before} ${c.after}`));
    const figures = knownFigures ? figureReference(...knownFigures, ...proposed) : null;
    if (figures) for (const item of items) item.unverifiedFigures = unverifiedFigures([item.title, item.why, item.evidence ?? "", ...opTexts(item.ops)].join(" \n "), figures);
    const replyUnverified = figures ? unverifiedFigures(response.reply, figures) : [];
    if (replyUnverified.length > 0) reply += `\n\n_Not found in the campaign data or the plan, so check before using: ${replyUnverified.join(", ")}._`;
    console.log(`[SCOUTAI] Plan ${plan.id} r${plan.revision}: ${turns.length} turn(s), ${linked.length ? `${linked.length} past campaign(s)${analysisTurn ? " (analysis)" : ""}, ` : ""}${proposal ? `${items.length} item(s), ${(proposal.changes as unknown[]).length} change(s)` : "no proposal"}${dropped.length ? `, ${dropped.length} dropped` : ""} via ${GEMINI_FLASH_MODEL} (${thinkingLevel} thinking).`);
    send({ type: "result", reply, proposal, executiveSummaryInstructions: response.executiveSummaryInstructions, revision: plan.revision });
    res.end();
  } catch (err: any) {
    console.error("[SCOUTAI] Chat failed:", err);
    const error = "ScoutAI couldn't answer just now. Please try again.";
    if (streaming) {
      res.write(`${JSON.stringify({ type: "error", error, details: err?.message || String(err) })}\n`);
      res.end();
    } else {
      res.status(502).json({ error, details: err?.message || String(err) });
    }
  }
});

// The free text an operation would write into the plan, for the number check. Ids and keys are not text.
const NON_TEXT_KEYS = new Set(["type", "channelId", "segmentId", "recordId", "recordType", "campaignId", "findingId", "path", "section", "panel", "dimension", "tier", "list"]);
function opTexts(ops: unknown[]): string[] {
  const out: string[] = [];
  const walk = (value: unknown, key = "") => {
    if (typeof value === "string" && !NON_TEXT_KEYS.has(key)) out.push(value);
    else if (Array.isArray(value)) value.forEach((v) => walk(v, key));
    else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) walk(v, k);
  };
  walk(ops);
  return out;
}

const enabledPublishersForHistory = (publishers: any[]) => publishers.filter((p) => p && p.enabled !== false && p.name).map((p) => String(p.name));

// The past campaigns linked to a plan, analysed. A campaign that fails to load is left out rather
// than failing the chat: the plan conversation still works without it.
async function linkedCampaigns(storage: StorageAdapter, planId: string): Promise<LinkedCampaign[]> {
  try {
    const summaries = (await storage.listPerformanceCampaigns()).filter((c) => c.linkedPlanIds.includes(planId));
    return await campaignsById(storage, summaries.map((c) => c.id));
  } catch (err) {
    console.error("[SCOUTAI] Could not load past campaigns:", err);
    return [];
  }
}

async function campaignsById(storage: StorageAdapter, ids: string[]): Promise<LinkedCampaign[]> {
  const campaigns = await Promise.all(ids.map((id) => storage.getPerformanceCampaign(id)));
  return campaigns.filter((c): c is PerformanceCampaign => Boolean(c && !c.archived)).map((campaign) => {
    const review = readStoredReview(campaign.review);
    return { campaign, analysis: analyzeFiles(campaign.files, campaign), review, reviewStale: Boolean(review && review.fingerprint !== reviewFingerprint(campaign)) };
  });
}

// What operations need beyond the plan: the publisher catalog a CTV publisher may be added from,
// and the settings the plan was built with, whose catalog its channel records come from. A plan
// pins its settings revision, so a later settings change cannot offer it records it was not built
// against.
async function scoutApplyContext(storage: StorageAdapter, plan: { id: string; advertiserName?: string; settingsRevision?: number | null }) {
  const [{ publishers }, settingsRecord] = await Promise.all([
    storage.getCurrentPublishers(),
    Number.isInteger(plan.settingsRevision) ? storage.getSettingsRevision(plan.settingsRevision as number) : storage.getCurrentSettings(),
  ]);
  const validated = validatePlanningSettings(settingsRecord?.settings);
  // Client learnings are checked against the campaigns linked to the plan when they are proposed
  // and again when they are applied, so a campaign unlinked in between cannot slip one through.
  const linked = await linkedCampaigns(storage, plan.id);
  return {
    publisherCatalog: publishers.map((p) => ({ name: p.name, category: p.category, enabled: p.enabled })),
    planningSettings: validated.valid && validated.settings ? validated.settings : DEFAULT_PLANNING_SETTINGS,
    linked,
    learningCampaigns: linked.map((l) => toLearningCampaign(l, plan.advertiserName || "")),
  };
}

// Dry run of the items a planner has kept, so the card shows the combined result before Apply.
app.post("/api/plans/:id/assistant/preview", async (req, res) => {
  try {
    const storage = await getStorage();
    const plan = await storage.getPlan(req.params.id);
    if (!plan || plan.archived) {
      res.status(404).json({ error: `Plan '${req.params.id}' was not found.`, code: "NOT_FOUND" });
      return;
    }
    if (plan.revision !== Number(req.body?.baseRevision)) {
      res.status(409).json({ error: "This plan changed after ScoutAI proposed this.", code: "REVISION_CONFLICT", currentRevision: plan.revision });
      return;
    }
    const { ops, rejected: unreadable } = parseOps(req.body?.ops);
    const result = applyOps(plan.payload, ops, await scoutApplyContext(storage, plan));
    res.json({ changes: result.changes, rejected: [...unreadable, ...result.rejected].map((r) => r.reason) });
  } catch (err: any) {
    respondToStorageError(res, err, "preview the ScoutAI change");
  }
});

app.post("/api/plans/:id/assistant/apply", async (req, res) => {
  try {
    const expectedRevision = Number(req.body?.baseRevision);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
      res.status(428).json({ error: "The revision this change was proposed against is required.", code: "REVISION_REQUIRED" });
      return;
    }
    const storage = await getStorage();
    const plan = await storage.getPlan(req.params.id);
    if (!plan || plan.archived) {
      res.status(404).json({ error: `Plan '${req.params.id}' was not found.`, code: "NOT_FOUND" });
      return;
    }
    if (plan.revision !== expectedRevision) {
      res.status(409).json({ error: "This plan changed after ScoutAI proposed this. Ask ScoutAI to propose it again.", code: "REVISION_CONFLICT", currentRevision: plan.revision });
      return;
    }
    // A revert may restore a removed publisher; a model proposal may not.
    const { ops, rejected: unreadable } = parseOps(req.body?.ops, { allowRestore: req.body?.revert === true });
    if (ops.length === 0 || unreadable.length > 0) {
      res.status(400).json({ error: "The change to apply is missing or unreadable.", reasons: unreadable.map((r) => r.reason) });
      return;
    }
    // The planner approved a specific result. If any part of it no longer applies, apply none of it.
    const result = applyOps(plan.payload, ops, await scoutApplyContext(storage, plan));
    if (result.rejected.length > 0 || result.changes.length === 0) {
      res.status(422).json({
        error: result.changes.length === 0 ? "This change would not alter the plan." : "Part of this change no longer applies to the plan, so nothing was changed.",
        reasons: result.rejected.map((r) => r.reason),
      });
      return;
    }
    const updated = await storage.updatePlan(plan.id, {
      ...planPayloadFromBody({ title: plan.title, advertiserName: plan.advertiserName, settingsRevision: plan.settingsRevision, payload: result.payload }),
      actor: actorName(req),
    }, expectedRevision);
    console.log(`[SCOUTAI] Plan ${plan.id}: ${req.body?.revert === true ? "reverted" : "applied"} ${result.changes.length} change(s) by ${actorName(req)}, r${expectedRevision} -> r${updated.revision}.`);
    res.json({ success: true, plan: updated, changes: result.changes, revertOps: result.revertOps, followUps: detectFollowUps(plan.payload, result.payload) });
  } catch (err: any) {
    respondToStorageError(res, err, "apply the ScoutAI change");
  }
});

// ---- Past campaign performance ----
// An advertiser's library of past campaigns: report sets the planner uploads so ScoutAI can say
// what worked and what to change. A campaign is its own record, linked to plans, so an upload
// never moves a plan's revision. Its analysis is recomputed from the stored files on every read.

function respondToCampaignError(res: any, err: any, context: string) {
  if (err instanceof RevisionConflictError) {
    res.status(409).json({ error: "This campaign was changed by someone else. Reload it and try again.", code: "REVISION_CONFLICT", currentRevision: err.currentRevision });
    return;
  }
  if (err instanceof CampaignNotFoundError) {
    res.status(404).json({ error: err.message, code: "NOT_FOUND" });
    return;
  }
  if (err instanceof CampaignTooLargeError) {
    res.status(413).json({ error: err.message, code: "TOO_LARGE" });
    return;
  }
  console.error(`Error in ${context}:`, err);
  res.status(500).json({ error: `Failed to ${context}`, details: err?.message || String(err) });
}

async function linkablePlanIds(storage: StorageAdapter, ids: unknown[]): Promise<string[]> {
  const plans = await Promise.all(ids.filter((id): id is string => typeof id === "string" && id.length > 0).map((id) => storage.getPlan(id)));
  return plans.filter((p): p is NonNullable<typeof p> => Boolean(p && !p.archived)).map((p) => p.id);
}

function campaignResponse(campaign: PerformanceCampaign) {
  const analysis = analyzeFiles(campaign.files, campaign);
  const review = readStoredReview(campaign.review);
  return {
    campaign: publicCampaign(campaign),
    analysis,
    advertiserMismatch: advertiserMismatch(campaign, analysis),
    review,
    reviewStale: Boolean(review && review.fingerprint !== reviewFingerprint(campaign)),
  };
}

app.get("/api/performance/campaigns", async (req, res) => {
  try {
    const advertiser = typeof req.query.advertiser === "string" ? toAdvertiserKey(req.query.advertiser) : "";
    const planId = typeof req.query.planId === "string" ? req.query.planId : "";
    const campaigns = (await (await getStorage()).listPerformanceCampaigns())
      .filter((c) => (!advertiser && !planId) || (advertiser && c.advertiserKey === advertiser) || (planId && c.linkedPlanIds.includes(planId)));
    res.json({ campaigns, goals: CAMPAIGN_GOALS });
  } catch (err: any) {
    respondToCampaignError(res, err, "list campaigns");
  }
});

// What a set of files would add up to, before anything is saved: the planner confirms the flight,
// the conversion event and the advertiser against what was read.
app.post("/api/performance/preview", async (req, res) => {
  try {
    const { files: added, rejected } = readUploadedFiles(req.body?.files, actorName(req));
    let existing: any = null;
    if (typeof req.body?.campaignId === "string" && req.body.campaignId) {
      existing = await (await getStorage()).getPerformanceCampaign(req.body.campaignId);
      if (!existing || existing.archived) throw new CampaignNotFoundError(req.body.campaignId);
    }
    const { files, duplicates } = mergeFiles(existing?.files ?? [], added);
    const suggested = suggestedDetails(analyzeFiles(files, { flightStart: null, flightEnd: null, conversionLabel: null }));
    // What the planner has set wins over what was saved, which wins over what the files suggest.
    const saved = Object.fromEntries(Object.entries(existing ?? {}).filter(([, v]) => v !== null && v !== ""));
    const merged = { ...suggested, ...saved, ...(req.body?.details ?? {}) };
    const details = readCampaignDetails({ ...merged, advertiserName: merged.advertiserName || "Unnamed advertiser" }).details;
    const analysis = analyzeFiles(files, details ?? { flightStart: null, flightEnd: null, conversionLabel: null });
    res.json({ analysis, suggested, duplicates, rejected, advertiserMismatch: merged.advertiserName ? advertiserMismatch({ advertiserName: merged.advertiserName }, analysis) : null });
  } catch (err: any) {
    respondToCampaignError(res, err, "read the reports");
  }
});

app.post("/api/performance/campaigns", async (req, res) => {
  try {
    const storage = await getStorage();
    const { files: uploaded, rejected } = readUploadedFiles(req.body?.files, actorName(req));
    if (uploaded.length === 0) {
      res.status(400).json({ error: rejected[0] || "Add at least one report.", reasons: rejected });
      return;
    }
    const { files, duplicates } = mergeFiles([], uploaded);
    const { details, error } = readCampaignDetails(req.body?.details, suggestedDetails(analyzeFiles(files, { flightStart: null, flightEnd: null, conversionLabel: null })));
    if (!details) {
      res.status(400).json({ error });
      return;
    }
    const linkedPlanIds = await linkablePlanIds(storage, [req.body?.planId]);
    const campaign = await storage.createPerformanceCampaign({ ...details, linkedPlanIds, files, actor: actorName(req) });
    console.log(`[PERFORMANCE] Campaign ${campaign.id} for ${campaign.advertiserName}: ${files.length} file(s) by ${actorName(req)}.`);
    res.json({ ...campaignResponse(campaign), rejected, duplicates });
  } catch (err: any) {
    respondToCampaignError(res, err, "save the campaign");
  }
});

app.get("/api/performance/campaigns/:id", async (req, res) => {
  try {
    const campaign = await (await getStorage()).getPerformanceCampaign(req.params.id);
    if (!campaign || campaign.archived) throw new CampaignNotFoundError(req.params.id);
    res.json(campaignResponse(campaign));
  } catch (err: any) {
    respondToCampaignError(res, err, "load the campaign");
  }
});

// Details, files and plan links in one revision-checked write. Every field is optional; what is
// left out stays as it is.
app.put("/api/performance/campaigns/:id", async (req, res) => {
  try {
    const expectedRevision = Number(req.get("If-Match"));
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
      res.status(428).json({ error: "An If-Match revision is required to update a campaign.", code: "REVISION_REQUIRED" });
      return;
    }
    const storage = await getStorage();
    const existing = await storage.getPerformanceCampaign(req.params.id);
    if (!existing || existing.archived) throw new CampaignNotFoundError(req.params.id);
    const { details, error } = readCampaignDetails(req.body?.details ?? {}, existing);
    if (!details) {
      res.status(400).json({ error });
      return;
    }
    const remove = new Set(Array.isArray(req.body?.removeFileIds) ? req.body.removeFileIds : []);
    const { files: added, rejected } = readUploadedFiles(req.body?.addFiles, actorName(req));
    const { files, duplicates } = mergeFiles(existing.files.filter((f) => !remove.has(f.id)), added);
    if (files.length === 0) {
      res.status(400).json({ error: "A campaign needs at least one report. Archive it instead." });
      return;
    }
    const unlink = new Set(Array.isArray(req.body?.unlinkPlanIds) ? req.body.unlinkPlanIds : []);
    const linkedPlanIds = [
      ...existing.linkedPlanIds.filter((id) => !unlink.has(id)),
      ...(await linkablePlanIds(storage, Array.isArray(req.body?.linkPlanIds) ? req.body.linkPlanIds : [])),
    ];
    const campaign = await storage.updatePerformanceCampaign(existing.id, { ...details, linkedPlanIds, files, actor: actorName(req) }, expectedRevision);
    res.json({ ...campaignResponse(campaign), rejected, duplicates });
  } catch (err: any) {
    respondToCampaignError(res, err, "update the campaign");
  }
});

// The saved review: one high-thinking read of the campaign, figures checked against its data.
// The planner waits for it once, after upload, and can rewrite it when the files change.
app.post("/api/performance/campaigns/:id/review", async (req, res) => {
  req.socket.setTimeout(0);
  try {
    const expectedRevision = Number(req.get("If-Match"));
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
      res.status(428).json({ error: "An If-Match revision is required to review a campaign.", code: "REVISION_REQUIRED" });
      return;
    }
    const storage = await getStorage();
    const campaign = await storage.getPerformanceCampaign(req.params.id);
    if (!campaign || campaign.archived) throw new CampaignNotFoundError(req.params.id);
    if (campaign.revision !== expectedRevision) throw new RevisionConflictError(campaign.revision);
    const analysis = analyzeFiles(campaign.files, campaign);
    const { data, thinkingLevel } = await generateStructuredJsonWithFallback(
      getAiClient(),
      { systemInstruction: REVIEW_SYSTEM_INSTRUCTION, input: buildReviewInput(campaign, analysis), schema: reviewSchema },
      BRIEF_ATTEMPTS,
    );
    const review = normalizeReview(data, analysis, { actor: actorName(req), fingerprint: reviewFingerprint(campaign) });
    if (review.findings.length === 0) throw new Error("The review came back with no findings.");
    const { files, review: _old, ...details } = campaign;
    const updated = await storage.updatePerformanceCampaign(campaign.id, { ...details, files, review, actor: actorName(req) }, expectedRevision);
    const unverified = review.findings.filter((f) => f.unverified.length).length;
    console.log(`[PERFORMANCE] Review of ${campaign.id}: ${review.findings.length} finding(s)${unverified ? `, ${unverified} with unverified figures` : ""} via ${GEMINI_FLASH_MODEL} (${thinkingLevel} thinking).`);
    res.json(campaignResponse(updated));
  } catch (err: any) {
    respondToCampaignError(res, err, "write the review");
  }
});

app.delete("/api/performance/campaigns/:id", async (req, res) => {
  try {
    await (await getStorage()).archivePerformanceCampaign(req.params.id, actorName(req));
    res.json({ success: true });
  } catch (err: any) {
    respondToCampaignError(res, err, "archive the campaign");
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
async function generatePersonaHeadshot(persona: any, instruction?: string, retryCount: number = 0): Promise<string | null> {
  try {
    const ai = getAiClient();
    
    // Clean up persona characteristics for natural, photorealistic prompt rendering
    const rawGender = persona.gender ? String(persona.gender).replace(/Skews\s+/i, "").replace(/\(\d+%\)/g, "").trim() : "person";
    const rawAge = persona.age ? String(persona.age).trim() : "35";
    const personaName = persona.name || "Audience Persona";

    const customDirective = instruction && instruction.trim()
      ? ` Creative instructions & styling directive: ${instruction.trim()}.`
      : "";

    const prompt = `A clean, authentic, high-quality 1:1 square photographic studio headshot portrait of a ${rawAge} year old ${rawGender}, styled as ${personaName}.${customDirective} Professional portrait lighting, neutral soft-focus studio background, warm, confident, approachable facial expression facing directly toward camera. Single subject, tightly centered on head and shoulders.`;

    console.log(`[GEMINI IMAGE GEN] Generating headshot photo for persona: '${personaName}' (attempt ${retryCount + 1})${instruction ? ` [Instruction: ${instruction.slice(0, 60)}]` : ""}...`);
    
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
        return await generatePersonaHeadshot(persona, instruction, retryCount + 1);
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
      return await generatePersonaHeadshot(persona, instruction, retryCount + 1);
    }
  } catch (err: any) {
    console.error(`[GEMINI IMAGE GEN ERROR] Failed to generate headshot for persona '${persona?.name}':`, err?.message || err);
    if (retryCount === 0) {
      console.log(`[GEMINI IMAGE GEN] Retrying after error for persona '${persona?.name}'...`);
      return await generatePersonaHeadshot(persona, instruction, retryCount + 1);
    }
  }
  return null;
}

// API: Generate individual persona headshot avatar on demand
app.post("/api/generate-persona-avatar", async (req, res) => {
  try {
    const { persona, instruction } = req.body;
    if (!persona || !persona.name) {
      res.status(400).json({ error: "Persona details required." });
      return;
    }
    console.log(`[API /api/generate-persona-avatar] Generating headshot for ${persona.name}${instruction ? ` with custom instruction` : ""}...`);
    const avatarUrl = await generatePersonaHeadshot(persona, instruction);
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

// The executive brief. The client sends the plan as the planner sees it (edits applied, hidden
// sections left out) rather than a plan id, so an unsaved or just-edited plan is summarised as it
// stands. The model writes the words; normalizeBrief fills the facts back in from the plan.
app.post("/api/executive-brief", async (req, res) => {
  req.socket.setTimeout(0);
  try {
    const snapshot = sanitizeBriefSnapshot(req.body?.snapshot);
    if (snapshot.channels.length === 0) {
      res.status(400).json({ error: "This plan has no channel plan yet, so there is nothing to summarise." });
      return;
    }
    const instructions = typeof req.body?.instructions === "string" ? req.body.instructions : "";
    const { systemInstruction, input } = buildBriefPrompt(snapshot, instructions);
    const { data, thinkingLevel } = await generateStructuredJsonWithFallback(
      getAiClient(),
      { systemInstruction, input, schema: buildBriefResponseSchema(snapshot) },
      BRIEF_ATTEMPTS,
    );
    const brief = normalizeBrief(data, snapshot, { instructions, model: `${GEMINI_FLASH_MODEL} (${thinkingLevel})` });
    console.log(`[API /api/executive-brief] ${brief.sections.length} section(s), ${brief.plannerNotes.length} planner note(s) via ${GEMINI_FLASH_MODEL} (${thinkingLevel} thinking).`);
    res.json({ brief });
  } catch (err: any) {
    console.error("Error in /api/executive-brief:", err);
    res.status(502).json({ error: "The executive summary could not be written. Please try again.", details: err?.message || String(err) });
  }
});

// Configuration for Presentation Slide Studio Aspect Ratios (gpt-image-2.5-sunburst)
// All sizes adhere to width and height being multiples of 16, within 655,360 - 8,294,400 pixels
const SLIDE_ASPECT_RATIO_CONFIG: Record<
  string,
  { size: string; width: number; height: number; type: "horizontal" | "square" | "vertical"; name: string }
> = {
  "21:9": { size: "2560x1088", width: 2560, height: 1088, type: "horizontal", name: "Ultrawide" },
  "2:1":  { size: "2560x1280", width: 2560, height: 1280, type: "horizontal", name: "Univisium" },
  "16:9": { size: "2560x1440", width: 2560, height: 1440, type: "horizontal", name: "Widescreen" },
  "3:2":  { size: "2160x1440", width: 2160, height: 1440, type: "horizontal", name: "Classic 3:2" },
  "4:3":  { size: "1920x1440", width: 1920, height: 1440, type: "horizontal", name: "Standard 4:3" },
  "1:1":  { size: "2048x2048", width: 2048, height: 2048, type: "square", name: "Square" },
  "3:4":  { size: "1440x1920", width: 1440, height: 1920, type: "vertical", name: "Portrait 3:4" },
  "2:3":  { size: "1440x2160", width: 1440, height: 2160, type: "vertical", name: "Portrait 2:3" },
  "9:16": { size: "1440x2560", width: 1440, height: 2560, type: "vertical", name: "Vertical / Mobile" },
};

/**
 * Persists a high-resolution base64 PNG slide to disk under /assets/slides/
 * and returns the static asset URL path (/assets/slides/<filename>.png).
 * This prevents multi-megabyte image payloads from inflating Firestore documents.
 */
function persistSlidePngToDisk(base64Data: string, prefix: string = "slide"): string {
  try {
    const slidesDir = path.join(process.cwd(), "assets", "slides");
    if (!fs.existsSync(slidesDir)) {
      fs.mkdirSync(slidesDir, { recursive: true });
    }
    const cleanBase64 = base64Data.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(cleanBase64, "base64");
    const filename = `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.png`;
    const fullPath = path.join(slidesDir, filename);
    fs.writeFileSync(fullPath, buffer);
    return `/assets/slides/${filename}`;
  } catch (err) {
    console.error("[persistSlidePngToDisk] Could not write slide PNG to disk:", err);
    // Graceful fallback to data URL if writing fails
    return base64Data.startsWith("data:") ? base64Data : `data:image/png;base64,${base64Data}`;
  }
}

// API: Generate Presentation Slides for Personas using gpt-image-2.5-sunburst
app.post("/api/personas/generate-slide", async (req, res) => {
  // Prevent socket timeout on long-running image generation
  req.socket.setTimeout(0);

  try {
    const {
      mode = "portfolio", // "portfolio" (4-in-1) | "spotlight" (1 persona)
      personaIndex = 0,
      personas = [],
      advertiserName = "",
      campaignFocus = "",
      geography = "",
      style = "corporate_light", // "corporate_light" | "modern_dark" | "minimal_slate"
      aspectRatio = "16:9",
      customNotes = "",
    } = req.body || {};

    if (!Array.isArray(personas) || personas.length === 0) {
      res.status(400).json({ error: "Personas array is required to generate presentation slide." });
      return;
    }
    // A slide is drawn from the persona exactly as generated. A missing field is refused rather
    // than filled with a stock age, income or narrative that would be rendered as fact.
    const REQUIRED_PERSONA_FIELDS = ["name", "age", "gender", "income", "watch", "browse", "buy", "narrative"];
    const slidePersonas = mode === "spotlight"
      ? [personas[Math.max(0, Math.min(personaIndex, personas.length - 1))]]
      : personas.slice(0, 4);
    const incomplete = slidePersonas
      .map((persona: any) => ({ name: persona?.name || "(unnamed persona)", missing: REQUIRED_PERSONA_FIELDS.filter((field) => !String(persona?.[field] ?? "").trim()) }))
      .filter((entry: any) => entry.missing.length > 0);
    if (incomplete.length > 0) {
      res.status(400).json({
        error: "A persona is missing details the slide needs.",
        details: incomplete.map((entry: any) => `${entry.name}: missing ${entry.missing.join(", ")}`).join("; "),
      });
      return;
    }

    let openai: OpenAI;
    try {
      openai = getOpenaiClient();
    } catch (clientErr: any) {
      res.status(500).json({ error: "OpenAI client configuration error.", details: clientErr.message || clientErr });
      return;
    }

    const ratioInfo = SLIDE_ASPECT_RATIO_CONFIG[aspectRatio] || SLIDE_ASPECT_RATIO_CONFIG["16:9"];
    const targetSize = ratioInfo.size;

    console.log(`[API /api/personas/generate-slide] Starting slide generation. Mode: '${mode}', Style: '${style}', Ratio: '${aspectRatio} (${ratioInfo.name} - ${targetSize})', Personas count: ${personas.length}`);

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
      const personaName = targetPersona.name;
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

      const layoutSection = ratioInfo.type === "vertical"
        ? `BODY CONTENT & COMPOSITION (Fills the ${aspectRatio} vertical canvas cleanly with generous vertical spacing):
The entire image consists purely of the vertically stacked spotlight body cards arranged from top to bottom:

TOP SECTION:
- Prominent Persona Portrait & Demographics:
  • Photographic Studio Portrait: A large, high-definition photorealistic studio headshot portrait of ${personaName} (${targetPersona.age} year old ${targetPersona.gender}). Warm, approachable studio lighting. No border around the photo (completely borderless photo with no stroke, outline, or border ring).
  • Eyebrow Label: "${roleTag.toUpperCase()}" in teal #0e8f86 (Lexend SemiBold)
  • Persona Name: "${personaName}" (Lexend Bold)
  • Demographic Pill Badges: Age: ${targetPersona.age} (teal #0e8f86) | Gender: ${targetPersona.gender} (indigo #6b63e6) | HHI: ${targetPersona.income} (lime #a6cf56)
${geography ? `  • Primary Geography: ${geography}` : ""}

MIDDLE SECTION:
- Three Structured Insight Blocks:
  1. 📺 Connected TV & Viewing Patterns:
     • Eyebrow: "CONNECTED TV & STREAMING" in teal #0e8f86 (Lexend SemiBold)
     • Body: "${targetPersona.watch}" (Lexend Regular in #0c1e24)
  2. 🌐 Digital, Mobile & Web Affinity:
     • Eyebrow: "DIGITAL & MOBILE BEHAVIOR" in teal #0e8f86 (Lexend SemiBold)
     • Body: "${targetPersona.browse}" (Lexend Regular in #0c1e24)
  3. 🛍️ Purchase Drivers & Commerce Behavior:
     • Eyebrow: "COMMERCE & PURCHASE DRIVERS" in teal #0e8f86 (Lexend SemiBold)
     • Body: "${targetPersona.buy}" (Lexend Regular in #0c1e24)

BOTTOM SECTION:
- Executive Persona Narrative & Strategic Recommendation:
  • Narrative Text: "${targetPersona.narrative}" (Lexend Regular in #0c1e24)
  • Strategic Activation Recommendation: "Deploy targeted CTV video creative and synchronized cross-device retargeting to engage ${personaName} during high-attention evening and weekend dayparts."`
        : ratioInfo.type === "square"
        ? `BODY CONTENT & COMPOSITION (Fills the 1:1 square canvas cleanly with balanced spacing):
The entire image consists purely of the balanced spotlight presentation cards:

LEFT SECTION:
- Photographic Studio Portrait & Demographics:
  • Photorealistic studio headshot portrait of ${personaName} (${targetPersona.age} year old ${targetPersona.gender}) with natural soft corners and NO border.
  • Eyebrow Label: "${roleTag.toUpperCase()}" (Lexend SemiBold in teal #0e8f86)
  • Persona Name: "${personaName}" (Lexend Bold)
  • Demographic Badges: Age: ${targetPersona.age} | Gender: ${targetPersona.gender} | HHI: ${targetPersona.income}
${geography ? `  • Primary Geography: ${geography}` : ""}

RIGHT SECTION:
- Executive Narrative & Behavioral Habits:
  • Narrative: "${targetPersona.narrative}"
  • 📺 Watch: ${targetPersona.watch}
  • 🌐 Browse: ${targetPersona.browse}
  • 🛍️ Buy: ${targetPersona.buy}
- Strategic Activation Recommendation container at the bottom.`
        : `BODY CONTENT & COMPOSITION (Fills the ${aspectRatio} canvas cleanly with generous whitespace for a premium executive feel):
The entire image consists purely of the two-column slide body cards:

LEFT COLUMN (~38% of width):
- Photographic Studio Portrait: A large, high-definition photorealistic studio headshot portrait of ${personaName} (${targetPersona.age} year old ${targetPersona.gender}). Warm, approachable, professional studio portrait lighting, facing camera. CRITICAL: For this spotlight layout, the persona image MUST NOT BE ROUND — instead, use what framing works best for the layout (e.g., an elegant vertical portrait or rectangular studio framing with natural soft corners that fills the top of the card). There must be NO border around the persona image (completely borderless, seamless photo placement with no stroke, outline, or border ring).
- Demographic Card directly beneath the portrait:
  • Eyebrow Label: "${roleTag.toUpperCase()}" (Lexend SemiBold in uppercase, 0.08em tracking, in teal #0e8f86)
  • Persona Name: "${personaName}" (Lexend Bold with tight 1.05 leading and -0.02em tracking, prominent title in card)
  • Demographic Pill Badges: Age: ${targetPersona.age} (teal #0e8f86) | Gender: ${targetPersona.gender} (indigo #6b63e6) | HHI: ${targetPersona.income} (lime #a6cf56 accent)
${geography ? `  • Primary Geography: ${geography}` : ""}

RIGHT COLUMN (~62% of width):
- Executive Persona Narrative Card:
  • Eyebrow Label: "AUDIENCE ARCHETYPE NARRATIVE" (Lexend SemiBold in uppercase, 0.08em tracking, in teal #0e8f86)
  • Narrative Text: "${targetPersona.narrative}" (Lexend Regular at 1.5 leading in #0c1e24)
- Three Structured Insight Blocks:
  1. 📺 Connected TV & Viewing Patterns:
     • Eyebrow: "CONNECTED TV & STREAMING" in teal #0e8f86 (Lexend SemiBold, 0.08em tracking)
     • Body: "${targetPersona.watch}" (Lexend Regular at 1.5 leading in #0c1e24)
  2. 🌐 Digital, Mobile & Web Affinity:
     • Eyebrow: "DIGITAL & MOBILE BEHAVIOR" in teal #0e8f86 (Lexend SemiBold, 0.08em tracking)
     • Body: "${targetPersona.browse}" (Lexend Regular at 1.5 leading in #0c1e24)
  3. 🛍️ Purchase Drivers & Commerce Behavior:
     • Eyebrow: "COMMERCE & PURCHASE DRIVERS" in teal #0e8f86 (Lexend SemiBold, 0.08em tracking)
     • Body: "${targetPersona.buy}" (Lexend Regular at 1.5 leading in #0c1e24)
- Media Planning Activation Recommendation:
  • Container: Deep teal (#0e3b42) or cool slate surface with subtle cool-tinted shadow and 1px border.
  • Eyebrow: "STRATEGIC ACTIVATION RECOMMENDATION" in teal #0e8f86 with a small lime #a6cf56 accent tag.
  • Recommendation Text: "Deploy targeted CTV video creative and synchronized cross-device retargeting to engage ${personaName} during high-attention evening and weekend dayparts." (Lexend Regular in #0c1e24 or crisp white if on deep teal)`;

      prompt = `A modern, modular slide body graphic in ${aspectRatio} format (${targetSize}) showcasing an audience persona spotlight, designed to be placed directly onto a white background presentation slide.

CRITICAL PRESENTATION INTEGRATION DIRECTIVES (SLIDE DECK READY):
- ABSOLUTELY NO SLIDE HEADER: Do NOT include any main slide title, do NOT include any slide subtitle, subhead, category banner, or top header text.
- ABSOLUTELY NO LOGO: Do NOT include any company logo, brand mark, insignia, or watermarks anywhere.
- ABSOLUTELY NO FOOTER: Do NOT include any footer bar, disclaimer, confidentiality notice, page number, slide counter, or bottom footer text.
- CANVAS BACKGROUND: PURE SOLID CLEAN WHITE (#FFFFFF) across the entire canvas with no outer border, no framing drop shadow, and no vignette, so it blends seamlessly into a white slide presentation.

${brandDesignGuide}

${layoutSection}

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

      let layoutSection = "";
      if (ratioInfo.type === "vertical") {
        // Vertical format: 4 personas vertically stacked as 4 rows from top to bottom
        layoutSection = `LAYOUT DIRECTIVE: VERTICAL STACK FORMAT (${aspectRatio} ratio, ${targetSize}).
The entire image consists purely of exactly 4 distinct, equal horizontal persona cards vertically stacked one above the other in a single vertical column running from top to bottom across the canvas:
Each stacked card is a full-width horizontal card container featuring:
- On the left: A crisp ROUND (circular) borderless headshot portrait
- In the center and right: Eyebrow tag, Persona Name, Demographics pill badges, 3 Key Media & Purchasing Behaviors (Watch / Browse / Buy), and summary highlight.

${candidatePersonas.map((p: any, idx: number) => `
STACKED ROW CARD ${idx + 1}:
• Photographic Studio Portrait: A crisp ROUND (circular) headshot portrait on the left side of the card showing a realistic ${p.age} year old ${p.gender} with friendly confident expression and professional studio lighting. CRITICAL: The persona image must be ROUND (a perfect circle avatar cutout) and there must be NO border around the persona image (completely borderless circular photo with no stroke, outline, or border ring).
• Eyebrow Tag: "${p.sourceType === "User" ? "TARGET SPECIFIC PERSONA" : p.sourceType === "RFP" ? "CORE RFP TARGET" : "SCOUTAI GROWTH SEGMENT"}" in teal #0e8f86 (Lexend SemiBold in uppercase with 0.08em tracking).
• Persona Name: "${p.name}" (Lexend Bold with tight 1.05 leading and -0.02em tracking).
• Demographic Pills: "${p.gender} | Age ${p.age} | HHI ${p.income}" (Teal #0e8f86, secondary indigo #6b63e6, and subtle lime #a6cf56 accents).
• 3 Key Media & Purchasing Behaviors (Lexend Regular text at 1.5 leading in #0c1e24):
  - 📺 Watch: ${p.watch}
  - 🌐 Browse: ${p.browse}
  - 🛍️ Buy: ${p.buy}
• Summary Highlight: "${(p.narrative || "").slice(0, 100)}..." (Lexend Regular in #0c1e24)
`).join("\n")}`;
      } else if (ratioInfo.type === "square") {
        // Square format: 2x2 balanced grid
        layoutSection = `LAYOUT DIRECTIVE: 2x2 BALANCED GRID FORMAT (1:1 ratio, ${targetSize}).
The entire image consists purely of exactly 4 distinct persona cards arranged in a clean, balanced 2x2 grid (2 columns by 2 rows) filling the square canvas with clean margins and equal quadrants:
Each quadrant card features:
- A crisp ROUND (circular) borderless headshot portrait at the top
- Eyebrow tag, Persona Name, Demographics pill badges, 3 Key Media & Purchasing Behaviors (Watch / Browse / Buy), and summary highlight.

${candidatePersonas.map((p: any, idx: number) => `
QUADRANT CARD ${idx + 1} (Quadrant ${idx === 0 ? "Top-Left" : idx === 1 ? "Top-Right" : idx === 2 ? "Bottom-Left" : "Bottom-Right"}):
• Photographic Studio Portrait: A crisp ROUND (circular) headshot portrait at the top showing a realistic ${p.age} year old ${p.gender} with friendly confident expression and professional studio lighting. CRITICAL: The persona image must be ROUND (a perfect circle avatar cutout) and there must be NO border around the persona image (completely borderless circular photo with no stroke, outline, or border ring).
• Eyebrow Tag: "${p.sourceType === "User" ? "TARGET SPECIFIC PERSONA" : p.sourceType === "RFP" ? "CORE RFP TARGET" : "SCOUTAI GROWTH SEGMENT"}" in teal #0e8f86 (Lexend SemiBold in uppercase with 0.08em tracking).
• Persona Name: "${p.name}" (Lexend Bold with tight 1.05 leading and -0.02em tracking).
• Demographic Pills: "${p.gender} | Age ${p.age} | HHI ${p.income}" (Teal #0e8f86, secondary indigo #6b63e6, and subtle lime #a6cf56 accents).
• 3 Key Media & Purchasing Behaviors (Lexend Regular text at 1.5 leading in #0c1e24):
  - 📺 Watch: ${p.watch}
  - 🌐 Browse: ${p.browse}
  - 🛍️ Buy: ${p.buy}
• Summary Highlight: "${(p.narrative || "").slice(0, 100)}..." (Lexend Regular in #0c1e24)
`).join("\n")}`;
      } else {
        // Horizontal format: 4 cards side-by-side
        layoutSection = `LAYOUT DIRECTIVE: HORIZONTAL 4-COLUMN FORMAT (${aspectRatio} ratio, ${targetSize}).
The entire image consists purely of exactly 4 distinct, equal vertical persona cards arranged horizontally side-by-side across the slide:

${candidatePersonas.map((p: any, idx: number) => `
CARD ${idx + 1}:
• Photographic Studio Portrait: A crisp ROUND (circular) headshot portrait at the top showing a realistic ${p.age} year old ${p.gender} with friendly confident expression and professional studio lighting. CRITICAL: The persona image must be ROUND (a perfect circle avatar cutout) and there must be NO border around the persona image (completely borderless circular photo with no stroke, outline, or border ring).
• Eyebrow Tag: "${p.sourceType === "User" ? "TARGET SPECIFIC PERSONA" : p.sourceType === "RFP" ? "CORE RFP TARGET" : "SCOUTAI GROWTH SEGMENT"}" in teal #0e8f86 (Lexend SemiBold in uppercase with 0.08em tracking).
• Persona Name: "${p.name}" (Lexend Bold with tight 1.05 leading and -0.02em tracking).
• Demographic Pills: "${p.gender} | Age ${p.age} | HHI ${p.income}" (Teal #0e8f86, secondary indigo #6b63e6, and subtle lime #a6cf56 accents).
• 3 Key Media & Purchasing Behaviors (Lexend Regular text at 1.5 leading in #0c1e24):
  - 📺 Watch: ${p.watch}
  - 🌐 Browse: ${p.browse}
  - 🛍️ Buy: ${p.buy}
• Summary Highlight: "${(p.narrative || "").slice(0, 100)}..." (Lexend Regular in #0c1e24)
`).join("\n")}`;
      }

      prompt = `A modern, modular slide body graphic in ${aspectRatio} format (${targetSize}) showcasing 4 audience persona cards, designed to be placed directly onto a white background presentation slide.

CRITICAL PRESENTATION INTEGRATION DIRECTIVES (SLIDE DECK READY):
- ABSOLUTELY NO SLIDE HEADER: Do NOT include any main slide title, do NOT include any slide subtitle, subhead, category banner, or top header text.
- ABSOLUTELY NO LOGO: Do NOT include any company logo, brand mark, insignia, or watermarks anywhere.
- ABSOLUTELY NO FOOTER: Do NOT include any footer bar, disclaimer, confidentiality notice, page number, slide counter, or bottom footer text.
- CANVAS BACKGROUND: PURE SOLID CLEAN WHITE (#FFFFFF) across the entire canvas with no outer border, no framing drop shadow, and no vignette, so it blends seamlessly into a white slide presentation.

${brandDesignGuide}

${layoutSection}

DESIGN & EXECUTION DIRECTIVES:
- Follow all directives in the CORE BRAND DESIGN GUIDE above.
- Round persona images with no border: All 4 persona portrait photos MUST BE ROUND (perfect circular avatars) with absolutely NO border around them (completely borderless circular photos with no outer stroke, ring, or outline).
- Clean card containers with cool slate-tinted neutral backgrounds (#F8FAFC), subtle 1px cool borders (#E2E8F0), and cool-tinted low-contrast shadows on a pure white (#FFFFFF) canvas.
- Deep teal #0e3b42 used for prominent card accents or dark surfaces, primary teal #0e8f86 for active tags, indigo #6b63e6 for secondary badges, and lime #a6cf56 for limited high-impact accents.
- All body copy strictly in #0c1e24.
- Generous whitespace between cards and within containers ensuring an uncluttered, high-end executive look.
- Razor-sharp, high-contrast, perfectly legible Lexend typography throughout.
- STRICT REMINDER: ONLY produce the 4 persona cards. NO top slide title, NO subhead, NO logo, NO footer text.
${customNotes ? `ADDITIONAL USER DIRECTIVE: ${customNotes}` : ""}`;
    }

    console.log(`[API /api/personas/generate-slide] Dispatching request to OpenAI model 'gpt-image-2.5-sunburst' (size: ${targetSize})...`);

    let resultImageBase64: string | null = null;
    let revisedPrompt: string | undefined = undefined;

    // Try edit endpoint if reference files exist
    if (referenceFiles.length > 0) {
      try {
        console.log(`[API /api/personas/generate-slide] Attempting openai.images.edit with ${referenceFiles.length} reference image(s) (size: ${targetSize})...`);
        const editResponse = await withTimeout(
          openai.images.edit({
            model: "gpt-image-2.5-sunburst",
            image: referenceFiles.length === 1 ? referenceFiles[0] : referenceFiles,
            prompt,
            size: targetSize,
            quality: "xhigh",
          } as any),
          180000,
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
      console.log(`[API /api/personas/generate-slide] Calling openai.images.generate with gpt-image-2.5-sunburst (size: ${targetSize})...`);
      const genResponse = await withTimeout(
        openai.images.generate({
          model: "gpt-image-2.5-sunburst",
          prompt,
          size: targetSize,
          quality: "xhigh",
        } as any),
        180000,
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

    const savedAssetUrl = persistSlidePngToDisk(resultImageBase64, `persona-${mode}-${personaIndex}`);
    const finalImageUrl = savedAssetUrl;
    res.json({
      success: true,
      imageUrl: finalImageUrl,
      dataUrl: `data:image/png;base64,${resultImageBase64}`,
      model: "gpt-image-2.5-sunburst",
      mode,
      personaIndex,
      aspectRatio,
      dimensions: { width: ratioInfo.width, height: ratioInfo.height },
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

// API: Generate Presentation Slides for Channel Strategy using gpt-image-2.5-sunburst
app.post("/api/channels/generate-slide", async (req, res) => {
  // Prevent socket timeout on long-running image generation
  req.socket.setTimeout(0);

  try {
    const {
      mode = "overview", // "overview" (all active channels on 1 slide) | "spotlight" (1 channel deep dive)
      channelIndex = 0,
      channels = [],
      workingMediaBudget = 0,
      flightDays = null,
      appliedBudgetTier = "",
      advertiserName = "",
      campaignFocus = "",
      geography = "",
      style = "corporate_light", // "corporate_light" | "modern_dark" | "minimal_slate"
      aspectRatio = "16:9",
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

    const ratioInfo = SLIDE_ASPECT_RATIO_CONFIG[aspectRatio] || SLIDE_ASPECT_RATIO_CONFIG["16:9"];
    const targetSize = ratioInfo.size;

    console.log(`[API /api/channels/generate-slide] Starting channel slide generation. Mode: '${mode}', Style: '${style}', Ratio: '${aspectRatio} (${ratioInfo.name} - ${targetSize})', Active channels count: ${channels.length}`);

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
      const score = targetChannel.recommendationScore ? targetChannel.recommendationScore.toFixed(1) : "n/a";
      const confidence = targetChannel.confidence || "Not assessed";

      // Extract tactics & publishers
      const tactics = Array.isArray(targetChannel.targetingTactics) && targetChannel.targetingTactics.length > 0
        ? targetChannel.targetingTactics.slice(0, 3).map((t: any) => t.displayName || t.id).join(", ")
        : "Not specified in the plan";

      const publishers = Array.isArray(targetChannel.publishers) && targetChannel.publishers.length > 0
        ? targetChannel.publishers.slice(0, 4).map((p: any) => p.displayName || p.id).join(", ")
        : "Not specified in the plan";

      const enhancements = Array.isArray(targetChannel.creativeEnhancements) && targetChannel.creativeEnhancements.length > 0
        ? targetChannel.creativeEnhancements.slice(0, 3).map((e: any) => e.displayName || e.id).join(", ")
        : "Not specified in the plan";

      const measurement = Array.isArray(targetChannel.measurementCapabilities) && targetChannel.measurementCapabilities.length > 0
        ? targetChannel.measurementCapabilities.slice(0, 3).map((m: any) => m.displayName || m.id).join(", ")
        : "Not specified in the plan";

      let compositionSection = "";
      if (ratioInfo.type === "vertical") {
        compositionSection = `BODY CONTENT & COMPOSITION (Fills the ${aspectRatio} vertical canvas cleanly with generous vertical spacing):
The entire image consists purely of vertically stacked channel strategy cards arranged from top to bottom:

TOP SECTION:
- Prominent Channel Overview Card:
  • Eyebrow Label: "CHANNEL STRATEGY" in teal #0e8f86 (Lexend SemiBold uppercase)
  • Channel Name: "${channelName}" (Lexend Bold)
  • Strategic Role: "${targetChannel.role || "Not specified in the plan"}" (Lexend Regular, #0c1e24)
  • Primary Allocation Metric Callout (Deep teal #0e3b42 card with lime #a6cf56 accent):
    - Percentage: "${allocPct}% of Total Budget"
    - Dollars: "${allocDollars}"
  • Badges: Fit Score: "${score}/100" | Confidence: "${confidence}"

MIDDLE SECTION:
- Structured Execution Cards (stacked vertically):
  1. 🎯 Targeting: "${tactics}"
  2. 📺 Publishers: "${publishers}"
  3. 🎨 Creative & Inventory Controls: "${enhancements}"
  4. 📊 Measurement & Attribution: "${measurement}"

BOTTOM SECTION:
- Strategic Allocation Rationale: "${targetChannel.allocationRationale || "Not specified in the plan"}"`;
      } else if (ratioInfo.type === "square") {
        compositionSection = `BODY CONTENT & COMPOSITION (Fills the 1:1 square canvas cleanly with balanced spacing):
The entire image consists purely of the channel strategy presentation cards:

LEFT SECTION:
- Prominent Channel Overview Card:
  • Eyebrow Label: "CHANNEL STRATEGY" in teal #0e8f86
  • Channel Name: "${channelName}" (Lexend Bold)
  • Strategic Role: "${targetChannel.role || "Not specified in the plan"}"
  • Primary Allocation Metric: "${allocPct}% of Budget" (${allocDollars})
  • Badges: Fit Score: "${score}/100" | Confidence: "${confidence}"

RIGHT SECTION:
- 4 Execution Cards in a 2x2 grid:
  1. 🎯 Targeting: "${tactics}"
  2. 📺 Publishers: "${publishers}"
  3. 🎨 Creative: "${enhancements}"
  4. 📊 Measurement: "${measurement}"
- Strategic Allocation Rationale container along the bottom.`;
      } else {
        compositionSection = `BODY CONTENT & COMPOSITION (Fills the ${aspectRatio} canvas cleanly with generous whitespace for a premium executive feel):
The entire image consists purely of the two-column slide body cards:

LEFT COLUMN (~36% of width):
- Prominent Channel Overview Card:
  • Eyebrow Label: "CHANNEL STRATEGY" (Lexend SemiBold in uppercase, 0.08em tracking, in teal #0e8f86)
  • Channel Name: "${channelName}" (Lexend Bold with tight 1.05 leading and -0.02em tracking, prominent title in card)
  • Strategic Role: "${targetChannel.role || "Not specified in the plan"}" (Lexend Regular, #0c1e24)
  • Primary Allocation Metric Callout (Deep teal #0e3b42 background card with lime #a6cf56 accent):
    - Percentage: "${allocPct}% of Total Budget" (Large bold display)
    - Dollars: "${allocDollars}" (Prominent secondary figure)
  • Key Badges:
    - Fit Score: "${score}/100" (Indigo #6b63e6 pill)
    - Confidence: "${confidence}" (Lime #a6cf56 accent badge)
    - Flight Duration: "${flightDays ? `${flightDays} Days` : "Not set in the plan"}"
  • Strategic Alignment Callout: "${targetChannel.gapAddressed || "Not specified in the plan"}"

RIGHT COLUMN (~64% of width):
- Four Structured Execution Cards in a clean 2x2 grid:
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
  • Text: "${targetChannel.allocationRationale || "Not specified in the plan"}" (Lexend Regular in #0c1e24)`;
      }

      prompt = `A modern, modular slide body graphic in ${aspectRatio} format (${targetSize}) showcasing a single media channel strategy spotlight deep dive, designed to be placed directly onto a white background presentation slide.

CRITICAL PRESENTATION INTEGRATION DIRECTIVES (SLIDE DECK READY):
- ABSOLUTELY NO SLIDE HEADER: Do NOT include any main slide title, do NOT include any slide subtitle, subhead, category banner, or top header text.
- ABSOLUTELY NO LOGO: Do NOT include any company logo, brand mark, insignia, or watermarks anywhere.
- ABSOLUTELY NO FOOTER: Do NOT include any footer bar, disclaimer, confidentiality notice, page number, slide counter, or bottom footer text.
- ABSOLUTELY NO "TACTICAL TEST" OR STATUS LABELS: Do NOT include any "Tactical Test", "Recommended Core", or test status tags anywhere.
- ABSOLUTELY NO "KEY BENCHMARK" OR CPM VALUES: Do NOT display any "Key Benchmark", "$CPM", CPM rates, or benchmark pricing numbers anywhere on the slide.
- CANVAS BACKGROUND: PURE SOLID CLEAN WHITE (#FFFFFF) across the entire canvas with no outer border, no framing drop shadow, and no vignette, so it blends seamlessly into a white slide presentation.
- NO UNSELECTED CANDIDATES: Only display this active, funded channel from the approved media plan.

${brandDesignGuide}

${compositionSection}

DESIGN & EXECUTION DIRECTIVES:
- Follow all directives in the CORE BRAND DESIGN GUIDE above.
- Clean graphic card containers with subtle 1px border outlines (#E2E8F0) and rounded corners (12px) on a pure white (#FFFFFF) background.
- Generous whitespace throughout ensuring an uncluttered, high-end presentation feel.
- Razor-sharp, high-contrast, perfectly legible Lexend typography.
- STRICT REMINDER: ONLY produce the visual body cards. NO top slide title, NO subhead, NO logo, NO footer text.
${customNotes ? `ADDITIONAL USER DIRECTIVE: ${customNotes}` : ""}`;

    } else {
      // mode === "overview" (All active funded channels on 1 slide)
      const activeChannels = Array.isArray(channels) ? channels : [];
      const numChannels = activeChannels.length;
      const totalBudgetFormatted = workingMediaBudget ? `$${Math.round(workingMediaBudget).toLocaleString()}` : "$0";

      // Determine adaptive layout geometry and content selectivity based on active channel count and aspect ratio orientation
      let layoutInstruction = "";
      let densityLevel: "spacious" | "moderate" | "compact" | "ultra_compact" = "spacious";
      let selectiveContentRule = "";

      if (ratioInfo.type === "vertical") {
        densityLevel = numChannels <= 4 ? "moderate" : numChannels <= 7 ? "compact" : "ultra_compact";
        layoutInstruction = `A single vertical column of ${numChannels} stacked horizontal channel allocation cards running top to bottom down the ${aspectRatio} vertical canvas, sized proportionally with clean spacing between cards.`;
        selectiveContentRule = `Streamlined vertical card metrics: Channel Name, Allocation (% and $), and Strategic Role (1 concise phrase) so all ${numChannels} channel rows fit cleanly down the vertical canvas.`;
      } else if (ratioInfo.type === "square") {
        densityLevel = numChannels <= 4 ? "spacious" : "compact";
        const rows = Math.ceil(Math.sqrt(numChannels));
        const cols = Math.ceil(numChannels / rows);
        layoutInstruction = `A balanced ${rows}×${cols} modular grid proportioned for the 1:1 square canvas, guaranteeing all ${numChannels} channels have equal visual weight and ample padding.`;
        selectiveContentRule = `Balanced square card metrics: Channel Name, Allocation (% and $), and Concise Strategic Objective.`;
      } else {
        // Horizontal / widescreen ratios
        if (numChannels <= 4) {
          densityLevel = "spacious";
          layoutInstruction = `A single horizontal row of ${numChannels} spacious, equal-width vertical cards arranged side-by-side across the ${aspectRatio} canvas with generous whitespace and margins.`;
          selectiveContentRule = `Full detail included: Channel Name, Allocation (% and $), Strategic Role, Recommendation Fit Score, Publishers, and Core Alignment.`;
        } else if (numChannels === 5) {
          densityLevel = "moderate";
          layoutInstruction = `A single horizontal row of 5 streamlined vertical cards arranged side-by-side with balanced margins across the ${aspectRatio} canvas.`;
          selectiveContentRule = `Streamlined content: Channel Name, Allocation (% and $), Strategic Role, and Top Publishers. Lengthy narrative text is excluded to maintain clean vertical breathing room.`;
        } else if (numChannels === 6) {
          densityLevel = "compact";
          layoutInstruction = `A balanced 2-row × 3-column modular grid (3 equal-sized cards in the top row, 3 equal-sized cards in the bottom row), guaranteeing all 6 channels have ample room, uniform dimensions, and equal visual weight across the ${aspectRatio} slide.`;
          selectiveContentRule = `Selective high-impact metrics: Channel Name, Allocation (% and $), and Concise Strategic Objective (1 phrase). Verbose publisher listings and long narrative paragraphs are selectively excluded to ensure large, crisp, legible typography and zero visual crowding.`;
        } else if (numChannels <= 8) {
          densityLevel = "compact";
          layoutInstruction = `A balanced 2-row modular grid (4 equal-sized cards in the top row, and ${numChannels - 4} equal-sized cards uniformly spaced in the bottom row), sizing all card containers proportionally within the ${aspectRatio} canvas.`;
          selectiveContentRule = `Selective executive metrics: Channel Name, Allocation (% and $), and Concise Strategic Role (single phrase). Secondary narrative is omitted to preserve comfortable spacing, clear card borders, and prominent numbers.`;
        } else {
          densityLevel = "ultra_compact";
          const rows = numChannels <= 12 ? 2 : 3;
          const cols = Math.ceil(numChannels / rows);
          layoutInstruction = `A structured executive allocation matrix organized into ${rows} balanced rows of ${cols} cards, uniformly proportioned so all ${numChannels} channels fit comfortably within the ${aspectRatio} canvas.`;
          selectiveContentRule = `Ultra-streamlined essential metrics: Channel Name, Allocation (% and $), and 1-line Core Role. Publisher lists and descriptions are excluded to ensure crystal-clear readability and comfortable spacing for all ${numChannels} channels.`;
        }
      }

      prompt = `A modern, modular slide body graphic in ${aspectRatio} format (${targetSize}) showcasing an executive media mix and channel allocation portfolio, designed to be placed directly onto a white background presentation slide.

CRITICAL PRESENTATION INTEGRATION DIRECTIVES (SLIDE DECK READY):
- ABSOLUTELY NO SLIDE HEADER: Do NOT include any main slide title, do NOT include any slide subtitle, subhead, category banner, or top header text.
- ABSOLUTELY NO LOGO: Do NOT include any company logo, brand mark, insignia, or watermarks anywhere.
- ABSOLUTELY NO FOOTER: Do NOT include any footer bar, disclaimer, confidentiality notice, page number, slide counter, or bottom footer text.
- ABSOLUTELY NO "TACTICAL TEST" OR STATUS TAGS: Do NOT include "Tactical Test", "Core Strategy", or status tags/eyebrows anywhere on the cards.
- ABSOLUTELY NO "KEY BENCHMARK" OR CPM VALUES: Do NOT display "Key Benchmark", "$CPM", CPM rates, or pricing benchmark numbers anywhere on the slide.
- CANVAS BACKGROUND: PURE SOLID CLEAN WHITE (#FFFFFF) across the entire canvas with no outer border, no framing drop shadow, and no vignette, so it blends seamlessly into a white slide presentation.
- NO UNSELECTED CANDIDATES: Absolutely DO NOT include any out-of-plan channels, rejected options, or "media types not in plan". Strictly feature ONLY the ${numChannels} funded active channels listed below.

${brandDesignGuide}

CRITICAL SLIDE PACKING & ADAPTIVE LAYOUT DIRECTIVE:
- ALL ${numChannels} CHANNELS MUST BE VISIBLE: Every one of the ${numChannels} funded active channels listed below MUST have its own designated card/tile. Do NOT skip, combine, or omit ANY channel.
- ADAPTIVE CARD GEOMETRY:
  ${layoutInstruction}
- CONTENT SELECTIVITY & BREATHING ROOM:
  To guarantee all ${numChannels} channels fit inside the ${aspectRatio} canvas (${targetSize}) without clipping, overflowing, or tiny unreadable text:
  ${selectiveContentRule}
  The cards must maintain comfortable margins, generous internal padding, crisp borders (#E2E8F0), and readable typography.

BODY CONTENT & COMPOSITION (Fills the ${aspectRatio} canvas cleanly with generous whitespace for a premium executive feel):
The entire image consists purely of the executive media allocation portfolio cards:

TOP SUMMARY STRIP:
- High-level allocation summary bar displaying:
  • Working Media Budget: "${totalBudgetFormatted}" (Bold Lexend display with lime #a6cf56 accent)
  • Flight Duration: "${flightDays ? `${flightDays} Days` : "Not set in the plan"}" (Lexend SemiBold)
  • Channels: "${numChannels} Channels" (Indigo #6b63e6 pill)
  (STRICT: Exclude Budget Tier completely from the slide export summary. Do NOT display any "Budget Tier" pill, label, or tier name. Only show Working Media Budget, Flight Duration, and Channels count.)
- Horizontal proportional color-segmented allocation bar visually representing the budget split across all ${numChannels} channels.

ACTIVE CHANNEL PORTFOLIO CARDS (${numChannels} cards arranged according to the adaptive grid layout above):
${activeChannels.map((c: any, idx: number) => {
  const pct = c.allocationPercent != null ? Math.round(c.allocationPercent) : 0;
  const dollars = c.allocationDollars ? `$${Math.round(c.allocationDollars).toLocaleString()}` : "";
  const score = c.recommendationScore ? c.recommendationScore.toFixed(1) : "9.0";
  const pubText = Array.isArray(c.publishers) && c.publishers.length > 0
    ? c.publishers.slice(0, 2).map((p: any) => p.displayName || p.id).join(", ")
    : "Not specified in the plan";

  if (densityLevel === "spacious") {
    return `
CARD ${idx + 1}: ${c.channelName}
• Channel Title: "${c.channelName}" (Lexend Bold)
• Allocation Callout: "${pct}%" / "${dollars}" (Large bold metric with lime #a6cf56 highlight)
• Strategic Role: "${c.role || "Not specified in the plan"}" (Lexend Regular in #0c1e24)
• Fit Score: "${score}/100" (Indigo #6b63e6 badge)
• Key Publishers / Environments: "${pubText}"
• Strategic Alignment: "${c.gapAddressed || "Not specified in the plan"}"
`;
  }

  if (densityLevel === "moderate") {
    return `
CARD ${idx + 1}: ${c.channelName}
• Channel Title: "${c.channelName}" (Lexend Bold)
• Allocation Callout: "${pct}%" / "${dollars}" (Large bold metric with lime #a6cf56 highlight)
• Strategic Role: "${c.role || "Not specified in the plan"}" (Lexend Regular, 1 concise sentence)
• Key Environment: "${pubText}"
(Selective Content Fit: Lengthy tactical narrative excluded to preserve vertical breathing space)`;
  }

  if (densityLevel === "compact") {
    return `
CARD ${idx + 1}: ${c.channelName}
• Channel Title: "${c.channelName}" (Lexend Bold)
• Allocation Callout: "${pct}%" / "${dollars}" (Prominent bold metric with lime #a6cf56 highlight)
• Strategic Objective: "${c.role || "Not specified in the plan"}" (Concise single phrase)
(Selective Content Fit: Publishers list and narrative excluded so all ${numChannels} cards fit cleanly into the 2-row grid with high legibility)`;
  }

  // ultra_compact
  return `
CARD ${idx + 1}: ${c.channelName}
• Channel Title: "${c.channelName}" (Lexend Bold)
• Allocation Callout: "${pct}%" / "${dollars}" (Prominent bold metric with lime #a6cf56 highlight)
• Primary Objective: "${c.role || "Not specified in the plan"}" (Brief 1-phrase summary)
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

    console.log(`[API /api/channels/generate-slide] Dispatching request to OpenAI model 'gpt-image-2.5-sunburst' (size: ${targetSize})...`);

    const genResponse = await withTimeout(
      openai.images.generate({
        model: "gpt-image-2.5-sunburst",
        prompt,
        size: targetSize,
        quality: "xhigh",
      } as any),
      180000,
      null
    );

    if (!genResponse || !genResponse.data || !genResponse.data[0]?.b64_json) {
      throw new Error("gpt-image-2.5-sunburst did not return image data for channel slide.");
    }

    const resultImageBase64 = genResponse.data[0].b64_json;
    const revisedPrompt = genResponse.data[0].revised_prompt;
    console.log("[API /api/channels/generate-slide] Successfully generated channel slide using openai.images.generate!");

    const savedAssetUrl = persistSlidePngToDisk(resultImageBase64, `channel-${mode}-${channelIndex}`);
    const finalImageUrl = savedAssetUrl;
    res.json({
      success: true,
      imageUrl: finalImageUrl,
      dataUrl: `data:image/png;base64,${resultImageBase64}`,
      model: "gpt-image-2.5-sunburst",
      mode,
      channelIndex,
      aspectRatio,
      dimensions: { width: ratioInfo.width, height: ratioInfo.height },
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

// API: Generate Presentation Slides for Recommended Segments using gpt-image-2.5-sunburst
app.post("/api/segments/generate-slide", async (req, res) => {
  // Prevent socket timeout on long-running image generation
  req.socket.setTimeout(0);

  try {
    const {
      segments = [],
      advertiserName = "",
      campaignFocus = "",
      geography = "",
      style = "corporate_light", // "corporate_light" | "modern_dark" | "minimal_slate"
      aspectRatio = "16:9",
      customNotes = "",
    } = req.body || {};

    if (!Array.isArray(segments) || segments.length === 0) {
      res.status(400).json({ error: "Segments array is required to generate presentation slide." });
      return;
    }

    let openai: OpenAI;
    try {
      openai = getOpenaiClient();
    } catch (clientErr: any) {
      res.status(500).json({ error: "OpenAI client configuration error.", details: clientErr.message || clientErr });
      return;
    }

    const ratioInfo = SLIDE_ASPECT_RATIO_CONFIG[aspectRatio] || SLIDE_ASPECT_RATIO_CONFIG["16:9"];
    const targetSize = ratioInfo.size;

    console.log(`[API /api/segments/generate-slide] Starting segment slide generation. Style: '${style}', Ratio: '${aspectRatio} (${ratioInfo.name} - ${targetSize})', Segments count: ${segments.length}`);

    // EXACT BRAND DESIGN GUIDE (Mandatory across all slide layouts)
    const brandDesignGuide = `
CORE BRAND DESIGN GUIDE & AESTHETIC SPECIFICATION (MANDATORY FOR ALL LAYOUTS):
- COLOR PALETTE & TONAL EXECUTION:
  • Primary Color: Teal #0e8f86 (used for primary brand elements, key highlights, active tags, and primary accents).
  • Dark Surfaces: Deep Teal #0e3b42 for dark surfaces, rich container backgrounds, or high-contrast card blocks.
  • Secondary Color: Indigo #6b63e6 for secondary tags, supporting category indicators, and demographic badges.
  • Limited Accents: Lime #a6cf56 for high-impact metric callouts, core targeting badges, and tier indicators.
  • Neutrals & Body Copy: Cool slate-tinted neutrals with all body text and descriptions rendered strictly at #0c1e24 rather than true black.
  • Elevation & Shadows: Shadows are cool-tinted and low-contrast, providing soft, premium depth without harsh dark edges.
  • Layout & Negative Space: Layout stays generous and breathable because ample whitespace is an intentional part of the premium feel.
- TYPOGRAPHY SYSTEM (LEXEND THROUGHOUT):
  • Typeface: Lexend throughout all textual elements.
  • Headlines & Dimension Titles: Lexend Bold with tight 1.05 leading and -0.02em tracking.
  • Body Text & Justifications: Lexend Regular at 1.4 leading with body text in #0c1e24.
  • Eyebrow Labels & Category Badges: Lexend SemiBold in all-caps (UPPERCASE) with 0.08em tracking for teal (#0e8f86) eyebrow labels.
`;

    // Palette & visual styling directives - optimized for white background slide decks
    let paletteDesc = "Pure white presentation canvas (#FFFFFF) with cool slate-tinted neutral card containers (#F8FAFC), subtle 1px cool borders (#E2E8F0), body text at #0c1e24, primary teal #0e8f86 accents, deep teal #0e3b42 dark surfaces, indigo #6b63e6 secondary accents, and limited lime #a6cf56 highlights";
    if (style === "modern_dark") {
      paletteDesc = "Executive dark theme: deep teal (#0e3b42) canvas and surfaces, clean white text, teal #0e8f86 and indigo #6b63e6 accents, limited lime #a6cf56 callouts, with subtle cool-tinted low-contrast borders";
    } else if (style === "minimal_slate") {
      paletteDesc = "Refined minimal editorial theme: pure white canvas (#FFFFFF), high-contrast #0c1e24 typography in Lexend, subtle cool slate borders (#E2E8F0), teal #0e8f86 eyebrow labels, and indigo #6b63e6 accents";
    }

    // Group segments by dimension
    const dimensionOrder = ["In-Market / Intent", "Behavioral", "Interest & Affinity", "Demographics"] as const;
    const groupedSegments: Record<string, any[]> = {};
    for (const d of dimensionOrder) {
      const match = segments.filter((s: any) => s.dimension === d);
      if (match.length > 0) {
        groupedSegments[d] = match;
      }
    }
    // Also include any segments with other dimensions if present
    const otherSegments = segments.filter((s: any) => !dimensionOrder.includes(s.dimension));
    if (otherSegments.length > 0) {
      groupedSegments["Strategic Target Segments"] = otherSegments;
    }

    const activeDimensions = Object.keys(groupedSegments);
    const numDimensions = activeDimensions.length || 1;

    let bentoLayoutInstruction = "";
    if (ratioInfo.type === "vertical") {
      bentoLayoutInstruction = `STRUCTURED VERTICAL BENTO BANDS OF AUDIENCE SEGMENTS (Stacked in ${numDimensions} horizontal rows/bands from top to bottom across the ${aspectRatio} vertical canvas):`;
    } else if (ratioInfo.type === "square") {
      bentoLayoutInstruction = `STRUCTURED 2x2 QUADRANT BENTO GRID OF AUDIENCE SEGMENTS (Arranged into 4 balanced quadrants for the 1:1 square canvas):`;
    } else {
      bentoLayoutInstruction = `STRUCTURED BENTO GRID OF AUDIENCE SEGMENTS (Arranged across ${numDimensions} balanced columns/containers side-by-side):`;
    }

    const prompt = `A modern, modular slide body graphic in ${aspectRatio} format (${targetSize}) showcasing target audience segment recommendations, designed to be placed directly onto a white background presentation slide.

CRITICAL PRESENTATION INTEGRATION DIRECTIVES (SLIDE DECK READY):
- ABSOLUTELY NO SLIDE HEADER: Do NOT include any main slide title, do NOT include any slide subtitle, subhead, category banner, or top header text.
- ABSOLUTELY NO LOGO: Do NOT include any company logo, brand mark, insignia, or watermarks anywhere.
- ABSOLUTELY NO FOOTER: Do NOT include any footer bar, disclaimer, confidentiality notice, page number, slide counter, or bottom footer text.
- CANVAS BACKGROUND: ${style === "modern_dark" ? "DEEP TEAL (#0e3b42)" : "PURE SOLID CLEAN WHITE (#FFFFFF)"} across the entire canvas with no outer border, no framing drop shadow, and no vignette, so it blends seamlessly into a presentation deck.

${brandDesignGuide}
VISUAL THEME: ${paletteDesc}

BODY CONTENT & COMPOSITION (Fills the ${aspectRatio} canvas cleanly with generous whitespace for a premium executive feel):
The entire image consists purely of the structured audience segment recommendation containers:

TOP SUMMARY STRIP:
- High-level audience segment summary bar displaying:
  • Scope: "${segments.length} Curated Audience Segments" (Bold Lexend display with teal #0e8f86 highlight)
  • Categories: "${activeDimensions.length} Targeting Dimensions" (Indigo #6b63e6 pill)
  • Core Focus: "${advertiserName ? `${advertiserName} Campaign` : "Digital Media Campaign"}" (Lexend SemiBold in #0c1e24)
  ${geography ? `• Target Geography: "${geography}"` : ""}

${bentoLayoutInstruction}
${activeDimensions.map((dim, colIdx) => {
  const dimSegs = groupedSegments[dim];
  const colorAccent = colIdx % 3 === 0 ? "teal #0e8f86" : colIdx % 3 === 1 ? "indigo #6b63e6" : "deep teal #0e3b42";
  return `
SECTION ${colIdx + 1}: ${dim.toUpperCase()} (${dimSegs.length} Segments)
- Container Header:
  • Dimension Label: "${dim.toUpperCase()}" (Lexend Bold with ${colorAccent} badge)
  • Subtitle: "${dimSegs.length} Active Segments"
- Segment Cards within this container:
${dimSegs.map((s: any, sIdx: number) => {
  const tier = s.tier || "Core";
  const tierColor = tier === "Core" ? "teal #0e8f86" : tier === "Expansion" ? "indigo #6b63e6" : "lime #a6cf56";
  const signal = s.dataSignal ? `Data Signal: ${s.dataSignal}` : "";
  const just = s.justification ? `Rationale: ${s.justification}` : "";
  return `  • Segment ${sIdx + 1}: "${s.name}"
    - Tier: "${tier.toUpperCase()}" (${tierColor} pill badge)
    ${signal ? `- Signal: "${s.dataSignal}"` : ""}
    ${just ? `- Activation Rationale: "${just}" (Lexend Regular in #0c1e24, 1 concise sentence)` : ""}
  `;
}).join("\n")}
`;
}).join("\n")}

DESIGN & EXECUTION DIRECTIVES:
- Follow all directives in the CORE BRAND DESIGN GUIDE above.
- Clean graphic card containers with subtle 1px cool borders (#E2E8F0) and softly rounded corners (12px).
- Crisp typography in Lexend with clear hierarchy between Segment Name (Bold), Tier/Data Signal badges, and concise rationale copy.
- Generous whitespace throughout ensuring an uncluttered, high-end presentation feel.
- STRICT REMINDER: ONLY produce the visual body cards. NO top slide title, NO subhead, NO logo, NO footer text.
${customNotes ? `ADDITIONAL USER DIRECTIVE: ${customNotes}` : ""}`;

    console.log(`[API /api/segments/generate-slide] Dispatching request to OpenAI model 'gpt-image-2.5-sunburst' (size: ${targetSize})...`);

    const genResponse = await withTimeout(
      openai.images.generate({
        model: "gpt-image-2.5-sunburst",
        prompt,
        size: targetSize,
        quality: "xhigh",
      } as any),
      180000,
      null
    );

    if (!genResponse || !genResponse.data || !genResponse.data[0]?.b64_json) {
      throw new Error("gpt-image-2.5-sunburst did not return image data for segments slide.");
    }

    const resultImageBase64 = genResponse.data[0].b64_json;
    const revisedPrompt = genResponse.data[0].revised_prompt;
    console.log("[API /api/segments/generate-slide] Successfully generated segments slide using openai.images.generate!");

    const savedAssetUrl = persistSlidePngToDisk(resultImageBase64, `segments-recommendations`);
    const finalImageUrl = savedAssetUrl;
    res.json({
      success: true,
      imageUrl: finalImageUrl,
      dataUrl: `data:image/png;base64,${resultImageBase64}`,
      model: "gpt-image-2.5-sunburst",
      aspectRatio,
      dimensions: { width: ratioInfo.width, height: ratioInfo.height },
      revisedPrompt,
    });
  } catch (err: any) {
    console.error("[API /api/segments/generate-slide ERROR]:", err);
    res.status(500).json({
      error: "Failed to generate segment recommendations presentation slide.",
      details: err.message || String(err),
    });
  }
});

// API: Summarize Publisher Insights with AI if text is too long for presentation slides
// The executive brief as a slide. The client sends the slide text it built from the brief (and
// the planner may have edited); it is rendered verbatim, then read back by Gemini and compared,
// since image models misspell and misnumber dense text. The image is returned inline rather
// than written to disk: files under assets/ exist only on the Cloud Run instance that wrote them.
const SLIDE_LAYOUTS = new Set<BriefSlideLayout>(["highlights", "strategy", "audience", "execution", "history"]);
const SLIDE_STYLES = new Set<BriefSlideStyle>(["corporate_light", "modern_dark", "minimal_slate"]);
const MAX_SLIDE_TEXT = 4000;

app.post("/api/executive-brief/generate-slide", async (req, res) => {
  req.socket.setTimeout(0);
  try {
    const text = typeof req.body?.text === "string" ? req.body.text.trim().slice(0, MAX_SLIDE_TEXT) : "";
    if (!text) {
      res.status(400).json({ error: "The slide has no content." });
      return;
    }
    const layout: BriefSlideLayout = SLIDE_LAYOUTS.has(req.body?.layout) ? req.body.layout : "highlights";
    const style: BriefSlideStyle = SLIDE_STYLES.has(req.body?.style) ? req.body.style : "corporate_light";
    const aspectRatio = SLIDE_ASPECT_RATIO_CONFIG[req.body?.aspectRatio] ? String(req.body.aspectRatio) : "16:9";
    const ratioInfo = SLIDE_ASPECT_RATIO_CONFIG[aspectRatio];
    const customNotes = typeof req.body?.customNotes === "string" ? req.body.customNotes.trim().slice(0, 600) : "";
    const proofread = req.body?.proofread !== false;

    const prompt = buildSlideImagePrompt({ text, layout, style, aspectRatio, size: ratioInfo.size, customNotes });
    console.log(`[API /api/executive-brief/generate-slide] ${layout} slide, ${style}, ${aspectRatio} (${ratioInfo.size}), proofread ${proofread ? "on" : "off"}.`);
    const genResponse: any = await withTimeout(
      getOpenaiClient().images.generate({ model: "gpt-image-2.5-sunburst", prompt, size: ratioInfo.size, quality: "xhigh" } as any),
      180000,
      null,
    );
    const base64 = genResponse?.data?.[0]?.b64_json;
    if (!base64) throw new Error("gpt-image-2.5-sunburst did not return image data for the executive summary slide.");

    let check: ProofreadResult | null = null;
    if (proofread) {
      try {
        const { data } = await generateStructuredJsonWithFallback(
          getAiClient(),
          {
            systemInstruction: PROOFREAD_SYSTEM_INSTRUCTION,
            input: `SOURCE TEXT (what the slide was meant to show):\n${text}\n\nThe generated slide image follows. List the differences.`,
            images: [{ data: base64, mimeType: "image/png" }],
            schema: proofreadSchema,
          },
          PROOFREAD_ATTEMPTS,
        );
        check = normalizeProofread(data);
      } catch (err: any) {
        console.warn("[API /api/executive-brief/generate-slide] Proofread failed:", err?.message || err);
        check = { status: "unavailable", issues: [], error: err?.message || String(err) };
      }
      console.log(`[API /api/executive-brief/generate-slide] Proofread: ${check.status}${check.issues.length ? ` (${check.issues.length} issue(s))` : ""}.`);
    }

    res.json({
      success: true,
      dataUrl: `data:image/png;base64,${base64}`,
      model: "gpt-image-2.5-sunburst",
      aspectRatio,
      dimensions: { width: ratioInfo.width, height: ratioInfo.height },
      proofread: check,
    });
  } catch (err: any) {
    console.error("[API /api/executive-brief/generate-slide ERROR]:", err);
    res.status(500).json({ error: "Failed to generate the executive summary slide.", details: err?.message || String(err) });
  }
});

app.post("/api/summarize-publisher-insights", async (req, res) => {
  try {
    const { text, maxWords = 65, maxCharacters = 450 } = req.body || {};
    if (!text || typeof text !== "string" || text.trim().length === 0) {
      res.json({ summary: "", reduced: false });
      return;
    }

    const trimmed = normalizePlanText(text);
    const words = trimmed.split(/\s+/);

    // If it's already within limits, return immediately without calling AI
    if (trimmed.length <= maxCharacters && words.length <= maxWords) {
      res.json({ summary: trimmed, reduced: false });
      return;
    }

    console.log(`[AI SUMMARIZER] Summarizing publisher insights (${trimmed.length} chars, ${words.length} words) to max ${maxWords} words...`);

    const ai = getAiClient();
    // A planner who asked for bullets should still get bullets on the slide, just shorter ones.
    const isList = hasPlanTextList(trimmed);
    const shape = isList
      ? `4. Keep the same structure: the lead-in sentence (if any), then the same bullets in the same order, one per line starting with "- ". Keep each bullet's short label before its colon and shorten the text after it to one brief clause.
5. No markdown: no asterisks, bold, headers or quotes. Return ONLY the summarized text.`
      : `4. Do NOT use bullet points, headers, quotes, or markdown.
5. Return ONLY the single summarized paragraph.`;
    const prompt = `You are a media planning strategist.
Summarize the following CTV "Publisher Alignment" insight ${isList ? "text" : "paragraph"} into ${isList ? "concise, high-impact text" : "a single concise, high-impact paragraph"} designed for an executive presentation slide.

STRICT REQUIREMENTS:
1. Maximum ${maxWords} words total.
2. Under ${maxCharacters} characters total.
3. Preserve the core strategic rationale (the strategic combination of premium SVOD, ad-supported FAST, OS reach, and contextual network affinity) and campaign fit.
${shape}

Original text:
${trimmed}`;

    const response = await generateText(ai, {
      input: prompt,
      thinkingLevel: "low",
      timeoutMs: TIMEOUT_SUMMARIZE_INSIGHTS_MS,
    });

    const summaryText = normalizePlanText(response.text.trim().replace(/^["']|["']$/g, ""));

    if (summaryText && summaryText.length > 20) {
      console.log(`[AI SUMMARIZER] Successfully summarized to ${summaryText.split(/\s+/).length} words (${summaryText.length} chars).`);
      res.json({ summary: summaryText, reduced: true });
    } else {
      console.warn(`[AI SUMMARIZER] Model returned no usable summary (${summaryText.length} chars).`);
      res.status(502).json({ error: "The publisher insight could not be summarized.", details: "The model returned no usable summary." });
    }
  } catch (err: any) {
    console.error("[AI SUMMARIZER] Error summarizing publisher insights:", err);
    // No sentence-truncation fallback: a clipped paragraph reads as a finished summary.
    res.status(502).json({ error: "The publisher insight could not be summarized.", details: err?.message || String(err) });
  }
});

// API: Generate profile using search grounding with live real-time research feedback
app.post("/api/generate-profile", async (req, res) => {
  // Prevent Express or Node from timing out socket connections on this long-running streaming endpoint
  req.socket.setTimeout(0);
  const runStartedAt = Date.now();
  
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
    draft,
  } = req.body;
  const quickMode = req.body?.quickMode === true;
  const pastCampaignIds: string[] = Array.isArray(req.body?.pastCampaignIds)
    ? req.body.pastCampaignIds.filter((id: unknown): id is string => typeof id === "string" && id.length > 0).slice(0, 10)
    : [];

  // SSE Setup Headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  let lastEventTime = Date.now();
  // Every step the console shows, saved with the plan so it can be reviewed after the run.
  const generationLog: GenerationLogEntry[] = [];
  const sendEvent = (type: string, data: any) => {
    lastEventTime = Date.now();
    if ((type === "status" || type === "research_result") && generationLog.length < GENERATION_LOG_MAX_ENTRIES) {
      generationLog.push({
        at: new Date(lastEventTime).toISOString(),
        type,
        ...(data.message ? { message: String(data.message) } : {}),
        ...(data.label ? { label: String(data.label) } : {}),
        ...(Array.isArray(data.sources) ? { sources: data.sources.slice(0, GENERATION_LOG_MAX_SOURCES).map((src: any) => ({ title: String(src?.title ?? ""), uri: String(src?.uri ?? "") })) } : {}),
        ...(data.blurb ? { blurb: String(data.blurb) } : {}),
        ...(data.failed ? { failed: true } : {}),
      });
    }
    // Stamped here so the client log shows when each step ran, not when it was displayed.
    res.write(`data: ${JSON.stringify({ type, ...data, at: new Date(lastEventTime).toISOString() })}\n\n`);
    if ((res as any).flush) {
      (res as any).flush();
    }
  };

  // A long model call streams what it is weighing to the console, at most one line per ~12s,
  // so the planner sees progress instead of "Still working...". Call `done()` when the call ends.
  const thoughtsFor = (who: string) => {
    const progress = throttledProgress((line) => sendEvent("status", { message: `${who}: ${line}...` }));
    return { onThought: progress.report, done: progress.stop };
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

    // Everything that failed or was not found, carried on the delivered profile.
    const generationAlerts: GenerationAlert[] = [];

    let crawl: CrawlResult | null = null;
    if (url) {
      sendEvent("status", { message: `Crawling website ${url} to extract brand positioning, offering details, and market context...` });
      crawl = await crawlSite(url);
      if (crawl.ok) {
        sendEvent("status", { message: `Crawl complete: extracted ${crawl.text.length} characters of brand text from ${crawl.url}.` });
      } else {
        console.warn(`[CRAWL] ${url} failed: ${crawl.errors.join("; ")}`);
        pushAlert(generationAlerts, { section: "research", severity: "failed", message: `The website crawl of ${url} failed (${crawl.errors.join("; ")}), so the advertiser was researched through web search only.` });
        sendEvent("status", { message: `Website crawl failed (${crawl.errors.join("; ")}). Continuing with web search research.` });
      }
    }
    const crawledPageText = crawl?.ok ? crawl.text : "";

    // Brief of Record: one settled answer to "who is this plan for?", written before research so
    // the dossiers, synthesis, channel reasoning and QA all work from the same definition rather
    // than each inferring its own. When the crawl got nothing usable, a grounded search stands in.
    let briefOfRecord: BriefOfRecord | null = null;
    // A planner who edited the Brief of Record (through ScoutAI) and regenerates wants the plan
    // rebuilt from their brief, not a fresh one written from the form inputs.
    const pinnedBrief = req.body?.pinnedBriefOfRecord
      ? normalizeBriefOfRecord(req.body.pinnedBriefOfRecord, ["brief + website", "brief + web search", "brief only"].includes(req.body.pinnedBriefOfRecord?.basis) ? req.body.pinnedBriefOfRecord.basis : "brief only")
      : null;
    if (pinnedBrief) {
      briefOfRecord = pinnedBrief;
      sendEvent("status", { message: `Using the planner's edited brief of record: ${pinnedBrief.primaryAudience}` });
    } else try {
      sendEvent("status", { message: "Defining the brief of record: advertiser offering, audience in scope and campaign objective..." });
      const briefAi = getAiClient();
      let searchSummary = "";
      if (!crawledPageText && (cleanAdvertiserName || cleanUrl)) {
        searchSummary = await generateGroundedText(briefAi, {
          input: buildAdvertiserSearchPrompt(cleanAdvertiserName, cleanUrl),
          thinkingLevel: "low",
          timeoutMs: TIMEOUT_BRIEF_OF_RECORD_MS,
        }).then((result) => result.text.trim()).catch((err: any) => {
          console.warn(`[BRIEF OF RECORD] Advertiser search failed: ${err?.message || err}`);
          return "";
        });
      }
      const raw = await generateStructuredJson(briefAi, {
        systemInstruction: BRIEF_OF_RECORD_SYSTEM_INSTRUCTION,
        input: buildBriefOfRecordInput({
          advertiserName: cleanAdvertiserName,
          url: cleanUrl,
          audienceDescription: cleanAudienceDesc,
          targetPersonas: cleanTargetPersonas,
          kpis: cleanKpis,
          campaignFocus: campaignFocus || "",
          geography: geography || "United States",
          additionalContext: cleanAdditionalContext,
          crawlText: crawledPageText.slice(0, 6000),
          searchSummary,
        }),
        schema: briefOfRecordSchema,
        thinkingLevel: "medium",
        timeoutMs: TIMEOUT_BRIEF_OF_RECORD_MS,
      });
      briefOfRecord = normalizeBriefOfRecord(raw, crawledPageText ? "brief + website" : searchSummary ? "brief + web search" : "brief only");
      if (!briefOfRecord) throw new Error("the model returned no audience definition");
      sendEvent("status", { message: `Brief of record: ${briefOfRecord.primaryAudience} Core segments: ${briefOfRecord.coreSegments?.join("; ") || "as described"}. Also in scope: ${briefOfRecord.includedSegments.length} group(s) in total.` });
    } catch (err: any) {
      console.warn(`[BRIEF OF RECORD] Failed: ${err?.message || err}`);
      pushAlert(generationAlerts, { section: "research", severity: "flagged", message: `The brief of record could not be written (${err?.message || err}), so each research step inferred the audience from the brief on its own.` });
    }
    const briefBlock = formatBriefOfRecord(briefOfRecord);
    // The one-line audience the chart estimate calls see. A bare URL told the skew model nothing
    // about who the charts describe.
    const audienceLine = briefOfRecord
      ? `${briefOfRecord.primaryAudience}${briefOfRecord.coreSegments?.length ? ` (core segments: ${briefOfRecord.coreSegments.join("; ")})` : ""}`
      : cleanAudienceDesc || cleanUrl;

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
${briefBlock ? `\n${briefBlock}\nResearch the audience defined above, across every in-scope group.\n` : ""}
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
${briefBlock ? `\n${briefBlock}\nResearch the audience defined above, across every in-scope group.\n` : ""}
TASK:
Search the web for real, reputable statistics regarding:
1. Top websites, apps, and digital platforms visited or preferred by this specific audience segment.
2. Direct traffic patterns, engagement times, or indexed affinities for categories of sites this audience uses (e.g., the category's retailers and brands, specialist publishers and communities, news, lifestyle).
3. Find 5 to 8 real root domains (e.g. the category's leading retailers, specialist publishers, communities and forums) that have high affinity from this audience, along with estimated Affinity Index metrics (where 100% represents average internet user likelihood).

INSTRUCTIONS:
- Search using tools like Similarweb, Semrush, Comscore, Exploding Topics, or trade studies.
- Write a detailed, bulleted, quantitative web affinity report featuring actual domain names, specific Affinity Index scores (e.g., 125%, 160%, 210%), and high-authority source citations.`;

    // 3. CTV & Devices Sub-Call Prompt
    const promptDevices = `Research and compile Connected TV (CTV) viewing, video streaming, and hardware device usage patterns for this target audience.
Target Audience Description: ${cleanAudienceDesc || "Inferred from Brand Website"}
Geography/Market: ${geography}
Campaign Focus/Goal: ${campaignFocus}
Brand Website (if any): ${cleanUrl || "None provided"}
${cleanUrl ? `Direct website crawled snippet: "${cleanCrawledText}"` : ""}
Additional Context: ${cleanAdditionalContext || "None provided"}
${briefBlock ? `\n${briefBlock}\nResearch the audience defined above, across every in-scope group.\n` : ""}
TASK:
Search the web for real, reputable statistics regarding:
1. Connected TV (CTV) vs. other video device viewing habits (Smart TVs, Streaming devices like Roku, FireTV, AppleTV).
2. Streaming platform preferences (e.g., ad-supported Netflix, Hulu, YouTube, Pluto TV, Tubi, Disney+) and share of viewing time.
3. Hardware device share distribution (CTV/Smart TV, Mobile/Smartphones, Desktop/PC, Gaming Consoles, Tablets) for this audience.

INSTRUCTIONS:
- Search for data from high-authority sources like Wurl, eMarketer, Insider Intelligence, Nielsen, IAB, Comscore, or major trade press.
- Write a detailed, bulleted, quantitative device usage report including exact platform splits and CTV activation insights.`;

    // 4. Temporal & Purchase Patterns Sub-Call Prompt. It used to ask for "browser gaming weekday
    // peaks" and name CrazyGames as a source - left over from a gaming brief - so every plan's
    // timing research came back with gaming-session data, and the writers timed pet-food search
    // and display from it. It now asks for the advertiser's category and labels general data.
    const promptTemporalPurchase = `Research and compile when this target audience researches, shops and buys in the advertiser's category, when it watches streaming TV, and its purchase triggers.
Target Audience Description: ${cleanAudienceDesc || "Inferred from Brand Website"}
Geography/Market: ${geography}
Campaign Focus/Goal: ${campaignFocus}
Brand Website (if any): ${cleanUrl || "None provided"}
${cleanUrl ? `Direct website crawled snippet: "${cleanCrawledText}"` : ""}
Additional Context: ${cleanAdditionalContext || "None provided"}
${briefBlock ? `\n${briefBlock}\nResearch the audience defined above, across every in-scope group.\n` : ""}
TASK:
Search the web for real, reputable statistics regarding:
1. Category timing: when this audience researches and buys in the advertiser's product categories - day of week, time of day, seasonality, replenishment or purchase cycles, and online versus in-store timing.
2. Streaming and CTV viewing timing for this audience: weekday versus weekend, and prime-time, daytime and late-night dayparts.
3. Buying habits in the category: where they buy (the brand's own site, retailers, marketplaces, stores), subscription and repeat-purchase behaviour, and brand or retailer preferences.
4. Primary purchase triggers and motivations in the category (e.g. health needs, price and deals, ingredients or quality, recommendations).

INSTRUCTIONS:
- Prefer studies about this category and this audience: category trade associations, retailer and earnings reports, Numerator, NielsenIQ, Circana, Nielsen, Comscore, eMarketer, Statista and category trade press.
- For every figure, state the population and the category or activity it measures.
- Where only general data exists (all e-commerce, all U.S. adults, all TV viewing, another product category), label it "GENERAL - not specific to this category" and do not present it as this audience's behaviour. Leave out data about unrelated activities (such as gaming) unless the brief of record defines the audience by them.
- Write a detailed, bulleted, quantitative report on category timing, viewing timing and buying habits, with specific timings, peak periods and purchase motivations.`;

    const ai = getAiClient();

    // What synthesis sees in place of a failed dossier. It is an instruction, not content: the
    // topic stays empty in the plan and the plan carries an alert saying so.
    const researchUnavailable = (label: string) =>
      `[RESEARCH UNAVAILABLE: the ${label} research did not complete. Provide no figures, chart values or claims for this topic; leave its charts empty.]`;

    // Helper to run research sub-calls in parallel with search grounding enabled
    const runResearchCall = async (prompt: string, label: string): Promise<{ label: string; text: string; sources: any[]; failed?: boolean; reason?: string }> => {
      try {
        console.log(`Starting parallel research query for: ${label}...`);
        const research = await generateGroundedText(ai, {
          systemInstruction: `You are an expert audience research analyst. Provide a highly detailed, fact-packed research brief. Always find and cite real stats, percentages, and sources. ${RESEARCH_SOURCE_GUIDANCE}`,
          input: prompt,
          thinkingLevel: RESEARCH_THINKING_LEVEL,
          timeoutMs: TIMEOUT_PARALLEL_RESEARCH_MS,
        });

        const text = research.text || `[Failed to retrieve detailed ${label} research text]`;
        const sources = research.sources;

        console.log(`Completed parallel research query for: ${label}. Found ${sources.length} sources.`);
        return { label, text, sources };
      } catch (err: any) {
        console.error(`Research sub-call for ${label} failed:`, err);
        return { label, text: researchUnavailable(label), sources: [] as any[], failed: true, reason: err?.message || String(err) };
      }
    };

    // Helper to execute research task and stream live feedback instantly
    const handleResearchStep = async (prompt: string, label: string, statusMsg: string) => {
      sendEvent("status", { message: statusMsg });
      
      const researchPromise = runResearchCall(prompt, label);
      const timedOut = {
        label,
        text: researchUnavailable(label),
        sources: [] as any[],
        failed: true,
        reason: `timed out after ${TIMEOUT_PARALLEL_RESEARCH_MS / 1000}s`,
      };

      const result = await withTimeout(researchPromise, TIMEOUT_PARALLEL_RESEARCH_MS, timedOut);

      sendEvent("research_result", {
        label,
        sources: result.sources,
        failed: Boolean(result.failed),
        blurb: result.failed ? `Research failed (${result.reason}).` : extractFindingBlurb(result.text, label),
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

    const researchResults = [demoResult, webResult, deviceResult, temporalResult];
    const failedDossiers = researchResults.filter((result) => result.failed).map((result) => result.label);
    if (failedDossiers.length === researchResults.length) {
      throw new Error(`All four research dossiers failed (${researchResults.map((r) => `${r.label}: ${r.reason}`).join("; ")}), so there is nothing to ground a profile in.`);
    }
    for (const result of researchResults) {
      if (result.failed) console.warn(`[RESEARCH] ${result.label} dossier failed: ${result.reason}`);
    }

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
    const resolvedSources = await resolveGroundingUrls(redirectSources, {
      timeoutMs: TIMEOUT_URL_RESOLUTION_MS,
      concurrency: URL_RESOLUTION_CONCURRENCY,
    });
    const resolvedCount = resolvedSources.filter((src, idx) => src.uri !== redirectSources[idx].uri).length;
    console.log(`Resolved ${resolvedCount}/${resolvedSources.length} grounding redirects to publisher URLs in ${Date.now() - resolveStartedAt}ms.`);
    // Social, forum and homework domains are never evidence, so they never reach the pool the
    // registry is curated from. Filtered after resolution: before it, every URL is a redirect.
    const citationPool = filterCitationPool(resolvedSources);
    const deduplicatedSources = citationPool.kept;
    if (citationPool.excluded.length > 0) {
      console.log(`[SOURCES] Excluded ${citationPool.excluded.length} non-evidence source(s) from the citation pool: ${citationPool.excluded.map((src) => `${src.uri} (${src.reason})`).join(", ")}`);
    }

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

    // Past campaigns the planner chose from the advertiser's library. A campaign that fails to
    // load is reported and left out; the plan is still built from the research.
    let history: GenerationHistory | null = null;
    if (pastCampaignIds.length > 0) {
      try {
        const past = await campaignsById(await getStorage(), pastCampaignIds);
        const validated = validatePlanningSettings(planningSettings);
        const channels = aiCandidateProducts(validated.valid && validated.settings ? validated.settings : DEFAULT_PLANNING_SETTINGS)
          .map((product: any) => ({ id: product.id, name: product.displayName, aliases: product.aliases || [] }));
        history = buildGenerationHistory(past, { advertiser: cleanAdvertiserName, channels, publisherPool: enabledPublishersForHistory(effectivePublishers) });
        if (history) {
          sendEvent("status", { message: `Reading ${history.used.length} past campaign${history.used.length === 1 ? "" : "s"} from the library: ${history.used.map((c) => `${c.name}${c.own ? "" : " (another advertiser's, patterns only)"}`).join("; ")}.` });
        }
        if (past.length < pastCampaignIds.length) pushAlert(generationAlerts, { section: "pastPerformance", severity: "flagged", message: `${pastCampaignIds.length - past.length} chosen past campaign(s) could not be found and were left out.` });
      } catch (err: any) {
        console.error("[GENERATE] Could not read past campaigns:", err?.message || err);
        pushAlert(generationAlerts, { section: "pastPerformance", severity: "failed", message: `The chosen past campaigns could not be read (${err?.message || err}); the plan was built without them.` });
      }
    }

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
   Also, write a professional, cohesive, and concise paragraph for 'publisherInsights' explaining why this curated CTV publisher mix maximizes addressable reach, view-through rates, and audience affinity for the campaign. Keep it strictly between 50 to 65 words (under 450 characters) so it fits slide presentation layouts without overflowing. (Remember: NEVER mention tiers here!)${history?.publisherBrief ? `\n\n${history.publisherBrief}` : ""}`;

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
   - Do not apply the income skew of a niche sub-segment (e.g. premium hardware buyers earning >$100k) to the whole audience. If the dossiers only report a sub-segment's income split, say so in the overview and leave 'incomeChartData' empty rather than presenting it as the audience's split.
   - Media performance rates (CTR, VCR/VTR, conversion rates) may only appear where a dossier reports them. Do not quote typical or benchmark rates from general knowledge.
3. MUTUALLY EXCLUSIVE DEVICE BREAKDOWNS: Correctly map the Connected TV and digital ecosystem as a fragmented but mutually exclusive environment. Explicitly distribute viewing share across Smart TVs, Streaming Devices (Roku/FireTV), Consoles, Smartphones, and Desktops so that there is no double-counting, and ensure percentage splits sum to approximately 100%.
4. Be highly precise with definitions: composition vs index vs reach vs penetration. Clearly distinguish percentage split from activity index (average = 100).
5. Do not call an audience segment "affluent", "young", "tech-savvy", etc. unless the research supportively proves it with metrics.
6. Ensure demographic charts, device charts, web share charts, and day/hour charts are fully populated with exact numbers. Percentage charts MUST sum to approximately 100 (except index charts which represent index scores). For 'browserAndReach.chartData' (Top Domain Affinity Index), all items MUST represent an Affinity Index % where 100% is the national average likelihood, and metricType MUST be strictly set to 'Affinity Index'. Provide realistic index values (e.g. 120%, 150%, 210%, 280% depending on target audience domain affinity).
7. Use current ${currentYear} data. Match geography: ${geography}. If exact geographic data is sparse, adapt it using a realistic 'Modeled Planning Proxy' or 'Directional Estimate', and clearly label the source property as such.
7b. REALISTIC, LABELLED ESTIMATES: Where a chart value comes from a dossier, copy it as reported and name that source. Where the dossiers have no figure and you estimate one, set 'isModeled' to true and make the source say it is an estimate (e.g. 'ScoutAI estimate informed by Nielsen 2025'). Estimates must look like real audience data, not a formula: day-of-week and hour-of-day series are uneven (hour-of-day has an early-morning low, a smaller daytime bump, a prime-time peak and an audience-specific late-night tail - never a straight climb; adjacent days never rise in a straight line), domain affinity indices have uneven gaps and precise values (e.g. 312, 287, 243 - never all multiples of 5 or 10), and shares are precise numbers (e.g. 43, 27, 14) rather than multiples of 5. The server checks for straight runs, even spacing, round numbers and repeated values and sends offending charts back for revision.
7c. NATIONAL-BASELINE CHARTS: For 'demographics.ageChartData', 'demographics.genderChartData', 'demographics.incomeChartData', 'temporalPatterns.dayOfWeekChartData' and 'temporalPatterns.hourOfDayChartData', use figures only if a dossier reports THIS audience's split, and copy them as reported. If it does not, return that chart as an EMPTY array and do not quote numbers for it in the narrative: the server builds it from U.S. Census and BLS national baselines adjusted for this audience. The narrative may still describe the audience's skew qualitatively (e.g. "skews younger than the U.S. adult population").
8. STRICT ANTI-HALLUCINATION & ZERO-FABRICATION RULE (MANDATORY):
   - You are STRICTLY PROHIBITED from fabricating, guessing, or making up consumer desire/sentiment figures, survey percentages, or market statistics (such as "85% of gamers express a desire to see product recommendations on their TV home screens").
   - Every single statistic or percentage mentioned in the recommendations ('recommendations.why' or 'recommendations.action') or core takeaways ('takeaways') MUST be directly grounded and cross-referenced from the provided parallel research dossiers.
   - If a statistic cannot be verified in the dossiers, leave it out. Do not substitute an industry benchmark, a "typical" rate, or a modeled figure, and do not tag an invented number as a baseline to make it acceptable.

8b. ${EVIDENCE_RULES}
   These apply to every field you write: personas, takeaways, recommendations, overviews, chart sources and publisher rationales.

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
     4. Build rich, realistic demographics, watch, browse, buy, and narrative profiles around each of these specific archetypes, informed by the research dossiers and the brief of record. Advertiser specifics (products, offers, retailers, fulfilment) come only from its verified advertiser facts.
     ${cleanTargetPersonas.length < 4 ? `5. For the remaining ${4 - cleanTargetPersonas.length} persona slot(s) (Slots ${cleanTargetPersonas.length + 1} through 4): You MUST autonomously generate complementary, high-potential expansion personas that broaden campaign addressable reach. Set 'sourceType' to 'ScoutAI' for these additional generated personas.` : '5. All 4 personas have been user-specified, so set \'sourceType\' to \'User\' for all 4.'}` : `   - STANDARD BRIEF MODE (when NO target personas entered and NO uploaded media plan / RFP):
     * Generate 4 distinct consumer personas representing the core target market. Set 'sourceType' to 'ScoutAI' for all 4.
     * Personas are audience portraits grounded in the research. Where a persona's story touches the advertiser, use only the brief of record's verified advertiser facts; otherwise describe the category ("a probiotic topper"), not a product, offer or service the brief does not list.
   - UPLOADED MEDIA PLAN / RFP MODE (when an uploaded media plan IS provided and no user personas specified):
     * You MUST generate EXACTLY 4 personas in total.
     * Up to 3 personas MUST be derived directly from the listed target audiences in the uploaded media plan RFP (set 'sourceType': 'RFP' for these personas).
     * At least 1 persona MUST be a ScoutAI recommended "expansion persona" targeting a high-potential complementary audience segment not explicitly in the RFP that expands total addressable reach (set 'sourceType': 'ScoutAI' for this expansion persona).
     * If the uploaded media plan lists fewer than 3 audiences (e.g., 2, 1, or 0), generate as many ScoutAI expansion personas ('sourceType': 'ScoutAI') as needed so the total array length is EXACTLY 4.`}

11. UPLOADED MEDIA PLAN AUDIENCE ANALYSIS (MANDATORY WHEN MEDIA PLAN CONTAINS AUDIENCES):
    If an uploaded media plan is provided and includes audience target specifications (e.g. listed audience segments in plan placements), you MUST populate 'audienceAnalysis' with a detailed, professional paragraph evaluating how well the listed audiences in the plan align with the advertiser, their brand positioning, product offering, and campaign goals.
    If NO media plan was uploaded OR if the uploaded plan contains no audience target definitions, set 'audienceAnalysis' to empty string ("").

12. EXECUTIVE SUMMARY BLUEPRINT (MANDATORY):
    Write an executive-ready, highly actionable strategic synthesis for 'executiveSummary'. You MUST explicitly emphasize:
    - Why the cross-screen channel strategy effectively reaches this audience where they actually are (e.g. living room Connected TV co-viewing, mobile digital companion screens, and high-affinity contextual domains during peak activity dayparts).
    - How this media mix pursues the campaign's target KPIs and how each will be measured (e.g., brand lift, view-through rates, incremental household reach, or direct conversion goals). Describe the approach; do not promise results.

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
${briefBlock ? `\n${briefBlock}\nThe personas, narrative and publisher picks must all describe this audience. Build the personas around the core segments; also-served groups are on-target but need no persona of their own. No persona may target a group outside the brief of record.\n` : ""}
${failedDossiers.length > 0 ? `RESEARCH THAT FAILED (leave every chart and figure for these topics empty): ${failedDossiers.join(", ")}
` : ""}
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
    const synthesisStartedAt = Date.now();
    const synthesisThoughts = thoughtsFor("Synthesis");
    const synthesisPromise = generateStructuredJsonWithFallback(
      ai,
      { systemInstruction: synthesisSystemInstruction, input: synthesisUserPrompt, schema: audienceProfileJsonSchema, onThought: synthesisThoughts.onThought },
      SYNTHESIS_ATTEMPTS,
      (failed, next) => sendEvent("status", { message: `Deep synthesis (${failed} reasoning) ran long; retrying with ${next} reasoning...` }),
    ).catch((err) => {
      // Timeouts get the user-facing message below; anything else is a real failure to surface.
      if (/timed? ?out|timeout|abort/i.test(`${err?.name} ${err?.message || err}`)) return null;
      throw err;
    });

    const synthesisResult = await withTimeout(
      synthesisPromise,
      TIMEOUT_SYNTHESIS_MS,
      null
    ).finally(synthesisThoughts.done);

    if (!synthesisResult) {
      throw new Error(`Synthesis stage exceeded the safety limit of ${TIMEOUT_SYNTHESIS_MS / 1000}s. Please simplify your input parameters and try again.`);
    }
    console.log(`Synthesis complete via ${GEMINI_FLASH_MODEL} (${synthesisResult.thinkingLevel} thinking) in ${((Date.now() - synthesisStartedAt) / 1000).toFixed(1)}s.`);

    const originalData = synthesisResult.data as any;
    if (briefOfRecord) originalData.briefOfRecord = briefOfRecord;

    // Publisher picks are settled here, before the channel strategy snapshots them: in the
    // enabled pool, each once, with the admin's category.
    for (const alert of settlePublisherSelection(originalData, enabledPublishers, targetPublisherCount)) pushAlert(generationAlerts, alert);

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
        } catch (err: any) {
          console.error("Error generating fallback audience analysis:", err);
          pushAlert(generationAlerts, { section: "audienceAnalysis", severity: "failed", message: `The uploaded-plan audience analysis could not be written (${err?.message || err}).` });
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
            research: [
              ...researchResults.map((result) => ({ label: result.label, text: result.failed ? "" : result.text, failed: Boolean(result.failed) })),
              ...(history?.dossier ? [{ ...history.dossier, failed: false }] : []),
            ],
            history: history?.channelBrief,
          },
        );
        originalData.channelStrategy = channelStrategy;
        sendEvent("status", { message: "Media portfolio and allocation constraints validated successfully." });
      } catch (channelErr: any) {
        console.error("Error generating media recommendation plan:", channelErr);
        pushAlert(generationAlerts, { section: "channelStrategy", severity: "failed", message: `The media plan could not be built: ${channelErr?.message || channelErr}` });
        sendEvent("status", { message: "Media plan failed. The profile will be delivered without a channel strategy and marked accordingly." });
      }
    }

    // Charts: a failed dossier's charts are cleared first, then any chart that looks generated
    // (a straight climb through the day, evenly spaced indices, all round numbers) gets one
    // targeted revision, then every point the research does not state is labelled as an
    // estimate. All of it runs on the values as synthesis wrote them, before rescaling.
    for (const alert of clearSectionsForFailedDossiers(originalData, failedDossiers)) pushAlert(generationAlerts, alert);
    const researchText = researchResults.filter((result) => !result.failed).map((result) => result.text).join("\n");
    // Label what the research did not state first, so the baseline step can tell a chart that
    // reports this audience's figures (kept) from one that is estimated anyway (rebuilt).
    labelEstimatedPoints(originalData, researchText);

    // Age, gender, income, day and hour charts without research figures are built from U.S.
    // Census / BLS national baselines: the model supplies only how this audience differs from
    // the nation and code applies it, so the estimate keeps a real shape.
    const builtFromBaseline = new Set<string>();
    const baselineIds = chartsNeedingBaselineEstimates(originalData, failedDossiers);
    if (baselineIds.length > 0) {
      sendEvent("status", { message: `Estimating ${baselineIds.length} chart${baselineIds.length === 1 ? "" : "s"} from U.S. Census and BLS national baselines...` });
      const dossierExcerpt = (label: string) => {
        const dossier = researchResults.find((result) => result.label === label);
        return dossier && !dossier.failed ? dossier.text.slice(0, 4000) : "(not available)";
      };
      try {
        const skews: any = await generateStructuredJson(ai, {
          systemInstruction: "You estimate how a target audience differs from the U.S. national population. For each bracket or time period you give an index: 100 = same as the national baseline, 150 = 1.5x as likely, 60 = 0.6x. Base every skew on the research and on well-established facts about this kind of audience; where there is no reason to differ, use 100 and say so. Do not flatten differences that the research supports, and do not invent sharp skews it does not. Use the exact labels given.",
          input: `AUDIENCE: ${audienceLine}\nGEOGRAPHY: ${geography}\nCAMPAIGN FOCUS: ${campaignFocus}\n\nNATIONAL BASELINES TO ADJUST:\n${describeBaselines(baselineIds)}\n\nFor day-of-week and hour-of-day, skew each period for this audience's own routine (work schedule, life stage, when they stream or browse) - the baseline is national TV viewing.\n\nRESEARCH - DEMOGRAPHICS:\n${dossierExcerpt("Demographics")}\n\nRESEARCH - TEMPORAL & PURCHASE:\n${dossierExcerpt("Temporal & Purchase")}\n\nReturn one index per label for each chart listed.`,
          schema: audienceSkewSchema(baselineIds),
          // Low: at medium this call hit its 45s budget in a live run; it is a small, structured
          // judgement per bracket, and the revision calls at low returned in 2-4s.
          thinkingLevel: "low",
          timeoutMs: TIMEOUT_BASELINE_SKEWS_MS,
        }).catch((err: any) => {
          console.warn(`[BASELINE] Skew call failed; using unadjusted national baselines (${err?.message || err}).`);
          pushAlert(generationAlerts, { section: "demographics", severity: "flagged", message: `Audience adjustments for the Census/BLS baseline charts could not be computed (${err?.message || err}); those charts show the unadjusted U.S. national baseline.` });
          return null;
        });
        for (const id of baselineIds) {
          const chart = PROFILE_CHARTS.find((spec) => spec.id === id)!;
          const baseline = NATIONAL_BASELINES[id];
          let points = skews ? applyAudienceSkews(baseline, skews[id], `ScoutAI estimate: ${baseline.source}, adjusted for this audience`) : null;
          if (!points) {
            // A published national distribution, labelled as such, is still real data - better
            // than an invented split or an empty chart.
            const labels = baseline.kind === "share" ? baseline.brackets.map((b) => b.label) : baseline.periods.map((p) => p.label);
            points = applyAudienceSkews(baseline, labels.map((label) => ({ label, index: 100 })), `U.S. national baseline, not adjusted for this audience: ${baseline.source}`);
            if (skews) console.warn(`[BASELINE] ${chart.label}: skews did not cover every bracket; showing the unadjusted national baseline.`);
          }
          if (!points) continue;
          if (!originalData[chart.section] || typeof originalData[chart.section] !== "object") originalData[chart.section] = {};
          originalData[chart.section][chart.key] = points;
          builtFromBaseline.add(id);
        }
        console.log(`[BASELINE] Built ${builtFromBaseline.size}/${baselineIds.length} charts from national baselines: ${[...builtFromBaseline].join(", ")}.`);
      } catch (err: any) {
        console.warn(`[BASELINE] Skew call failed; keeping synthesized estimates (${err?.message || err}).`);
        pushAlert(generationAlerts, { section: "demographics", severity: "flagged", message: `Estimated demographic and timing charts could not be built from U.S. Census/BLS baselines (${err?.message || err}); the model's own estimates are shown instead.` });
      }
    }

    // Charts built from a baseline keep its real shape (TV viewing does climb all day to an
    // 8-9 PM peak), so they are not sent back for "looking" too steady.
    const unrealistic = findUnrealisticCharts(originalData).filter(({ chart }) => !builtFromBaseline.has(chart.id));
    if (unrealistic.length > 0) {
      sendEvent("status", { message: `Refining ${unrealistic.length} chart${unrealistic.length === 1 ? "" : "s"} whose estimates looked unrealistic...` });
      await Promise.all(unrealistic.map(async ({ chart, problems }) => {
        const current = originalData[chart.section][chart.key];
        const dossier = researchResults.find((result) => result.label === chart.dossier);
        const itemSchema = (audienceProfileJsonSchema as any).properties?.[chart.section]?.properties?.[chart.key];
        const labelKey = Object.keys(current[0] || {}).find((key) => !["value", "index", "isModeled", "source", "metricType"].includes(key));
        try {
          const revision: any = await generateStructuredJson(ai, {
            systemInstruction: "You revise one chart in a media-planning audience profile so its estimated values look like real audience data. Keep the same items in the same order. Points marked isModeled true are estimates: change them as the required fixes say. Keep a point marked isModeled false only if the research below states that exact figure; otherwise treat it as an estimate. Mark every estimated point isModeled true with a source that says it is an estimate.",
            input: `AUDIENCE: ${audienceLine}\nGEOGRAPHY: ${geography}\n\nCHART: ${chart.label}\nCURRENT VALUES:\n${JSON.stringify(current, null, 2)}\n\nWHY IT LOOKS GENERATED: ${problems.join("; ")}.\n\nREQUIRED FIXES:\n${realismFixes(problems).map((fix) => `- ${fix}`).join("\n")}\n\nWHAT REALISTIC DATA LOOKS LIKE: ${CHART_SHAPE_GUIDANCE[chart.id] || ""}\n\nRESEARCH FOR THIS TOPIC (excerpt, for context):\n${(dossier && !dossier.failed ? dossier.text : "").slice(0, 3000)}\n\nReturn the revised chart as 'chartData'.`,
            schema: { type: "object", properties: { chartData: itemSchema }, required: ["chartData"] },
            thinkingLevel: "low",
            timeoutMs: TIMEOUT_CHART_REVISION_MS,
          });
          const revised = revision?.chartData;
          const sameItems = Array.isArray(revised) && revised.length === current.length
            && (!labelKey || current.every((item: any, i: number) => revised[i]?.[labelKey] === item[labelKey]));
          if (!sameItems) throw new Error("revision did not return the same chart items");
          originalData[chart.section][chart.key] = revised;
          const remaining = chartRealismProblems(chart, revised);
          console.log(`[CHART REALISM] ${chart.label}: revised${remaining.length ? `; still ${remaining.join("; ")}` : ""}.`);
          if (remaining.length > 0) {
            pushAlert(generationAlerts, { section: chart.section, severity: "flagged", message: `${chart.label}: the estimates may look unrealistic (${remaining.join("; ")}).` });
          }
        } catch (err: any) {
          console.warn(`[CHART REALISM] ${chart.label}: revision failed, keeping the original (${err?.message || err}).`);
          pushAlert(generationAlerts, { section: chart.section, severity: "flagged", message: `${chart.label}: the estimates may look unrealistic (${problems.join("; ")}), and the automatic revision did not complete.` });
        }
      }));
    }
    labelEstimatedPoints(originalData, researchText);

    // Run the research-integrity rules before scoring, so QA grades the profile we will ship
    // rather than values that are about to be removed. They run again after remediation.
    const integrityCorrections: string[] = [];
    const enforceResearchIntegrity = (profile: any) => {
      for (const alert of clearSectionsForFailedDossiers(profile, failedDossiers)) pushAlert(generationAlerts, alert);
      const sanity = applyProgrammaticSanityChecks(profile, req.body);
      for (const alert of sanity.alerts) pushAlert(generationAlerts, alert);
      integrityCorrections.push(...sanity.corrections);
    };
    enforceResearchIntegrity(originalData);
    // ---- Everything below reads the settled plan: charts, publishers and the channel plan. ----
    const auditInputs: AuditInputs = {
      briefBlock,
      campaignLine: campaignLineFrom({
        advertiser: cleanAdvertiserName || cleanUrl,
        kpis: cleanKpis,
        campaignFocus: campaignFocus || "",
        geography,
        workingMediaBudget: Number(workingMediaBudget) || 0,
        flightDays: Number(campaignFlightDays) || null,
        targetPersonas: cleanTargetPersonas,
        uploadedPlan: Boolean(selectedPlanOptions?.length),
        rfp: Boolean(rfpAnalysis),
      }),
      // The client's own past campaign data is a source the plan may quote; without it here the
      // number check would flag every figure taken from it as unsupported.
      research: [
        ...researchResults.map((result) => ({ label: result.label, text: result.failed ? "" : result.text, failed: Boolean(result.failed) })),
        ...(history?.dossier ? [{ ...history.dossier, failed: false }] : []),
      ],
      planInputs: { workingMediaBudget: Number(originalData.channelStrategy?.mediaPlan?.workingMediaBudget ?? workingMediaBudget) || 0, flightDays: Number(campaignFlightDays) || null },
      // The live array, so alerts raised by the narrative step reach the auditor.
      alerts: generationAlerts,
    };
    const remainingMs = () => RUN_BUDGET_MS - (Date.now() - runStartedAt);

    // The narrative is written last, by one writer, with the settled plan in front of it. Skipped
    // (keeping synthesis's draft) only when the run is short of time, so the audit always runs.
    const narrativeAttempts = quickMode ? QUICK_NARRATIVE_ATTEMPTS : NARRATIVE_ATTEMPTS;
    const narrativeReserveMs = quickMode
      ? narrativeAttempts.reduce((sum, attempt) => sum + attempt.timeoutMs, 0)
      : TIMEOUT_NARRATIVE_MS + TIMEOUT_AUDIT_MS;
    if (remainingMs() > narrativeReserveMs) {
      sendEvent("status", { message: "Writing the final plan narrative against the settled charts, channel plan and research..." });
      const narrativeStartedAt = Date.now();
      const narrativeThoughts = thoughtsFor("Narrative writer");
      try {
        const { data, thinkingLevel } = await generateStructuredJsonWithFallback(
          ai,
          {
            systemInstruction: NARRATIVE_SYSTEM_INSTRUCTION,
            input: buildNarrativeInput({
              briefBlock,
              campaign: auditInputs.campaignLine,
              personas: describePersonas(originalData),
              charts: describeCharts(originalData),
              channelPlan: describeChannelPlan(originalData),
              publishers: publishersLine(originalData),
              ledger: ledgerFor(originalData, auditInputs),
              research: researchForPrompt(auditInputs.research),
              draft: currentNarrative(originalData),
            }),
            schema: narrativeSchema,
            onThought: narrativeThoughts.onThought,
          },
          narrativeAttempts,
          (failed, next) => sendEvent("status", { message: `Narrative writing (${failed} reasoning) ran long; retrying with ${next} reasoning...` }),
        );
        const replaced = applyNarrative(originalData, data);
        console.log(`[NARRATIVE] Rewrote ${replaced.length} field(s) at ${thinkingLevel} thinking in ${((Date.now() - narrativeStartedAt) / 1000).toFixed(1)}s.`);
        if (replaced.length === 0) throw new Error("the model returned no usable narrative");
      } catch (err: any) {
        console.warn(`[NARRATIVE] Failed; keeping the synthesis draft (${err?.message || err}).`);
        pushAlert(generationAlerts, { section: "narrative", severity: "flagged", message: `The final narrative pass did not complete (${err?.message || err}), so the narrative is synthesis's draft, written before the charts and channel plan were settled. Check it against them before presenting.` });
      } finally {
        narrativeThoughts.done();
      }
    } else {
      pushAlert(generationAlerts, { section: "narrative", severity: "flagged", message: "The run was short of time, so the final narrative pass was skipped and the narrative is synthesis's draft. Check it against the charts and channel plan before presenting." });
    }

    // ---- QA: audit (GPT-6 Sol), targeted fixes (Gemini), verify (GPT-6 Sol). ----
    // The scorer is a different model with a different training cutoff, so it has no idea what
    // "now" is. Left unanchored it read current-year figures as future-dated fabrications.
    const auditToday = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    const stageTimeout = (budget: number) => Math.max(15000, Math.min(budget, remainingMs() - 10000));
    const modelOptions = (effort: OpenAiEffort, budget: number) => ({ model: AUDIT_MODEL, effort, timeoutMs: stageTimeout(budget), today: auditToday, currentYear });

    let audit: NormalizedAudit | null = null;
    let qaBypassed = false;
    if (quickMode) {
      sendEvent("status", { message: "Quick mode: skipping the QA audit. Run QA Audit on the saved plan before sharing it with a client." });
    } else if (remainingMs() > 60000) {
      sendEvent("status", { message: "Auditing the plan evidence, brief fit, cohesion, strategy and client readiness..." });
      const auditThoughts = thoughtsFor("QA auditor");
      try {
        audit = await runAudit(getOpenaiClient(), originalData, auditInputs, { ...modelOptions(AUDIT_EFFORT, TIMEOUT_AUDIT_MS), onThought: auditThoughts.onThought });
      } catch (err: any) {
        console.error("QA audit failed:", err?.message || err);
      } finally {
        auditThoughts.done();
      }
    }
    if (quickMode) {
      qaBypassed = true;
    } else if (!audit) {
      qaBypassed = true;
      console.warn("[QA BYPASS] The QA audit did not run. This profile was NOT independently scored.");
      pushAlert(generationAlerts, { section: "qa", severity: "failed", message: "QA scoring did not run (timed out or failed), so this profile has not been independently scored." });
      sendEvent("status", { message: "QA audit unavailable - delivering the profile unverified. Please review before presenting." });
    }

    let verify: NormalizedVerify | null = null;
    let autoFixesList: Array<{ issue: string; resolution: string }> = [];
    if (audit) {
      const fixable = audit.findings.filter((f) => PROSE_OWNERS.has(f.owner));
      sendEvent("status", { message: "Audit complete" });

      let applied: AppliedPatch[] = [];
      if (fixable.length > 0 && remainingMs() > TIMEOUT_FIX_MS + 30000) {
        sendEvent("status", { message: "Applying adjustments" });
        const fixThoughts = thoughtsFor("Fixer");
        try {
          const fix = await proposeFixes(ai, audit.findings, originalData, auditInputs, stageTimeout(TIMEOUT_FIX_MS), fixThoughts.onThought);
          const result = applyPatches(originalData, fix.patches, audit.findings);
          applied = result.applied;
          autoFixesList = describeAppliedFixes(audit.findings, applied, fix.notes);
          console.log(`[REMEDIATION] Applied ${applied.length} patch(es) across ${autoFixesList.length} finding(s); rejected ${result.rejected.length}.`);
          for (const r of result.rejected) console.log(`[REMEDIATION] Rejected ${r.findingId} ${r.path}: ${r.reason}.`);
        } catch (err: any) {
          console.error("Targeted fixes failed:", err?.message || err);
          pushAlert(generationAlerts, { section: "remediation", severity: "flagged", message: `QA fixes were not applied (${err?.message || err}). The plan is shown as written; review the QA findings before presenting.` });
        } finally {
          fixThoughts.done();
        }
      } else if (fixable.length > 0) {
        pushAlert(generationAlerts, { section: "remediation", severity: "flagged", message: "The run was short of time, so QA fixes were not applied. Review the QA findings before presenting." });
      }

      // Re-scored only when something changed: otherwise the audit's score already describes
      // the plan that ships.
      if (applied.length > 0 && remainingMs() > 45000) {
        sendEvent("status", { message: "Verifying adjustments..." });
        const verifyThoughts = thoughtsFor("QA verifier");
        try {
          verify = await runVerify(getOpenaiClient(), originalData, auditInputs, audit, applied, { ...modelOptions(VERIFY_EFFORT, TIMEOUT_VERIFY_MS), onThought: verifyThoughts.onThought });
        } catch (err: any) {
          console.error("QA verify failed:", err?.message || err);
          pushAlert(generationAlerts, { section: "qa", severity: "flagged", message: `Fixes were applied but not re-verified (${err?.message || err}); the score shown is from before the fixes.` });
        } finally {
          verifyThoughts.done();
        }
      }
    }
    const finalProfile = originalData;

    for (const corr of integrityCorrections) {
      autoFixesList.push({
        issue: "Programmatic metric verification mismatch",
        resolution: corr
      });
    }

    const findings = audit ? mergeFindings(audit, verify) : [];
    const openFlags = openFindingsAsFlags(findings);
    const finalAuditResult = buildAuditResult({ audit, verify, findings, autoFixes: autoFixesList, qaBypassed, quickMode, auditModel: quickMode ? "" : `${AUDIT_MODEL} (${AUDIT_EFFORT})` });

    // Embed the audit results into the final profile
    finalProfile.auditResult = finalAuditResult;

    // Digital Remedy's own historical campaign data heads the registry. It has no public URL, so
    // it carries no link; the UI renders an unlinked entry in the same style as the rest.
    if (!Array.isArray(finalProfile.sources)) finalProfile.sources = [];
    if (!finalProfile.sources.some((src: any) => src?.name === DIGITAL_REMEDY_SOURCE.name)) {
      finalProfile.sources.unshift({ ...DIGITAL_REMEDY_SOURCE });
    }

    // Personas are shown as generated - never padded to four, never relabelled by position.
    const isMediaPlanUploaded = Boolean(selectedPlanOptions && selectedPlanOptions.length > 0);
    for (const alert of checkPersonas(finalProfile, { mediaPlanUploaded: isMediaPlanUploaded })) pushAlert(generationAlerts, alert);
    delete finalProfile.expansionReachPercent;
    // Synthesis's executiveSummary draft has done its job (an audience signal for the channel
    // engine). It was written before the charts and channel plan were settled and nothing
    // rewrites it; the executive brief replaces it after delivery. Kept, it leaked stale claims
    // into the Markdown export and the segment prompt, and showed as an "older summary".
    delete finalProfile.executiveSummary;
    for (const alert of reportChartsNotFound(finalProfile, generationAlerts)) pushAlert(generationAlerts, alert);
    finalProfile.generationAlerts = generationAlerts;

    // The research the plan was built from, kept with the plan so a later audit can check its
    // figures against the dossiers rather than the auditor's memory. Each dossier is capped so
    // the plan stays well inside Firestore's 1MB document limit.
    finalProfile.researchSnapshot = {
      capturedAt: new Date().toISOString(),
      dossiers: [
        ...researchResults.map((result) => ({ label: result.label, failed: Boolean(result.failed), text: result.failed ? "" : result.text.slice(0, RESEARCH_SNAPSHOT_MAX_CHARS) })),
        // Kept with the plan so a later manual QA audit traces the same figures.
        ...(history?.dossier ? [{ label: history.dossier.label, failed: false, text: history.dossier.text.slice(0, RESEARCH_SNAPSHOT_MAX_CHARS) }] : []),
      ],
      ...(crawl ? { crawl: { url: crawl.url, ok: crawl.ok, chars: crawl.text.length } } : {}),
    };

    // Persona headshots are deliberately NOT generated here. Four sequential image calls
    // (45s timeout plus one retry each) could add up to 360s to a request the browser is
    // already blocked on, which on its own overruns Cloud Run's default 300s deadline.
    // The client requests each portrait from /api/generate-persona-avatar in parallel once
    // the profile has rendered, so image latency no longer gates the result.
    sendEvent("status", { message: "Profile complete. Studio persona portraits will render as they finish generating..." });

    // The QA audit and remediation have completed.
    // Scores and individual finding details remain available in the Plan Audit modal.

    for (const alert of generationAlerts) {
      sendEvent("status", { message: `• [${alert.severity === "failed" ? "FAILED" : alert.severity === "not_found" ? "NOT FOUND" : "CHECK"}] ${alert.message}` });
    }

    finalProfile.generationLog = generationLog;
    if (history) finalProfile.pastCampaignsUsed = history.used;

    // Every finished run is saved as a draft before it is sent, so a browser tab that crashes,
    // reloads or closes cannot lose a run that took minutes. Clicking Save later updates this
    // same record. A failed draft save is reported but never blocks delivering the plan.
    let savedPlanId: string | null = null;
    try {
      const advertiserLabel = cleanAdvertiserName || cleanUrl || "Audience";
      const baseTitle = typeof draft?.title === "string" && draft.title.trim() ? draft.title.trim() : `${advertiserLabel} Plan`;
      const record = await (await getStorage()).createPlan({
        ...planPayloadFromBody({
          title: `${baseTitle} (draft)`.slice(0, 200),
          advertiserName: cleanAdvertiserName || undefined,
          settingsRevision: draft?.settingsRevision,
          payload: {
            kpis: cleanKpis,
            audienceDescription: audienceDescription || "",
            url: url || "",
            geography,
            geographyConfig: draft?.geographyConfig,
            campaignFocus,
            additionalContext: additionalContext || "",
            targetPersonas: cleanTargetPersonas,
            budget: draft?.budget,
            campaignLength: draft?.campaignLength,
            planningSettings,
            profile: finalProfile,
            groundingSources: deduplicatedSources,
            autoSavedDraft: true,
          },
        }),
        actor: actorName(req),
      });
      savedPlanId = record.id;
      console.log(`[DRAFT] Saved the finished run as plan ${record.id} ("${record.title}").`);
      // The campaigns the plan was built from stay linked to it, so ScoutAI reads them and their
      // learnings can go to the client. Linking is best effort: the plan is already saved.
      for (const used of history?.used ?? []) {
        try {
          const storage = await getStorage();
          const campaign = await storage.getPerformanceCampaign(used.id);
          if (!campaign || campaign.archived || campaign.linkedPlanIds.includes(record.id)) continue;
          const { files, review, linkedPlanIds, ...details } = campaign;
          await storage.updatePerformanceCampaign(campaign.id, { ...details, files, linkedPlanIds: [...linkedPlanIds, record.id], actor: actorName(req) }, campaign.revision);
        } catch (err: any) {
          console.error(`[DRAFT] Could not link past campaign ${used.id}:`, err?.message || err);
        }
      }
    } catch (err: any) {
      console.error("[DRAFT] Could not auto-save the finished run:", err?.message || err);
      sendEvent("status", { message: `• [CHECK] The plan could not be auto-saved (${err?.message || err}). Save it manually before leaving the page.` });
    }

    // Return structured profile and citations
    sendEvent("complete", {
      savedPlanId,
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
