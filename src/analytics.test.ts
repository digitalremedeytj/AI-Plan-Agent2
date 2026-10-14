import assert from "node:assert/strict";
import test from "node:test";
import { safeReferrer, syntheticLocation } from "./analytics";

const ORIGIN = "https://plan-agent.digitalremedylabs.com";

test("the location sent to GA names the screen and never carries a share token", () => {
  assert.equal(syntheticLocation(ORIGIN, "share"), `${ORIGIN}/share`);
  assert.equal(syntheticLocation(ORIGIN), `${ORIGIN}/`);
});

test("a referrer that is this app's own share link is reduced to the origin", () => {
  const ref = safeReferrer(`${ORIGIN}/?share=sec_abc123`, ORIGIN);
  assert.equal(ref, `${ORIGIN}/`);
  assert.ok(!ref.includes("sec_"));
});

test("an outside referrer keeps only its origin, so its path and query stay private", () => {
  assert.equal(safeReferrer("https://mail.example.com/inbox/42?x=1", ORIGIN), "https://mail.example.com");
  assert.equal(safeReferrer("", ORIGIN), "");
  assert.equal(safeReferrer("not a url", ORIGIN), "");
});
