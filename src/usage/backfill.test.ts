import assert from "node:assert/strict";
import test from "node:test";
import fs from "fs";
import os from "os";
import path from "path";
import { LocalFileAdapter } from "../storage/localFileAdapter";
import { backfillUsageFromPlans } from "./backfill";

const profile = { channelStrategy: { mediaPlan: { workingMediaBudget: 100000, channels: [{ channelName: "Search", allocationDollars: 100000 }] } } };

test("history import counts each saved plan once, however often it runs", async () => {
  const store = new LocalFileAdapter(fs.mkdtempSync(path.join(os.tmpdir(), "backfill-")));
  const plan = await store.createPlan({ title: "Acme", advertiserName: "Acme", settingsRevision: 1, payload: { profile }, actor: "Ana" });
  await store.setPlanShare(plan.id, true, "sec_token_for_test_only_000000");
  await store.createPlan({ title: "Empty", settingsRevision: 1, payload: {}, actor: "Ana" });

  const first = await backfillUsageFromPlans(store);
  assert.deepEqual({ generations: first.generations, shares: first.shares }, { generations: 1, shares: 1 });
  const second = await backfillUsageFromPlans(store);
  assert.deepEqual({ generations: second.generations, shares: second.shares }, { generations: 0, shares: 0 });

  const events = await store.listUsageEvents("");
  const generated = events.filter((e) => e.action === "plan_generate");
  assert.equal(generated.length, 1);
  assert.equal(generated[0].actor, "Ana");
  assert.equal(generated[0].budget, 100000);
  assert.deepEqual(generated[0].channels, { Search: 100000 });
});

test("a plan the live log already recorded is not imported again", async () => {
  const store = new LocalFileAdapter(fs.mkdtempSync(path.join(os.tmpdir(), "backfill-")));
  const plan = await store.createPlan({ title: "Acme", settingsRevision: 1, payload: { profile }, actor: "Ana" });
  await store.recordUsageEvent({ id: "live-1", at: plan.createdAt, actor: "Ana", action: "plan_generate", ok: true, planId: plan.id });
  const result = await backfillUsageFromPlans(store);
  assert.equal(result.generations, 0);
});
