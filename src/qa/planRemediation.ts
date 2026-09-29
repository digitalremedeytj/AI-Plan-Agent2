// Targeted fixes. The fixer used to rewrite the whole plan in one call and report what it
// meant to change; the server then restored the charts, channel plan and publishers, so the
// fix list claimed changes that never shipped ("removed B2B targeting from the channel
// strategy"), and every unflagged section drifted in another model's voice.
//
// Now the fixer returns patches: one field, one new value, one finding. The server applies a
// patch only when the field exists, holds text, and belongs to an owner the prose fixer may
// touch. The fix list is built from the patches that were applied, so it can only report
// changes the plan actually contains.

import { PROSE_OWNERS, type AuditFinding, type FindingOwner } from "./planAudit";
import { EVIDENCE_RULES } from "./evidenceRules";

const ALLOWED_PATHS: Array<[FindingOwner, RegExp]> = [
  ["narrative", /^(intro|publisherInsights|audienceAnalysis)$/],
  ["narrative", /^takeaways\[\d+\]$/],
  // What a citation is said to support is prose; its name, URL and tier are not.
  ["narrative", /^sources\[\d+\]\.supportedClaims$/],
  ["narrative", /^recommendations\[\d+\]\.(title|action|why|channels)$/],
  ["narrative", /^(demographics\.(overview|geographyNotes)|browserAndReach\.overview|deviceTypeIndex\.overview|temporalPatterns\.(overview|activationNotes))$/],
  // Not name, age or income: those define who the persona is, and changing them changes who
  // the plan targets after the channel plan and publishers were built for them.
  ["personas", /^personas\[\d+\]\.(watch|browse|buy|narrative|gender)$/],
  ["publisherRationale", /^ctvPublishers\[\d+\]\.why$/],
  // A channel's words, never its numbers, tactics, measurement or which channels exist.
  ["channelRationale", /^channelStrategy\.mediaPlan\.channels\[\d+\]\.(gapAddressed|allocationRationale|tradeoffs\[\d+\]|evidence\[\d+\]\.detail)$/],
];

// Evidence lines code writes from the catalog, the brief or an uploaded plan state facts, not
// claims about the audience, so the fixer may reword only research and benchmark lines.
const CATALOG_EVIDENCE = new Set(["digital_remedy_rule", "brief", "uploaded_plan"]);
const CHANNEL_PATH = /^channelStrategy\.mediaPlan\.channels\[(\d+)\]\.(.+)$/;

/**
 * A fixed channel field is written to the channel's evaluated candidate too. Adding a removed
 * media type back rebuilds the channel from that candidate, which would bring the unfixed text
 * back with it.
 */
function mirrorToCandidate(profile: any, path: string, value: string): void {
  const match = path.match(CHANNEL_PATH);
  if (!match) return;
  const plan = profile?.channelStrategy?.mediaPlan;
  const channelId = plan?.channels?.[Number(match[1])]?.channelId;
  const index = (plan?.evaluatedCandidates || []).findIndex((c: any) => c?.product?.id === channelId);
  if (index < 0) return;
  setAtPath(profile, `channelStrategy.mediaPlan.evaluatedCandidates[${index}].${match[2]}`, value);
}

export function ownerOfPath(path: string): FindingOwner | null {
  return ALLOWED_PATHS.find(([, pattern]) => pattern.test(path))?.[0] ?? null;
}

type PathToken = string | number;

function parsePath(path: string): PathToken[] | null {
  const tokens: PathToken[] = [];
  for (const part of path.split(".")) {
    const match = part.match(/^([A-Za-z]+)((?:\[\d+\])*)$/);
    if (!match) return null;
    tokens.push(match[1]);
    for (const index of match[2].match(/\d+/g) || []) tokens.push(Number(index));
  }
  return tokens;
}

export function getAtPath(target: any, path: string): unknown {
  const tokens = parsePath(path);
  if (!tokens) return undefined;
  return tokens.reduce<any>((node, token) => (node == null ? undefined : node[token]), target);
}

function setAtPath(target: any, path: string, value: string): boolean {
  const tokens = parsePath(path);
  if (!tokens || tokens.length === 0) return false;
  let node = target;
  for (const token of tokens.slice(0, -1)) {
    node = node?.[token];
    if (node == null || typeof node !== "object") return false;
  }
  const last = tokens[tokens.length - 1];
  if (typeof node[last] !== "string") return false;
  node[last] = value;
  return true;
}

export interface Patch {
  findingId: string;
  path: string;
  value: string;
}

export interface AppliedPatch extends Patch {
  before: string;
}

export interface RejectedPatch extends Patch {
  reason: string;
}

const MAX_PATCH_CHARS = 3000;

/**
 * Writes one prose field if the prose fixer may touch it. Shared by the QA fixer and the ScoutAI
 * assistant, so both are held to the same list of fields that are words rather than decisions.
 */
export function writeProseField(profile: any, rawPath: string, rawValue: unknown): { ok: true; before: string } | { ok: false; reason: string } {
  const path = String(rawPath ?? "").trim();
  const value = typeof rawValue === "string" ? rawValue.trim() : "";
  const owner = ownerOfPath(path);
  if (!owner || !PROSE_OWNERS.has(owner)) return { ok: false, reason: "field is not editable by the prose fixer" };
  if (!value || value.length > MAX_PATCH_CHARS) return { ok: false, reason: "empty or oversized value" };
  const before = getAtPath(profile, path);
  if (typeof before !== "string") return { ok: false, reason: "field does not exist" };
  if (before.trim() === value) return { ok: false, reason: "no change" };
  const evidenceLine = path.match(/^(.+\.evidence\[\d+\])\.detail$/);
  if (evidenceLine && CATALOG_EVIDENCE.has(String((getAtPath(profile, evidenceLine[1]) as any)?.sourceType))) return { ok: false, reason: "catalog evidence is not prose" };
  if (!setAtPath(profile, path, value)) return { ok: false, reason: "field could not be written" };
  mirrorToCandidate(profile, path, value);
  return { ok: true, before };
}

/** Applies what may be applied; returns both sides so the caller can report honestly. */
export function applyPatches(profile: any, patches: unknown, findings: AuditFinding[]): { applied: AppliedPatch[]; rejected: RejectedPatch[] } {
  const applied: AppliedPatch[] = [];
  const rejected: RejectedPatch[] = [];
  const fixable = new Map(findings.filter((f) => PROSE_OWNERS.has(f.owner)).map((f) => [f.id, f]));
  for (const raw of Array.isArray(patches) ? patches : []) {
    const patch: Patch = { findingId: String(raw?.findingId ?? ""), path: String(raw?.path ?? "").trim(), value: typeof raw?.value === "string" ? raw.value.trim() : "" };
    if (!fixable.has(patch.findingId)) { rejected.push({ ...patch, reason: "not a finding the prose fixer may act on" }); continue; }
    const result = writeProseField(profile, patch.path, patch.value);
    if ("reason" in result) rejected.push({ ...patch, reason: result.reason });
    else applied.push({ ...patch, before: result.before });
  }
  return { applied, rejected };
}

export const REMEDIATION_SYSTEM_INSTRUCTION = `You are the senior media planner who wrote this plan, correcting it after a QA review. Fix each finding you are given with the smallest edit that resolves it, in the plan's existing voice.

Rules:
- Return patches: { "findingId", "path", "value" } where 'path' is an exact field (e.g. "intro", "takeaways[2]", "recommendations[1].why", "personas[0].narrative", "ctvPublishers[3].why") and 'value' is that field's complete new text. Patch only fields the finding concerns, plus any other field that repeats the same problem.
- Never change who the plan targets, which personas or publishers it has, the charts, or the channel plan's decisions (channels, allocations, tactics, measurement). A channel's written rationale is text you may fix: "channelStrategy.mediaPlan.channels[2].gapAddressed", ".allocationRationale", ".tradeoffs[0]", ".evidence[1].detail". If a finding can only be resolved by changing a decision, skip it and say so in 'notes'.
- Numbers: use only figures in the research, the charts or the plan's own inputs, applied to the population they describe. Removing a misapplied figure is better than keeping it; replacing it with an invented one is never acceptable.
- Voice: confident and concise. Do not add compliance, consent or legal caveats, and do not stack qualifications.
- A fix must not break another rule: verify re-reads every patched field against the evidence rules below and flags any new problem.

${EVIDENCE_RULES}

Return JSON: { "patches": [...], "notes": [{ "findingId", "resolution": one sentence describing what you changed, or why you could not }] }`;

export function buildRemediationInput(findings: AuditFinding[], profile: any, context: string): string {
  const fixable = findings.filter((f) => PROSE_OWNERS.has(f.owner));
  const fields = new Map<string, unknown>();
  for (const f of fixable) for (const path of f.paths) {
    const value = getAtPath(profile, path);
    if (typeof value === "string") fields.set(path, value);
  }
  return [
    "FINDINGS TO FIX:",
    JSON.stringify(fixable.map(({ id, severity, owner, paths, issue, evidence, fix }) => ({ id, severity, owner, paths, issue, evidence, fix })), null, 1),
    "CURRENT TEXT OF THE FIELDS THEY NAME:",
    JSON.stringify(Object.fromEntries(fields), null, 1),
    context,
  ].join("\n\n");
}

export const remediationSchema = {
  type: "object",
  properties: {
    patches: {
      type: "array",
      items: {
        type: "object",
        properties: { findingId: { type: "string" }, path: { type: "string" }, value: { type: "string" } },
        required: ["findingId", "path", "value"],
      },
    },
    notes: {
      type: "array",
      items: {
        type: "object",
        properties: { findingId: { type: "string" }, resolution: { type: "string" } },
        required: ["findingId", "resolution"],
      },
    },
  },
  required: ["patches", "notes"],
};

/** The client-facing fix list: one entry per finding that at least one applied patch addressed. */
export function describeAppliedFixes(findings: AuditFinding[], applied: AppliedPatch[], notes: unknown): Array<{ issue: string; resolution: string }> {
  const noteById = new Map((Array.isArray(notes) ? notes : []).map((n: any) => [String(n?.findingId ?? ""), typeof n?.resolution === "string" ? n.resolution.trim() : ""]));
  return findings.flatMap((f) => {
    const paths = applied.filter((p) => p.findingId === f.id).map((p) => p.path);
    if (paths.length === 0) return [];
    return [{ issue: f.issue, resolution: `${noteById.get(f.id) || "Rewrote the affected text."} (Changed: ${[...new Set(paths)].join(", ")}.)` }];
  });
}
