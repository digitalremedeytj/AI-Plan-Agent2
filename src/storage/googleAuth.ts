import crypto from "crypto";

/**
 * Minimal Google access-token source, with no npm dependency.
 *
 * Two paths, tried in order:
 *   1. GOOGLE_SERVICE_ACCOUNT_KEY - a service-account JSON key (or its base64 form)
 *      supplied as a secret. Signs a JWT and exchanges it for an access token.
 *      Use this if the Cloud Run runtime service account cannot be granted Firestore IAM.
 *   2. The GCE/Cloud Run metadata server - ambient credentials for the runtime service
 *      account. No secret to manage; preferred when the runtime SA has roles/datastore.user.
 *
 * Deliberately avoids google-auth-library so the AI Studio buildpack does not have to
 * resolve a new dependency tree on deploy.
 */

const METADATA_HOST = process.env.GCE_METADATA_HOST || "metadata.google.internal";
const TOKEN_SCOPE = "https://www.googleapis.com/auth/datastore";
/** Refresh a minute early so a token never expires mid-request. */
const EXPIRY_SKEW_MS = 60_000;

interface CachedToken {
  token: string;
  expiresAt: number;
}

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  project_id?: string;
}

let cachedToken: CachedToken | null = null;
let inFlight: Promise<string> | null = null;

export function parseServiceAccountKey(raw: string | undefined): ServiceAccountKey | null {
  if (!raw || !raw.trim()) return null;
  let text = raw.trim();
  // Accept base64 to survive env-var editors that mangle multi-line JSON.
  if (!text.startsWith("{")) {
    try {
      text = Buffer.from(text, "base64").toString("utf-8");
    } catch {
      return null;
    }
  }
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed?.client_email === "string" && typeof parsed?.private_key === "string") {
      return parsed as ServiceAccountKey;
    }
  } catch (err) {
    console.error("[AUTH:gcp] GOOGLE_SERVICE_ACCOUNT_KEY is not valid JSON:", err);
  }
  return null;
}

/** Returns a cached access token, fetching a new one only when the current one is near expiry. */
export async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - EXPIRY_SKEW_MS) {
    return cachedToken.token;
  }
  // Collapse concurrent refreshes so a burst of requests mints one token, not N.
  if (inFlight) return inFlight;

  inFlight = fetchToken()
    .then((result) => {
      cachedToken = result;
      return result.token;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

async function fetchToken(): Promise<CachedToken> {
  const key = parseServiceAccountKey(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  if (key) return fetchTokenFromServiceAccountKey(key);
  return fetchTokenFromMetadataServer();
}

async function fetchTokenFromMetadataServer(): Promise<CachedToken> {
  const url = `http://${METADATA_HOST}/computeMetadata/v1/instance/service-accounts/default/token`;
  const res = await fetch(url, { headers: { "Metadata-Flavor": "Google" } });
  if (!res.ok) {
    throw new Error(
      `Metadata server returned ${res.status}. On Cloud Run, grant the runtime service account ` +
        `roles/datastore.user; elsewhere set GOOGLE_SERVICE_ACCOUNT_KEY.`,
    );
  }
  const body: any = await res.json();
  return {
    token: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  };
}

async function fetchTokenFromServiceAccountKey(key: ServiceAccountKey): Promise<CachedToken> {
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + 3600;
  const claims = {
    iss: key.client_email,
    scope: TOKEN_SCOPE,
    aud: "https://oauth2.googleapis.com/token",
    iat: issuedAt,
    exp: expiresAt,
  };

  const signingInput = `${base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64url(JSON.stringify(claims))}`;
  const signature = crypto.createSign("RSA-SHA256").update(signingInput).sign(key.private_key);
  const assertion = `${signingInput}.${signature.toString("base64url")}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  if (!res.ok) {
    throw new Error(`Token exchange failed (${res.status}): ${await res.text()}`);
  }
  const body: any = await res.json();
  return {
    token: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  };
}

/** Resolves the GCP project id from an explicit env var, the key file, or the metadata server. */
export async function resolveProjectId(): Promise<string | null> {
  const explicit = process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;
  if (explicit) return explicit;

  const key = parseServiceAccountKey(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  if (key?.project_id) return key.project_id;

  try {
    const res = await fetch(`http://${METADATA_HOST}/computeMetadata/v1/project/project-id`, {
      headers: { "Metadata-Flavor": "Google" },
    });
    if (res.ok) return (await res.text()).trim();
  } catch {
    // Not running on GCP - the caller falls back to the local driver.
  }
  return null;
}

/** Exposed for tests: clears the module-level token cache. */
export function resetTokenCacheForTests(): void {
  cachedToken = null;
  inFlight = null;
}

function base64url(value: string): string {
  return Buffer.from(value, "utf-8").toString("base64url");
}
