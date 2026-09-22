/**
 * Google Search Grounding hands back opaque redirects, not publisher URLs.
 * On Gemini 3.8 every `url_citation` annotation's `url` is a
 * `vertexaisearch.cloud.google.com/grounding-api-redirect/…` link (as `groundingChunks[].web.uri`
 * was on 2.5), and the only trace of the real publisher is `title`, which carries a bare domain.
 *
 * That was quietly poisoning the whole citation chain. Synthesis is told to cite exact deep links
 * from the discovered pool, but the pool had none to give; the QA scorer then red-flagged the
 * profile for "opaque grounding redirects"; and the remediation agent, told to resolve every red
 * flag, threw the registry away and substituted URLs it recalled from its own training. The
 * delivered citations stopped describing the research that produced the profile.
 *
 * Resolving one hop up front fixes it at the source: the redirect's Location header is already the
 * publisher deep link, so a single HEAD per source is enough. Anything that fails, times out or
 * does not redirect keeps its original URI - a slow publisher should cost us a nicer link, never a
 * citation.
 */

export interface GroundingSource {
  title: string;
  uri: string;
}

/** Vertex is the only host we rewrite; a URL that is already a publisher link is left untouched. */
const REDIRECT_HOST = "vertexaisearch.cloud.google.com";

export interface ResolveOptions {
  /** Per-request budget. Publishers that stall should not hold up the pipeline. */
  timeoutMs?: number;
  /** How many requests are in flight at once, so 100 sources do not arrive as 100 sockets. */
  concurrency?: number;
  /** Injected for tests. */
  fetchImpl?: typeof fetch;
}

function isRedirectUrl(uri: string): boolean {
  try {
    return new URL(uri).hostname === REDIRECT_HOST;
  } catch {
    return false;
  }
}

async function resolveOne(
  source: GroundingSource,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<GroundingSource> {
  if (!isRedirectUrl(source.uri)) return source;

  try {
    // `redirect: "manual"` so we read the Location rather than paying for the publisher's page.
    const response = await fetchImpl(source.uri, {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const location = response.headers.get("location");
    if (!location) return source;

    // Resolved against the request URL so a relative Location cannot produce a broken citation.
    const resolved = new URL(location, source.uri).toString();
    if (isRedirectUrl(resolved)) return source;

    return { ...source, uri: resolved };
  } catch {
    return source;
  }
}

/**
 * Resolves grounding redirects to publisher URLs, preserving input order. Never rejects and never
 * drops an entry: every source comes back, resolved where possible and untouched where not.
 */
export async function resolveGroundingUrls(
  sources: GroundingSource[],
  options: ResolveOptions = {},
): Promise<GroundingSource[]> {
  const { timeoutMs = 5000, concurrency = 12, fetchImpl = fetch } = options;
  if (!Array.isArray(sources) || sources.length === 0) return [];

  const resolved = new Array<GroundingSource>(sources.length);
  let next = 0;

  const worker = async () => {
    while (true) {
      const index = next++;
      if (index >= sources.length) return;
      resolved[index] = await resolveOne(sources[index], timeoutMs, fetchImpl);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, sources.length) }, worker),
  );

  return resolved;
}
