import assert from "node:assert/strict";
import test from "node:test";
import {
  analyticsIdFor,
  createSessionToken,
  getSession,
  isAdminRequestAllowed,
  isPeopleAdminAllowed,
  parseCookies,
  createStaffDeviceToken,
  sanitizeDisplayName,
  staffViewerName,
  verifySessionToken,
} from "./session";

// The signing key is derived from these when SESSION_SECRET is unset.
delete process.env.SESSION_SECRET;
process.env.TEST_USER = "demo";
process.env.TEST_PASSWORD = "demo-password";

const now = () => Date.now();

test("a signed session round-trips", () => {
  const token = createSessionToken({ name: "TJ Pascal", isAdmin: false, issuedAt: now() });
  const user = verifySessionToken(token);
  assert.equal(user?.name, "TJ Pascal");
  assert.equal(user?.isAdmin, false);
});

test("a tampered payload is rejected", () => {
  const token = createSessionToken({ name: "TJ", isAdmin: false, issuedAt: now() });
  const [payload, signature] = token.split(".");

  // Re-encode the payload with isAdmin flipped, keeping the original signature.
  const forgedPayload = Buffer.from(JSON.stringify({ name: "TJ", isAdmin: true, issuedAt: now() }), "utf-8").toString(
    "base64url",
  );
  assert.equal(verifySessionToken(`${forgedPayload}.${signature}`), null);
  assert.ok(payload, "sanity: token had a payload segment");
});

test("a session signed with a different key is rejected", () => {
  const token = createSessionToken({ name: "TJ", isAdmin: true, issuedAt: now() });
  const original = process.env.TEST_PASSWORD;
  process.env.TEST_PASSWORD = "rotated-password";
  try {
    assert.equal(verifySessionToken(token), null);
  } finally {
    process.env.TEST_PASSWORD = original;
  }
});

test("an expired session is rejected", () => {
  const thirtyOneDaysAgo = Date.now() - 31 * 24 * 60 * 60 * 1000;
  const token = createSessionToken({ name: "TJ", isAdmin: false, issuedAt: thirtyOneDaysAgo });
  assert.equal(verifySessionToken(token), null);
  const twentyNineDaysAgo = Date.now() - 29 * 24 * 60 * 60 * 1000;
  assert.equal(verifySessionToken(createSessionToken({ name: "TJ", isAdmin: false, issuedAt: twentyNineDaysAgo }))?.name, "TJ");
});

test("malformed tokens are rejected without throwing", () => {
  for (const bad of [undefined, "", "no-dot", "a.b", "....", "!!!.???"]) {
    assert.equal(verifySessionToken(bad as any), null, `failed for ${JSON.stringify(bad)}`);
  }
});

test("display names are trimmed, truncated and stripped of control characters", () => {
  assert.equal(sanitizeDisplayName("  TJ Pascal  "), "TJ Pascal");
  assert.equal(sanitizeDisplayName("TJ\u0007\u001BPascal"), "TJPascal");
  assert.equal(sanitizeDisplayName("x".repeat(200)).length, 60);
  assert.equal(sanitizeDisplayName(42), "");
  assert.equal(sanitizeDisplayName(undefined), "");
});

test("cookie parsing handles spacing, encoding and junk segments", () => {
  const jar = parseCookies("apa_session=abc.def; other=1; malformed; name=TJ%20Pascal");
  assert.equal(jar.apa_session, "abc.def");
  assert.equal(jar.other, "1");
  assert.equal(jar.name, "TJ Pascal");
  assert.equal(parseCookies(undefined).apa_session, undefined);
});

test("settings stay writable by everyone until ADMIN_PASSWORD is configured", () => {
  const user = { name: "TJ", isAdmin: false, issuedAt: now() };
  delete process.env.ADMIN_PASSWORD;
  assert.equal(isAdminRequestAllowed(user), true, "no regression before an admin password exists");

  process.env.ADMIN_PASSWORD = "s3cret";
  try {
    assert.equal(isAdminRequestAllowed(user), false, "non-admins are locked out once configured");
    assert.equal(isAdminRequestAllowed({ ...user, isAdmin: true }), true);
    assert.equal(isAdminRequestAllowed(null), false);
  } finally {
    delete process.env.ADMIN_PASSWORD;
  }
});

test("getSession accepts Authorization Bearer header", () => {
  const token = createSessionToken({ name: "TJ Pascal", isAdmin: false, issuedAt: now() });
  const req = { headers: { authorization: `Bearer ${token}` } } as any;
  const user = getSession(req);
  assert.equal(user?.name, "TJ Pascal");
  assert.equal(user?.isAdmin, false);
});

test("getSession accepts x-session-token header", () => {
  const token = createSessionToken({ name: "TJ Pascal", isAdmin: true, issuedAt: now() });
  const req = { headers: { "x-session-token": token } } as any;
  const user = getSession(req);
  assert.equal(user?.name, "TJ Pascal");
  assert.equal(user?.isAdmin, true);
});


test("the analytics id is stable per person, ignores capitalisation, and does not contain the name", () => {
  const id = analyticsIdFor("TJ Pascal");
  assert.equal(id, analyticsIdFor(" tj  pascal "));
  assert.notEqual(id, analyticsIdFor("Ana Smith"));
  assert.ok(!id.toLowerCase().includes("pascal"));
  assert.match(id, /^[0-9a-f]{32}$/);
});

const withCookie = (cookie: string) => ({ headers: { cookie } }) as any;

test("a planner whose session has expired is still recognised on a share link they open", () => {
  const fortyDaysAgo = Date.now() - 40 * 24 * 60 * 60 * 1000;
  const expired = createSessionToken({ name: "Ana", isAdmin: false, issuedAt: fortyDaysAgo });
  const cookie = `apa_session=${expired}; apa_staff=${createStaffDeviceToken("Ana", fortyDaysAgo)}`;
  assert.equal(getSession(withCookie(cookie)), null);
  assert.equal(staffViewerName(withCookie(cookie)), "Ana");
});

test("a browser no planner has signed in on is a client", () => {
  assert.equal(staffViewerName(withCookie("")), null);
  assert.equal(staffViewerName(withCookie("apa_staff=forged.signature")), null);
});

test("the staff mark cannot be used as a session", () => {
  const mark = createStaffDeviceToken("Ana");
  assert.equal(verifySessionToken(mark), null);
  assert.equal(getSession(withCookie(`apa_session=${mark}`)), null);
});

test("a Google sign-in's email survives the session token, and a forged one cannot be added", () => {
  const token = createSessionToken({ name: "TJ Pascal", email: "tpascal@digitalremedy.com", isAdmin: true, issuedAt: now() });
  assert.equal(verifySessionToken(token)?.email, "tpascal@digitalremedy.com");
  const [payload, signature] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ name: "Ana", email: "boss@digitalremedy.com", isAdmin: true, issuedAt: now() })).toString("base64url");
  assert.equal(verifySessionToken(`${forged}.${signature}`), null);
  assert.equal(verifySessionToken(`${payload}.${signature}`)?.name, "TJ Pascal");
});

test("ADMIN_EMAILS alone locks settings to administrators", () => {
  const user = { name: "Ana", isAdmin: false, issuedAt: now() };
  delete process.env.ADMIN_PASSWORD;
  process.env.ADMIN_EMAILS = "tpascal@digitalremedy.com";
  try {
    assert.equal(isAdminRequestAllowed(user), false);
    assert.equal(isAdminRequestAllowed({ ...user, isAdmin: true }), true);
  } finally {
    delete process.env.ADMIN_EMAILS;
  }
});

test("the analytics id for a Google sign-in follows the email, not the display name", () => {
  assert.equal(analyticsIdFor("TJ Pascal", "tpascal@digitalremedy.com"), analyticsIdFor("Tj P.", "TPascal@digitalremedy.com"));
  assert.notEqual(analyticsIdFor("TJ Pascal", "tpascal@digitalremedy.com"), analyticsIdFor("TJ Pascal"));
});

test("an editor may change settings but not manage people; an admin may do both", () => {
  process.env.ADMIN_EMAILS = "tpascal@digitalremedy.com";
  try {
    const editor = { name: "Ana", email: "ana@digitalremedy.com", isAdmin: true, role: "editor" as const, issuedAt: now() };
    assert.equal(isAdminRequestAllowed(editor), true);
    assert.equal(isPeopleAdminAllowed(editor), false);
    assert.equal(isPeopleAdminAllowed({ ...editor, role: "admin" }), true);
    assert.equal(isPeopleAdminAllowed({ ...editor, isAdmin: false, role: "user" }), false);
  } finally {
    delete process.env.ADMIN_EMAILS;
  }
});

test("a session issued before roles existed keeps the access it had", () => {
  assert.equal(verifySessionToken(createSessionToken({ name: "TJ", isAdmin: true, issuedAt: now() }))?.role, "admin");
  assert.equal(verifySessionToken(createSessionToken({ name: "Ana", isAdmin: false, issuedAt: now() }))?.role, "user");
});
