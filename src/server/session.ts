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
 * This is deliberately a thin seam: swapping in Google Sign-In later means changing
 * only how `SessionUser` is produced at login - every route keeps calling getSession().
 */

export const SESSION_COOKIE = "apa_session";
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // matches the previous 24h client-side gate
const MAX_NAME_LENGTH = 60;

export interface SessionUser {
  /** Display name typed at login, used for plan attribution. */
  name: string;
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
    return { name: user.name, isAdmin: Boolean(user.isAdmin), issuedAt: user.issuedAt };
  } catch {
    return null;
  }
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
  return verifySessionToken(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
}

export function setSessionCookie(res: Response, user: SessionUser): void {
  res.cookie(SESSION_COOKIE, createSessionToken(user), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production", // Cloud Run terminates TLS
    maxAge: SESSION_TTL_MS,
    path: "/",
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

/**
 * Whether this request may write global settings.
 *
 * If ADMIN_PASSWORD is not configured, every signed-in user may write - that is exactly
 * today's behaviour, so adding sessions cannot brick settings editing on first deploy.
 * Setting ADMIN_PASSWORD is what actually locks settings down.
 */
export function isAdminRequestAllowed(user: SessionUser | null): boolean {
  if (!user) return false;
  if (!isAdminPasswordConfigured()) return true;
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
