import { PROMPT_MODES, type PromptMode } from "../assistant/promptLibrary";
import type { PromptDraft } from "./scoutAsk";

/**
 * Hands a library prompt drafted on the ScoutAI review page to the Settings prompt editor, which
 * opens in another tab (/#settings=prompts). localStorage is the only thing two tabs share; the
 * draft is not the library (nothing is saved until the admin presses Save in the editor, which
 * goes through the server), so losing it costs one click. It is read once and expires quickly so
 * a stale draft never appears in a later Settings visit.
 */

export const PROMPT_DRAFT_KEY = "apa_scout_prompt_draft";
export const PROMPT_DRAFT_TTL_MS = 10 * 60 * 1000;
export const PROMPT_EDITOR_URL = "/#settings=prompts";

type KeyValueStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function stashPromptDraft(draft: PromptDraft, store: KeyValueStore, now = Date.now()): void {
  store.setItem(PROMPT_DRAFT_KEY, JSON.stringify({ draft, at: now }));
}

/** The waiting draft, removed as it is read; null if there is none, it is stale, or it is malformed. */
export function takePromptDraft(store: KeyValueStore, now = Date.now()): PromptDraft | null {
  const raw = store.getItem(PROMPT_DRAFT_KEY);
  if (raw === null) return null;
  store.removeItem(PROMPT_DRAFT_KEY);
  try {
    const { draft, at } = JSON.parse(raw);
    if (typeof at !== "number" || now - at > PROMPT_DRAFT_TTL_MS) return null;
    if (typeof draft?.text !== "string" || !draft.text.trim()) return null;
    const mode: PromptMode = (PROMPT_MODES as readonly string[]).includes(draft.mode) ? draft.mode : "plan";
    return {
      title: String(draft.title || "New prompt").slice(0, 80),
      category: String(draft.category || "From ScoutAI review").slice(0, 40),
      text: draft.text.slice(0, 1500),
      mode,
    };
  } catch {
    return null;
  }
}
