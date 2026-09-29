import type { AttachedPlanningRecord } from "./types";

// Which media types carry the plan's CTV publisher list. Shared by the plan view and the server,
// so the list a planner edits and the channel that shows it never disagree.

export const isCtvOrPerformanceTvChannel = (
  channelId?: string,
  channelName?: string,
  canonicalId?: string,
): boolean => {
  const id = (channelId || '').toLowerCase().trim();
  const name = (channelName || '').toLowerCase().trim();
  const canonical = (canonicalId || '').toLowerCase().trim();

  return (
    id === 'channel.ctv' ||
    id === 'channel.performance_tv' ||
    id === 'ctv' ||
    id === 'ctv_ott' ||
    id === 'performance_tv' ||
    id === 'performance_ctv' ||
    canonical === 'ctv' ||
    canonical === 'ctv_ott' ||
    canonical === 'performance_tv' ||
    name === 'ctv / ott' ||
    name === 'ctv/ott' ||
    name === 'performance tv' ||
    name === 'performance ctv' ||
    name === 'connected tv' ||
    id.includes('channel.ctv') ||
    id.includes('performance_tv') ||
    id.includes('performancetv') ||
    name.includes('performance tv') ||
    name.includes('performance ctv') ||
    name.includes('ctv / ott') ||
    name.includes('ctv/ott')
  );
};

/** The plan's CTV publishers as the records a channel lists, the same shape the plan view shows. */
export function ctvPublisherRecords(publishers: Array<{ publisher: string; why?: string }>): AttachedPlanningRecord[] {
  return publishers.map((pub) => ({
    id: `publisher.ctv.${pub.publisher.toLowerCase().replace(/[^a-z0-9]/g, "_")}`,
    displayName: pub.publisher,
    rationale: pub.why || "",
  }));
}

/**
 * Writes the plan's CTV publisher list onto its CTV media types. The plan view already shows the
 * list there; without this the channel's own records (which the executive summary and exports
 * read) kept the publishers the plan was generated with after a planner changed them.
 */
export function syncCtvChannelPublishers<T extends { ctvPublishers?: Array<{ publisher: string; why?: string }>; channelStrategy?: any }>(profile: T): T {
  const publishers = profile.ctvPublishers || [];
  const plan = profile.channelStrategy?.mediaPlan;
  if (!plan?.channels || publishers.length === 0) return profile;
  const records = ctvPublisherRecords(publishers);
  const channels = plan.channels.map((c: any) => (isCtvOrPerformanceTvChannel(c.channelId, c.channelName, c.canonicalId) ? { ...c, publishers: records } : c));
  return { ...profile, channelStrategy: { ...profile.channelStrategy, mediaPlan: { ...plan, channels } } };
}
