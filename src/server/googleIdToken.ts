import crypto from "crypto";

/**
 * Verifies the ID token "Sign in with Google" hands the browser, with no npm dependency.
 *
 * The token is a JWT signed by Google. Its signature is checked against Google's published
 * keys, then the claims: it was issued by Google, for this app's OAuth client, has not expired,
 * and belongs to a verified address in an allowed Workspace domain. `hd` is the Workspace domain
 * Google itself vouches for; the email's domain is checked too, so a personal Gmail address can
 * never pass.
 */

const GOOGLE_CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);
/** Tolerates small clock differences between this instance and Google. */
const CLOCK_SKEW_SECONDS = 60;
const DEFAULT_KEY_TTL_MS = 60 * 60 * 1000;

export interface GoogleIdentity {
  email: string;
  name: string;
  domain: string;
}

export class GoogleTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleTokenError";
  }
}

export type KeyLookup = (kid: string) => Promise<crypto.KeyObject | null>;

export interface VerifyOptions {
  clientId: string;
  allowedDomains: string[];
  getKey?: KeyLookup;
  nowSeconds?: number;
}

export async function verifyGoogleIdToken(token: unknown, options: VerifyOptions): Promise<GoogleIdentity> {
  if (typeof token !== "string") throw new GoogleTokenError("No Google credential was sent.");
  const parts = token.split(".");
  if (parts.length !== 3) throw new GoogleTokenError("The Google credential is malformed.");
  const [headerPart, payloadPart, signaturePart] = parts;

  const header = decodeJson(headerPart);
  if (header?.alg !== "RS256" || typeof header.kid !== "string") throw new GoogleTokenError("The Google credential uses an unexpected signature.");
  const key = await (options.getKey ?? googleKey)(header.kid);
  if (!key) throw new GoogleTokenError("The Google credential was signed with an unknown key.");
  const signed = crypto.verify("RSA-SHA256", Buffer.from(`${headerPart}.${payloadPart}`), key, Buffer.from(signaturePart, "base64url"));
  if (!signed) throw new GoogleTokenError("The Google credential's signature is not valid.");

  const claims = decodeJson(payloadPart);
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (!claims || !GOOGLE_ISSUERS.has(claims.iss)) throw new GoogleTokenError("The credential was not issued by Google.");
  if (claims.aud !== options.clientId) throw new GoogleTokenError("The Google credential was issued for a different app.");
  if (typeof claims.exp !== "number" || claims.exp + CLOCK_SKEW_SECONDS < now) throw new GoogleTokenError("The Google credential has expired. Please sign in again.");
  if (claims.email_verified !== true || typeof claims.email !== "string") throw new GoogleTokenError("Google has not verified this account's email address.");

  const email = claims.email.trim().toLowerCase();
  const emailDomain = email.split("@")[1] || "";
  const hostedDomain = typeof claims.hd === "string" ? claims.hd.toLowerCase() : "";
  if (!options.allowedDomains.includes(hostedDomain) || emailDomain !== hostedDomain) {
    throw new GoogleTokenError(`Sign in with your ${options.allowedDomains.map((d) => `@${d}`).join(" or ")} Google account.`);
  }
  const name = typeof claims.name === "string" ? claims.name : [claims.given_name, claims.family_name].filter((n) => typeof n === "string").join(" ");
  return { email, name: name.trim(), domain: hostedDomain };
}

function decodeJson(part: string): any {
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf-8"));
  } catch {
    return null;
  }
}

// Google rotates its keys every few days and says how long to cache them (Cache-Control max-age).
let keyCache: { keys: Map<string, crypto.KeyObject>; expiresAt: number } | null = null;

async function googleKey(kid: string): Promise<crypto.KeyObject | null> {
  if (!keyCache || Date.now() > keyCache.expiresAt || !keyCache.keys.has(kid)) {
    const res = await fetch(GOOGLE_CERTS_URL);
    if (!res.ok) throw new Error(`Google's signing keys could not be fetched (${res.status}).`);
    const body = (await res.json()) as { keys?: Array<crypto.JsonWebKey & { kid?: string }> };
    const keys = new Map<string, crypto.KeyObject>();
    for (const jwk of body.keys ?? []) if (jwk.kid) keys.set(jwk.kid, crypto.createPublicKey({ key: jwk, format: "jwk" }));
    const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get("cache-control") || "")?.[1]);
    keyCache = { keys, expiresAt: Date.now() + (maxAge > 0 ? maxAge * 1000 : DEFAULT_KEY_TTL_MS) };
  }
  return keyCache.keys.get(kid) ?? null;
}
