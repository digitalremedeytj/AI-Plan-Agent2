// Report names onto the plan's names: a platform media type onto a catalog channel, a report
// publisher onto the CTV publisher pool. Shared by ScoutAI's context, plan generation and the
// live plan-vs-actual comparison.

// "+" is part of a streaming brand ("Discovery+" is not "Discovery"), so it survives as a word.
const squash = (name: string) => name.toLowerCase().replace(/\+/g, "plus").replace(/[^a-z0-9]/g, "");

export interface Channel {
  id: string;
  name: string;
  aliases: string[];
}

/**
 * The plan channel a report's media type is. An exact name or alias wins; otherwise the longest
 * alias the name contains ("Pre-Roll/Mid-Roll" holds "preroll"), so "Display Retargeting" is
 * retargeting and not display.
 */
export function matchChannel(reportName: string, channels: Channel[]): Channel | null {
  const name = squash(reportName);
  if (!name) return null;
  const exact = channels.find((c) => squash(c.name) === name || c.aliases.some((a) => squash(a) === name));
  if (exact) return exact;
  let best: { channel: Channel; length: number } | null = null;
  for (const c of channels) {
    for (const alias of [c.name, ...c.aliases]) {
      const a = squash(alias);
      if (a.length >= 3 && name.includes(a) && (!best || a.length > best.length)) best = { channel: c, length: a.length };
    }
  }
  return best?.channel ?? null;
}

/**
 * "Pluto TV" is the catalog's "Pluto"; "DirecTV Stream" is "DirecTV". A match on a shared prefix
 * is approximate ("Paramount" may or may not be "Paramount+"), and is marked so.
 */
export function matchPublisher(reportName: string, names: string[]): { name: string; approximate: boolean } | null {
  const name = squash(reportName);
  if (!name) return null;
  const exact = names.find((n) => squash(n) === name);
  if (exact) return { name: exact, approximate: false };
  const prefix = names
    .filter((n) => squash(n).length >= 4 && (name.startsWith(squash(n)) || squash(n).startsWith(name)))
    .sort((a, b) => squash(b).length - squash(a).length);
  return prefix[0] ? { name: prefix[0], approximate: true } : null;
}
