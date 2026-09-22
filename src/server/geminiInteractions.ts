import type { GoogleGenAI } from "@google/genai";

/**
 * Gemini 3.8 calls through the Interactions API. Every Gemini text call in the app goes
 * through this module; only image generation (a different model) still uses `generateContent`.
 *
 * 3.8 differs from 2.5: `generateContent` is legacy, `temperature`/`top_p`/`top_k` are removed,
 * and `thinking_level` replaces `thinking_budget` (`minimal` is rejected). See
 * documentation/gemini_3-8_api_documentation.txt.
 */

export const GEMINI_FLASH_MODEL = "gemini-3.8-flash";

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
  thinkingLevel: GeminiThinkingLevel;
  timeoutMs: number;
  model?: string;
}

async function createInteraction(
  client: GoogleGenAI,
  request: InteractionRequest,
  extra: Record<string, unknown>,
): Promise<InteractionLike> {
  const interaction = await client.interactions.create(
    {
      model: request.model ?? GEMINI_FLASH_MODEL,
      ...(request.systemInstruction ? { system_instruction: request.systemInstruction } : {}),
      input: request.input,
      generation_config: { thinking_level: request.thinkingLevel },
      // Briefs are client-confidential; nothing here needs server-side conversation state.
      store: false,
      ...extra,
    } as any,
    // Retries are the caller's decision: a silent SDK retry would double a timeout budget.
    { timeout: request.timeoutMs, maxRetries: 0 },
  );
  return interaction as InteractionLike;
}

export interface StructuredJsonRequest extends InteractionRequest {
  systemInstruction: string;
  /** JSON Schema subset supported by Gemini structured output. */
  schema: Record<string, unknown>;
}

export async function generateStructuredJson(client: GoogleGenAI, request: StructuredJsonRequest): Promise<unknown> {
  const interaction = await createInteraction(client, request, {
    response_format: { type: "text", mime_type: "application/json", schema: request.schema },
  });

  const text = interaction.output_text;
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
  for (const [index, attempt] of attempts.entries()) {
    try {
      const data = await generateStructuredJson(client, { ...request, ...attempt });
      return { data, thinkingLevel: attempt.thinkingLevel };
    } catch (err) {
      lastError = err;
      console.warn(`[GEMINI 3.8] ${attempt.thinkingLevel}-thinking attempt failed: ${(err as Error)?.message || err}`);
      const next = attempts[index + 1];
      if (next) onFallback?.(attempt.thinkingLevel, next.thinkingLevel);
    }
  }
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

export async function generateGroundedText(
  client: GoogleGenAI,
  request: Omit<TextRequest, "tools">,
): Promise<{ text: string; sources: UrlCitation[] }> {
  const { text, interaction } = await generateText(client, { ...request, tools: [{ type: "google_search" }] });
  return { text, sources: extractUrlCitations(interaction) };
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
