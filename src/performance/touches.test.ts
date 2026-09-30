import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "./__fixtures__/load";
import { readReport, readTouchReportStream, type TouchReport } from "./reports";

const allTouch = () => {
  const f = fixture("all_touch_sample.csv");
  return (readReport(f.name, f.text) as TouchReport).summary;
};
const lastTouch = () => {
  const f = fixture("last_touch_sample.csv");
  return (readReport(f.name, f.text) as TouchReport).summary;
};

const HEADER = "Unique ID,Hashed IP address,($)Rev,Conversion Timestamp,Creative,Publisher,Audience/Tactic,Media Type,State,DMA,Device Type,Imp Timestamp,Time to Convert (Hrs),Times Exposed";
const touch = (id: string, household: string, rev: number, converted: string, publisher: string, mediaType: string, seen: string) =>
  [id, household, rev, converted, "Spot", publisher, "Aud", mediaType, "IA", "Des Moines-Ames IA", mediaType === "OTT" ? "CTV" : "Desktop", seen, "0", "1"].join(",");

test("the files are told apart by whether conversions repeat, not by name", () => {
  assert.equal(allTouch().attribution, "all-touch");
  assert.equal(lastTouch().attribution, "last-touch");
});

test("all-touch revenue is counted once per conversion, not once per touch row", () => {
  const s = allTouch();
  assert.equal(s.rows, 24);
  assert.equal(s.conversions, 2);
  // 100.24 + 32.61; summing the column would give over $780.
  assert.equal(Math.round(s.revenue * 100) / 100, 132.85);
});

test("linear credit splits each conversion across its touches and still adds up to the conversions", () => {
  const s = allTouch();
  const linear = s.byMediaType.reduce((sum, m) => sum + m.linear, 0);
  assert.ok(Math.abs(linear - s.conversions) < 1e-9);
  const retargeting = s.byMediaType.find((m) => m.mediaType === "Display Retargeting")!;
  assert.equal(retargeting.lastTouch, 0);
  assert.equal(retargeting.firstTouch, 1);
  assert.ok(Math.abs(retargeting.linear - 2 / 3) < 1e-9);
});

test("the last touch derived from an all-touch path is the impression the last-touch export credits", () => {
  // Conversion 900000000: retargeting on 4/29 and 5/20, then pre-roll on 5/22.
  const s = allTouch();
  assert.deepEqual(s.paths.find((p) => p.path.length === 2)?.path, ["Display Retargeting", "Pre-Roll/Mid-Roll"]);
  const credited = lastTouch().byMediaType.find((m) => m.mediaType === "Pre-Roll/Mid-Roll");
  assert.ok(credited && credited.lastTouch >= 1);
});

test("a publisher column that repeats the media type is not a publisher", () => {
  const names = lastTouch().publishers.map((p) => p.name);
  assert.deepEqual(names.sort(), ["DirecTV Stream", "Hulu", "Tubi TV"]);
});

test("a household that converts twice is one household with two conversions", () => {
  const s = lastTouch();
  assert.equal(s.conversions, 27);
  assert.equal(s.households, 26);
  assert.equal(s.repeatHouseholds, 1);
});

test("impressions stacked within an hour on one path are flagged", () => {
  const s = allTouch();
  assert.equal(s.bursts?.conversions, 1);
  assert.equal(s.bursts?.maxInWindow, 17);
  assert.equal(s.bursts?.byMediaType[0].name, "Pre-Roll/Mid-Roll");
});

test("Times Exposed that does not match the touch rows is reported, not used for frequency", () => {
  const s = allTouch();
  assert.equal(s.timesExposed?.matchesPathLength, 0);
  assert.ok(s.notes.some((n) => n.includes("Times Exposed")));
});

test("CTV exposure credited to another media type under last touch is counted", () => {
  const text = [
    HEADER,
    touch("1", "h1", 50, "2026-02-10 12:00:00", "Hulu", "OTT", "2026-02-08 20:00:00"),
    touch("1", "h1", 50, "2026-02-10 12:00:00", "Display", "Display", "2026-02-10 09:00:00"),
    touch("2", "h2", 20, "2026-02-11 12:00:00", "Tubi", "OTT", "2026-02-11 08:00:00"),
    touch("3", "h3", 10, "2026-02-12 12:00:00", "Display", "Display", "2026-02-12 08:00:00"),
    touch("3", "h3", 10, "2026-02-12 12:00:00", "Display", "Display", "2026-02-12 09:00:00"),
  ].join("\n");
  const s = (readReport("touches.csv", text) as TouchReport).summary;
  assert.deepEqual(s.ctv, { anyTouch: 2, lastTouch: 1, onlyCtv: 1, creditedElsewhere: 1 });
  assert.equal(s.byMediaType.find((m) => m.mediaType === "OTT")?.isCtv, true);
  assert.equal(s.revenue, 80);
});

test("rows for one conversion need not be next to each other", () => {
  const text = [
    HEADER,
    touch("1", "h1", 50, "2026-02-10 12:00:00", "Display", "Display", "2026-02-10 09:00:00"),
    touch("2", "h2", 20, "2026-02-11 12:00:00", "Tubi", "OTT", "2026-02-11 08:00:00"),
    touch("1", "h1", 50, "2026-02-10 12:00:00", "Hulu", "OTT", "2026-02-08 20:00:00"),
  ].join("\n");
  const s = (readReport("touches.csv", text) as TouchReport).summary;
  assert.equal(s.conversions, 2);
  assert.deepEqual(s.paths.map((p) => p.path.join(" > ")).sort(), ["OTT", "OTT > Display"]);
});

test("streaming a touch file in small chunks gives the same summary as reading it whole", async () => {
  const f = fixture("all_touch_sample.csv");
  const whole = readReport(f.name, f.text) as TouchReport;
  const chunks: string[] = [];
  for (let i = 0; i < f.text.length; i += 37) chunks.push(f.text.slice(i, i + 37));
  const streamed = (await readTouchReportStream(f.name, chunks)) as TouchReport;
  assert.deepEqual(streamed.summary, whole.summary);
});

test("streaming a file that is not touch-level stops at the header and says why", async () => {
  const report = await readTouchReportStream("x.csv", ["name,Spend\n", "Hulu,1\n"]);
  assert.equal(report.kind, "unread");
});

test("no household hash appears anywhere in the summary", () => {
  const f = fixture("all_touch_sample.csv");
  const hashes = new Set(f.text.split("\n").slice(1).map((line) => line.split(",")[1]).filter(Boolean));
  const out = JSON.stringify([allTouch(), lastTouch()]);
  for (const hash of hashes) assert.ok(!out.includes(hash));
});
