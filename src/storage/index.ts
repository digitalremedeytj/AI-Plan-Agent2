import { FirestoreAdapter } from "./firestoreAdapter";
import { LocalFileAdapter } from "./localFileAdapter";
import { resolveProjectId } from "./googleAuth";
import type { StorageAdapter } from "./types";

export * from "./types";
export { LocalFileAdapter } from "./localFileAdapter";
export { FirestoreAdapter } from "./firestoreAdapter";

/**
 * Driver selection, in order:
 *   STORAGE_DRIVER=local     force the on-disk driver (local development)
 *   STORAGE_DRIVER=firestore force Firestore, and fail loudly if it is unreachable
 *   unset                    use Firestore when a GCP project can be resolved,
 *                            otherwise fall back to disk
 *
 * The fallback is what makes `npm run dev` work with no credentials, while a deployed
 * Cloud Run revision picks Firestore up automatically from the metadata server.
 */
export async function createStorage(): Promise<StorageAdapter> {
  const requested = (process.env.STORAGE_DRIVER || "").trim().toLowerCase();

  if (requested === "local") {
    const adapter = new LocalFileAdapter();
    await adapter.init();
    console.log("[STORAGE] Using local-file driver (STORAGE_DRIVER=local).");
    return adapter;
  }

  const projectId = await resolveProjectId();

  if (requested === "firestore") {
    if (!projectId) {
      console.warn(
        "[STORAGE] STORAGE_DRIVER=firestore but no GCP project could be resolved. " +
          "Falling back to local-file driver.",
      );
      const adapter = new LocalFileAdapter();
      await adapter.init();
      return adapter;
    }
    try {
      const adapter = new FirestoreAdapter(projectId);
      await adapter.init();
      console.log(`[STORAGE] Using Firestore driver (project '${projectId}').`);
      return adapter;
    } catch (err: any) {
      console.warn(
        `[STORAGE] Firestore was requested for project '${projectId}' but failed to initialize. ` +
          "Falling back to local-file driver so the application can run. Cause:",
        err?.message || err,
      );
      const adapter = new LocalFileAdapter();
      await adapter.init();
      return adapter;
    }
  }

  if (projectId) {
    try {
      const adapter = new FirestoreAdapter(projectId);
      await adapter.init();
      console.log(`[STORAGE] Using Firestore driver (project '${projectId}', auto-detected).`);
      return adapter;
    } catch (err: any) {
      // A deployed revision should never silently degrade to a disk that will not
      // persist, so make this loud even though we continue.
      console.error(
        "[STORAGE] Firestore was detected but is not usable, falling back to the local-file driver. " +
          "Plans saved now will NOT be shared or survive a restart. Cause:",
        err?.message || err,
      );
    }
  } else {
    console.log("[STORAGE] No GCP project detected; using local-file driver.");
  }

  const adapter = new LocalFileAdapter();
  await adapter.init();
  return adapter;
}
