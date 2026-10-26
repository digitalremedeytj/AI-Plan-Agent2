import fs from "node:fs";
import path from "node:path";
import { effectiveChannelCount, replayInputsFromRecord, replayMix, sameSelection, type MixSummary } from "./mixReplay";

// Before/after harness for channel selection and allocation.
//
//   npx tsx src/planning/testing/compareChannelMix.ts --save-baseline   # record the current engine
//   npx tsx src/planning/testing/compareChannelMix.ts                   # compare the engine now to it
//
// Reads saved plans from data/store/plans (or --plans <dir> of exported plan records). The
// baseline lives in data/, which is gitignored local state, because it is built from local plans.

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const plansDir = path.resolve(option("--plans") || "data/store/plans");
const baselinePath = path.resolve(option("--baseline") || "data/channel-mix/baseline.json");

const money = (value: number) => `$${Math.round(value).toLocaleString("en-US")}`;
const shares = (mix: MixSummary) => mix.channels.map((channel) => `${channel.name} ${channel.percent}%`).join(", ");
const average = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0);

function aggregate(label: string, mixes: MixSummary[]) {
  const counts = mixes.map((mix) => mix.channels.length);
  return [
    `${label}:`,
    `  media types per plan  ${average(counts).toFixed(1)} (range ${Math.min(...counts)}-${Math.max(...counts)})`,
    `  plans at the cap      ${mixes.filter((mix) => mix.channels.length >= mix.cap).length} of ${mixes.length}`,
    `  top media type share  ${average(mixes.map((mix) => mix.channels[0]?.percent || 0)).toFixed(1)}%`,
    `  effective count       ${average(mixes.map(effectiveChannelCount)).toFixed(1)}  (8 equal shares = 8.0)`,
  ].join("\n");
}

const files = fs.readdirSync(plansDir).filter((file) => file.endsWith(".json")).sort();
const replayed: MixSummary[] = [];
const skipped: string[] = [];
let mismatches = 0;
for (const file of files) {
  const outcome = replayInputsFromRecord(JSON.parse(fs.readFileSync(path.join(plansDir, file), "utf8")));
  // The repo's tsconfig is not strict, so the ok flag alone does not narrow the union.
  if ("reason" in outcome) {
    skipped.push(`  ${outcome.title} - ${outcome.reason}`);
    continue;
  }
  const mix = replayMix(outcome.stored.id, outcome.stored.title, outcome.inputs);
  replayed.push(mix);
  if (flag("--save-baseline") && !sameSelection(mix, outcome.stored)) {
    mismatches += 1;
    console.log(`Replay differs from the saved plan "${mix.title}":\n  saved:    ${shares(outcome.stored)}\n  replayed: ${shares(mix)}`);
  }
}

if (flag("--save-baseline")) {
  fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
  fs.writeFileSync(baselinePath, JSON.stringify({ savedAt: new Date().toISOString(), plans: replayed }, null, 2));
  console.log(`Saved a baseline of ${replayed.length} plans to ${path.relative(process.cwd(), baselinePath)}.`);
  console.log(`${replayed.length - mismatches} of ${replayed.length} replays chose the same media types as the saved plan.`);
  console.log(aggregate("\nBaseline", replayed));
} else {
  if (!fs.existsSync(baselinePath)) {
    console.error(`No baseline at ${baselinePath}. Run with --save-baseline first, on the engine you want to compare against.`);
    process.exit(1);
  }
  const baseline = new Map<string, MixSummary>((JSON.parse(fs.readFileSync(baselinePath, "utf8")).plans as MixSummary[]).map((mix) => [mix.id, mix]));
  const compared = replayed.filter((mix) => baseline.has(mix.id));
  for (const after of compared) {
    const before = baseline.get(after.id)!;
    const dropped = before.channels.filter((channel) => !after.channels.some((other) => other.channelId === channel.channelId)).map((channel) => channel.name);
    const added = after.channels.filter((channel) => !before.channels.some((other) => other.channelId === channel.channelId)).map((channel) => channel.name);
    console.log(`\n${after.title}  (${money(after.budget)}, ${after.flightDays ?? "?"} days, KPI: ${after.primaryKpi}, cap ${after.cap})`);
    console.log(`  before ${before.channels.length}: ${shares(before)}`);
    console.log(`  after  ${after.channels.length}: ${shares(after)}`);
    if (dropped.length || added.length) console.log(`  ${dropped.length ? `dropped ${dropped.join(", ")}` : ""}${dropped.length && added.length ? "; " : ""}${added.length ? `added ${added.join(", ")}` : ""}`);
  }
  console.log(`\n${aggregate("Before", compared.map((mix) => baseline.get(mix.id)!))}\n${aggregate("After", compared)}`);
}
if (skipped.length) console.log(`\nSkipped ${skipped.length} plan(s):\n${skipped.join("\n")}`);
