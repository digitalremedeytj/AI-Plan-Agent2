# Gemini 2.5 → 3.8 Migration Plan

Move every remaining `gemini-2.5-flash` call in the app to `gemini-3.8-flash` on the
Interactions API. Written to be executed from a fresh session with no chat history.

**Priority: quality over speed**, as long as the full generation stays inside its time limits.

---

## 0. Read first

1. `CLAUDE.md`: storage, auth, deployment, dependency and testing rules. They all apply.
2. `documentation/gemini_3-8_api_documentation.txt`: the vendor docs (7,700 lines). Relevant parts:
   | Topic | Lines (approx.) |
   | --- | --- |
   | Interactions API replaces `generateContent` ("legacy") | 180–200 |
   | 3.8 Flash: thinking levels, migration checklist | 905–1183 |
   | Structured output (`response_format`) examples | 2820–2900 |
   | JSON Schema subset supported | 3841–3908 |
   | Grounding with Google Search, `url_citation` annotations | 7299–7500 |
3. **The working precedent, already on 3.8 in production code:**
   - `src/server/geminiInteractions.ts`: `generateStructuredJson()` and
     `generateStructuredJsonWithFallback()`. Extend this module; don't start a new one.
   - `POST /api/generate-segments` in `server.ts` (segment recommendations): uses the wrapper
     with `high` thinking and a single `medium` fallback. A live call took about 47s for
     13 segments with the schema accepted.

## 1. What changes between 2.5 (`generateContent`) and 3.8 (Interactions)

| Concern | 2.5 today | 3.8 target |
| --- | --- | --- |
| Call | `ai.models.generateContent({ model, contents, config })` | `ai.interactions.create({ model, input, ... }, { timeout, maxRetries: 0 })` |
| System prompt | `config.systemInstruction` | top-level `system_instruction` |
| Output text | `response.text` | `interaction.output_text` |
| JSON output | `responseMimeType` + `responseSchema` (`Type.OBJECT` enums) | `response_format: { type: "text", mime_type: "application/json", schema }` with standard lowercase JSON Schema |
| Thinking | `thinkingConfig.thinkingBudget` (number) | `generation_config.thinking_level`: `"low" \| "medium" \| "high"`. **`minimal` returns an error on 3.8.** The default is `medium`. |
| Sampling | `temperature` 0.1 / 0.2 | **Removed.** Remove `temperature`, `top_p`, `top_k` and `candidate_count`. |
| Search grounding | `tools: [{ googleSearch: {} }]` | `tools: [{ type: "google_search" }]` |
| Citations | `candidates[0].groundingMetadata.groundingChunks[].web.{uri,title}` | `url_citation` annotations on text blocks in `interaction.steps[]` where `step.type === "model_output"`, content `type === "text"`, `annotations[].{url,title,start_index,end_index}` |
| Server-side storage | n/a | Pass `store: false` (client briefs are confidential; no multi-turn state is needed) |

The installed `@google/genai` is **2.10.0** and already includes `interactions` with typed
`response_format`, `generation_config.thinking_level`, `system_instruction`, `store` and
`output_text`. **No new npm dependency is needed** (CLAUDE.md: avoid adding dependencies).

## 2. Call-site inventory (all in `server.ts`)

Find each one with `grep -n '"gemini-2.5-flash"' server.ts`. Line numbers drift, so search for
the anchor text.

| # | Anchor (function / route) | Today | Output | Target thinking | Timeout today |
| --- | --- | --- | --- | --- | --- |
| 1 | `runResearchCall` inside `app.post("/api/generate-profile"` (4 parallel dossiers: demographics, web, device, temporal) | `googleSearch` tool, `temperature: 0.2`, system instruction | Text + grounding sources | `medium` | `TIMEOUT_PARALLEL_RESEARCH_MS` 90s, via `withTimeout` |
| 2 | `const synthesisPromise = ai.models.generateContent(` (main synthesis) | `responseSchema: audienceProfileSchema`, `temperature: 0.1`, `thinkingBudget: SYNTHESIS_THINKING_BUDGET` (4096) | JSON (largest schema) | `medium` (try `high` in the spike; keep it only if it fits) | `TIMEOUT_SYNTHESIS_MS` 120s |
| 3 | `const analysisResp = await ai.models.generateContent(` (uploaded-plan audience-alignment paragraph, fallback only) | no config | Plain text | `low` | none. **Add one** (e.g. 30s) |
| 4 | `async function generateCandidateSignals(` (planning-engine AI signals) | `responseSchema: candidateSignalSchema` (**top-level ARRAY**), `temperature: 0.1` | JSON | `low` or `medium` (decide in the spike) | `TIMEOUT_SCORING_MS` 60s |
| 5 | `app.post("/api/summarize-publisher-insights"` | `temperature: 0.2` | Plain text | `low` | none. **Add one** (e.g. 30s) |

**Out of scope (leave as is):**
- `generatePersonaHeadshot`: `gemini-3.1-flash-image` for image output, still on legacy
  `generateContent`, which remains supported. It uses `ThinkingLevel.MINIMAL`, which is fine on
  that model. Keep the `ThinkingLevel` import while this call exists.
- OpenAI QA scoring and auto-remediation (`openai.responses.create`), and the `gpt-image-*` slide
  endpoints.

## 3. Step 0: baseline, then a spike (before editing `server.ts`)

**Baseline on the current code.** Run the three README example queries (Gamers/Razer,
Luxury travel/Visit California, New parents/Target) end to end in the browser. For each run,
record:
- total wall time, and the time for each stage from the server log timestamps
- `Found N sources` for each research dossier (server log)
- the QA score (`auditResult.originalScore`) and red-flag count
- the number of entries in the final `profile.sources`
- whether `[PLANNING] AI candidate reasoning unavailable` appears (it should not)

**Spike, as a throwaway script in the session scratchpad.** Answer these three questions
before changing app code:
1. Does 3.8 accept `audienceProfileSchema` after conversion to lowercase JSON Schema? The docs
   warn that "very large or deeply nested schemas may be rejected". If it's rejected, see Risks.
2. What does a real grounded research call return: the annotation field casing
   (`start_index` vs `startIndex`; the docs show both), how many unique `url_citation` URLs
   come back, and whether any are still `vertexaisearch` redirects?
3. How long do synthesis at `medium` and at `high`, and one research call at `medium`, take?

Scratch-script gotchas already hit once:
- Name the file `.mts` so top-level `await` works.
- Import packages by absolute path, e.g.
  `/Users/tj/ai-plan-agent/node_modules/@google/genai/dist/node/index.mjs` and
  `/Users/tj/ai-plan-agent/node_modules/dotenv/lib/main.js`. A file outside the repo can't resolve
  bare package names.
- Load `/Users/tj/ai-plan-agent/.env.local` for `GEMINI_API_KEY`.
- Run it with Node 22: `source ~/.nvm/nvm.sh && nvm use 22 && npx tsx <file>.mts` from the repo root.

## 4. Implementation

Make one commit per step, so any single call site can be reverted.

### 4.1 Extend `src/server/geminiInteractions.ts` (with tests)
- `toGeminiJsonSchema(schema)`: a pure, recursive conversion of `@google/genai` `Type.*`
  schemas (uppercase `"OBJECT"`, `"STRING"`, …) into lowercase JSON Schema. The existing
  schemas use only `type`, `properties`, `items`, `required` and `description`; no `nullable`,
  `enum` or `format` appear. Throw on anything unexpected, so a new schema feature fails loudly
  rather than silently. This avoids rewriting ~370 lines of schema by hand.
- `generateText(client, { systemInstruction?, input, thinkingLevel, timeoutMs, tools? })`
  returns `{ text, interaction }`, for call sites 3 and 5 and the base of 4.1's grounded helper.
- `extractUrlCitations(interaction)`: a pure function returning `{ title, uri }[]`, deduplicated
  by URL. Accept both `start_index` and `startIndex`. Fall back to `url` as the title when
  `title` is empty.
- `generateGroundedText(...)` = `generateText` with `tools: [{ type: "google_search" }]` plus
  `extractUrlCitations`.
- Tests in `src/server/geminiInteractions.test.ts` (node:test, following CLAUDE.md's naming
  convention), using a fixture shaped like the docs' grounding response (docs lines ~7394–7447):
  - the converter lowercases nested types and preserves `required`/`description`
  - the converter throws on an unknown keyword
  - citations are deduplicated
  - both index casings are handled
  - a response with no annotations returns `[]`

### 4.2 Migrate in increasing order of risk
1. **#5 summarize-publisher-insights**: `generateText` at `low`, with a new 30s timeout. The
   existing sentence-truncation fallback already covers failure.
2. **#3 audience-analysis paragraph**: `generateText` at `low`, with a new 30s timeout. It's
   already in a try/catch.
3. **#4 candidate signals**: wrap the top-level array schema in an object
   (`{ signals: [...] }`) to avoid relying on a top-level-array `response_format`, and update the
   parser to read `.signals`. Keep the "return [] and use deterministic fallback" behavior.
4. **#2 synthesis**:
   - use `generateStructuredJson` with `toGeminiJsonSchema(audienceProfileSchema)`
   - remove `temperature` and `thinkingBudget`
   - replace `SYNTHESIS_THINKING_BUDGET` and its comment with a `SYNTHESIS_THINKING_LEVEL`
     constant and a comment explaining the choice
   - keep `TIMEOUT_SYNTHESIS_MS` semantics; the current code throws a user-facing error when
     synthesis times out
   - `JSON.parse(synthesisResult.text)` becomes the wrapper's parsed result
5. **#1 research dossiers**:
   - use `generateGroundedText` at `medium`
   - map citations into the existing `{ label, text, sources }` shape so everything downstream
     is untouched: `extractFindingBlurb`, `research_result` SSE events, `deduplicatedSources`
     and `resolveGroundingUrls`
   - `resolveGroundingUrls` rewrites only `vertexaisearch.cloud.google.com` redirects and leaves
     direct publisher URLs alone, so it stays safe either way. Update its header comment if 3.8
     no longer returns redirects.
   - keep the per-call `withTimeout` fallback text

### 4.3 Clean up
- Remove the `Type` import only if nothing uses it any more. The converter consumes the
  existing `Type` schemas, so it probably stays.
- Update comments that describe 2.5 behavior, such as the "gemini-2.5-flash defaults to
  DYNAMIC thinking" note.
- README "Tech Stack" / "AI Core": it currently says `gemini-3.5-flash` and generateContent.
  Update it to Gemini 3.8 Flash on the Interactions API.
- CLAUDE.md architecture: add one line noting that `src/server/geminiInteractions.ts` is where
  all Gemini text calls go.
- Confirm that `grep -n "gemini-2.5" server.ts src -r` returns nothing.

## 5. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| **Latency.** 3.8 "can use more tokens on longer running and complex tasks, by design". The pipeline's worst case (90 + 120 + 60 + 90s ≈ 360s) already exceeds Cloud Run's 300s default, and the SSE watchdog kills a stream after 240s without an event. | Measure in the spike. Prefer `medium` for research and synthesis. Keep every `withTimeout`. Pass the SDK `timeout` equal to the stage budget, with `maxRetries: 0`. Don't raise stage timeouts without re-checking the total. |
| **Large-schema rejection** of `audienceProfileSchema`. | Found in the spike, not in production. If it's rejected: first try removing `description` text from deep leaves, then as a last resort split synthesis into two structured calls. Don't fall back to unschema'd JSON, because `chartSanity` and the QA stages depend on the exact shape. |
| **Citation pool changes** (count or shape). Synthesis is told to curate 8–12 sources from the pool, and the QA scorer penalizes opaque sourcing. | Compare the `Found N sources` counts with the baseline. If the pool shrinks badly, add `{ type: "url_context" }` alongside `google_search` (docs ~line 3707) or adjust the research prompts. Never let the model invent URLs (see the `groundingUrls.ts` header for why). |
| **No `temperature`**, so output is less deterministic. | Judge by the QA score and red flags against the baseline, not by exact output diffs. |
| **Cost.** Intro pricing is $0.75 / $3.75 per 1M input/output tokens through 2026-12-31, then $1.50 / $7.50 from 2027-01-01. | Note it in the PR description. `low` thinking on the small calls keeps it down. |
| **2.5 access.** The docs say 2.5 isn't deprecated, only restricted to existing users. | There's no forced deadline, so don't rush the verification. |

## 6. Verification checklist

- [ ] `npm test` passes. The count should be 161 plus the new wrapper tests.
- [ ] `npm run lint`: **12 errors already exist** in the geo-targeting files
      (`GeoTargeting*`, `geoTargeting.ts`, `markdownExporter.ts`). They aren't regressions.
      There must be no new ones.
- [ ] Use Node 22 (`nvm use 22`); the shell defaults to 18. Start the dev server with the
      existing `.claude/launch.json` config named `ai-plan-agent`.
- [ ] The user signs in to the browser pane themselves. **Claude never types passwords.**
- [ ] Re-run the three README examples and compare them with the baseline: stage times, source
      counts, QA score, final source count, and no candidate-reasoning fallback warning.
- [ ] Uploaded-media-plan path, with a plan that lists audiences: `audienceAnalysis` is
      populated, and the RFP personas and "From media plan" segments still appear.
- [ ] Trigger publisher-insight summarization: the CTV export in `CtvSlideExportView` or
      `App.tsx` (`/api/summarize-publisher-insights`).
- [ ] Segment recommendations still generate after the profile renders; they're already on 3.8.
- [ ] Server log: no `[TIMEOUT]` warnings on a normal run.

## 7. Deploy

`git push origin main` → pull in AI Studio's GitHub panel → **Publish**. Then check
`curl -s <service-url>/api/health` reports `"storageDriver":"firestore"`, and run one real
generation on the deployed service.
