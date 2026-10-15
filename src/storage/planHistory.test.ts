import assert from "node:assert/strict";
import test from "node:test";
import fs from "fs";
import os from "os";
import path from "path";
import { LocalFileAdapter } from "./localFileAdapter";
import { CHECKPOINT_INTERVAL_MS, MAX_CHECKPOINTS, checkpointBeforeWrite, needsCheckpoint, recordOriginal, versionsToPrune } from "./planHistory";

function freshAdapter(): LocalFileAdapter {
  return new LocalFileAdapter(fs.mkdtempSync(path.join(os.tmpdir(), "plan-history-")));
}

const at = (minutes: number) => new Date(Date.UTC(2026, 9, 15, 12, 0, 0) + minutes * 60_000);

async function planWithEdits(adapter: LocalFileAdapter) {
  const plan = await adapter.createPlan({ title: "Husky Q4", settingsRevision: 3, payload: { profile: { step: 0 } }, actor: "Pat" });
  await recordOriginal(adapter, plan, "Pat", at(0));
  return plan;
}

async function edit(adapter: LocalFileAdapter, id: string, step: number, minute: number, reason: "editing" | "scout" = "editing") {
  await checkpointBeforeWrite(adapter, id, reason, "Pat", { now: at(minute) });
  const current = (await adapter.getPlan(id))!;
  return adapter.updatePlan(id, { title: current.title, settingsRevision: 3, payload: { profile: { step } }, actor: "Pat" }, current.revision);
}

test("auto-saves within 15 minutes of the last checkpoint add no new checkpoint", async () => {
  const adapter = freshAdapter();
  const plan = await planWithEdits(adapter);
  for (let minute = 1; minute <= 14; minute++) await edit(adapter, plan.id, minute, minute);
  const versions = await adapter.listPlanVersions(plan.id);
  assert.deepEqual(versions.map((v) => v.reason), ["original"]);
});

test("a long editing session leaves a checkpoint about every 15 minutes, each holding the plan before that save", async () => {
  const adapter = freshAdapter();
  const plan = await planWithEdits(adapter);
  for (let minute = 1; minute <= 46; minute++) await edit(adapter, plan.id, minute, minute);
  const versions = await adapter.listPlanVersions(plan.id);
  assert.deepEqual(versions.map((v) => v.reason), ["editing", "editing", "editing", "original"]);
  const oldestEditing = await adapter.getPlanVersion(plan.id, versions[2].id);
  // Taken at minute 15, before that save: the plan as minute 14 left it.
  assert.deepEqual(oldestEditing?.payload, { profile: { step: 14 } });
});

test("a big change is always checkpointed first, so it can be undone even mid-session", async () => {
  const adapter = freshAdapter();
  const plan = await planWithEdits(adapter);
  await edit(adapter, plan.id, 1, 1);
  await edit(adapter, plan.id, 2, 2, "scout");
  const versions = await adapter.listPlanVersions(plan.id);
  assert.equal(versions[0].reason, "scout");
  assert.deepEqual((await adapter.getPlanVersion(plan.id, versions[0].id))?.payload, { profile: { step: 1 } });
});

test("a state that is already kept is not checkpointed twice", () => {
  assert.equal(needsCheckpoint({ createdAt: at(0).toISOString(), planRevision: 4 }, 4, "scout", at(60).getTime()), false);
  assert.equal(needsCheckpoint({ createdAt: at(0).toISOString(), planRevision: 4 }, 5, "scout", at(1).getTime()), true);
  assert.equal(needsCheckpoint(undefined, 1, "editing", at(0).getTime()), true);
  assert.equal(needsCheckpoint({ createdAt: at(0).toISOString(), planRevision: 1 }, 2, "editing", at(0).getTime() + CHECKPOINT_INTERVAL_MS - 1), false);
});

test("retention keeps the original and the newest 20, and drops the ones in between", async () => {
  const adapter = freshAdapter();
  const plan = await planWithEdits(adapter);
  for (let i = 1; i <= MAX_CHECKPOINTS + 5; i++) await edit(adapter, plan.id, i, i * 16);
  const versions = await adapter.listPlanVersions(plan.id);
  assert.equal(versions.length, MAX_CHECKPOINTS + 1);
  assert.equal(versions.at(-1)?.reason, "original");
  assert.equal(versions[0].createdAt, at((MAX_CHECKPOINTS + 5) * 16).toISOString());
});

test("pruning nothing until there are more than the original plus the cap", () => {
  const versions = Array.from({ length: MAX_CHECKPOINTS + 1 }, (_, i) => ({ id: `v${i}`, createdAt: at(i).toISOString() }));
  assert.deepEqual(versionsToPrune(versions), []);
  assert.deepEqual(versionsToPrune([...versions, { id: "new", createdAt: at(999).toISOString() }]), ["v1"]);
});

test("a checkpoint that cannot be written never blocks the save", async () => {
  const adapter = freshAdapter();
  const plan = await planWithEdits(adapter);
  adapter.savePlanVersion = async () => { throw new Error("disk full"); };
  await assert.doesNotReject(edit(adapter, plan.id, 1, 30));
  assert.deepEqual((await adapter.getPlan(plan.id))?.payload, { profile: { step: 1 } });
});

test("listing versions never returns their payloads", async () => {
  const adapter = freshAdapter();
  const plan = await planWithEdits(adapter);
  const [summary] = await adapter.listPlanVersions(plan.id);
  assert.equal((summary as any).payload, undefined);
  assert.equal(summary.title, "Husky Q4");
  assert.equal(summary.planRevision, 1);
});
