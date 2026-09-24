import type OpenAI from "openai";
import { ThoughtHeadlines, streamDeadline } from "./thoughtProgress";

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
  /** When set, the call streams and reports each reasoning-summary headline as it arrives. */
  onThought?: (line: string) => void;
}

export interface OpenAiJsonResult {
  data: unknown;
  ms: number;
  usage: { input: number; output: number; reasoning: number };
}

export async function openAiJson(client: OpenAI, request: OpenAiJsonRequest): Promise<OpenAiJsonResult> {
  const startedAt = Date.now();
  const body = {
    model: request.model,
    reasoning: { effort: request.effort } as any,
    input: [
      { role: "system" as const, content: request.system },
      { role: "user" as const, content: request.input },
    ],
    text: { format: { type: "json_object" as const } },
  };
  let response: any = null;
  if (request.onThought) {
    try {
      response = await streamWithThoughts(client, body, request, request.onThought);
    } catch (err: any) {
      // A rejected request (e.g. summaries not enabled for the org) costs nothing yet, so fall
      // back to the plain call. A timeout or mid-stream failure spent the budget: surface it.
      if (!(err?.status >= 400 && err?.status < 500 && err?.status !== 408 && err?.status !== 429)) throw err;
      console.warn(`[OPENAI] ${request.label}: streaming with reasoning summaries was rejected (${err?.message || err}); retrying without.`);
    }
  }
  if (!response) {
    response = await client.responses.create(
      body,
      // Retries are the caller's decision: a silent SDK retry would double the stage's budget.
      { timeout: Math.max(1000, request.timeoutMs - (Date.now() - startedAt)), maxRetries: 0 },
    );
  }
  const ms = Date.now() - startedAt;
  const usage = {
    input: Number(response?.usage?.input_tokens) || 0,
    output: Number(response?.usage?.output_tokens) || 0,
    reasoning: Number(response?.usage?.output_tokens_details?.reasoning_tokens) || 0,
  };
  console.log(`[OPENAI] ${request.label}: ${request.model} (${request.effort}) in ${(ms / 1000).toFixed(1)}s; tokens in ${usage.input}, out ${usage.output} (reasoning ${usage.reasoning}).`);
  const text = response?.output_text || outputText(response);
  if (!text) throw new Error(`${request.label} returned no output.`);
  return { data: JSON.parse(text), ms, usage };
}

async function streamWithThoughts(client: OpenAI, body: any, request: OpenAiJsonRequest, onThought: (line: string) => void): Promise<any> {
  const deadline = streamDeadline(request.timeoutMs, request.label);
  const headlines = new ThoughtHeadlines(onThought);
  try {
    const stream = client.responses.stream(
      { ...body, reasoning: { ...body.reasoning, summary: "auto" } },
      { signal: deadline.signal, maxRetries: 0 },
    );
    stream.on("response.reasoning_summary_text.delta", (event) => headlines.push(event.delta));
    stream.on("response.reasoning_summary_text.done", () => headlines.end());
    return await stream.finalResponse();
  } catch (err) {
    // The SDK reports an abort generically; the deadline's own error says what happened.
    if (deadline.signal.aborted) throw deadline.signal.reason;
    throw err;
  } finally {
    deadline.clear();
  }
}

function outputText(response: any): string {
  return (response?.output ?? [])
    .filter((item: any) => item?.type === "message")
    .flatMap((item: any) => item.content ?? [])
    .filter((part: any) => part?.type === "output_text")
    .map((part: any) => part.text)
    .join("");
}
