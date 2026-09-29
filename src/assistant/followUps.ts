// What an applied ScoutAI change left out of date. The plan is built in a chain (brief, research,
// personas, segments, channels, narrative), so a change early in it can leave later parts
// describing something that is gone. These are offered to the planner as follow-ups after Apply;
// none runs on its own. (The executive summary and the QA audit have their own staleness checks
// in the browser, which adds those two.)

export interface FollowUp {
  kind: "retag_segments" | "update_text" | "regenerate_plan";
  label: string;
  /** For follow-ups ScoutAI handles: the message sent to it when the planner accepts. */
  prompt?: string;
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The planner-visible prose where a removed name would still read as part of the plan. */
function planText(profile: any): string[] {
  const texts: unknown[] = [
    profile?.intro, profile?.audienceAnalysis, profile?.publisherInsights,
    ...(profile?.takeaways || []),
    ...(profile?.recommendations || []).flatMap((r: any) => [r?.title, r?.action, r?.why, r?.channels]),
    ...(profile?.channelStrategy?.mediaPlan?.channels || []).flatMap((c: any) => [c?.gapAddressed, c?.allocationRationale]),
    ...(profile?.personas || []).map((p: any) => p?.narrative),
    ...(profile?.segmentRecommendations || []).map((s: any) => s?.justification),
    ...(profile?.ctvPublishers || []).map((p: any) => p?.why),
  ];
  return texts.filter((t): t is string => typeof t === "string" && t.length > 0);
}

function mentions(texts: string[], name: string): number {
  if (name.trim().length < 3) return 0;
  const pattern = new RegExp(`(^|[^A-Za-z0-9])${escape(name.trim())}([^A-Za-z0-9]|$)`, "i");
  return texts.filter((t) => pattern.test(t)).length;
}

export function detectFollowUps(before: any, after: any): FollowUp[] {
  const out: FollowUp[] = [];
  const a = before?.profile ?? {};
  const b = after?.profile ?? {};

  // A replace keeps the persona's slot, so a new name in an old slot is a rename; an old name
  // with no new one in its slot was removed.
  const lower = (value: unknown) => String(value ?? "").toLowerCase();
  const namesBefore = new Set((a.personas || []).map((p: any) => lower(p?.name)));
  const namesAfter = new Set((b.personas || []).map((p: any) => lower(p?.name)));
  const renamed: Array<{ from: string; to: string }> = [];
  const removedPersonas: string[] = [];
  (a.personas || []).forEach((p: any, index: number) => {
    const name = String(p?.name ?? "");
    if (namesAfter.has(lower(name))) return;
    const sameSlot = (b.personas || [])[index];
    if (sameSlot && !namesBefore.has(lower(sameSlot.name))) renamed.push({ from: name, to: sameSlot.name });
    else removedPersonas.push(name);
  });

  for (const { from, to } of renamed) {
    const index = (b.personas || []).findIndex((p: any) => p?.name === to);
    const tagged = (b.segmentRecommendations || []).filter((s: any) => (s?.personaIndices || []).includes(index));
    if (tagged.length > 0) {
      out.push({
        kind: "retag_segments",
        label: `${tagged.length} segment${tagged.length === 1 ? " was" : "s were"} chosen for ${from}, now ${to}`,
        prompt: `The persona ${from} was replaced by ${to}. Review the segments tagged to ${to} and propose retagging, rewriting or replacing any that no longer fit.`,
      });
    }
  }
  if (removedPersonas.length > 0) {
    const orphaned = (b.segmentRecommendations || []).filter((s: any) => {
      const beforeSegment = (a.segmentRecommendations || []).find((x: any) => x?.id === s?.id);
      return beforeSegment?.personaIndices?.length > 0 && (s?.personaIndices || []).length === 0;
    });
    if (orphaned.length > 0) {
      out.push({
        kind: "retag_segments",
        label: `${orphaned.length} segment${orphaned.length === 1 ? " is" : "s are"} no longer tagged to any persona`,
        prompt: `These segments lost their persona when ${removedPersonas.join(" and ")} ${removedPersonas.length === 1 ? "was" : "were"} removed: ${orphaned.map((s: any) => s.name).join("; ")}. Propose tagging them to a remaining persona, or removing them.`,
      });
    }
  }

  // Names that left the plan but may still be written into it.
  const channelsAfter = new Set((b.channelStrategy?.mediaPlan?.channels || []).map((c: any) => c?.channelId));
  const removedChannels = (a.channelStrategy?.mediaPlan?.channels || []).filter((c: any) => !channelsAfter.has(c?.channelId)).map((c: any) => String(c?.channelName ?? ""));
  const publishersAfter = new Set((b.ctvPublishers || []).map((p: any) => String(p?.publisher ?? "").toLowerCase()));
  const removedPublishers = (a.ctvPublishers || []).map((p: any) => String(p?.publisher ?? "")).filter((name: string) => !publishersAfter.has(name.toLowerCase()));
  const texts = planText(b);
  const gone = [...removedPersonas, ...renamed.map((r) => r.from), ...removedChannels, ...removedPublishers]
    .map((name) => ({ name, count: mentions(texts, name) }))
    .filter((g) => g.count > 0);
  if (gone.length > 0) {
    const list = gone.map((g) => g.name);
    out.push({
      kind: "update_text",
      label: `The plan text still mentions ${list.join(", ")} (${gone.reduce((sum, g) => sum + g.count, 0)} place${gone.reduce((sum, g) => sum + g.count, 0) === 1 ? "" : "s"})`,
      prompt: `${list.join(", ")} ${list.length === 1 ? "is" : "are"} no longer in the plan, but the plan text still mentions ${list.length === 1 ? "it" : "them"}. Propose text edits that bring those passages in line with the current plan.`,
    });
  }

  const briefEdited = JSON.stringify(a.briefOfRecord ?? null) !== JSON.stringify(b.briefOfRecord ?? null);
  const inputsEdited = JSON.stringify(before?.kpis ?? null) !== JSON.stringify(after?.kpis ?? null) || (before?.geography ?? "") !== (after?.geography ?? "");
  if (briefEdited || inputsEdited) {
    out.push({
      kind: "regenerate_plan",
      label: `The research, personas and channel plan were built from the ${briefEdited && inputsEdited ? "earlier brief and inputs" : briefEdited ? "earlier Brief of Record" : "earlier KPIs and geography"}`,
    });
  }
  return out;
}
