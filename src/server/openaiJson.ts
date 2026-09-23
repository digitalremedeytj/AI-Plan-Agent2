import type OpenAI from "openai";

/**
 * One JSON call to an OpenAI reasoning model, with its token usage logged. The QA calls never
 * logged usage, so their cost could only be estimated; every call through here reports it.
 */

export type OpenAiEffort = "low" | "medium" | "high" | "xhigh";

export interface OpenAiJsonRequest {
  model: string;
  effort: OpenAiEffort;
  system: string;
  input: string;
  timeoutMs: number;
  /** Short name for the log line, e.g. "QA audit". */
  label: string;
}

export interface OpenAiJsonResult {
  data: unknown;
  ms: number;
  usage: { input: number; output: number; reasoning: number };
}

export async function openAiJson(client: OpenAI, request: OpenAiJsonRequest): Promise<OpenAiJsonResult> {
  const startedAt = Date.now();
  const response: any = await client.responses.create(
    {
      model: request.model,
      reasoning: { effort: request.effort } as any,
      input: [
        { role: "system", content: request.system },
        { role: "user", content: request.input },
      ],
      text: { format: { type: "json_object" } },
    },
    // Retries are the caller's decision: a silent SDK retry would double the stage's budget.
    { timeout: request.timeoutMs, maxRetries: 0 },
  );
  const ms = Date.now() - startedAt;
  const usage = {
    input: Number(response?.usage?.input_tokens) || 0,
    output: Number(response?.usage?.output_tokens) || 0,
    reasoning: Number(response?.usage?.output_tokens_details?.reasoning_tokens) || 0,
  };
  console.log(`[OPENAI] ${request.label}: ${request.model} (${request.effort}) in ${(ms / 1000).toFixed(1)}s; tokens in ${usage.input}, out ${usage.output} (reasoning ${usage.reasoning}).`);
  const text = response?.output_text;
  if (!text) throw new Error(`${request.label} returned no output.`);
  return { data: JSON.parse(text), ms, usage };
}
