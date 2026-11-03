/**
 * Sends people who open the AI Studio address to the team's own domain.
 *
 * The service answers on both https://<app>.ai.studio and the custom domain, but Google sign-in
 * only works on an origin registered with the OAuth client, so the AI Studio address fails with
 * origin_mismatch. Only page loads are moved: /api stays reachable on every host (health checks,
 * and image URLs a plan already holds), and a POST would not survive a redirect anyway.
 *
 * The custom domain is proxied by Cloudflare, which may forward to the AI Studio host. A request
 * that came through Cloudflare (cf-ray) is never redirected, or the custom domain would loop.
 */
export const DEFAULT_CANONICAL_ORIGIN = "https://plan-agent.digitalremedylabs.com";

export interface CanonicalRequest {
  method: string;
  path: string;
  originalUrl: string;
  host: string | undefined;
  forwardedHost?: string | undefined;
  cfRay?: string | undefined;
}

/** The URL to redirect to, or null to serve the request where it is. */
export function canonicalRedirect(req: CanonicalRequest, canonicalOrigin: string = DEFAULT_CANONICAL_ORIGIN): string | null {
  if (!canonicalOrigin) return null;
  if (req.method !== "GET" && req.method !== "HEAD") return null;
  if (req.path === "/api" || req.path.startsWith("/api/")) return null;
  if (req.cfRay) return null;
  const hosts = [req.host, req.forwardedHost].map((h) => String(h || "").split(",")[0].trim().toLowerCase().replace(/:\d+$/, ""));
  if (!hosts.some((h) => h.endsWith(".ai.studio"))) return null;
  let target: URL;
  try {
    target = new URL(canonicalOrigin);
  } catch {
    return null;
  }
  if (hosts.includes(target.hostname.toLowerCase())) return null;
  // originalUrl is a path (with query), never a full URL, so it cannot point the redirect elsewhere.
  const pathAndQuery = req.originalUrl.startsWith("/") && !req.originalUrl.startsWith("//") ? req.originalUrl : "/";
  return `${target.origin}${pathAndQuery}`;
}
