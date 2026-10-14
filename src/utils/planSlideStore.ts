import { useCallback, useRef, useState } from "react";

/**
 * Generated slide images, kept per plan for this browser session.
 *
 * The slide studios used to hold their slides in component state, and the components stay mounted
 * across plan switches, so one plan's slides showed up in the next plan's studio. Filing them
 * under the plan's key fixes that while still letting a planner close a studio, switch away and
 * come back to the slides they made. Nothing is persisted: a reload starts empty.
 */
const store = new Map<string, unknown>();

const entryKey = (planKey: string, kind: string) => `${planKey}\u0000${kind}`;

export type SlideUpdate<T> = T | ((prev: T) => T);

/** The hook's store access, exported so the filing rules can be tested without rendering. */
export function readPlanSlides<T>(planKey: string, kind: string, initial: () => T): T {
  const key = entryKey(planKey, kind);
  return store.has(key) ? (store.get(key) as T) : initial();
}

export function writePlanSlides<T>(planKey: string, kind: string, initial: () => T, update: SlideUpdate<T>): T {
  const previous = readPlanSlides(planKey, kind, initial);
  const resolved = typeof update === "function" ? (update as (prev: T) => T)(previous) : update;
  store.set(entryKey(planKey, kind), resolved);
  return resolved;
}

/**
 * Like useState, but the value lives in the plan's bucket. The setter is bound to the plan it was
 * created for, so a slide that finishes rendering after the planner switched plans is filed under
 * the plan that asked for it rather than the one now on screen.
 */
export function usePlanSlides<T>(planKey: string, kind: string, initial: () => T): [T, (update: SlideUpdate<T>) => void] {
  const key = entryKey(planKey, kind);
  const [value, setValue] = useState<T>(() => readPlanSlides(planKey, kind, initial));
  const initialRef = useRef(initial);
  initialRef.current = initial;
  const shownKey = useRef(key);
  shownKey.current = key;

  const update = useCallback((next: SlideUpdate<T>) => {
    const resolved = writePlanSlides(planKey, kind, initialRef.current, next);
    if (shownKey.current === key) setValue(resolved);
  }, [planKey, kind, key]);

  return [value, update];
}

/** An unsaved plan that gets saved keeps the slides made while it was unsaved. */
export function movePlanSlides(fromPlanKey: string, toPlanKey: string): void {
  if (fromPlanKey === toPlanKey) return;
  const prefix = entryKey(fromPlanKey, "");
  for (const [key, value] of [...store.entries()]) {
    if (!key.startsWith(prefix)) continue;
    store.set(entryKey(toPlanKey, key.slice(prefix.length)), value);
    store.delete(key);
  }
}

export function clearPlanSlides(planKey: string): void {
  const prefix = entryKey(planKey, "");
  for (const key of [...store.keys()]) if (key.startsWith(prefix)) store.delete(key);
}

/** Key for a plan with no saved id yet. Only one can be open at a time. */
export const UNSAVED_PLAN_SLIDE_KEY = "unsaved";
