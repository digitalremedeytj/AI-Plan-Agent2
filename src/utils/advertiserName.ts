// The brief's Advertiser Name is pre-filled from uploaded plans and RFPs, both from a label scan
// of the file and from the AI's RFP extraction. Either can return a heading instead of a name: a
// form row "Client | Account / Advertiser" scanned as label + value gave "Account / Advertiser".
// A value made only of label words or a placeholder is not a name, so it is not used.

const LABEL_WORDS = new Set([
  "account", "accounts", "advertiser", "advertisers", "agency", "brand", "brands", "business", "client", "clients",
  "company", "customer", "name", "names", "organization", "organisation", "partner", "sponsor", "info", "information",
  "details", "contact", "the", "and", "or", "of", "for", "s",
]);
const PLACEHOLDERS = /^(?:n\/?a|tbd|tbc|none|null|unknown|not (?:specified|provided|applicable|stated)|see (?:above|below|attached)|-+|\?+|x+)$/i;

/** The value as an advertiser name, or "" when it is a field label, a placeholder or not a name. */
export function asAdvertiserName(value: unknown): string {
  const text = String(value ?? "").trim().replace(/^["'“‘]+|["'”’]+$/g, "").replace(/\s+/g, " ").trim();
  if (!text || text.length > 80 || /[:?]$/.test(text) || PLACEHOLDERS.test(text)) return "";
  const words = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (words.length === 0 || words.every((word) => LABEL_WORDS.has(word))) return "";
  return text;
}
