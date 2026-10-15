import { SCOUT_LOG_RETENTION_DAYS, type ScoutLog } from "../storage/types";

/**
 * Builds the stored record of one ScoutAI turn (see ScoutLog). Pure, so the size limits are
 * tested: every text is capped, so one record stays a few KB to a few tens of KB however long
 * the answer, far under Firestore's 1MB document limit.
 */

export const SCOUT_LOG_LIMITS = {
  question: 4_000,
  reply: 20_000,
  /** Any one field of a proposal item (title, why, evidence, a before or after). */
  proposalText: 2_000,
  items: 20,
  changesPerItem: 30,
  dropped: 20,
  error: 1_000,
  /** The whole proposal, as JSON. Texts are shortened until it fits. */
  proposalTotal: 40_000,
};

const DAY_MS = 24 * 60 * 60 * 1000;

const clip = (text: unknown, max: number): string => {
  const s = typeof text === "string" ? text : "";
  return s.length > max ? `${s.slice(0, max)}…` : s;
};

/** A browser-made conversation id; anything else is dropped rather than stored. */
export function sanitizeConversationId(raw: unknown): string | undefined {
  return typeof raw === "string" && /^[A-Za-z0-9_-]{6,64}$/.test(raw) ? raw : undefined;
}

export interface ScoutLogInput extends Omit<ScoutLog, "expireAt" | "proposal" | "dropped" | "error"> {
  proposal?: { summary?: string; items: Array<{ title?: string; why?: string; evidence?: string; changes?: Array<{ label?: string; before?: string; after?: string }>; unverifiedFigures?: string[] }> } | null;
  dropped?: string[];
  error?: { code: string; message: string };
}

type ProposalInput = NonNullable<ScoutLogInput["proposal"]>;

function storedProposal(proposal: ProposalInput, t: number, changesPerItem: number = SCOUT_LOG_LIMITS.changesPerItem): ScoutLog["proposal"] {
  return {
    summary: proposal.summary ? clip(proposal.summary, t) : undefined,
    items: proposal.items.slice(0, SCOUT_LOG_LIMITS.items).map((item) => ({
      title: clip(item.title, Math.min(t, 300)),
      why: clip(item.why, t),
      ...(item.evidence ? { evidence: clip(item.evidence, t) } : {}),
      changes: (item.changes ?? []).slice(0, changesPerItem).map((c) => ({ label: clip(c.label, Math.min(t, 200)), before: clip(c.before, t), after: clip(c.after, t) })),
      ...(item.unverifiedFigures?.length ? { unverifiedFigures: item.unverifiedFigures.slice(0, 20).map((f) => clip(f, 100)) } : {}),
    })),
  };
}

/**
 * Shortens every text, then keeps fewer changes per item, until the proposal fits its budget.
 * A typical proposal (a few items, a few changes) fits at full length.
 */
function fitProposal(proposal: ProposalInput): ScoutLog["proposal"] {
  const fits = (p: ScoutLog["proposal"]) => JSON.stringify(p).length <= SCOUT_LOG_LIMITS.proposalTotal;
  let fitted = storedProposal(proposal, SCOUT_LOG_LIMITS.proposalText);
  for (const t of [1_000, 400, 150, 60]) {
    if (fits(fitted)) return fitted;
    fitted = storedProposal(proposal, t);
  }
  for (let perItem = SCOUT_LOG_LIMITS.changesPerItem; !fits(fitted) && perItem > 1; ) {
    perItem = Math.floor(perItem / 2);
    fitted = storedProposal(proposal, 60, perItem);
  }
  return fitted;
}

export function buildScoutLog(input: ScoutLogInput): ScoutLog {
  const { proposal, dropped, error, ...rest } = input;
  return {
    ...rest,
    expireAt: new Date(new Date(input.at).getTime() + SCOUT_LOG_RETENTION_DAYS * DAY_MS).toISOString(),
    question: clip(input.question, SCOUT_LOG_LIMITS.question),
    reply: input.reply === undefined ? undefined : clip(input.reply, SCOUT_LOG_LIMITS.reply),
    proposal: proposal?.items.length ? fitProposal(proposal) : undefined,
    dropped: dropped?.length ? dropped.slice(0, SCOUT_LOG_LIMITS.dropped).map((d) => clip(d, 400)) : undefined,
    error: error ? { code: error.code, message: clip(error.message, SCOUT_LOG_LIMITS.error) } : undefined,
  };
}
