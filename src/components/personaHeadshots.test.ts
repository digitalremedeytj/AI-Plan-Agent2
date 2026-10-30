import test from "node:test";
import assert from "node:assert/strict";
import type { PersonaAvatarVersion } from "../types";
import { settleAvatarHistory } from "./personaHeadshots";

const toThumbnail = async (url: string) => (url.startsWith("thumb:") ? url : `thumb:${url.slice(0, 3)}`);
const version = (id: string, url: string): PersonaAvatarVersion => ({ id, url, createdAt: "10:00" });

test("only the active headshot is stored full size; other versions become thumbnails", async () => {
  const settled = await settleAvatarHistory(
    "BBB-full-size-image",
    [version("b", "BBB-full-size-image"), version("a", "AAA-full-size-image")],
    toThumbnail,
    new Map(),
  );
  assert.equal(settled.avatarUrl, "BBB-full-size-image");
  assert.deepEqual(settled.avatarHistory.map((v) => v.url), ["BBB-full-size-image", "thumb:AAA"]);
});

test("switching back to a version generated this session restores its full-size image", async () => {
  const fullById = new Map<string, string>();
  const first = await settleAvatarHistory("BBB-full-size-image", [version("b", "BBB-full-size-image"), version("a", "AAA-full-size-image")], toThumbnail, fullById);
  // The modal hands back the thumbnail URL it now holds for version a.
  const second = await settleAvatarHistory("thumb:AAA", first.avatarHistory, toThumbnail, fullById);
  assert.equal(second.avatarUrl, "AAA-full-size-image");
  assert.deepEqual(second.avatarHistory.map((v) => v.url), ["thumb:BBB", "AAA-full-size-image"]);
});

test("a version with no full-size copy this session stays a thumbnail rather than failing", async () => {
  const settled = await settleAvatarHistory("thumb:OLD", [version("x", "thumb:OLD")], toThumbnail, new Map());
  assert.equal(settled.avatarUrl, "thumb:OLD");
  assert.deepEqual(settled.avatarHistory.map((v) => v.url), ["thumb:OLD"]);
});
