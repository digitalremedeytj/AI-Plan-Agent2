// A slow call gets a backup instead of a longer wait. Research dossiers run at high thinking with
// search grounding; on slow days one of the four would run past its limit (90s, then 150s) and
// the plan shipped with that topic empty. Raising the limit again would come out of the
// narrative and QA stages' time. Instead, once the first request has run `backupAfterMs` without
// an answer, a second, cheaper request for the same work starts beside it; whichever answers
// first wins and the other is cancelled. The overall limit does not move.

export type HedgeAttempt = "primary" | "backup";

export interface HedgeOptions {
  /** Start the backup if the primary has not answered by now. */
  backupAfterMs: number;
  /** Nothing runs past this, counted from the start. */
  totalMs: number;
}

export interface HedgeResult<T> {
  value: T;
  winner: HedgeAttempt;
  /** Whether the backup request was started at all. */
  backupStarted: boolean;
}

/**
 * Runs `run("primary", ...)`, and `run("backup", ...)` if the primary is slow or fails early.
 * Each call gets an abort signal and the time it may take; the loser is aborted. Rejects only
 * when both fail (or the primary fails with no time left for a backup), with the primary's error.
 */
export function hedge<T>(
  run: (attempt: HedgeAttempt, signal: AbortSignal, timeoutMs: number) => Promise<T>,
  { backupAfterMs, totalMs }: HedgeOptions,
  onBackup?: (reason: "slow" | "failed") => void,
): Promise<HedgeResult<T>> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const controllers: Partial<Record<HedgeAttempt, AbortController>> = {};
    const errors: Partial<Record<HedgeAttempt, unknown>> = {};
    let settled = false;
    let backupStarted = false;

    const finish = (outcome: { value: T; winner: HedgeAttempt } | { error: unknown }) => {
      if (settled) return;
      settled = true;
      clearTimeout(backupTimer);
      clearTimeout(deadline);
      const winner = "winner" in outcome ? outcome.winner : null;
      for (const [attempt, controller] of Object.entries(controllers)) if (attempt !== winner) controller?.abort(new Error("Superseded by the other request."));
      if ("error" in outcome) reject(outcome.error);
      else resolve({ ...outcome, backupStarted });
    };

    const start = (attempt: HedgeAttempt) => {
      const remaining = totalMs - (Date.now() - startedAt);
      if (remaining <= 0) return false;
      const controller = new AbortController();
      controllers[attempt] = controller;
      run(attempt, controller.signal, remaining).then(
        (value) => finish({ value, winner: attempt }),
        (error) => {
          errors[attempt] = error;
          if (attempt === "primary" && !backupStarted) {
            // A quick failure (a 5xx, a dropped connection) goes straight to the backup.
            if (startBackup("failed")) return;
            finish({ error });
          } else if ((attempt === "primary" ? errors.backup : errors.primary) !== undefined) {
            // Both have failed.
            finish({ error: errors.primary ?? error });
          }
        },
      );
      return true;
    };

    const startBackup = (reason: "slow" | "failed") => {
      if (backupStarted || settled) return false;
      backupStarted = true;
      clearTimeout(backupTimer);
      onBackup?.(reason);
      return start("backup");
    };

    const backupTimer = setTimeout(() => startBackup("slow"), backupAfterMs);
    // Each request has its own timeout; this is the guarantee that nothing outlives the limit.
    const deadline = setTimeout(() => finish({ error: errors.primary ?? new Error(`timed out after ${Math.round(totalMs / 1000)}s`) }), totalMs);
    start("primary");
  });
}
