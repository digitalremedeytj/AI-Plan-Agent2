import crypto from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { getAccessToken } from "./googleAuth";

/**
 * The original partner research files (PDF, Word, Excel, CSV, images), kept so a reviewer can
 * check a fact against its source and so the library can be re-read later. They live where
 * persona images do (imageStore.ts): the project's Cloud Storage bucket when plans are in
 * Firestore, data/store/research-files/ otherwise. Never the container disk in production.
 *
 * Unlike images, these are read only through an authenticated route: they are licensed data,
 * and some were prepared for a specific client.
 */

export interface StoredResearchFile {
  bytes: Buffer;
  contentType: string;
}

export interface ResearchFileStore {
  readonly name: string;
  put(bytes: Buffer, fileName: string): Promise<string>;
  get(id: string): Promise<StoredResearchFile | null>;
}

const CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  txt: "text/plain",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};
// The id is also an object and file name, so only hex and a known extension may reach it.
const ID_PATTERN = /^[0-9a-f]{32}\.(pdf|docx?|xlsx?|csv|txt|png|jpe?g|webp)$/;

export const isResearchFileId = (id: string) => ID_PATTERN.test(id);
export const researchContentType = (fileNameOrId: string) => CONTENT_TYPES[fileNameOrId.split(".").pop()?.toLowerCase() || ""] || "application/octet-stream";

export function newResearchFileId(fileName: string): string | null {
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  return CONTENT_TYPES[ext] ? `${crypto.randomBytes(16).toString("hex")}.${ext}` : null;
}

export class LocalResearchFileStore implements ResearchFileStore {
  readonly name = "local-file";
  constructor(private readonly dir: string = path.join(process.cwd(), "data", "store", "research-files")) {}

  async put(bytes: Buffer, fileName: string): Promise<string> {
    const id = newResearchFileId(fileName);
    if (!id) throw new Error(`Unsupported research file type: ${fileName}`);
    await fs.mkdir(this.dir, { recursive: true });
    await fs.writeFile(path.join(this.dir, id), bytes);
    return id;
  }

  async get(id: string): Promise<StoredResearchFile | null> {
    if (!isResearchFileId(id)) return null;
    try {
      return { bytes: await fs.readFile(path.join(this.dir, id)), contentType: researchContentType(id) };
    } catch (err: any) {
      if (err?.code === "ENOENT") return null;
      throw err;
    }
  }
}

export class CloudStorageResearchFileStore implements ResearchFileStore {
  readonly name = "cloud-storage";
  constructor(readonly bucket: string, private readonly prefix = "research/") {}

  async put(bytes: Buffer, fileName: string): Promise<string> {
    const id = newResearchFileId(fileName);
    if (!id) throw new Error(`Unsupported research file type: ${fileName}`);
    const url = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(this.bucket)}/o?uploadType=media&name=${encodeURIComponent(this.prefix + id)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${await getAccessToken()}`, "Content-Type": researchContentType(id) },
      body: bytes,
    });
    if (!res.ok) {
      throw new Error(`Cloud Storage upload to '${this.bucket}' failed (${res.status}): ${(await res.text()).slice(0, 300)}.`);
    }
    return id;
  }

  async get(id: string): Promise<StoredResearchFile | null> {
    if (!isResearchFileId(id)) return null;
    const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(this.bucket)}/o/${encodeURIComponent(this.prefix + id)}?alt=media`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${await getAccessToken()}` } });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Cloud Storage read from '${this.bucket}' failed (${res.status}).`);
    return { bytes: Buffer.from(await res.arrayBuffer()), contentType: researchContentType(id) };
  }
}

/** Follows the image store's choice of bucket, so both kinds of file land in the same place. */
export function createResearchFileStore(storageDriver: string, projectId: string | null): ResearchFileStore {
  if (storageDriver === "firestore" && projectId) {
    const bucket = (process.env.STORAGE_BUCKET || "").trim().replace(/^gs:\/\//, "") || `${projectId}.firebasestorage.app`;
    return new CloudStorageResearchFileStore(bucket);
  }
  return new LocalResearchFileStore();
}
