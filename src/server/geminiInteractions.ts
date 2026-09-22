import type { GoogleGenAI } from "@google/genai";

/**
 * Structured-JSON calls to Gemini 3.8 through the Interactions API.
 *
 * 3.8 differs from the 2.5 calls elsewhere in server.ts: `generateContent` is legacy,
 * `temperature`/`top_p`/`top_k` are removed, and `thinking_level` replaces `thinking_budget`
 * (`minimal` is rejected). See documentation/gemini_3-8_api_documentation.txt.
 */

export const GEMINI_FLASH_MODEL = "gemini-3.8-flash";

export type GeminiThinkingLevel = "low" | "medium" | "high";

export interface StructuredJsonRequest {
  systemInstruction: string;
  input: string;
  /** JSON Schema subset supported by Gemini structured output. */
  schema: Record<string, unknown>;
  thinkingLevel: GeminiThinkingLevel;
  timeoutMs: number;
  model?: string;
}

export async function generateStructuredJson(client: GoogleGenAI, request: StructuredJsonRequest): Promise<unknown> {
  const interaction = await client.interactions.create(
    {
      model: request.model ?? GEMINI_FLASH_MODEL,
      system_instruction: request.systemInstruction,
      input: request.input,
      response_format: { type: "text", mime_type: "application/json", schema: request.schema },
      generation_config: { thinking_level: request.thinkingLevel },
      // Briefs are client-confidential; nothing here needs server-side conversation state.
      store: false,
    },
    // Retries are the caller's decision: a silent SDK retry would double a timeout budget.
    { timeout: request.timeoutMs, maxRetries: 0 },
  );

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
): Promise<{ data: unknown; thinkingLevel: GeminiThinkingLevel }> {
  let lastError: unknown = new Error("No attempts configured.");
  for (const attempt of attempts) {
    try {
      const data = await generateStructuredJson(client, { ...request, ...attempt });
      return { data, thinkingLevel: attempt.thinkingLevel };
    } catch (err) {
      lastError = err;
      console.warn(`[GEMINI 3.8] ${attempt.thinkingLevel}-thinking attempt failed: ${(err as Error)?.message || err}`);
    }
  }
  throw lastError;
}
