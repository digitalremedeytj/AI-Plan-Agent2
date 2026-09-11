/**
 * The 50 states plus DC, keyed by USPS code - which is what assets/dma-to-state.csv uses
 * in its state column. Display names and aliases live here because the CSV carries codes
 * only; dmaMarkets.test.ts asserts the two stay in step.
 */
export interface UsState {
  /** USPS code, e.g. "NY". Used as the GeoEntry id for state targeting. */
  code: string;
  name: string;
  /** Extra spellings accepted on input, beyond the name and code themselves. */
  aliases?: string[];
}

export const US_STATES: UsState[] = [
  { code: "AL", name: "Alabama" },
  { code: "AK", name: "Alaska" },
  { code: "AZ", name: "Arizona" },
  { code: "AR", name: "Arkansas" },
  { code: "CA", name: "California", aliases: ["calif"] },
  { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut", aliases: ["conn"] },
  { code: "DE", name: "Delaware" },
  { code: "DC", name: "District of Columbia", aliases: ["washington dc", "washington d.c.", "d.c."] },
  { code: "FL", name: "Florida", aliases: ["fla"] },
  { code: "GA", name: "Georgia" },
  { code: "HI", name: "Hawaii" },
  { code: "ID", name: "Idaho" },
  { code: "IL", name: "Illinois", aliases: ["ill"] },
  { code: "IN", name: "Indiana" },
  { code: "IA", name: "Iowa" },
  { code: "KS", name: "Kansas" },
  { code: "KY", name: "Kentucky" },
  { code: "LA", name: "Louisiana" },
  { code: "ME", name: "Maine" },
  { code: "MD", name: "Maryland" },
  { code: "MA", name: "Massachusetts", aliases: ["mass"] },
  { code: "MI", name: "Michigan" },
  { code: "MN", name: "Minnesota", aliases: ["minn"] },
  { code: "MS", name: "Mississippi" },
  { code: "MO", name: "Missouri" },
  { code: "MT", name: "Montana" },
  { code: "NE", name: "Nebraska" },
  { code: "NV", name: "Nevada" },
  { code: "NH", name: "New Hampshire" },
  { code: "NJ", name: "New Jersey" },
  { code: "NM", name: "New Mexico" },
  { code: "NY", name: "New York" },
  { code: "NC", name: "North Carolina" },
  { code: "ND", name: "North Dakota" },
  { code: "OH", name: "Ohio" },
  { code: "OK", name: "Oklahoma" },
  { code: "OR", name: "Oregon", aliases: ["ore"] },
  { code: "PA", name: "Pennsylvania", aliases: ["penn"] },
  { code: "RI", name: "Rhode Island" },
  { code: "SC", name: "South Carolina" },
  { code: "SD", name: "South Dakota" },
  { code: "TN", name: "Tennessee", aliases: ["tenn"] },
  { code: "TX", name: "Texas", aliases: ["tex"] },
  { code: "UT", name: "Utah" },
  { code: "VT", name: "Vermont" },
  { code: "VA", name: "Virginia" },
  { code: "WA", name: "Washington", aliases: ["wash", "washington state"] },
  { code: "WV", name: "West Virginia" },
  { code: "WI", name: "Wisconsin", aliases: ["wisc"] },
  { code: "WY", name: "Wyoming" },
];

const byCode = new Map(US_STATES.map((state) => [state.code, state]));

export function findStateByCode(code: string): UsState | undefined {
  return byCode.get(code.trim().toUpperCase());
}
