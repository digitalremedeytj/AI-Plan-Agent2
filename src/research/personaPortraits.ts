// The hidden casting brief behind each persona headshot. The image model draws each headshot on
// its own and sees only that persona's brief, so the four briefs are written together, in one
// call, to keep the four people visibly different.
//
// This was first a field of the synthesis schema. Synthesis was already running close to its
// 240s limit (high thinking regularly past its 120s, finishing on the medium fallback), and the
// extra casting work pushed an RFP run over it (2026-10-08). As its own small call it starts
// once synthesis returns and runs beside the channel plan, narrative and QA, so it adds no time
// to the run. If it fails, headshots fall back to the original prompt.

import type { PersonaPortrait } from "../types";

export const PORTRAIT_FIELDS = ["apparentAge", "gender", "ethnicity", "ethnicityBasis", "appearance", "wardrobe", "setting", "expression"] as const;
// The Demographics dossier is the one the ethnicity casting is grounded in; the rest of the
// research is not needed to cast four faces.
const DOSSIER_CHARS = 12000;

export const PORTRAIT_SYSTEM_INSTRUCTION = `You are a casting director writing photo briefs for a media agency's audience personas. Each brief is sent alone to an image model that draws one photorealistic headshot, so it must fully describe one specific, believable person.

Cast the personas as a set:
- Make them visibly different people: spread their apparent ages across what their age ranges allow, and give each a different hair colour and style, build, distinguishing detail, wardrobe and background setting. No two share a setting.
- Wardrobe and setting come from the persona's own story, viewing and buying habits, so the photo reads as that lifestyle.
- Ethnicity: ground it in data first. If the Demographics research reports this audience's (or the category's buyers') racial/ethnic makeup, cast the set to reflect it and cite that figure in ethnicityBasis. If it does not, cast the set to reflect the general population of the market given, and set ethnicityBasis to "market population". Cast the set as a whole, never one persona at a time by stereotype: never choose a persona's ethnicity from its income, education, job, neighbourhood or any hardship in its story.
- A persona is an archetype, not a named person: never give anyone a name.`;

export interface PortraitPersona {
  name?: unknown;
  age?: unknown;
  gender?: unknown;
  income?: unknown;
  watch?: unknown;
  buy?: unknown;
  narrative?: unknown;
}

export function buildPortraitInput(personas: PortraitPersona[], demographicsResearch: string, geography: string): string {
  const research = String(demographicsResearch || "").trim();
  return [
    `MARKET: ${geography || "United States"}`,
    "",
    `PERSONAS (write one brief per persona, in this order, with its index):`,
    ...personas.map((p, i) => `[${i}] ${String(p?.name ?? "")}. Age ${String(p?.age ?? "")}; gender ${String(p?.gender ?? "")}; HHI ${String(p?.income ?? "")}. Watches: ${String(p?.watch ?? "")}. Buys: ${String(p?.buy ?? "")}. Story: ${String(p?.narrative ?? "")}`),
    "",
    "DEMOGRAPHICS RESEARCH:",
    research ? research.slice(0, DOSSIER_CHARS) : "None available. Cast to the market population.",
  ].join("\n");
}

/** JSON Schema for the Interactions API `response_format`. */
export function buildPortraitResponseSchema(personaCount: number) {
  return {
    type: "object",
    properties: {
      portraits: {
        type: "array",
        minItems: personaCount,
        maxItems: personaCount,
        items: {
          type: "object",
          properties: {
            index: { type: "integer", minimum: 0, maximum: Math.max(0, personaCount - 1), description: "The persona's index from the list." },
            apparentAge: { type: "integer", description: "One age inside the persona's age range, e.g. 34." },
            gender: { type: "string", description: "'woman' or 'man': one gender for this one person, following the persona's gender skew." },
            ethnicity: { type: "string", description: "Casting note, e.g. 'Black', 'Hispanic / Latina', 'East Asian', 'South Asian', 'White', 'Middle Eastern'." },
            ethnicityBasis: { type: "string", description: "The Demographics research figure the casting follows, or 'market population'." },
            appearance: { type: "string", description: "Face, hair (colour, length, style), build and one distinguishing detail (glasses, freckles, beard, greying temples, earrings)." },
            wardrobe: { type: "string", description: "What they wear, from their lifestyle, e.g. 'zip fleece and a trail cap'." },
            setting: { type: "string", description: "A softly blurred background from their life, e.g. 'a sunlit trailhead'. Different for each persona." },
            expression: { type: "string", description: "Expression and mood, e.g. 'easy laugh', 'calm and focused'." },
          },
          required: ["index", ...PORTRAIT_FIELDS],
        },
      },
    },
    required: ["portraits"],
  };
}

function clean(value: unknown, max = 240): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

/**
 * Attaches each brief to its persona by index. A brief missing a field the headshot needs is
 * dropped, so that persona keeps the original headshot prompt. Returns how many were attached.
 */
export function applyPortraits(personas: any[], data: unknown): number {
  const portraits: any[] = Array.isArray((data as any)?.portraits) ? (data as any).portraits : [];
  let attached = 0;
  for (const raw of portraits) {
    const index = Number(raw?.index);
    const persona = Number.isInteger(index) ? personas[index] : undefined;
    if (!persona || persona.portrait) continue;
    const apparentAge = Math.round(Number(raw?.apparentAge));
    const portrait: PersonaPortrait = {
      apparentAge: Number.isFinite(apparentAge) && apparentAge >= 16 && apparentAge <= 100 ? apparentAge : 0,
      gender: clean(raw?.gender, 40),
      ethnicity: clean(raw?.ethnicity, 80),
      ethnicityBasis: clean(raw?.ethnicityBasis),
      appearance: clean(raw?.appearance),
      wardrobe: clean(raw?.wardrobe),
      setting: clean(raw?.setting),
      expression: clean(raw?.expression, 120),
    };
    if (!portrait.apparentAge || !portrait.gender || !portrait.appearance || !portrait.setting) continue;
    persona.portrait = portrait;
    attached++;
  }
  return attached;
}
