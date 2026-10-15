import assert from "node:assert/strict";
import test from "node:test";
import { PROMPT_DRAFT_KEY, PROMPT_DRAFT_TTL_MS, stashPromptDraft, takePromptDraft } from "./promptHandoff";

function memoryStore() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

const draft = { title: "Export help", category: "Using the app", text: "How do I export this plan?", mode: "plan" as const };

test("a drafted prompt reaches the editor once, then is gone", () => {
  const store = memoryStore();
  stashPromptDraft(draft, store, 1_000);
  assert.deepEqual(takePromptDraft(store, 2_000), draft);
  assert.equal(takePromptDraft(store, 2_000), null);
});

test("a draft left waiting too long is not shown in a later Settings visit", () => {
  const store = memoryStore();
  stashPromptDraft(draft, store, 0);
  assert.equal(takePromptDraft(store, PROMPT_DRAFT_TTL_MS + 1), null);
  assert.equal(store.data.has(PROMPT_DRAFT_KEY), false);
});

test("a malformed draft is discarded rather than opened", () => {
  const store = memoryStore();
  store.setItem(PROMPT_DRAFT_KEY, "{not json");
  assert.equal(takePromptDraft(store), null);
  store.setItem(PROMPT_DRAFT_KEY, JSON.stringify({ draft: { title: "x", text: "  " }, at: Date.now() }));
  assert.equal(takePromptDraft(store), null);
});
