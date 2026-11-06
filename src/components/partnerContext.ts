import React from "react";
import { partnerForSource, type PartnerEvidence, type PartnerProvider } from "../research/partnerData";

// The open plan's partner evidence, for components deep in the plan (chart cards, citations) that
// badge a figure with the partner it came from. Empty outside a plan built with partner research.

export interface PartnerContextValue {
  evidence: PartnerEvidence | null;
  /** Current logos, which may be newer than the plan's snapshot. */
  liveProviders?: PartnerProvider[];
}

export const PartnerEvidenceContext = React.createContext<PartnerContextValue>({ evidence: null });

/** The partner a source line credits, with its current logo; null when it is not partner data. */
export function usePartnerForSource(source: unknown) {
  const { evidence, liveProviders } = React.useContext(PartnerEvidenceContext);
  const partner = partnerForSource(source, evidence);
  if (!partner) return null;
  const live = liveProviders?.find((p) => p.id === partner.id);
  return { ...partner, logoUrl: live?.logoUrl || partner.logoUrl };
}
