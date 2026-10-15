import { recordUsage } from "./api/client";

/**
 * Google Analytics 4: how the app is used, for leadership reporting.
 *
 * Three rules shape this module:
 *  - GA never sees a real URL. A share link carries its secret token in the query string, and
 *    gtag's default page_location would hand that token (and with it the plan) to Google on
 *    every hit. Every hit instead carries a synthetic location built from the screen name.
 *  - GA never sees a name. Google's terms forbid personal data, so user_id is a keyed hash
 *    issued by the server (src/server/session.ts analyticsIdFor). Named usage lives in the
 *    server-side usage log and the admin Usage report.
 *  - Only the production host reports, so local development and AI Studio previews do not
 *    pollute the numbers. Set localStorage "apa_analytics_debug" to "1" to report from any
 *    host with debug_mode on, which shows hits live in GA's DebugView.
 *
 * Event names and parameters are the contract with the GA property: custom dimensions are
 * registered there by parameter name (see documentation/ANALYTICS.md), so renaming one here
 * silently empties its report.
 */

const MEASUREMENT_ID = "G-NKNVTM30FW";
const PRODUCTION_HOST = "plan-agent.digitalremedylabs.com";
const DEBUG_FLAG_KEY = "apa_analytics_debug";

type Gtag = (...args: unknown[]) => void;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: Gtag;
  }
}

/** The screens a page_view can name. Each becomes the page path GA reports, e.g. "/saved". */
export type AnalyticsScreen = "brief" | "saved" | "overview" | "scout" | "plan" | "share" | "login" | "settings" | "dashboard";

export type AnalyticsParams = Record<string, string | number | boolean | null | undefined>;

let gtag: Gtag | null = null;

function debugEnabled(): boolean {
  try {
    return localStorage.getItem(DEBUG_FLAG_KEY) === "1";
  } catch {
    return false;
  }
}

/** The location GA records: the origin plus a screen name, never the real path or query. */
export function syntheticLocation(origin: string, screen: AnalyticsScreen | "" = ""): string {
  return `${origin}/${screen}`;
}

/** A referrer that is this app's own share link would carry the token; GA gets the origin only. */
export function safeReferrer(referrer: string, ownOrigin: string): string {
  if (!referrer) return "";
  try {
    const url = new URL(referrer);
    return url.origin === ownOrigin ? syntheticLocation(ownOrigin) : url.origin;
  } catch {
    return "";
  }
}

/** Advertiser names are free text; GA truncates parameters at 100 characters anyway. */
const trim = (value: string | null | undefined) => (value ? value.trim().slice(0, 100) || undefined : undefined);

export function initAnalytics(): void {
  if (gtag || typeof window === "undefined") return;
  const debug = debugEnabled();
  if (window.location.hostname !== PRODUCTION_HOST && !debug) return;

  window.dataLayer = window.dataLayer || [];
  // gtag.js reads the arguments object itself, so this must stay a plain function.
  window.gtag = function gtagShim() {
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments);
  };
  gtag = window.gtag;

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;
  document.head.appendChild(script);

  gtag("js", new Date());
  // Set, not passed to config: a config-level page_location outranks every later "set", which
  // would pin automatic events (scrolls, outbound clicks) to "/" instead of the current screen.
  gtag("set", {
    page_location: syntheticLocation(window.location.origin),
    page_referrer: safeReferrer(document.referrer, window.location.origin),
  });
  gtag("config", MEASUREMENT_ID, {
    // Page views are sent by screen from the app; an automatic one would carry the real URL.
    send_page_view: false,
    // An internal tool: no advertising features, no cross-device Google signals.
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
    ...(debug ? { debug_mode: true } : {}),
  });
}

/** A signed-in planner. Pass null on sign-out so later hits are not attributed to them. */
export function identifyUser(user: { analyticsId?: string; isAdmin?: boolean } | null): void {
  if (!gtag) return;
  if (!user) {
    gtag("set", { user_id: null });
    gtag("set", "user_properties", { user_type: null, is_admin: null });
    return;
  }
  gtag("set", { user_id: user.analyticsId || null });
  gtag("set", "user_properties", { user_type: "staff", is_admin: user.isAdmin ? "yes" : "no" });
}

/** Someone viewing a share link without signing in: almost always the client. */
export function identifyShareViewer(): void {
  if (!gtag) return;
  gtag("set", { user_id: null });
  gtag("set", "user_properties", { user_type: "client_share" });
}

/** Someone opening the leadership dashboard through a view-only link. */
export function identifyDashboardViewer(): void {
  if (!gtag) return;
  gtag("set", { user_id: null });
  gtag("set", "user_properties", { user_type: "dashboard_link" });
}

export function trackScreen(screen: AnalyticsScreen): void {
  if (!gtag) return;
  const location = syntheticLocation(window.location.origin, screen);
  // Set as well as sent, so enhanced-measurement events (scrolls, outbound clicks) that
  // follow carry the screen rather than the real URL.
  gtag("set", { page_location: location });
  gtag("event", "page_view", { page_location: location, page_title: `AI Plan Agent - ${screen}` });
}

export function track(event: string, params: AnalyticsParams = {}): void {
  if (!gtag) return;
  const cleaned: AnalyticsParams = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    cleaned[key] = typeof value === "string" ? trim(value) : value;
  }
  gtag("event", event, cleaned);
}

/**
 * For actions only the browser sees: reports to GA and also to the server's usage log, which
 * is where per-person numbers come from (and which ad blockers cannot drop).
 */
export function trackClientAction(
  action: "plan_open" | "plan_save" | "export",
  details: { planId?: string | null; advertiserName?: string; format?: string } = {},
): void {
  track(action, { plan_id: details.planId, advertiser_name: details.advertiserName, format: details.format });
  recordUsage(action, { planId: details.planId, advertiserName: details.advertiserName, detail: details.format });
}
