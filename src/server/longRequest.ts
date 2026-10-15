import type { Request, Response } from "express";

/**
 * Long JSON requests behind Cloudflare.
 *
 * The custom domain is proxied by Cloudflare, which ends a request with a 524 once the origin
 * has sent nothing for 100 seconds. Plan generation streams progress, so it is safe; a route
 * that answers with one JSON body after several model calls (a campaign recap, a QA audit) is
 * not, and the planner sees a failure even though the server finishes and saves the work.
 *
 * A client that sends "Accept: application/x-ndjson" (longRequest in src/api/client.ts) gets
 * the response held open: headers at once, a heartbeat line every 15s, and the real status and
 * body as the last line. The route's own res.status().json() calls are captured, so its logic
 * is unchanged. A client that does not ask still gets a plain JSON response.
 *
 * The real status is kept in res.locals.finalStatus for anything that reports the outcome.
 */
export function holdOpenForLongRequest(req: Request, res: Response, heartbeatMs = 15000): void {
  if (!String(req.get("accept") || "").includes("application/x-ndjson")) return;
  res.status(200);
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  const beat = setInterval(() => res.write(`{"type":"heartbeat"}\n`), heartbeatMs);
  res.on("close", () => clearInterval(beat));
  res.locals.finalStatus = 200;
  res.status = ((code: number) => {
    res.locals.finalStatus = code;
    return res;
  }) as typeof res.status;
  res.json = ((body: unknown) => {
    clearInterval(beat);
    res.end(`${JSON.stringify({ type: "result", status: res.locals.finalStatus, body })}\n`);
    return res;
  }) as typeof res.json;
}
