// Fetches the advertiser's homepage text. A brief often carries the bare domain
// ("petsmart.com"), and some sites only answer on the other host variant: bare petsmart.com
// failed at the network level while https://www.petsmart.com/ returned the page. So the crawl
// tries the URL as entered, then the www / non-www twin, before giving up.
//
// The result says whether it worked. The old helper returned its failure notes as ordinary
// text, so a 403 note was passed to research as if it were brand copy and raised no alert.

export interface CrawlResult {
  ok: boolean;
  /** The URL that returned the text, or the last one tried when every attempt failed. */
  url: string;
  text: string;
  /** Why the crawl failed, one entry per URL tried. Empty when ok. */
  errors: string[];
}

/** Below this, a 200 response is a bot wall or an empty shell, not brand copy. */
export const MIN_USEFUL_CRAWL_CHARS = 200;

const MAX_CRAWL_CHARS = 12000;

/** The URLs to try, in order: as entered (with https:// added), then the www / non-www twin. */
export function crawlCandidates(raw: string): string[] {
  const trimmed = (raw || "").trim();
  if (!trimmed) return [];
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return [withScheme];
  }
  const twin = new URL(parsed.toString());
  twin.hostname = parsed.hostname.startsWith("www.") ? parsed.hostname.slice(4) : `www.${parsed.hostname}`;
  // An IP address or single-label host has no www twin worth trying.
  const hasTwin = parsed.hostname.includes(".") && !/^\d+(\.\d+){3}$/.test(parsed.hostname);
  return hasTwin ? [parsed.toString(), twin.toString()] : [parsed.toString()];
}

export function htmlToText(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

type Fetcher = (url: string, init: RequestInit) => Promise<Pick<Response, "ok" | "status" | "text">>;

export async function crawlSite(
  raw: string,
  { timeoutMs = 6000, fetcher = fetch as Fetcher }: { timeoutMs?: number; fetcher?: Fetcher } = {},
): Promise<CrawlResult> {
  const candidates = crawlCandidates(raw);
  const errors: string[] = [];
  for (const url of candidates) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5",
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        errors.push(`${url} returned status ${response.status}`);
        continue;
      }
      const text = htmlToText(await response.text());
      if (text.length < MIN_USEFUL_CRAWL_CHARS) {
        errors.push(`${url} returned only ${text.length} characters of text`);
        continue;
      }
      return { ok: true, url, text: text.slice(0, MAX_CRAWL_CHARS), errors: [] };
    } catch (err: any) {
      errors.push(`${url} failed (${err?.name === "AbortError" ? `timed out after ${timeoutMs / 1000}s` : err?.message || err})`);
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, url: candidates[candidates.length - 1] || raw, text: "", errors };
}
