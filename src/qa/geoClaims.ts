// Geography the plan's prose promises but the plan does not deliver. The QA audit reads the plan
// as a whole and can miss a single "nationwide" in a recommendation, and these are the two claims
// a prospect will hold the plan to: where it runs, and whether it reaches a specific place.
//
// Deterministic, so it runs after the audit and its fixes, on the plan as delivered.

import type { GenerationAlert } from "../types";
import { GEOFENCE_CLAIM, NATIONAL_CLAIM, footprintSummary, type GeoPlanFacts } from "../planning/geoFootprint";
import { collectProse } from "./claimLedger";

/** Where a prospect would read the claim; persona descriptions are about people, not the buy. */
const CHECKED_OWNERS = new Set(["narrative", "channelStrategy", "publisherRationale"]);

function excerpt(text: string, pattern: RegExp): string {
  const match = pattern.exec(text);
  if (!match) return text.slice(0, 80);
  const start = Math.max(0, match.index - 35);
  const end = Math.min(text.length, match.index + match[0].length + 35);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

function hasGeofencing(profile: any): boolean {
  const channels: any[] = profile?.channelStrategy?.mediaPlan?.channels || [];
  return channels.some((channel) => (channel?.allocationDollars || 0) > 0
    && (channel?.targetingTactics || []).some((tactic: any) => /geo[-_]?fenc/i.test(`${tactic?.id} ${tactic?.displayName}`)));
}

function alertFor(lines: string[], lead: string, fix: string): GenerationAlert {
  const quoted = lines.slice(0, 3).map((line) => `"${line}"`).join("; ");
  const more = lines.length > 3 ? ` and ${lines.length - 3} more` : "";
  return { section: "geo", severity: "flagged", message: `${lead} ${quoted}${more}. ${fix}` };
}

export function geoClaimAlerts(profile: any, geo: GeoPlanFacts | undefined): GenerationAlert[] {
  const prose = collectProse(profile).filter((field) => CHECKED_OWNERS.has(field.owner));
  const alerts: GenerationAlert[] = [];

  if (geo) {
    const national = prose.filter((field) => NATIONAL_CLAIM.test(field.text)).map((field) => excerpt(field.text, NATIONAL_CLAIM));
    if (national.length > 0) {
      alerts.push(alertFor(national, `The plan targets ${footprintSummary(geo)}, but ${national.length === 1 ? "a line calls" : `${national.length} lines call`} it national:`, "Edit before presenting."));
    }
  }

  if (!hasGeofencing(profile)) {
    const fenced = prose.filter((field) => GEOFENCE_CLAIM.test(field.text)).map((field) => excerpt(field.text, GEOFENCE_CLAIM));
    if (fenced.length > 0) {
      alerts.push(alertFor(
        fenced,
        `No media type in the plan carries Geo-Fencing, but ${fenced.length === 1 ? "a line promises" : `${fenced.length} lines promise`} radius or venue targeting:`,
        geo?.precision.includes("radius")
          ? "The brief asks for a radius; add a media type that supports Geo-Fencing (Display, OLV, Native, Audio or DOOH) or reword the line."
          : "Reword the line, or add Geo-Fencing to a media type that supports it.",
      ));
    }
  }
  return alerts;
}
