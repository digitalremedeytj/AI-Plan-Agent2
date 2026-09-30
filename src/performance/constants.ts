// Shared by the server and the browser; nothing here may import Node modules.

/** A summarised export larger than this is not a summary; touch-level files are summarised in the browser. */
export const MAX_REPORT_TEXT_CHARS = 800_000;

/** What a past campaign optimised for, which decides what "performed well" means. */
export const CAMPAIGN_GOALS = [
  { id: "cpa", label: "Cost per conversion (CPA)" },
  { id: "roas", label: "Return on ad spend (ROAS)" },
  { id: "reach", label: "Reach and awareness" },
  { id: "engagement", label: "Site visits and engagement" },
  { id: "other", label: "Other" },
] as const;

/** Conversion events offered at upload; the planner may type another. */
export const CONVERSION_EVENTS = ["Checkouts", "Purchases", "Site visits", "Leads", "App installs", "Sign-ups"] as const;
