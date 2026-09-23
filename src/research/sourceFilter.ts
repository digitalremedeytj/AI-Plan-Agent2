// Removes domains that are never evidence from the citation pool before synthesis sees it.
// The synthesis prompt already tells the model to skip them, but live runs still cited
// reddit.com, facebook.com and homework-sharing sites, so the rule is enforced in code.
//
// This only narrows what the plan may cite. It does not claim the dossier text is clean: the
// research model may still have read these pages, which is why the research instruction also
// asks it not to rely on them.

const EXCLUDED_DOMAINS: Record<string, string> = {
  // Social networks, forums and user-generated content.
  "facebook.com": "social",
  "instagram.com": "social",
  "tiktok.com": "social",
  "x.com": "social",
  "twitter.com": "social",
  "linkedin.com": "social",
  "pinterest.com": "social",
  "reddit.com": "forum",
  "quora.com": "forum",
  "medium.com": "blog platform",
  "substack.com": "blog platform",
  "youtube.com": "video platform",
  // Document-sharing and homework sites: reposted material with no accountable publisher.
  "scribd.com": "document sharing",
  "slideshare.net": "document sharing",
  "prezi.com": "document sharing",
  "sweetstudy.com": "homework site",
  "coursehero.com": "homework site",
  "studocu.com": "homework site",
  "sourceforge.net": "software directory",
  // Statistic round-up pages that restate other sources' figures without their methodology.
  "demandsage.com": "statistics round-up",
  "twicsy.com": "statistics round-up",
  "zippia.com": "statistics round-up",
  "capitaloneshopping.com": "statistics round-up",
};

export function hostnameOf(uri: string): string {
  try {
    return new URL(uri).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** The reason a URL is excluded from the citation pool, or null when it may be cited. */
export function exclusionReason(uri: string): string | null {
  const host = hostnameOf(uri);
  if (!host) return null;
  for (const [domain, reason] of Object.entries(EXCLUDED_DOMAINS)) {
    if (host === domain || host.endsWith(`.${domain}`)) return reason;
  }
  return null;
}

export function filterCitationPool<T extends { uri: string }>(sources: T[]): { kept: T[]; excluded: Array<T & { reason: string }> } {
  const kept: T[] = [];
  const excluded: Array<T & { reason: string }> = [];
  for (const source of sources) {
    const reason = exclusionReason(source.uri);
    if (reason) excluded.push({ ...source, reason });
    else kept.push(source);
  }
  return { kept, excluded };
}

/** Appended to each research call's instruction so the dossier text leans on citable sources. */
export const RESEARCH_SOURCE_GUIDANCE =
  "Do not rely on social media, forums, Q&A sites, document-sharing or homework sites, or statistic round-up pages; find the original study or publisher instead.";
