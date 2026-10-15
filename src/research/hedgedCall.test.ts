import test from "node:test";
import assert from "node:assert/strict";
import { hedge, type HedgeAttempt } from "./hedgedCall";

/** A fake request that answers after `ms`, or fails, and records whether it was aborted. */
function fake(plan: Partial<Record<HedgeAttempt, { ms: number; fail?: boolean }>>, log: string[]) {
  return (attempt: HedgeAttempt, signal: AbortSignal, timeoutMs: number) => new Promise<string>((resolve, reject) => {
    const p = plan[attempt]!;
    log.push(`${attempt} start (${timeoutMs}ms left)`);
    const timer = setTimeout(() => (p.fail ? reject(new Error(`${attempt} failed`)) : resolve(attempt)), Math.min(p.ms, timeoutMs));
    signal.addEventListener("abort", () => { clearTimeout(timer); log.push(`${attempt} aborted`); reject(signal.reason); });
  });
}

test("a primary that answers in time is used, and no backup is started", async () => {
  const log: string[] = [];
  // Wide margins: the suite runs files in parallel, and timers under load fire late.
  const r = await hedge(fake({ primary: { ms: 10 }, backup: { ms: 10 } }, log), { backupAfterMs: 1000, totalMs: 3000 });
  assert.deepEqual([r.winner, r.backupStarted], ["primary", false]);
  assert.equal(log.length, 1, log.join("; "));
  assert.match(log[0], /^primary start \(\d+ms left\)$/);
});

test("a slow primary gets a backup; the first answer wins and the other is cancelled", async () => {
  const log: string[] = [];
  const reasons: string[] = [];
  const r = await hedge(fake({ primary: { ms: 2000 }, backup: { ms: 20 } }, log), { backupAfterMs: 50, totalMs: 3000 }, (why) => reasons.push(why));
  assert.deepEqual([r.value, r.winner, r.backupStarted], ["backup", "backup", true]);
  assert.deepEqual(reasons, ["slow"]);
  assert.ok(log.includes("primary aborted"), "the slow primary is cancelled, not left running");
  const left = Number(log[1].match(/^backup start \((\d+)ms left\)$/)?.[1]);
  assert.ok(left > 0 && left <= 2950, `the backup only gets what is left of the limit (${left}ms)`);
});

test("if the slow primary still answers first, it wins and the backup is cancelled", async () => {
  const log: string[] = [];
  const r = await hedge(fake({ primary: { ms: 50 }, backup: { ms: 500 } }, log), { backupAfterMs: 20, totalMs: 300 });
  assert.equal(r.winner, "primary");
  assert.ok(log.includes("backup aborted"));
});

test("a primary that fails quickly goes straight to the backup", async () => {
  const log: string[] = [];
  const reasons: string[] = [];
  const r = await hedge(fake({ primary: { ms: 5, fail: true }, backup: { ms: 10 } }, log), { backupAfterMs: 1000, totalMs: 2000 }, (why) => reasons.push(why));
  assert.equal(r.winner, "backup");
  assert.deepEqual(reasons, ["failed"]);
});

test("a failure the caller marks as not worth retrying gets no backup", async () => {
  const log: string[] = [];
  const reasons: string[] = [];
  await assert.rejects(
    hedge(fake({ primary: { ms: 10, fail: true }, backup: { ms: 10 } }, log), { backupAfterMs: 1000, totalMs: 3000, backupOnFailure: () => false }, (why) => reasons.push(why)),
    /primary failed/,
  );
  assert.deepEqual(reasons, []);
  assert.ok(!log.some((l) => l.startsWith("backup")), log.join("; "));
});

test("when both fail, the primary's error is reported", async () => {
  const log: string[] = [];
  await assert.rejects(hedge(fake({ primary: { ms: 40, fail: true }, backup: { ms: 10, fail: true } }, log), { backupAfterMs: 20, totalMs: 300 }), /primary failed/);
});

test("nothing outlives the overall limit, even a request that ignores its timeout", async () => {
  const run = () => new Promise<string>(() => {});
  const startedAt = Date.now();
  await assert.rejects(hedge(run, { backupAfterMs: 20, totalMs: 60 }), /timed out after 0s|timed out/);
  assert.ok(Date.now() - startedAt < 200);
});
