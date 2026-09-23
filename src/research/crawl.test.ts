import test from "node:test";
import assert from "node:assert/strict";
import { crawlCandidates, crawlSite, MIN_USEFUL_CRAWL_CHARS } from "./crawl";

const page = (body: string) => `<html><head><style>x{}</style><script>var a=1;</script></head><body>${body}</body></html>`;
const longCopy = "Dog food, cat food, grooming and vet services. ".repeat(10);

test("a bare domain is tried as entered first, then with www", () => {
  assert.deepEqual(crawlCandidates("petsmart.com"), ["https://petsmart.com/", "https://www.petsmart.com/"]);
});

test("a www URL falls back to the bare host and keeps its path", () => {
  assert.deepEqual(crawlCandidates("https://www.thinkjinx.com/shop"), ["https://www.thinkjinx.com/shop", "https://thinkjinx.com/shop"]);
});

test("the www twin is used when the domain as entered does not answer", async () => {
  const tried: string[] = [];
  const result = await crawlSite("petsmart.com", {
    fetcher: async (url) => {
      tried.push(url);
      if (!url.includes("www.")) throw new Error("fetch failed");
      return { ok: true, status: 200, text: async () => page(longCopy) };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.url, "https://www.petsmart.com/");
  assert.ok(!result.text.includes("var a"));
  assert.deepEqual(tried, ["https://petsmart.com/", "https://www.petsmart.com/"]);
});

test("a blocked crawl is reported as failed instead of passing its status note off as brand text", async () => {
  const result = await crawlSite("example.com", {
    fetcher: async () => ({ ok: false, status: 403, text: async () => "" }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.text, "");
  assert.equal(result.errors.length, 2);
  assert.match(result.errors[0], /403/);
});

test("a page with almost no text counts as a failed crawl", async () => {
  const result = await crawlSite("https://www.example.com", {
    fetcher: async () => ({ ok: true, status: 200, text: async () => page("Access denied") }),
  });
  assert.equal(result.ok, false);
  assert.match(result.errors[0], new RegExp(`only \\d+ characters`));
  assert.ok("Access denied".length < MIN_USEFUL_CRAWL_CHARS);
});
