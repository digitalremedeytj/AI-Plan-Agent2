import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";

/**
 * Session identity for the shared-login model.
 *
 * The app sits behind one shared username/password (TEST_USER / TEST_PASSWORD), but
 * each person types a display name at login. That name rides in an HMAC-signed,
 * HTTP-only cookie so the server can attribute plan writes without trusting anything
 * the client sends in a request body.
 *
 * Google sign-in (POST /api/auth/google) produces the same SessionUser with an email added,
 * and the name taken from the people directory, so every route keeps calling getSession().
 */

export const SESSION_COOKIE = "apa_session";
// Long enough that planners rarely see the sign-in screen. A Google session still picks up admin
// changes on every app load (/api/auth/me), and rotating SESSION_SECRET signs everyone out.
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_NAME_LENGTH = 60;

export interface SessionUser {
  /** Display name typed at login, or the people directory's name for a Google sign-in. Recorded on writes. */
  name: string;
  /** Set only for Google sign-ins: the verified Workspace email. */
  email?: string;
  /** True when the user also supplied the admin password. Gates settings writes. */
  isAdmin: boolean;
  /** Epoch ms the session was issued; used for expiry. */
  issuedAt: number;
}

/**
 * Signing key. A dedicated SESSION_SECRET is preferred; without one we derive a stable
 * key from the existing credentials so the feature works on first deploy with no new
 * secret. Rotating the password invalidates outstanding sessions, which is acceptable.
 */
function getSigningKey(): string {
  const explicit = (process.env.SESSION_SECRET || "").trim();
  if (explicit) return explicit;
  const derived = `${process.env.TEST_USER || ""}:${process.env.TEST_PASSWORD || ""}`;
  return crypto.createHash("sha256").update(`apa-session-fallback:${derived}`).digest("hex");
}

/** True when an admin password is configured; see isAdminRequestAllowed for why it matters. */
export function isAdminPasswordConfigured(): boolean {
  return Boolean((process.env.ADMIN_PASSWORD || "").trim());
}

/** Google accounts that are administrators, from ADMIN_EMAILS (comma-separated). */
export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS || "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
}

/** Workspace domains allowed to sign in with Google, from ALLOWED_EMAIL_DOMAINS. */
export function allowedEmailDomains(): string[] {
  const configured = (process.env.ALLOWED_EMAIL_DOMAINS || "").split(",").map((d) => d.trim().toLowerCase().replace(/^@/, "")).filter(Boolean);
  return configured.length ? configured : ["digitalremedy.com"];
}

export function googleClientId(): string {
  return (process.env.GOOGLE_CLIENT_ID || "").trim();
}

/**
 * Whether the shared username/password form is offered. On by default while Google sign-in is
 * new, so a misconfigured OAuth client after a Publish never locks everyone out.
 */
export function isPasswordLoginEnabled(): boolean {
  return (process.env.PASSWORD_LOGIN_ENABLED || "").trim().toLowerCase() !== "false";
}

export function sanitizeDisplayName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  // Strip control characters so a name cannot forge log lines or break JSON rendering.
  return raw.replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, MAX_NAME_LENGTH);
}

export function createSessionToken(user: SessionUser): string {
  const payload = Buffer.from(JSON.stringify(user), "utf-8").toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token: string | undefined): SessionUser | null {
  if (!token || !token.includes(".")) return null;
  const separator = token.lastIndexOf(".");
  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);

  if (!timingSafeEqual(signature, sign(payload))) return null;

  try {
    const user = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8")) as SessionUser;
    if (!user?.name || typeof user.issuedAt !== "number") return null;
    if (Date.now() - user.issuedAt > SESSION_TTL_MS) return null;
    return { name: user.name, ...(typeof user.email === "string" && user.email ? { email: user.email } : {}), isAdmin: Boolean(user.isAdmin), issuedAt: user.issuedAt };
  } catch {
    return null;
  }
}

/**
 * A stable, pseudonymous id for Google Analytics' user_id. GA's terms forbid sending names,
 * so it gets a keyed hash instead: the same person (however they capitalise their name) maps
 * to the same id across devices, and the id cannot be reversed without the signing key.
 * Names are only attached to usage in the server-side usage log.
 */
export function analyticsIdFor(name: string, email?: string): string {
  // An email is the steadier identity; GA history from before Google sign-in starts over once.
  const normalized = email ? `email:${email.toLowerCase()}` : name.trim().toLowerCase().replace(/\s+/g, " ");
  return crypto.createHmac("sha256", getSigningKey()).update(`analytics:${normalized}`).digest("hex").slice(0, 32);
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", getSigningKey()).update(payload).digest("base64url");
}

function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** Minimal cookie header parser - avoids pulling in cookie-parser for one header. */
export function parseCookies(header: string | undefined): Record<string, string> {
  const jar: Record<string, string> = {};
  if (!header) return jar;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    if (!key) continue;
    try {
      jar[key] = decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      jar[key] = part.slice(eq + 1).trim();
    }
  }
  return jar;
}

export function getSession(req: Request): SessionUser | null {
  // 1. Authorization header: "Bearer <token>"
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
    const token = authHeader.slice(7).trim();
    const user = verifySessionToken(token);
    if (user) return user;
  }
  // 2. Custom header: "x-session-token: <token>"
  const customHeader = req.headers["x-session-token"];
  if (typeof customHeader === "string" && customHeader.trim()) {
    const user = verifySessionToken(customHeader.trim());
    if (user) return user;
  }
  // 3. Cookie fallback
  return verifySessionToken(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
}

export function setSessionCookie(res: Response, user: SessionUser): void {
  // In an iframe environment (e.g. AI Studio preview), cross-site cookies must have SameSite=None and Secure=true.
  // Note: partitioned: true is supported in modern Chrome for CHIPS.
  res.cookie(SESSION_COOKIE, createSessionToken(user), {
    httpOnly: true,
    sameSite: "none",
    secure: true,
    maxAge: SESSION_TTL_MS,
    path: "/",
    partitioned: true,
  } as any);
}

/**
 * Marks a browser that a planner has signed in on, so a share link they open there is not
 * counted as a client view. It outlives the 30-day session on purpose: planners double-check a
 * link before sending it, often long after they signed in, and signing out does not make them
 * the client. It is signed under its own prefix, so it can never pass as a session.
 */
export const STAFF_DEVICE_COOKIE = "apa_staff";
const STAFF_DEVICE_TTL_MS = 400 * 24 * 60 * 60 * 1000; // browsers cap cookie lifetime at 400 days

export function createStaffDeviceToken(name: string, issuedAt = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ staff: name, issuedAt }), "utf-8").toString("base64url");
  return `${payload}.${sign(`staff:${payload}`)}`;
}

/** The planner a browser was last signed in as, or null if it never was (or the mark is forged). */
export function verifyStaffDeviceToken(token: string | undefined): string | null {
  if (!token || !token.includes(".")) return null;
  const separator = token.lastIndexOf(".");
  const payload = token.slice(0, separator);
  if (!timingSafeEqual(token.slice(separator + 1), sign(`staff:${payload}`))) return null;
  try {
    const mark = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"));
    if (typeof mark?.staff !== "string" || !mark.staff || typeof mark.issuedAt !== "number") return null;
    if (Date.now() - mark.issuedAt > STAFF_DEVICE_TTL_MS) return null;
    return mark.staff;
  } catch {
    return null;
  }
}

/** Who is previewing a share link: the signed-in planner, else a planner who signed in on this browser before. */
export function staffViewerName(req: Request): string | null {
  return getSession(req)?.name || verifyStaffDeviceToken(parseCookies(req.headers.cookie)[STAFF_DEVICE_COOKIE]);
}

export function setStaffDeviceCookie(res: Response, name: string): void {
  res.cookie(STAFF_DEVICE_COOKIE, createStaffDeviceToken(name), {
    httpOnly: true,
    sameSite: "none",
    secure: true,
    maxAge: STAFF_DEVICE_TTL_MS,
    path: "/",
    partitioned: true,
  } as any);
}

export function clearSessionCookie(res: Response): void {
  // A partitioned cookie is only cleared by a Set-Cookie that is partitioned too; without the
  // attribute the browser kept the session and signing out undid itself on the next load.
  res.clearCookie(SESSION_COOKIE, {
    path: "/",
    sameSite: "none",
    secure: true,
    partitioned: true,
  } as any);
}

/**
 * Whether this request may write global settings.
 *
 * If neither ADMIN_PASSWORD nor ADMIN_EMAILS is configured, every signed-in user may write,
 * so deploying cannot brick settings editing. Setting either one locks settings down.
 */
export function isAdminRequestAllowed(user: SessionUser | null): boolean {
  if (!user) return false;
  if (!isAdminPasswordConfigured() && adminEmails().length === 0) return true;
  return user.isAdmin;
}

/** Express middleware: rejects unauthenticated API calls with 401. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const user = getSession(req);
  if (!user) {
    res.status(401).json({ error: "Not signed in.", code: "UNAUTHENTICATED" });
    return;
  }
  (req as any).user = user;
  next();
}

/** Express middleware: rejects non-admins with 403 when an admin password is configured. */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const user = getSession(req);
  if (!user) {
    res.status(401).json({ error: "Not signed in.", code: "UNAUTHENTICATED" });
    return;
  }
  if (!isAdminRequestAllowed(user)) {
    res.status(403).json({
      error: "Only administrators can change global settings.",
      code: "FORBIDDEN",
    });
    return;
  }
  (req as any).user = user;
  next();
}

/** The name recorded on writes. Falls back to a marker rather than an empty string. */
export function actorName(req: Request): string {
  return getSession(req)?.name || "unknown";
}
