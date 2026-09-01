import type { ChannelStrategyData } from "../types";

export interface ManualPlanTransitionValidation {
  valid: boolean;
  error?: string;
}

export function validateManualPlanTransition(
  previous: ChannelStrategyData,
  next: ChannelStrategyData | null | undefined,
  channelId: string,
  action: "add" | "remove",
): ManualPlanTransitionValidation {
  const previousCandidateCount = previous.mediaPlan?.evaluatedCandidates?.length || 0;
  const nextPlan = next?.mediaPlan;
  if (!nextPlan) {
    return { valid: false, error: "The recalculated response did not include a media plan. Your existing plan was kept unchanged." };
  }
  if (previousCandidateCount > 0 && (!Array.isArray(nextPlan.evaluatedCandidates) || nextPlan.evaluatedCandidates.length === 0)) {
    return { valid: false, error: "The recalculated response omitted the media-type catalog. Your existing plan was kept unchanged." };
  }
  const selected = nextPlan.channels.some((channel) => channel.channelId === channelId);
  if (action === "add" && !selected) {
    const name = previous.mediaPlan?.evaluatedCandidates.find((candidate) => candidate.product.id === channelId)?.product.displayName || "That media type";
    return {
      valid: false,
      error: `${name} could not be added because the requested mix conflicts with another selected media family or cannot satisfy the current spend and allocation constraints. Remove the conflicting media type or adjust its settings first. Your existing plan was kept unchanged.`,
    };
  }
  if (action === "remove" && selected) {
    return { valid: false, error: "The media type remained in the recalculated plan, so your existing plan was kept unchanged." };
  }
  return { valid: true };
}
