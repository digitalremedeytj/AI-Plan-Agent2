import assert from "node:assert/strict";
import test from "node:test";
import fs from "fs";
import os from "os";
import path from "path";
import { LocalFileAdapter } from "./localFileAdapter";
import { CampaignTooLargeError, PlanNotFoundError, RevisionConflictError } from "./types";
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

test("a settings record from an older version keeps its catalog edits instead of being reseeded", async () => {
  const adapter = freshAdapter();
  await adapter.getCurrentSettings();

  // Rewrite the stored record as the previous schema version, the way a deploy that
  // adds a settings field leaves it. Reseeding here would discard shared team edits.
  const currentPath = path.join((adapter as any).rootDir, "settings", "current.json");
  const stored = JSON.parse(fs.readFileSync(currentPath, "utf8"));
  stored.settings.products[0].minimumTotalSpend = 99_999;
  delete stored.settings.internalOnly;
  stored.settings.version = 3;
  fs.writeFileSync(currentPath, JSON.stringify(stored));

  const loaded = await adapter.getCurrentSettings();
  assert.equal(loaded.revision, 1, "migrating on read does not burn a revision");
  assert.equal(loaded.settings.products[0].minimumTotalSpend, 99_999);
  assert.deepEqual(loaded.settings.internalOnly, DEFAULT_PLANNING_SETTINGS.internalOnly);
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

test("a plan can be shared and looked up by its secret token", async () => {
  const adapter = freshAdapter();
  const created = await adapter.createPlan({ title: "Shared Campaign", settingsRevision: 1, payload, actor: "tj@dr.com" });

  const token = "sec_testing_long_unguessable_token_1234567890";
  const shared = await adapter.setPlanShare(created.id, true, token);
  assert.equal(shared.isShared, true);
  assert.equal(shared.shareToken, token);

  const found = await adapter.getPlanByShareToken(token);
  assert.ok(found);
  assert.equal(found?.id, created.id);
  assert.equal(found?.title, "Shared Campaign");

  // Revoking makes it immediately unresolvable
  await adapter.setPlanShare(created.id, false);
  const revoked = await adapter.getPlanByShareToken(token);
  assert.equal(revoked, null);
});

test("an archived plan cannot be fetched by share token", async () => {
  const adapter = freshAdapter();
  const created = await adapter.createPlan({ title: "To Be Archived", settingsRevision: 1, payload, actor: "tj@dr.com" });
  const token = "sec_token_for_archived_plan_9876543210";
  await adapter.setPlanShare(created.id, true, token);

  // Archive the plan
  await adapter.archivePlan(created.id, "tj@dr.com");
  const found = await adapter.getPlanByShareToken(token);
  assert.equal(found, null);
});


// --- past campaign performance ---------------------------------------------

const campaignInput = (overrides: Record<string, unknown> = {}) => ({
  advertiserName: "Acme Auto ",
  name: "Feb flight",
  flightStart: "2026-02-09",
  flightEnd: "2026-03-10",
  conversionLabel: "Checkouts",
  campaignGoal: "cpa",
  notes: null,
  linkedPlanIds: ["plan-1", "plan-1"],
  files: [{ id: "f1", fileName: "a.csv", sizeBytes: 3, fingerprint: "x", uploadedAt: "t", uploadedBy: "a", text: "a,b" }],
  actor: "tj",
  ...overrides,
});

test("a campaign is listed by summary only, under its normalised advertiser", async () => {
  const adapter = freshAdapter();
  const created = await adapter.createPerformanceCampaign(campaignInput());
  assert.equal(created.advertiserKey, "acme auto");
  assert.deepEqual(created.linkedPlanIds, ["plan-1"], "a plan is linked once however often it is sent");
  const [summary] = await adapter.listPerformanceCampaigns();
  assert.equal(summary.fileCount, 1);
  assert.equal((summary as any).files, undefined);
  assert.equal((await adapter.getPerformanceCampaign(created.id))?.files[0].text, "a,b");
});

test("a stale campaign revision is rejected instead of clobbering the other upload", async () => {
  const adapter = freshAdapter();
  const created = await adapter.createPerformanceCampaign(campaignInput());
  const updated = await adapter.updatePerformanceCampaign(created.id, campaignInput({ name: "Renamed" }), 1);
  assert.equal(updated.revision, 2);
  assert.equal(updated.createdBy, "tj");
  await assert.rejects(adapter.updatePerformanceCampaign(created.id, campaignInput({ name: "Late" }), 1), RevisionConflictError);
});

test("a campaign too large for one Firestore document is refused in development too", async () => {
  const adapter = freshAdapter();
  const big = [{ id: "f", fileName: "big.csv", sizeBytes: 1, fingerprint: "y", uploadedAt: "t", uploadedBy: "a", text: "x".repeat(950_000) }];
  await assert.rejects(adapter.createPerformanceCampaign(campaignInput({ files: big })), CampaignTooLargeError);
});

test("an archived campaign drops out of the library but is kept", async () => {
  const adapter = freshAdapter();
  const created = await adapter.createPerformanceCampaign(campaignInput());
  await adapter.archivePerformanceCampaign(created.id, "jo");
  assert.equal((await adapter.listPerformanceCampaigns()).length, 0);
  assert.equal((await adapter.listPerformanceCampaigns({ includeArchived: true })).length, 1);
  assert.equal((await adapter.getPerformanceCampaign(created.id))?.files.length, 1);
});

test("the prompt library starts empty, and a stale save is refused instead of overwriting another admin", async () => {
  const adapter = freshAdapter();
  assert.equal(await adapter.getScoutPrompts(), null);
  const prompt = { id: "x", title: "X", category: "Plan review", text: "Ask", needs: [], mode: "plan" as const, featured: false, enabled: true, builtIn: false };
  const first = await adapter.saveScoutPrompts([prompt], "admin-a", 0);
  assert.equal(first.revision, 1);
  await assert.rejects(adapter.saveScoutPrompts([prompt], "admin-b", 0), RevisionConflictError);
  const second = await adapter.saveScoutPrompts([{ ...prompt, title: "Y" }], "admin-b", 1);
  assert.equal(second.revision, 2);
  assert.equal((await adapter.getScoutPrompts())?.prompts[0].title, "Y");
});

test("usage events are read back oldest first, from the requested time onward", async () => {
  const adapter = freshAdapter();
  await adapter.recordUsageEvent({ id: "b", at: "2026-10-02T09:00:00.000Z", actor: "Ana", action: "export", detail: "pdf" });
  await adapter.recordUsageEvent({ id: "a", at: "2026-10-01T09:00:00.000Z", actor: "Ana", action: "login" });
  await adapter.recordUsageEvent({ id: "old", at: "2026-09-30T09:00:00.000Z", actor: "Ana", action: "login" });

  const events = await new LocalFileAdapter((adapter as any).rootDir).listUsageEvents("2026-10-01T00:00:00.000Z");
  assert.deepEqual(events.map((e) => e.id), ["a", "b"]);
  assert.equal(events[1].detail, "pdf");
});

test("a ScoutAI record can be rated and its outcome recorded, and lists newest first", async () => {
  const adapter = freshAdapter();
  const log = (id: string, at: string) => ({
    id, at, expireAt: "2099-01-01T00:00:00.000Z", actor: "Ana", planId: "p1", planRevision: 1, turn: 1,
    promptId: "typed", promptLabel: "Typed question", kind: "plan" as const, ok: true, durationMs: 1000, question: `q ${id}`,
  });
  await adapter.recordScoutLog(log("a", "2026-10-01T10:00:00.000Z"));
  await adapter.recordScoutLog(log("b", "2026-10-02T10:00:00.000Z"));
  await adapter.updateScoutLog("a", { feedback: { rating: "down", comment: "Wrong CPA", by: "Ana", at: "2026-10-01T11:00:00.000Z" } });
  await adapter.updateScoutLog("a", { outcome: { status: "applied", changes: 2, by: "Ana", at: "2026-10-01T11:05:00.000Z" } });

  const stored = await adapter.getScoutLog("a");
  assert.equal(stored?.feedback?.rating, "down");
  assert.equal(stored?.outcome?.status, "applied", "a later update keeps the earlier one");
  assert.deepEqual((await adapter.listScoutLogs({ sinceIso: "2026-09-01T00:00:00.000Z" })).map((l) => l.id), ["b", "a"]);
  assert.equal(await adapter.updateScoutLog("gone", { feedback: undefined }), null);
});

test("expired ScoutAI records are removed on the next write, like Firestore's TTL in production", async () => {
  const adapter = freshAdapter();
  const base = { actor: "Ana", planId: "p1", planRevision: 1, turn: 1, promptId: "typed", promptLabel: "Typed question", kind: "plan" as const, ok: true, durationMs: 1000, question: "q" };
  await adapter.recordScoutLog({ ...base, id: "old", at: "2020-01-01T10:00:00.000Z", expireAt: "2021-01-01T10:00:00.000Z" });
  await adapter.recordScoutLog({ ...base, id: "new", at: new Date().toISOString(), expireAt: "2099-01-01T00:00:00.000Z" });
  assert.equal(await adapter.getScoutLog("old"), null);
  assert.ok(await adapter.getScoutLog("new"));
});
