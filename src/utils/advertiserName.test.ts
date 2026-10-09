import test from "node:test";
import assert from "node:assert/strict";
import { asAdvertiserName } from "./advertiserName";

test("a field label or placeholder is never used as the advertiser name", () => {
  for (const value of ["Account / Advertiser", "Advertiser Name", "Client Name:", "Brand", "Client / Agency", "Company Information", "N/A", "TBD", "Not specified", "?", "", null, undefined]) {
    assert.equal(asAdvertiserName(value), "", String(value));
  }
});

test("real advertiser names are kept as written", () => {
  assert.equal(asAdvertiserName("View Boston"), "View Boston");
  assert.equal(asAdvertiserName("Acme Outdoor Co."), "Acme Outdoor Co.");
  assert.equal(asAdvertiserName("“Brand X Brewing”"), "Brand X Brewing");
  assert.equal(asAdvertiserName("Client Partners Bank"), "Client Partners Bank");
});
