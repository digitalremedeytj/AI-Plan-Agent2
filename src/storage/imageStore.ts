import crypto from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { getAccessToken } from "./googleAuth";

/**
 * Image files (persona headshots) kept outside the plan document. A plan is one Firestore
 * document (1MB), so headshots stored in it as data URLs had to be shrunk to 384px and their
 * history to thumbnails. The plan now holds a short /api/images/<id> URL instead.
 *
 * Production writes to a Cloud Storage bucket (the project's Firebase Storage bucket) over the
 * JSON API with the same service-account token as Firestore, so no SDK is added. Development
 * writes to data/store/images/, for the same reason the plan store does: nothing to configure.
 *
 * Images are immutable: an edit makes a new image, never overwrites one. That is what lets the
 * browser cache them forever and lets version history point at old ones safely.
 */

export interface StoredImage {
  bytes: Buffer;
  contentType: string;
}

export interface ImageStore {
  readonly name: string;
  put(bytes: Buffer, contentType: string): Promise<string>;
  get(id: string): Promise<StoredImage | null>;
}

export const IMAGE_URL_PREFIX = "/api/images/";
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const EXTENSIONS: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const CONTENT_TYPES: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };
// The id is the access check, as in a Firebase Storage download URL: the app signs requests with
// a header token an <img> cannot send, so image reads carry no session. 128 random bits cannot be
// guessed, and an id only reaches people who can open a plan showing that image (a share link
// carries no hidden headshot and no old version). It is also a file and object name, so nothing
// but hex and the extension may reach it.
const ID_PATTERN = /^[0-9a-f]{32}\.(jpg|png|webp)$/;

export function isImageId(id: string): boolean {
  return ID_PATTERN.test(id);
}

export function newImageId(contentType: string): string | null {
  const ext = EXTENSIONS[contentType.toLowerCase()];
  return ext ? `${crypto.randomBytes(16).toString("hex")}.${ext}` : null;
}

export function contentTypeOf(id: string): string {
  return CONTENT_TYPES[id.split(".").pop() || ""] || "application/octet-stream";
}

export function imageUrl(id: string): string {
  return `${IMAGE_URL_PREFIX}${id}`;
}

/** The image id in a stored-image URL. Null for anything else. */
export function imageIdFromUrl(url: unknown): string | null {
  if (typeof url !== "string" || !url.startsWith(IMAGE_URL_PREFIX)) return null;
  const id = url.slice(IMAGE_URL_PREFIX.length).split("?")[0];
  return isImageId(id) ? id : null;
}

/** Decodes a data:image/...;base64 URL. Null for anything else, or an unsupported image type. */
export function decodeImageDataUrl(url: unknown): StoredImage | null {
  if (typeof url !== "string") return null;
  const match = /^data:(image\/[a-z+.-]+);base64,(.+)$/i.exec(url);
  if (!match) return null;
  const contentType = match[1].toLowerCase() === "image/jpg" ? "image/jpeg" : match[1].toLowerCase();
  if (!EXTENSIONS[contentType]) return null;
  return { bytes: Buffer.from(match[2], "base64"), contentType };
}

export class LocalImageStore implements ImageStore {
  readonly name = "local-file";
  constructor(private readonly dir: string = path.join(process.cwd(), "data", "store", "images")) {}

  async put(bytes: Buffer, contentType: string): Promise<string> {
    const id = newImageId(contentType);
    if (!id) throw new Error(`Unsupported image type: ${contentType}`);
    await fs.mkdir(this.dir, { recursive: true });
    await fs.writeFile(path.join(this.dir, id), bytes);
    return id;
  }

  async get(id: string): Promise<StoredImage | null> {
    if (!isImageId(id)) return null;
    try {
      return { bytes: await fs.readFile(path.join(this.dir, id)), contentType: contentTypeOf(id) };
    } catch (err: any) {
      if (err?.code === "ENOENT") return null;
      throw err;
    }
  }
}

export class CloudStorageImageStore implements ImageStore {
  readonly name = "cloud-storage";
  constructor(readonly bucket: string, private readonly prefix = "images/") {}

  async put(bytes: Buffer, contentType: string): Promise<string> {
    const id = newImageId(contentType);
    if (!id) throw new Error(`Unsupported image type: ${contentType}`);
    const url = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(this.bucket)}/o?uploadType=media&name=${encodeURIComponent(this.prefix + id)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${await getAccessToken()}`, "Content-Type": contentType },
      body: bytes,
    });
    if (!res.ok) {
      throw new Error(
        `Cloud Storage upload to '${this.bucket}' failed (${res.status}): ${(await res.text()).slice(0, 300)}. ` +
          "The runtime service account needs Storage Object Admin on the bucket.",
      );
    }
    return id;
  }

  async get(id: string): Promise<StoredImage | null> {
    if (!isImageId(id)) return null;
    const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(this.bucket)}/o/${encodeURIComponent(this.prefix + id)}?alt=media`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${await getAccessToken()}` } });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Cloud Storage read from '${this.bucket}' failed (${res.status}).`);
    return { bytes: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get("content-type") || contentTypeOf(id) };
  }
}

/**
 * Follows the plan store: images go to the bucket exactly when plans go to Firestore, so a
 * deployed plan never points at an image left on one instance's disk. STORAGE_BUCKET overrides
 * the project's default Firebase Storage bucket.
 */
export function createImageStore(storageDriver: string, projectId: string | null): ImageStore {
  if (storageDriver === "firestore" && projectId) {
    const bucket = (process.env.STORAGE_BUCKET || "").trim().replace(/^gs:\/\//, "") || `${projectId}.firebasestorage.app`;
    console.log(`[IMAGES] Using Cloud Storage bucket '${bucket}'.`);
    return new CloudStorageImageStore(bucket);
  }
  console.log("[IMAGES] Using local-file image store (data/store/images).");
  return new LocalImageStore();
}
