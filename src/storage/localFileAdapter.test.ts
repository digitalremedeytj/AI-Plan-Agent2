import assert from "node:assert/strict";
import test from "node:test";
import fs from "fs";
import os from "os";
import path from "path";
import { LocalFileAdapter } from "./localFileAdapter";
import { PlanNotFoundError, RevisionConflictError } from "./types";
import { clonePlanningSettings, DEFAULT_PLANNING_SETTINGS } from "../planning/settings";

function freshAdapter(): LocalFileAdapter {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plan-store-"));
  return new LocalFileAdapter(dir);
}

const payload = { audienceDescription: "Gamers in the US", profile: { personas: [] } };

test("a created plan is visible to a different reader with server-assigned metadata", async () => {
  const adapter = freshAdapter();
  await adapter.createPlan({ title: "Razer Q1", settingsRevision: 1, payload, actor: "tj@digitalremedy.com" });

  // A second adapter over the same directory stands in for another instance/user.
  const other = new LocalFileAdapter((adapter as any).rootDir);
  const plans = await other.listPlans();

  assert.equal(plans.length, 1);
  assert.equal(plans[0].title, "Razer Q1");
  assert.equal(plans[0].createdBy, "tj@digitalremedy.com");
  assert.equal(plans[0].revision, 1);
  assert.equal(plans[0].archived, false);
});

test("listing returns summaries only, never plan payloads", async () => {
  const adapter = freshAdapter();
  await adapter.createPlan({ title: "Heavy", settingsRevision: 1, payload, actor: "a@x.com" });
  const [summary] = await adapter.listPlans();
  assert.equal((summary as any).payload, undefined);
});

test("update bumps the revision and records the editor", async () => {
  const adapter = freshAdapter();
  const created = await adapter.createPlan({ title: "v1", settingsRevision: 1, payload, actor: "a@x.com" });

  const updated = await adapter.updatePlan(
    created.id,
    { title: "v2", settingsRevision: 2, payload: { ...payload, url: "https://razer.com" }, actor: "b@x.com" },
    created.revision,
  );

  assert.equal(updated.revision, 2);
  assert.equal(updated.title, "v2");
  assert.equal(updated.updatedBy, "b@x.com");
  assert.equal(updated.createdBy, "a@x.com", "original author is preserved");
  assert.equal((updated.payload as any).url, "https://razer.com");
});

test("a stale revision is rejected instead of clobbering the other writer", async () => {
  const adapter = freshAdapter();
  const created = await adapter.createPlan({ title: "v1", settingsRevision: 1, payload, actor: "a@x.com" });

  await adapter.updatePlan(created.id, { title: "from-A", settingsRevision: 1, payload, actor: "a@x.com" }, 1);

  await assert.rejects(
    () => adapter.updatePlan(created.id, { title: "from-B", settingsRevision: 1, payload, actor: "b@x.com" }, 1),
    (err: unknown) => err instanceof RevisionConflictError && err.currentRevision === 2,
  );

  const stored = await adapter.getPlan(created.id);
  assert.equal(stored?.title, "from-A", "the first writer's change survives");
});

test("archiving hides a plan from the default listing but never destroys it", async () => {
  const adapter = freshAdapter();
  const created = await adapter.createPlan({ title: "Doomed", settingsRevision: 1, payload, actor: "a@x.com" });

  await adapter.archivePlan(created.id, "b@x.com");
  assert.equal((await adapter.listPlans()).length, 0);
  assert.equal((await adapter.listPlans({ includeArchived: true })).length, 1);
  assert.ok(await adapter.getPlan(created.id), "the record is still retrievable");

  await adapter.restorePlan(created.id, "b@x.com");
  assert.equal((await adapter.listPlans()).length, 1);
});

test("updating a missing plan reports not-found rather than creating one", async () => {
  const adapter = freshAdapter();
  await assert.rejects(
    () => adapter.updatePlan("does-not-exist", { title: "x", settingsRevision: null, payload, actor: "a@x.com" }, 1),
    (err: unknown) => err instanceof PlanNotFoundError,
  );
});

test("a crafted plan id cannot escape the plans directory", async () => {
  const adapter = freshAdapter();
  const escaped = await adapter.getPlan("../../../../etc/passwd");
  assert.equal(escaped, null);
});

test("settings writes are versioned and old revisions stay readable", async () => {
  const adapter = freshAdapter();
  const first = await adapter.getCurrentSettings();
  assert.equal(first.revision, 1);

  const changed = clonePlanningSettings(DEFAULT_PLANNING_SETTINGS);
  changed.products[0].recommendationEligible = !changed.products[0].recommendationEligible;
  const second = await adapter.saveSettings(changed, "admin@x.com");

  assert.equal(second.revision, 2);
  assert.equal(second.updatedBy, "admin@x.com");
  assert.equal((await adapter.getCurrentSettings()).revision, 2);

  const historical = await adapter.getSettingsRevision(1);
  assert.ok(historical, "revision 1 is still retrievable for plans that reference it");
  assert.equal(
    historical!.settings.products[0].recommendationEligible,
    DEFAULT_PLANNING_SETTINGS.products[0].recommendationEligible,
    "the old revision is unaffected by the newer save",
  );
});

test("invalid settings are rejected without advancing the revision", async () => {
  const adapter = freshAdapter();
  await adapter.getCurrentSettings();
  await assert.rejects(() => adapter.saveSettings({ bogus: true } as any, "admin@x.com"));
  assert.equal((await adapter.getCurrentSettings()).revision, 1);
});

test("publishers seed from defaults and version on save", async () => {
  const adapter = freshAdapter();
  const seeded = await adapter.getCurrentPublishers();
  assert.equal(seeded.revision, 1);
  assert.ok(seeded.publishers.length > 0);

  const next = await adapter.savePublishers(seeded.publishers.slice(0, 5), "admin@x.com");
  assert.equal(next.revision, 2);
  assert.equal(next.publishers.length, 5);
});
