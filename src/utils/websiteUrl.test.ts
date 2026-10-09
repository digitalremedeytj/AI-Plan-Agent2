import test from "node:test";
import assert from "node:assert/strict";
import { asWebsiteUrl } from "./websiteUrl";

test("text beside a website label that is not an address is not used as the brief's URL", () => {
  for (const value of ["Max File Size for HTML", "N/A", "TBD", "See attached", "HTML5", "200KB", "jane@acme.com", "", null, undefined]) {
    assert.equal(asWebsiteUrl(value), "", String(value));
  }
});

test("real website addresses are kept as written", () => {
  assert.equal(asWebsiteUrl("www.acmeoutdoor.com"), "www.acmeoutdoor.com");
  assert.equal(asWebsiteUrl("https://acme.co.uk/spring-sale?utm=1"), "https://acme.co.uk/spring-sale?utm=1");
  assert.equal(asWebsiteUrl("viewboston.com"), "viewboston.com");
  assert.equal(asWebsiteUrl("  <https://acme.com/>. "), "https://acme.com/");
});
