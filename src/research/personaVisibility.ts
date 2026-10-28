// Planners can hide a single persona, or only its headshot, from the share link. Everything the
// client sees (the share link, the executive brief, the plan export) reads these switches here.

import type { Persona } from "../types";

export function isPersonaShared(persona: Pick<Persona, "hiddenFromShare"> | null | undefined): boolean {
  return Boolean(persona) && !persona!.hiddenFromShare;
}

export function isPersonaAvatarShared(persona: Pick<Persona, "hiddenFromShare" | "avatarHiddenFromShare"> | null | undefined): boolean {
  return isPersonaShared(persona) && !persona!.avatarHiddenFromShare;
}

/**
 * The personas as the share response carries them. Hiding is otherwise display-only, but a hidden
 * persona or headshot must not be readable from the response either. A hidden persona keeps its
 * slot, emptied, because segments name the personas they serve by position.
 */
export function personasForShare<T extends Partial<Persona>>(personas: T[] | null | undefined): T[] {
  if (!Array.isArray(personas)) return [];
  return personas.map((persona) => {
    if (!persona || typeof persona !== "object") return persona;
    if (persona.hiddenFromShare) {
      return { name: "", gender: "", income: "", age: "", watch: "", browse: "", buy: "", narrative: "", hiddenFromShare: true } as unknown as T;
    }
    // The casting brief and earlier headshots are never shown on the link.
    const { avatarHistory: _history, portrait: _portrait, ...rest } = persona;
    if (persona.avatarHiddenFromShare) delete (rest as Partial<Persona>).avatarUrl;
    return rest as T;
  });
}

/**
 * The executive brief as the share response carries it. A brief written before a persona was
 * hidden can still give that persona its own "who / how we reach them" card; the card is dropped.
 * Prose that names the persona stays until the planner regenerates the brief, which the
 * out-of-date badge prompts, since the brief's snapshot leaves hidden personas out.
 */
export function briefForShare<T extends { sections?: Array<{ audienceMatches?: Array<{ audience?: string }> }>; previous?: unknown }>(
  brief: T | null | undefined,
  personas: Array<Partial<Persona>> | null | undefined,
): T | null | undefined {
  if (!brief || typeof brief !== "object") return brief;
  const hidden = new Set((Array.isArray(personas) ? personas : [])
    .filter((persona) => persona?.hiddenFromShare && persona.name)
    .map((persona) => String(persona.name).trim().toLowerCase()));
  // The replaced version is kept only for the planner's undo.
  const { previous: _previous, ...rest } = brief;
  if (hidden.size === 0) return rest as T;
  return {
    ...rest,
    sections: (brief.sections || []).map((section) => section.audienceMatches
      ? { ...section, audienceMatches: section.audienceMatches.filter((match) => !hidden.has(String(match?.audience || "").trim().toLowerCase())) }
      : section),
  } as T;
}
