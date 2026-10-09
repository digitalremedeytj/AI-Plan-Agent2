// The brief's Website URL is pre-filled from uploaded plans and RFPs, both from a label scan of
// the file ("Website: ...") and from the AI's RFP extraction. Either can hand back text that sits
// next to a URL-ish label without being one (a creative spec row gave "Max File Size for HTML"),
// so a value is only used when it reads as a web address.

const DOMAIN = /^(?:https?:\/\/)?(?:www\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}(?::\d{2,5})?(?:[/?#]\S*)?$/i;

/** The value as a website URL, or "" when it is not one. */
export function asWebsiteUrl(value: unknown): string {
  const text = String(value ?? "").trim().replace(/^[<(]+/, "").replace(/[.,;)>]+$/, "");
  if (!text || /\s/.test(text) || /@/.test(text.split(/[/?#]/)[0])) return "";
  return DOMAIN.test(text) ? text : "";
}
