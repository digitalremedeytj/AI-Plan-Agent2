/**
 * Firestore REST value encoding.
 *
 * The REST API represents every field as a tagged union ({"stringValue": "x"}), so
 * plain JSON has to be converted in both directions. Large, deeply nested app data
 * (plan payloads, settings) is stored as a single JSON *string* field rather than a
 * Firestore map - that sidesteps Firestore's no-nested-arrays rule and means the
 * storage layer never has to track the app's evolving schema.
 */

export type FirestoreValue = Record<string, unknown>;

export function encodeValue(value: unknown): FirestoreValue {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return { doubleValue: value };
    // Firestore transports 64-bit integers as strings to avoid JS precision loss.
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(encodeValue) } };
  }
  if (typeof value === "object") {
    return { mapValue: { fields: encodeFields(value as Record<string, unknown>) } };
  }
  throw new TypeError(`Cannot encode value of type ${typeof value} for Firestore.`);
}

export function encodeFields(obj: Record<string, unknown>): Record<string, FirestoreValue> {
  const fields: Record<string, FirestoreValue> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue; // omit rather than storing an explicit null
    fields[key] = encodeValue(value);
  }
  return fields;
}

export function decodeValue(value: FirestoreValue | undefined): unknown {
  if (!value) return undefined;
  if ("nullValue" in value) return null;
  if ("stringValue" in value) return value.stringValue as string;
  if ("booleanValue" in value) return value.booleanValue as boolean;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("timestampValue" in value) return value.timestampValue as string;
  if ("arrayValue" in value) {
    const values = (value.arrayValue as any)?.values;
    return Array.isArray(values) ? values.map(decodeValue) : [];
  }
  if ("mapValue" in value) {
    return decodeFields((value.mapValue as any)?.fields || {});
  }
  return undefined;
}

export function decodeFields(fields: Record<string, FirestoreValue>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields || {})) {
    result[key] = decodeValue(value);
  }
  return result;
}
