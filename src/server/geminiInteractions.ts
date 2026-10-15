import type { GoogleGenAI } from "@google/genai";
import { ThoughtHeadlines, streamDeadline } from "./thoughtProgress";

/**
 * Gemini 3.8 calls through the Interactions API. Every Gemini text call in the app goes
 * through this module. Image generation (a different model) and the 2.5 search-grounding
 * fallback still use `generateContent`.
 *
 * 3.8 differs from 2.5: `generateContent` is legacy, `temperature`/`top_p`/`top_k` are removed,
 * and `thinking_level` replaces `thinking_budget` (`minimal` is rejected). See
 * documentation/gemini_3-8_api_documentation.txt.
 */

export const GEMINI_FLASH_MODEL = "gemini-3.8-flash";

/**
 * Where a grounded call goes when 3.8's search grounding is out of quota. Google meters search
 * grounding per model generation: "Gemini 3 and newer" has a 1.5K/day cap, counted per search
 * query, which a busy day of research dossiers exhausted (2026-10-15). 2.5's grounding is a
 * separate, larger bucket (5K/day, counted per prompt), so a dossier that cannot search on 3.8
 * can still search on 2.5 instead of shipping the topic empty. 2.5 is on the legacy
 * `generateContent` API.
 */
export const GEMINI_GROUNDING_FALLBACK_MODEL = "gemini-2.5-flash";

/** Thinking budgets for the 2.5 fallback, which takes tokens rather than 3.8's levels. */
const FALLBACK_THINKING_BUDGET: Record<GeminiThinkingLevel, number> = { low: 1024, medium: 4096, high: 8192 };

/** A quota (429 / RESOURCE_EXHAUSTED) error from either the Interactions or the legacy API. */
export function isQuotaError(err: unknown): boolean {
  const e = err as { status?: unknown; statusCode?: unknown; message?: unknown } | null;
  if (!e || typeof e !== "object") return false;
  if (e.status === 429 || e.statusCode === 429) return true;
  const message = typeof e.message === "string" ? e.message : "";
  return /^429\b|RESOURCE_EXHAUSTED/.test(message);
}

/**
 * Which quota a 429 hit, from the QuotaFailure detail Google attaches, e.g.
 * "generativelanguage.googleapis.com/search_grounding_request_count (model gemini-3.8-flash)".
 * The message alone ("You exceeded your current quota") does not say, and the per-model,
 * per-tool and per-day buckets call for different fixes. Empty when no detail came back.
 */
export function describeQuota(err: unknown): string {
  const e = err as { error?: unknown; body?: unknown; message?: unknown } | null;
  if (!e || typeof e !== "object") return "";
  const parsed: unknown[] = [e.error];
  for (const text of [e.body, e.message]) {
    if (typeof text !== "string") continue;
    const start = text.indexOf("{");
    if (start < 0) continue;
    try { parsed.push(JSON.parse(text.slice(start))); } catch { /* not JSON; nothing to read */ }
  }
  const found: string[] = [];
  let retry = "";
  const walk = (node: unknown, depth: number) => {
    if (!node || typeof node !== "object" || depth > 6) return;
    if (Array.isArray(node)) { for (const item of node) walk(item, depth + 1); return; }
    const obj = node as Record<string, unknown>;
    if (typeof obj.retryDelay === "string" && !retry) retry = obj.retryDelay;
    if (Array.isArray(obj.violations)) {
      for (const v of obj.violations as Array<Record<string, unknown>>) {
        const dims = (v?.quotaDimensions ?? {}) as Record<string, unknown>;
        const metric = String(v?.quotaMetric || v?.quotaId || "").trim();
        if (!metric) continue;
        const extra = [dims.model && `model ${dims.model}`, v?.quotaValue && `limit ${v.quotaValue}`].filter(Boolean).join(", ");
        const line = extra ? `${metric} (${extra})` : metric;
        if (!found.includes(line)) found.push(line);
      }
    }
    for (const value of Object.values(obj)) walk(value, depth + 1);
  };
  for (const node of parsed) walk(node, 0);
  if (!found.length) return "";
  return `${found.join("; ")}${retry ? `; retry after ${retry}` : ""}`;
}

/** One log line per 429, naming the quota, so the next one is diagnosed from the logs alone. */
function logQuota(err: unknown, model: string, what: string): void {
  if (!isQuotaError(err)) return;
  const detail = describeQuota(err);
  console.warn(`[GEMINI QUOTA] ${model} ${what} hit a quota limit: ${detail || "no quota detail in the response"}.`);
}

export type GeminiThinkingLevel = "low" | "medium" | "high";

/** The slice of an Interaction this module reads. Kept structural so tests can hand-build one. */
export interface InteractionLike {
  output_text?: string;
  steps?: Array<{
    type: string;
    content?: Array<{ type: string; text?: string; annotations?: Array<Record<string, unknown>> }>;
  }>;
}

interface InteractionRequest {
  systemInstruction?: string;
  input: string;
  /** Images sent after the text, e.g. a generated slide to proofread. Base64 without the data: prefix. */
  images?: Array<{ data: string; mimeType: string }>;
  thinkingLevel: GeminiThinkingLevel;
  timeoutMs: number;
  model?: string;
  /** When set, the call streams and reports each thought-summary headline as it arrives. */
  onThought?: (line: string) => void;
  /** Cancels the request, e.g. when a backup request for the same work answered first. */
  signal?: AbortSignal;
}

function interactionParams(request: InteractionRequest, extra: Record<string, unknown>): Record<string, unknown> {
  return {
    model: request.model ?? GEMINI_FLASH_MODEL,
    ...(request.systemInstruction ? { system_instruction: request.systemInstruction } : {}),
    input: request.images?.length
      ? [{ type: "text", text: request.input }, ...request.images.map((image) => ({ type: "image", data: image.data, mime_type: image.mimeType }))]
      : request.input,
    generation_config: { thinking_level: request.thinkingLevel },
    // Briefs are client-confidential; nothing here needs server-side conversation state.
    store: false,
    ...extra,
  };
}

async function createInteraction(
  client: GoogleGenAI,
  request: InteractionRequest,
  extra: Record<string, unknown>,
): Promise<InteractionLike> {
  const params = interactionParams(request, extra);
  const interaction = await client.interactions.create(
    params as any,
    // Retries are the caller's decision: a silent SDK retry would double a timeout budget. A
    // fetch signal takes precedence over the SDK's own timeout, so the timeout rides on it too.
    {
      timeout: request.timeoutMs,
      maxRetries: 0,
      ...(request.signal ? { fetchOptions: { signal: AbortSignal.any([request.signal, AbortSignal.timeout(request.timeoutMs)]) } } : {}),
    },
  ).catch((err: unknown) => {
    logQuota(err, String(params.model), extra.tools ? "call with tools" : "call");
    throw err;
  });
  return interaction as InteractionLike;
}

/**
 * The same call, streamed so thought summaries reach `onThought` while the model works. Returns
 * the concatenated model output text, which is what `output_text` holds for a JSON response.
 */
async function streamInteractionText(
  client: GoogleGenAI,
  request: InteractionRequest,
  extra: Record<string, unknown>,
  onThought: (line: string) => void,
): Promise<string> {
  const deadline = streamDeadline(request.timeoutMs, "Gemini call");
  const headlines = new ThoughtHeadlines(onThought);
  const kinds = new Map<number, string>();
  let text = "";
  try {
    const params = interactionParams(request, extra) as any;
    const stream: AsyncIterable<any> = await client.interactions.create(
      { ...params, generation_config: { ...params.generation_config, thinking_summaries: "auto" }, stream: true },
      { timeout: request.timeoutMs, maxRetries: 0, fetchOptions: { signal: deadline.signal } } as any,
    ) as any;
    for await (const event of stream) {
      switch (event?.event_type) {
        case "step.start": {
          const step = event.step ?? {};
          kinds.set(event.index, step.type);
          if (step.type === "thought") for (const part of step.summary ?? []) headlines.push(part?.text ?? "");
          if (step.type === "model_output") for (const part of step.content ?? []) if (part?.type === "text") text += part.text ?? "";
          break;
        }
        case "step.delta": {
          const delta = event.delta ?? {};
          if (delta.type === "thought_summary") headlines.push(delta.content?.text ?? "");
          else if (delta.type === "text" && kinds.get(event.index) === "model_output") text += delta.text ?? "";
          break;
        }
        case "step.stop":
          if (kinds.get(event.index) === "thought") headlines.end();
          break;
        case "error":
          throw new Error(`Gemini stream error: ${event.error?.message || JSON.stringify(event.error ?? {})}`);
      }
    }
    return text;
  } catch (err) {
    // The SDK reports an abort generically; the deadline's own error says what happened.
    if (deadline.signal.aborted) throw deadline.signal.reason;
    logQuota(err, request.model ?? GEMINI_FLASH_MODEL, "streamed call");
    throw err;
  } finally {
    deadline.clear();
  }
}

export interface StructuredJsonRequest extends InteractionRequest {
  /** JSON Schema subset supported by Gemini structured output. */
  schema: Record<string, unknown>;
}

export async function generateStructuredJson(client: GoogleGenAI, request: StructuredJsonRequest): Promise<unknown> {
  const format = { response_format: { type: "text", mime_type: "application/json", schema: request.schema } };
  const text = request.onThought
    ? await streamInteractionText(client, request, format, request.onThought)
    : (await createInteraction(client, request, format)).output_text;
  if (!text) throw new Error("Gemini returned no output text.");
  return JSON.parse(text);
}

/**
 * Runs at the preferred thinking level and falls back once to a cheaper one on timeout or
 * error, so a slow high-effort run degrades to a good answer instead of no answer.
 */
export async function generateStructuredJsonWithFallback(
  client: GoogleGenAI,
  request: Omit<StructuredJsonRequest, "thinkingLevel" | "timeoutMs">,
  attempts: Array<{ thinkingLevel: GeminiThinkingLevel; timeoutMs: number }>,
  onFallback?: (failed: GeminiThinkingLevel, next: GeminiThinkingLevel) => void,
): Promise<{ data: unknown; thinkingLevel: GeminiThinkingLevel }> {
  let lastError: unknown = new Error("No attempts configured.");
  // Every attempt's outcome rides on the final error, so a caller can log the whole story
  // ("high timed out at 90s, medium failed at 41s") rather than only the last failure.
  const tried: Array<{ thinkingLevel: GeminiThinkingLevel; seconds: number; error: string }> = [];
  for (const [index, attempt] of attempts.entries()) {
    const startedAt = Date.now();
    try {
      const data = await generateStructuredJson(client, { ...request, ...attempt });
      return { data, thinkingLevel: attempt.thinkingLevel };
    } catch (err) {
      lastError = err;
      const seconds = Math.round((Date.now() - startedAt) / 1000);
      tried.push({ thinkingLevel: attempt.thinkingLevel, seconds, error: (err as Error)?.message || String(err) });
      console.warn(`[GEMINI 3.8] ${attempt.thinkingLevel}-thinking attempt failed after ${seconds}s: ${(err as Error)?.message || err}`);
      const next = attempts[index + 1];
      if (next) onFallback?.(attempt.thinkingLevel, next.thinkingLevel);
    }
  }
  if (lastError && typeof lastError === "object") (lastError as { attempts?: typeof tried }).attempts = tried;
  throw lastError;
}

export interface TextRequest extends InteractionRequest {
  tools?: Array<Record<string, unknown>>;
}

export async function generateText(
  client: GoogleGenAI,
  request: TextRequest,
): Promise<{ text: string; interaction: InteractionLike }> {
  const interaction = await createInteraction(client, request, request.tools ? { tools: request.tools } : {});
  return { text: interaction.output_text ?? "", interaction };
}

export interface UrlCitation {
  title: string;
  uri: string;
}

/**
 * Collects the `url_citation` annotations 3.8 attaches to its text output, one entry per URL.
 * Replaces 2.5's `groundingMetadata.groundingChunks`. The live API sends `start_index`; the
 * docs' JavaScript sample reads `startIndex`. Neither is needed here, so both shapes pass.
 */
export function extractUrlCitations(interaction: InteractionLike): UrlCitation[] {
  const byUrl = new Map<string, UrlCitation>();
  for (const step of interaction.steps ?? []) {
    if (step.type !== "model_output") continue;
    for (const block of step.content ?? []) {
      if (block.type !== "text") continue;
      for (const annotation of block.annotations ?? []) {
        if (annotation.type !== "url_citation") continue;
        const uri = typeof annotation.url === "string" ? annotation.url.trim() : "";
        if (!uri || byUrl.has(uri)) continue;
        const title = typeof annotation.title === "string" && annotation.title.trim() ? annotation.title.trim() : uri;
        byUrl.set(uri, { title, uri });
      }
    }
  }
  return [...byUrl.values()];
}

/** Below this, a 2.5 retry would only be cut off by the caller's deadline. */
const MIN_FALLBACK_MS = 10_000;

/**
 * A search-grounded answer on 3.8, or on 2.5 when 3.8's grounding quota is spent (see
 * GEMINI_GROUNDING_FALLBACK_MODEL). `model` says which one answered. Any other failure, and a
 * 429 from 2.5 as well, is thrown as is.
 */
export async function generateGroundedText(
  client: GoogleGenAI,
  request: Omit<TextRequest, "tools">,
): Promise<{ text: string; sources: UrlCitation[]; model: string }> {
  const startedAt = Date.now();
  try {
    const { text, interaction } = await generateText(client, { ...request, tools: [{ type: "google_search" }] });
    return { text, sources: extractUrlCitations(interaction), model: request.model ?? GEMINI_FLASH_MODEL };
  } catch (err) {
    const remainingMs = request.timeoutMs - (Date.now() - startedAt);
    if (!isQuotaError(err) || request.signal?.aborted || remainingMs < MIN_FALLBACK_MS) throw err;
    console.warn(`[GEMINI GROUNDING] Retrying on ${GEMINI_GROUNDING_FALLBACK_MODEL} search grounding after a 429 from ${request.model ?? GEMINI_FLASH_MODEL}.`);
    return generateLegacyGroundedText(client, { ...request, timeoutMs: remainingMs });
  }
}

interface LegacyGroundingResponse {
  text?: string;
  candidates?: Array<{ groundingMetadata?: { groundingChunks?: Array<{ web?: { uri?: string; title?: string } }> } }>;
}

async function generateLegacyGroundedText(
  client: GoogleGenAI,
  request: Omit<TextRequest, "tools">,
): Promise<{ text: string; sources: UrlCitation[]; model: string }> {
  const model = GEMINI_GROUNDING_FALLBACK_MODEL;
  const signal = request.signal ? AbortSignal.any([request.signal, AbortSignal.timeout(request.timeoutMs)]) : AbortSignal.timeout(request.timeoutMs);
  let response: LegacyGroundingResponse;
  try {
    response = await client.models.generateContent({
      model,
      contents: request.input,
      config: {
        ...(request.systemInstruction ? { systemInstruction: request.systemInstruction } : {}),
        tools: [{ googleSearch: {} }],
        thinkingConfig: { thinkingBudget: FALLBACK_THINKING_BUDGET[request.thinkingLevel] },
        abortSignal: signal,
        httpOptions: { timeout: request.timeoutMs },
      },
    }) as LegacyGroundingResponse;
  } catch (err) {
    logQuota(err, model, "grounded fallback");
    throw err;
  }
  const text = response.text ?? "";
  if (!text) throw new Error(`${model} returned no output text.`);
  // The same one-entry-per-URL shape extractUrlCitations gives for 3.8, so callers see no difference.
  const byUrl = new Map<string, UrlCitation>();
  for (const chunk of response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? []) {
    const uri = chunk.web?.uri?.trim();
    if (!uri || byUrl.has(uri)) continue;
    byUrl.set(uri, { title: chunk.web?.title?.trim() || uri, uri });
  }
  return { text, sources: [...byUrl.values()], model };
}

const SCHEMA_TYPES = new Set(["string", "number", "integer", "boolean", "object", "array"]);

/**
 * Converts the `@google/genai` `Type.*` schemas used for 2.5 (`"OBJECT"`, `"STRING"`, ...) into
 * the lowercase JSON Schema that 3.8's `response_format` takes, so the existing schemas stay the
 * single definition. It handles exactly the keywords those schemas use today and throws on
 * anything else: a new keyword should be mapped deliberately, not passed through and possibly
 * mistranslated or rejected at request time.
 */
export function toGeminiJsonSchema(schema: unknown, path = "$"): Record<string, unknown> {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    throw new Error(`Schema at ${path} must be an object.`);
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    switch (key) {
      case "type": {
        const type = String(value).toLowerCase();
        if (!SCHEMA_TYPES.has(type)) throw new Error(`Unsupported schema type "${value}" at ${path}.`);
        out.type = type;
        break;
      }
      case "properties":
        if (!value || typeof value !== "object") throw new Error(`Schema properties at ${path} must be an object.`);
        out.properties = Object.fromEntries(
          Object.entries(value as Record<string, unknown>).map(([name, child]) => [
            name,
            toGeminiJsonSchema(child, `${path}.${name}`),
          ]),
        );
        break;
      case "items":
        out.items = toGeminiJsonSchema(value, `${path}[]`);
        break;
      case "required":
        if (!Array.isArray(value)) throw new Error(`Schema required at ${path} must be an array.`);
        out.required = [...value];
        break;
      case "description":
        out.description = value;
        break;
      default:
        throw new Error(`Unsupported schema keyword "${key}" at ${path}; map it in toGeminiJsonSchema.`);
    }
  }
  if (!out.type) throw new Error(`Schema at ${path} has no type.`);
  return out;
}
