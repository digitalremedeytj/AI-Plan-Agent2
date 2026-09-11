import test from "node:test";
import assert from "node:assert/strict";
import { resolveGroundingUrls, type GroundingSource } from "./groundingUrls";

const redirect = (id: string) =>
  `https://vertexaisearch.cloud.google.com/grounding-api-redirect/${id}`;

/** Minimal stand-in for fetch: maps a URL to a Location header, or throws to simulate a failure. */
const stubFetch = (routes: Record<string, string | Error>, calls?: string[]) =>
  (async (input: any, init?: any) => {
    const url = String(input);
    calls?.push(`${init?.method} ${url}`);
    const route = routes[url];
    if (route instanceof Error) throw route;
    return {
      headers: { get: (name: string) => (name === "location" ? route ?? null : null) },
    } as unknown as Response;
  }) as unknown as typeof fetch;

test("a grounding redirect is replaced by the publisher deep link it points at", async () => {
  const sources: GroundingSource[] = [{ title: "pawlicy.com", uri: redirect("AAA") }];

  const resolved = await resolveGroundingUrls(sources, {
    fetchImpl: stubFetch({ [redirect("AAA")]: "https://www.pawlicy.com/blog/us-pet-ownership-statistics/" }),
  });

  assert.deepEqual(resolved, [
    { title: "pawlicy.com", uri: "https://www.pawlicy.com/blog/us-pet-ownership-statistics/" },
  ]);
});

test("a source that fails to resolve keeps its citation rather than being dropped", async () => {
  const sources: GroundingSource[] = [
    { title: "forbes.com", uri: redirect("OK") },
    { title: "slow.com", uri: redirect("TIMEOUT") },
    { title: "nolocation.com", uri: redirect("NOLOC") },
  ];

  const resolved = await resolveGroundingUrls(sources, {
    fetchImpl: stubFetch({
      [redirect("OK")]: "https://www.forbes.com/advisor/pet-insurance/pet-ownership-statistics/",
      [redirect("TIMEOUT")]: new Error("The operation was aborted due to timeout"),
    }),
  });

  assert.equal(resolved.length, 3);
  assert.equal(resolved[0].uri, "https://www.forbes.com/advisor/pet-insurance/pet-ownership-statistics/");
  assert.equal(resolved[1].uri, redirect("TIMEOUT"));
  assert.equal(resolved[2].uri, redirect("NOLOC"));
});

test("input order survives concurrent resolution", async () => {
  const sources: GroundingSource[] = Array.from({ length: 30 }, (_, i) => ({
    title: `site${i}.com`,
    uri: redirect(`R${i}`),
  }));
  const routes = Object.fromEntries(
    sources.map((s, i) => [s.uri, `https://site${i}.com/article-${i}`]),
  );

  const resolved = await resolveGroundingUrls(sources, { fetchImpl: stubFetch(routes), concurrency: 7 });

  assert.deepEqual(
    resolved.map(r => r.uri),
    sources.map((_, i) => `https://site${i}.com/article-${i}`),
  );
});

test("a URL that is already a publisher link is not fetched at all", async () => {
  const calls: string[] = [];
  const sources: GroundingSource[] = [{ title: "nielsen.com", uri: "https://www.nielsen.com/insights/the-gauge/" }];

  const resolved = await resolveGroundingUrls(sources, { fetchImpl: stubFetch({}, calls) });

  assert.deepEqual(resolved, sources);
  assert.deepEqual(calls, []);
});

test("a redirect that only points at another redirect is left as it was", async () => {
  const sources: GroundingSource[] = [{ title: "loop.com", uri: redirect("LOOP") }];

  const resolved = await resolveGroundingUrls(sources, {
    fetchImpl: stubFetch({ [redirect("LOOP")]: redirect("LOOP2") }),
  });

  assert.equal(resolved[0].uri, redirect("LOOP"));
});

test("resolution uses HEAD so we never pay for the publisher's page body", async () => {
  const calls: string[] = [];

  await resolveGroundingUrls([{ title: "a.com", uri: redirect("A") }], {
    fetchImpl: stubFetch({ [redirect("A")]: "https://a.com/x" }, calls),
  });

  assert.deepEqual(calls, [`HEAD ${redirect("A")}`]);
});

test("an empty pool resolves to an empty list without touching the network", async () => {
  const calls: string[] = [];
  assert.deepEqual(await resolveGroundingUrls([], { fetchImpl: stubFetch({}, calls) }), []);
  assert.deepEqual(calls, []);
});
