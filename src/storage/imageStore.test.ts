import test from "node:test";
import assert from "node:assert/strict";
import os from "os";
import path from "path";
import { promises as fs } from "fs";
import {
  LocalImageStore,
  createImageStore,
  decodeImageDataUrl,
  imageIdFromUrl,
  imageUrl,
} from "./imageStore";

const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test("a stored headshot comes back byte for byte under the URL the plan keeps", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "images-"));
  const store = new LocalImageStore(dir);
  const image = decodeImageDataUrl(PIXEL)!;
  const id = await store.put(image.bytes, image.contentType);
  assert.equal(imageIdFromUrl(imageUrl(id)), id);
  const read = await store.get(id);
  assert.ok(read);
  assert.deepEqual(read.bytes, image.bytes);
  assert.equal(read.contentType, "image/png");
});

test("an id that could walk out of the image folder is never read", async () => {
  const store = new LocalImageStore(await fs.mkdtemp(path.join(os.tmpdir(), "images-")));
  assert.equal(await store.get("../plans/abc.json"), null);
  assert.equal(imageIdFromUrl("/api/images/../../etc/passwd"), null);
  assert.equal(imageIdFromUrl("https://example.com/a.png"), null);
});

test("only real image data URLs are accepted for storing", () => {
  assert.equal(decodeImageDataUrl("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="), null);
  assert.equal(decodeImageDataUrl("data:text/html;base64,PGgxPg=="), null);
  assert.equal(decodeImageDataUrl("/api/images/x.png"), null);
  assert.equal(decodeImageDataUrl("data:image/jpg;base64,AAAA")?.contentType, "image/jpeg");
});

test("a stored image id cannot be guessed from another", async () => {
  const store = new LocalImageStore(await fs.mkdtemp(path.join(os.tmpdir(), "images-")));
  const image = decodeImageDataUrl(PIXEL)!;
  const [a, b] = [await store.put(image.bytes, image.contentType), await store.put(image.bytes, image.contentType)];
  assert.notEqual(a, b);
  assert.match(a, /^[0-9a-f]{32}\.png$/);
});

test("images go to the bucket exactly when plans go to Firestore", () => {
  const previous = process.env.STORAGE_BUCKET;
  delete process.env.STORAGE_BUCKET;
  try {
    assert.equal(createImageStore("local-file", null).name, "local-file");
    const store = createImageStore("firestore", "ai-api-project-465519") as any;
    assert.equal(store.name, "cloud-storage");
    assert.equal(store.bucket, "ai-api-project-465519.firebasestorage.app");
    process.env.STORAGE_BUCKET = "gs://other-bucket";
    assert.equal((createImageStore("firestore", "p") as any).bucket, "other-bucket");
  } finally {
    if (previous === undefined) delete process.env.STORAGE_BUCKET;
    else process.env.STORAGE_BUCKET = previous;
  }
});
