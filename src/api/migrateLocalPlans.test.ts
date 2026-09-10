import assert from "node:assert/strict";
import test from "node:test";
import {
  LEGACY_BACKUP_KEY,
  LEGACY_PLANS_KEY,
  MIGRATION_FLAG_KEY,
  migrateLocalPlans,
  readLegacyPlans,
  toCreateInput,
} from "./migrateLocalPlans";
import type { SavedProfile } from "../types";

/** Minimal in-memory Storage stand-in; jsdom is not part of this project's test setup. */
function makeStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(seed));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  } as Storage;
}

const plan = (id: string, title: string): SavedProfile =>
  ({
    id,
    savedAt: "9/1/2026, 10:00:00 AM",
    title,
    advertiserName: "Razer",
    audienceDescription: "Gamers in the US",
    url: "https://razer.com",
    geography: "United States",
    campaignFocus: "CTV-first",
    additionalContext: "",
    profile: { personas: [] },
  }) as unknown as SavedProfile;

test("legacy metadata is lifted out of the payload the server stores", () => {
  const input = toCreateInput(plan("local-1", "  Razer Q1  "), 7);
  assert.equal(input.title, "Razer Q1");
  assert.equal(input.advertiserName, "Razer");
  assert.equal(input.settingsRevision, 7);
  assert.equal((input.payload as any).id, undefined, "the browser-generated id is dropped");
  assert.equal((input.payload as any).savedAt, undefined);
  assert.equal((input.payload as any).title, undefined);
  assert.equal((input.payload as any).audienceDescription, "Gamers in the US", "plan body survives");
});

test("every local plan is uploaded, oldest first, and the flag is set", async () => {
  // Legacy storage is newest-first, so uploading in reverse restores save order.
  const storage = makeStorage({ [LEGACY_PLANS_KEY]: JSON.stringify([plan("b", "Newer"), plan("a", "Older")]) });
  const uploaded: string[] = [];

  const result = await migrateLocalPlans(storage, async (input) => {
    uploaded.push(input.title);
    return { id: input.title } as any;
  }, 3);

  assert.deepEqual(uploaded, ["Older", "Newer"]);
  assert.equal(result.migrated, 2);
  assert.equal(result.failed, 0);
  assert.equal(storage.getItem(MIGRATION_FLAG_KEY), "true");
  assert.ok(storage.getItem(LEGACY_BACKUP_KEY), "the original entry is backed up, not deleted");
  assert.ok(storage.getItem(LEGACY_PLANS_KEY), "the original entry is left in place");
});

test("migration runs only once per browser", async () => {
  const storage = makeStorage({
    [LEGACY_PLANS_KEY]: JSON.stringify([plan("a", "One")]),
    [MIGRATION_FLAG_KEY]: "true",
  });
  let calls = 0;
  const result = await migrateLocalPlans(storage, async () => {
    calls += 1;
    return {} as any;
  }, 1);

  assert.equal(calls, 0);
  assert.equal(result.skipped, true);
});

test("a failed upload leaves the flag unset so the user can retry", async () => {
  const storage = makeStorage({ [LEGACY_PLANS_KEY]: JSON.stringify([plan("a", "One"), plan("b", "Two")]) });

  const result = await migrateLocalPlans(storage, async (input) => {
    if (input.title === "Two") throw new Error("network down");
    return {} as any;
  }, 1);

  assert.equal(result.migrated, 1);
  assert.equal(result.failed, 1);
  assert.match(result.errors[0], /network down/);
  assert.equal(storage.getItem(MIGRATION_FLAG_KEY), null, "not marked done, so it retries next load");
});

test("an empty or corrupt legacy entry is handled without throwing", async () => {
  assert.deepEqual(readLegacyPlans(makeStorage({ [LEGACY_PLANS_KEY]: "{not json" })), []);
  assert.deepEqual(readLegacyPlans(makeStorage()), []);

  const storage = makeStorage();
  const result = await migrateLocalPlans(storage, async () => {
    throw new Error("should not be called");
  }, null);
  assert.equal(result.skipped, true);
  assert.equal(storage.getItem(MIGRATION_FLAG_KEY), "true");
});
