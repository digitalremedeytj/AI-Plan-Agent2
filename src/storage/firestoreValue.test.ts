import assert from "node:assert/strict";
import test from "node:test";
import { decodeFields, decodeValue, encodeFields, encodeValue } from "./firestoreValue";

test("scalars round-trip through the Firestore value encoding", () => {
  const cases: unknown[] = ["hello", "", true, false, 0, 42, -7, 3.5, null];
  for (const value of cases) {
    assert.deepEqual(decodeValue(encodeValue(value)), value, `failed for ${JSON.stringify(value)}`);
  }
});

test("integers are transported as strings, doubles as numbers", () => {
  assert.deepEqual(encodeValue(42), { integerValue: "42" });
  assert.deepEqual(encodeValue(3.5), { doubleValue: 3.5 });
  assert.equal(decodeValue({ integerValue: "9007199254740" }), 9007199254740);
});

test("nested maps and arrays round-trip", () => {
  const value = { a: [1, "two", { b: true }], c: { d: { e: null } } };
  assert.deepEqual(decodeFields(encodeFields(value)), value);
});

test("undefined fields are omitted rather than written as null", () => {
  const fields = encodeFields({ present: "yes", absent: undefined });
  assert.deepEqual(Object.keys(fields), ["present"]);
});

test("a plan payload survives as a JSON string field", () => {
  // This is how plan payloads are actually stored - nested arrays would be illegal
  // as native Firestore values, so they go over as one JSON string.
  const payload = { chart: [[1, 2], [3, 4]], personas: [{ name: "A" }] };
  const fields = encodeFields({ id: "p1", payloadJson: JSON.stringify(payload) });
  const decoded = decodeFields(fields) as any;
  assert.deepEqual(JSON.parse(decoded.payloadJson), payload);
});

test("timestamp values decode to their ISO string", () => {
  assert.equal(decodeValue({ timestampValue: "2026-09-10T12:00:00Z" }), "2026-09-10T12:00:00Z");
});
