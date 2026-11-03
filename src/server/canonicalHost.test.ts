import test from "node:test";
import assert from "node:assert/strict";
import { canonicalRedirect } from "./canonicalHost";

const page = (extra: Record<string, string | undefined> = {}) => ({
  method: "GET", path: "/", originalUrl: "/", host: "ai-plan-agent.ai.studio", ...extra,
});

test("opening the AI Studio address lands on the team domain, keeping the path and query", () => {
  assert.equal(
    canonicalRedirect(page({ path: "/share/abc", originalUrl: "/share/abc?x=1" })),
    "https://plan-agent.digitalremedylabs.com/share/abc?x=1",
  );
});

test("the custom domain never loops, even when Cloudflare forwards the AI Studio host", () => {
  assert.equal(canonicalRedirect(page({ cfRay: "a54d26c0e94a4e05-MCI" })), null);
  assert.equal(canonicalRedirect(page({ host: "plan-agent.digitalremedylabs.com" })), null);
});

test("API calls and non-GET requests are served on every host", () => {
  assert.equal(canonicalRedirect(page({ path: "/api/health", originalUrl: "/api/health" })), null);
  assert.equal(canonicalRedirect(page({ method: "POST" })), null);
});

test("other hosts, including local development and the run.app address, are left alone", () => {
  assert.equal(canonicalRedirect(page({ host: "localhost" })), null);
  assert.equal(canonicalRedirect(page({ host: "ai-plan-agent-123.us-east1.run.app" })), null);
});

test("an empty canonical origin turns the redirect off", () => {
  assert.equal(canonicalRedirect(page(), ""), null);
});

test("a protocol-relative path cannot send the redirect to another site", () => {
  assert.equal(canonicalRedirect(page({ originalUrl: "//evil.example/x" })), "https://plan-agent.digitalremedylabs.com/");
});
