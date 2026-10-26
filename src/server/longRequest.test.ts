import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { holdOpenForLongRequest, sendLongRequestProgress } from "./longRequest";
import { readHeldOpenResult, readHeldOpenText } from "../api/client";

// A route that answers after `delayMs`, like a recap waiting on the model.
async function serve(delayMs: number, status: number, body: unknown) {
  const app = express();
  app.post("/slow", (req, res) => {
    holdOpenForLongRequest(req, res, 20);
    setTimeout(() => res.status(status).json(body), delayMs);
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/slow`, close: () => server.close() };
}

test("a held-open response sends heartbeats while waiting, then the real status and body", async () => {
  const { url, close } = await serve(90, 200, { ok: true });
  try {
    const res = await fetch(url, { method: "POST", headers: { Accept: "application/x-ndjson" } });
    assert.equal(res.headers.get("content-type"), "application/x-ndjson; charset=utf-8");
    const text = await res.text();
    assert.ok(text.split("\n").filter((l) => l.includes("heartbeat")).length >= 2, "heartbeats keep Cloudflare from timing out");
    assert.deepEqual(readHeldOpenResult(text), { status: 200, body: { ok: true } });
  } finally {
    close();
  }
});

test("an error status survives the 200 the held-open response has to start with", async () => {
  const { url, close } = await serve(10, 409, { error: "The plan changed", code: "REVISION_CONFLICT" });
  try {
    const res = await fetch(url, { method: "POST", headers: { Accept: "application/x-ndjson" } });
    assert.equal(res.status, 200);
    assert.deepEqual(readHeldOpenResult(await res.text()), { status: 409, body: { error: "The plan changed", code: "REVISION_CONFLICT" } });
  } finally {
    close();
  }
});

test("a client that does not ask for it gets the plain JSON response as before", async () => {
  const { url, close } = await serve(10, 422, { error: "No campaigns" });
  try {
    const res = await fetch(url, { method: "POST", headers: { Accept: "application/json" } });
    assert.equal(res.status, 422);
    assert.deepEqual(await res.json(), { error: "No campaigns" });
  } finally {
    close();
  }
});

test("a response cut off before its result is reported as missing, not as success", () => {
  assert.equal(readHeldOpenResult('{"type":"heartbeat"}\n{"type":"heartbeat"}\n'), null);
  assert.equal(readHeldOpenResult('{"type":"heartbeat"}\n{"type":"resu'), null);
});

test("progress lines reach the client while the request is still running, and the result still arrives", async () => {
  const app = express();
  app.post("/steps", (req, res) => {
    holdOpenForLongRequest(req, res, 1000);
    sendLongRequestProgress(res, { file: "RFP.pdf", status: "reading" });
    setTimeout(() => sendLongRequestProgress(res, { file: "RFP.pdf", status: "done" }), 20);
    setTimeout(() => res.json({ ok: true }), 60);
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const seen: Array<{ status: string; at: number }> = [];
    const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/steps`, { method: "POST", headers: { Accept: "application/x-ndjson" } });
    const text = await readHeldOpenText(res, (event) => seen.push({ status: event.status, at: Date.now() }));

    assert.deepEqual(seen.map((event) => event.status), ["reading", "done"]);
    assert.deepEqual(readHeldOpenResult(text), { status: 200, body: { ok: true } });
  } finally {
    server.close();
  }
});

test("a plain JSON response has nowhere to put progress, so it is left out", async () => {
  const app = express();
  app.post("/plain", (req, res) => {
    holdOpenForLongRequest(req, res);
    sendLongRequestProgress(res, { file: "RFP.pdf", status: "reading" });
    res.json({ ok: true });
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/plain`, { method: "POST" });
    assert.deepEqual(await res.json(), { ok: true });
  } finally {
    server.close();
  }
});
