import test from "node:test";
import assert from "node:assert/strict";
import { Type, type GoogleGenAI } from "@google/genai";
import {
  extractUrlCitations,
  generateGroundedText,
  generateStructuredJsonWithFallback,
  generateText,
  describeFailedAttempts,
  describeQuota,
  isQuotaError,
  toGeminiJsonSchema,
  type InteractionLike,
} from "./geminiInteractions";

/** Shaped like the documented grounding response (gemini_3-8_api_documentation.txt, ~7394). */
const groundedInteraction: InteractionLike = {
  output_text: "Spain won Euro 2024, defeating England 2-1 in the final.",
  steps: [
    { type: "thought", content: [] },
    { type: "google_search_call" },
    { type: "google_search_result" },
    {
      type: "model_output",
      content: [
        {
          type: "text",
          text: "Spain won Euro 2024, defeating England 2-1 in the final.",
          annotations: [
            { type: "url_citation", url: "https://www.aljazeera.com/sports/euro-2024-final", title: "aljazeera.com", start_index: 0, end_index: 20 },
            { type: "url_citation", url: "https://www.uefa.com/euro2024/news/spain-wins-euro-2024", title: "uefa.com", start_index: 21, end_index: 56 },
            { type: "url_citation", url: "https://www.aljazeera.com/sports/euro-2024-final", title: "aljazeera.com", start_index: 30, end_index: 56 },
          ],
        },
      ],
    },
  ],
};

/** Records every create() call and answers from a script of results or errors. */
const stubClient = (results: Array<InteractionLike | Error>, calls: Array<{ params: any; options: any }> = []) =>
  ({
    interactions: {
      create: async (params: any, options: any) => {
        calls.push({ params, options });
        const next = results.shift();
        if (next instanceof Error) throw next;
        return next ?? {};
      },
    },
  }) as unknown as GoogleGenAI;

test("the converter lowercases nested types and keeps required and description", () => {
  const schema = {
    type: Type.OBJECT,
    properties: {
      personas: {
        type: Type.ARRAY,
        description: "Audience personas.",
        items: {
          type: Type.OBJECT,
          properties: { name: { type: Type.STRING }, share: { type: Type.NUMBER } },
          required: ["name"],
        },
      },
    },
    required: ["personas"],
  };

  assert.deepEqual(toGeminiJsonSchema(schema), {
    type: "object",
    properties: {
      personas: {
        type: "array",
        description: "Audience personas.",
        items: {
          type: "object",
          properties: { name: { type: "string" }, share: { type: "number" } },
          required: ["name"],
        },
      },
    },
    required: ["personas"],
  });
});

test("the converter refuses a keyword it has not been taught instead of passing it through", () => {
  const schema = { type: Type.OBJECT, properties: { tier: { type: Type.STRING, nullable: true } } };

  assert.throws(() => toGeminiJsonSchema(schema), /Unsupported schema keyword "nullable" at \$\.tier/);
});

test("the converter refuses an unknown type", () => {
  assert.throws(() => toGeminiJsonSchema({ type: "TYPE_UNSPECIFIED" }), /Unsupported schema type/);
});

test("a URL cited several times appears once in the source list", () => {
  assert.deepEqual(extractUrlCitations(groundedInteraction), [
    { title: "aljazeera.com", uri: "https://www.aljazeera.com/sports/euro-2024-final" },
    { title: "uefa.com", uri: "https://www.uefa.com/euro2024/news/spain-wins-euro-2024" },
  ]);
});

test("citations are read whether the index fields are snake_case or camelCase", () => {
  const camel: InteractionLike = {
    steps: [
      {
        type: "model_output",
        content: [
          {
            type: "text",
            text: "Gamers stream on CTV.",
            annotations: [{ type: "url_citation", url: "https://www.comscore.com/gaming", title: "comscore.com", startIndex: 0, endIndex: 21 }],
          },
        ],
      },
    ],
  };

  assert.deepEqual(extractUrlCitations(camel), [{ title: "comscore.com", uri: "https://www.comscore.com/gaming" }]);
});

test("a citation with no title falls back to its URL rather than an empty label", () => {
  const untitled: InteractionLike = {
    steps: [{ type: "model_output", content: [{ type: "text", text: "x", annotations: [{ type: "url_citation", url: "https://example.com/a", title: "" }] }] }],
  };

  assert.deepEqual(extractUrlCitations(untitled), [{ title: "https://example.com/a", uri: "https://example.com/a" }]);
});

test("an ungrounded response yields no sources", () => {
  assert.deepEqual(extractUrlCitations({ output_text: "No search needed.", steps: [{ type: "model_output", content: [{ type: "text", text: "No search needed." }] }] }), []);
  assert.deepEqual(extractUrlCitations({}), []);
});

test("text calls send no sampling parameters, never store the brief, and never retry silently", async () => {
  const calls: Array<{ params: any; options: any }> = [];
  const client = stubClient([{ output_text: "  A summary.  " }], calls);

  const { text } = await generateText(client, { input: "Summarize.", thinkingLevel: "low", timeoutMs: 30000 });

  assert.equal(text, "  A summary.  ");
  const { params, options } = calls[0];
  assert.equal(params.model, "gemini-3.8-flash");
  assert.deepEqual(params.generation_config, { thinking_level: "low" });
  assert.equal(params.store, false);
  assert.equal("temperature" in params || "system_instruction" in params || "tools" in params, false);
  assert.deepEqual(options, { timeout: 30000, maxRetries: 0 });
});

test("a grounded call enables Google Search and returns its citations with the text", async () => {
  const calls: Array<{ params: any; options: any }> = [];
  const client = stubClient([groundedInteraction], calls);

  const result = await generateGroundedText(client, {
    systemInstruction: "You are a research analyst.",
    input: "Who won Euro 2024?",
    thinkingLevel: "high",
    timeoutMs: 90000,
  });

  assert.deepEqual(calls[0].params.tools, [{ type: "google_search" }]);
  assert.equal(calls[0].params.system_instruction, "You are a research analyst.");
  assert.equal(result.text, groundedInteraction.output_text);
  assert.equal(result.sources.length, 2);
});

test("a failed high-thinking attempt falls back once and reports the switch", async () => {
  const calls: Array<{ params: any; options: any }> = [];
  const client = stubClient([new Error("Request timed out."), { output_text: '{"ok":true}' }], calls);
  const switches: string[] = [];

  const result = await generateStructuredJsonWithFallback(
    client,
    { systemInstruction: "sys", input: "in", schema: { type: "object" } },
    [
      { thinkingLevel: "high", timeoutMs: 120000 },
      { thinkingLevel: "medium", timeoutMs: 60000 },
    ],
    (failed, next) => switches.push(`${failed}->${next}`),
  );

  assert.deepEqual(result, { data: { ok: true }, thinkingLevel: "medium" });
  assert.deepEqual(switches, ["high->medium"]);
  assert.deepEqual(calls.map((c) => [c.params.generation_config.thinking_level, c.options.timeout]), [["high", 120000], ["medium", 60000]]);
});

test("when every attempt fails, the error carries each attempt's level and outcome", async () => {
  const calls: Array<{ params: any; options: any }> = [];
  const client = stubClient([new Error("high timed out after 90s."), new Error("medium timed out after 90s.")], calls);
  await assert.rejects(
    generateStructuredJsonWithFallback(client, { systemInstruction: "sys", input: "in", schema: { type: "object" } }, [
      { thinkingLevel: "high", timeoutMs: 90000 },
      { thinkingLevel: "medium", timeoutMs: 90000 },
    ]),
    (err: any) => {
      assert.deepEqual(err.attempts.map((a: any) => [a.thinkingLevel, a.error]), [["high", "high timed out after 90s."], ["medium", "medium timed out after 90s."]]);
      assert.ok(err.attempts.every((a: any) => Number.isInteger(a.seconds)));
      return true;
    },
  );
});

/** A 429 shaped like the SDK's RateLimitError: status plus the parsed Google error body. */
function quotaError(model = "gemini-3.8-flash"): Error {
  const err = new Error("429 You exceeded your current quota, please check your plan and billing details.") as any;
  err.status = 429;
  err.error = {
    code: 429,
    status: "RESOURCE_EXHAUSTED",
    details: [
      {
        "@type": "type.googleapis.com/google.rpc.QuotaFailure",
        violations: [{ quotaMetric: "generativelanguage.googleapis.com/search_grounding_request_count", quotaId: "SearchGroundingRequestsPerDay", quotaDimensions: { model }, quotaValue: "1500" }],
      },
      { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "3600s" },
    ],
  };
  return err;
}

/** An Interactions stub that also answers the legacy generateContent call the 2.5 fallback makes. */
const stubWithLegacy = (results: Array<InteractionLike | Error>, legacy: unknown | Error, legacyCalls: any[] = []) => {
  const client = stubClient(results) as any;
  client.models = {
    generateContent: async (params: any) => {
      legacyCalls.push(params);
      if (legacy instanceof Error) throw legacy;
      return legacy;
    },
  };
  return client as GoogleGenAI;
};

test("a 429 names the quota it hit, so the logs say which limit to raise", () => {
  assert.equal(isQuotaError(quotaError()), true);
  assert.equal(isQuotaError(new Error("Request timed out.")), false);
  assert.equal(
    describeQuota(quotaError()),
    "generativelanguage.googleapis.com/search_grounding_request_count (model gemini-3.8-flash, limit 1500); retry after 3600s",
  );
  // The legacy API only puts the body in the message.
  const legacy = new Error(`got status: 429 . ${JSON.stringify({ error: (quotaError() as any).error })}`);
  assert.equal(isQuotaError(legacy), true);
  assert.match(describeQuota(legacy), /search_grounding_request_count/);
  assert.equal(describeQuota(new Error("429 quota")), "");
});

test("when 3.8's search grounding is out of quota, the research still runs on 2.5 grounding", async () => {
  const legacyCalls: any[] = [];
  const client = stubWithLegacy([quotaError()], {
    text: "Spain won Euro 2024.",
    candidates: [{ groundingMetadata: { groundingChunks: [
      { web: { uri: "https://www.uefa.com/euro2024", title: "uefa.com" } },
      { web: { uri: "https://www.uefa.com/euro2024", title: "uefa.com" } },
      { retrievedContext: {} },
    ] } }],
  }, legacyCalls);

  const result = await generateGroundedText(client, { systemInstruction: "You are a research analyst.", input: "Who won Euro 2024?", thinkingLevel: "high", timeoutMs: 90000 });

  assert.equal(result.model, "gemini-2.5-flash");
  assert.equal(result.text, "Spain won Euro 2024.");
  assert.deepEqual(result.sources, [{ title: "uefa.com", uri: "https://www.uefa.com/euro2024" }]);
  assert.deepEqual(legacyCalls[0].config.tools, [{ googleSearch: {} }]);
  assert.equal(legacyCalls[0].config.systemInstruction, "You are a research analyst.");
  assert.equal(legacyCalls[0].config.thinkingConfig.thinkingBudget, 8192);
});

test("a grounded call that fails for any reason other than quota is not retried on 2.5", async () => {
  const legacyCalls: any[] = [];
  const client = stubWithLegacy([new Error("Request timed out.")], { text: "unused" }, legacyCalls);
  await assert.rejects(generateGroundedText(client, { input: "q", thinkingLevel: "high", timeoutMs: 90000 }), /timed out/);
  assert.equal(legacyCalls.length, 0);
});

test("if 2.5 grounding is out of quota too, that 429 is what the caller sees", async () => {
  const client = stubWithLegacy([quotaError()], quotaError("gemini-2.5-flash"));
  await assert.rejects(generateGroundedText(client, { input: "q", thinkingLevel: "high", timeoutMs: 90000 }), (err) => isQuotaError(err) && /gemini-2\.5-flash/.test(describeQuota(err)));
});

test("a failed fallback call says which attempts timed out and which errored, so a slow day and an outage read differently", () => {
  const err = Object.assign(new Error("429 RESOURCE_EXHAUSTED"), {
    attempts: [
      { thinkingLevel: "medium", seconds: 75, error: "Gemini call timed out after 75000ms" },
      { thinkingLevel: "low", seconds: 12, error: "429 RESOURCE_EXHAUSTED" },
    ],
  });
  assert.equal(describeFailedAttempts(err), "medium timed out after 75s; low failed after 12s (429 RESOURCE_EXHAUSTED)");
  assert.equal(describeFailedAttempts(new Error("bad schema")), "bad schema");
});
