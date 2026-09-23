import test from "node:test";
import assert from "node:assert/strict";
import { buildClaimLedger, extractFigures, formatClaimLedger } from "./claimLedger";

const dossiers = [
  { label: "Temporal & Purchase", text: "SureBright's national transaction study reveals that over 36% of all U.S. e-commerce orders occur between 11:00 AM and 3:00 PM." },
  { label: "Demographics", text: "Female consumers drive nearly two-thirds of traffic on PetSmart.com (66.46%). Combined, Gen Z and Millennials represent 66% of reptile owners. 94 to 95 million U.S. households own pets; dogs average $2,351 a year." },
];

const statusOf = (entries: ReturnType<typeof buildClaimLedger>, raw: string) => entries.find((e) => e.raw === raw)?.status;

test("a figure the research states is traced to its dossier with the sentence it came from", () => {
  const entries = buildClaimLedger({ takeaways: ["36% of orders happen at lunch, so run search midday."] }, dossiers);
  const entry = entries.find((e) => e.raw === "36%")!;
  assert.equal(entry.status, "research");
  assert.equal(entry.dossier, "Temporal & Purchase");
  assert.match(entry.researchContext!, /all U\.S\. e-commerce orders/);
});

test("a figure is matched at the precision it is written, so 66.5% finds 66.46% and not a nearby 66%", () => {
  const entries = buildClaimLedger({ intro: "Female visitors are 66.5% of PetSmart.com traffic." }, dossiers);
  assert.match(entries[0].researchContext!, /66\.46%/);
  const derived = buildClaimLedger({ intro: "A 25-54 majority of 63.1% of visitors." }, dossiers);
  assert.equal(statusOf(derived, "63.1%"), "not_found");
});

test("money and counts are matched in their own units", () => {
  const entries = buildClaimLedger({ executiveSummary: "Dog owners spend $2,351 a year across 95 million households." }, dossiers);
  assert.equal(statusOf(entries, "$2,351"), "research");
  assert.equal(statusOf(entries, "95 million"), "research");
});

test("chart values and the plan's own budget and allocations are not reported as missing", () => {
  const profile = {
    demographics: { ageChartData: [{ range: "25-34", value: 22, isModeled: true, source: "x" }] },
    channelStrategy: { mediaPlan: { channels: [{ allocationPercent: 13, allocationDollars: 13000, gapAddressed: "Search takes 13% ($13,000)." }] } },
    takeaways: ["22% of the audience is 25-34, and the $100,000 budget covers eight channels."],
  };
  const entries = buildClaimLedger(profile, dossiers, { workingMediaBudget: 100000, flightDays: 30 });
  assert.equal(statusOf(entries, "22%"), "chart");
  assert.equal(statusOf(entries, "$100,000"), "plan");
  assert.equal(statusOf(entries, "13%"), "plan");
  assert.equal(statusOf(entries, "$13,000"), "plan");
});

test("years, times, age ranges, durations and small counts are not treated as claims", () => {
  const raws = extractFigures("In 2025, adults 25–34 watch from 8 PM to 11:30 PM, 4 personas, a 30-day flight, 15-second spots, 55+ viewers.").map((f) => f.raw);
  assert.deepEqual(raws, []);
  assert.deepEqual(extractFigures("84–91% of viewers").map((f) => [f.raw, f.unit]), [["84", "percent"], ["91%", "percent"]]);
});

test("the ledger lists what was not found before what was", () => {
  const entries = buildClaimLedger({ takeaways: ["36% of orders occur midday.", "72% of owners prefer Autoship."] }, dossiers);
  const text = formatClaimLedger(entries);
  assert.ok(text.indexOf("NOT FOUND") < text.indexOf("FOUND IN RESEARCH"));
  assert.match(text, /\[takeaways\[1\]\] 72%/);
});
