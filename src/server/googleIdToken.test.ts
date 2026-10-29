import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { GoogleTokenError, verifyGoogleIdToken } from "./googleIdToken";

const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const { privateKey: strangerKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });

const CLIENT_ID = "123.apps.googleusercontent.com";
const NOW = 1_800_000_000;
const options = { clientId: CLIENT_ID, allowedDomains: ["digitalremedy.com"], nowSeconds: NOW, getKey: async (kid: string) => (kid === "k1" ? publicKey : null) };

function token(claims: Record<string, unknown>, { key = privateKey, kid = "k1" } = {}) {
  const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const body = `${enc({ alg: "RS256", kid, typ: "JWT" })}.${enc({
    iss: "https://accounts.google.com",
    aud: CLIENT_ID,
    exp: NOW + 600,
    email: "ana@digitalremedy.com",
    email_verified: true,
    hd: "digitalremedy.com",
    name: "Ana Smith",
    ...claims,
  })}`;
  return `${body}.${crypto.sign("RSA-SHA256", Buffer.from(body), key).toString("base64url")}`;
}

test("a Digital Remedy Google account signs in as its email and Google name", async () => {
  assert.deepEqual(await verifyGoogleIdToken(token({ email: "Ana@DigitalRemedy.com" }), options), { email: "ana@digitalremedy.com", name: "Ana Smith", domain: "digitalremedy.com" });
});

test("a personal Gmail account is refused, even with a verified email", async () => {
  await assert.rejects(verifyGoogleIdToken(token({ email: "ana@gmail.com", hd: undefined }), options), GoogleTokenError);
});

test("another company's Workspace account is refused", async () => {
  await assert.rejects(verifyGoogleIdToken(token({ email: "ana@other.com", hd: "other.com" }), options), GoogleTokenError);
});

test("an hd claim that does not match the email's domain is refused", async () => {
  await assert.rejects(verifyGoogleIdToken(token({ email: "ana@gmail.com", hd: "digitalremedy.com" }), options), GoogleTokenError);
});

test("a token minted for a different OAuth client cannot be replayed here", async () => {
  await assert.rejects(verifyGoogleIdToken(token({ aud: "someone-else.apps.googleusercontent.com" }), options), GoogleTokenError);
});

test("an expired token is refused", async () => {
  await assert.rejects(verifyGoogleIdToken(token({ exp: NOW - 3600 }), options), GoogleTokenError);
});

test("a token signed by anyone but Google is refused", async () => {
  await assert.rejects(verifyGoogleIdToken(token({}, { key: strangerKey }), options), /signature/);
  await assert.rejects(verifyGoogleIdToken(token({}, { kid: "unknown" }), options), /unknown key/);
});

test("an edited claim breaks the signature", async () => {
  const [header, , signature] = token({}).split(".");
  const forged = Buffer.from(JSON.stringify({ iss: "accounts.google.com", aud: CLIENT_ID, exp: NOW + 600, email: "boss@digitalremedy.com", email_verified: true, hd: "digitalremedy.com" })).toString("base64url");
  await assert.rejects(verifyGoogleIdToken(`${header}.${forged}.${signature}`, options), /signature/);
});

test("an unverified email address is refused", async () => {
  await assert.rejects(verifyGoogleIdToken(token({ email_verified: false }), options), GoogleTokenError);
});
