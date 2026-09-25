import test from "node:test";
import assert from "node:assert/strict";
import type { ExecutiveBrief } from "./executiveBrief";
import {
  SLIDE_WORD_BUDGET,
  buildBriefSlides,
  buildGoogleSlidesPrompt,
  buildSlideImagePrompt,
  countWords,
  normalizeProofread,
} from "./executiveBriefSlides";

const bullets = (n: number, words = 14) =>
  Array.from({ length: n }, (_, i) => ({ lead: `Point ${i + 1}`, text: Array.from({ length: words }, (_, w) => `word${w}`).join(" ") + "." }));

function brief(overrides: Partial<ExecutiveBrief> = {}): ExecutiveBrief {
  return {
    version: 1,
    generatedAt: "2026-09-23T00:00:00.000Z",
    inputFingerprint: "x",
    plannerNotes: ["Internal: check the 73% figure."],
    sections: [
      { key: "understanding", headline: "Acme needs online sales from premium dog owners.", bullets: bullets(3) },
      { key: "strategicPov", headline: "Evening CTV primes, search captures.", bullets: bullets(3) },
      {
        key: "audience", headline: "Purchase data finds real premium buyers.", bullets: bullets(3),
        audienceMatches: [{ audience: "Premium dog owners", reachedWith: ["Premium Pet Food Buyers"], why: "Proven spend." }],
      },
      {
        key: "media", headline: "Two channels, one story.", bullets: bullets(2),
        channels: [
          { channelId: "search", channelName: "Google Search", allocationPercent: 40, funnelRole: "Conversion", role: "Captures demand." },
          { channelId: "ctv", channelName: "CTV", allocationPercent: 60, funnelRole: "Awareness", role: "Builds reach." },
        ],
      },
      {
        key: "measurement", headline: "We prove net-new sales.", bullets: bullets(2),
        measurement: [
          { capability: "LeadMatch", advanced: false, proves: "Exposure to sale.", kpi: "Online sales" },
          { capability: "Incrementality", advanced: true, proves: "Net-new sales.", kpi: "Online sales" },
        ],
      },
    ],
    ...overrides,
  };
}

const context = { advertiserName: "Acme Pets", geography: "National", livePercents: { ctv: 55, search: 45 }, glance: [{ label: "Media budget", value: "$100,000" }] };

test("highlights is one slide with every section's headline and the live allocations", () => {
  const [slide, ...rest] = buildBriefSlides(brief(), "highlights", context);
  assert.equal(rest.length, 0);
  assert.match(slide.text, /SLIDE TITLE: Executive Summary\nSUBTITLE: Acme Pets · National\nAT A GLANCE: Media budget: \$100,000/);
  for (const headline of ["Acme needs online sales", "Evening CTV primes", "Purchase data finds", "Two channels", "We prove net-new"]) assert.ok(slide.text.includes(headline), headline);
  assert.ok(slide.text.indexOf("CTV | 55%") < slide.text.indexOf("Google Search | 45%"), "channels by live allocation, not the stored one");
  assert.ok(slide.text.indexOf("Incrementality (Business impact)") < slide.text.indexOf("LeadMatch"), "business-impact measurement first");
  assert.doesNotMatch(slide.text, /word13/, "no bullet bodies on the highlights slide");
});

test("the full summary is strategy, audience, then media and measurement, with the glance strip on the first only", () => {
  const slides = buildBriefSlides(brief(), "full", context);
  assert.deepEqual(slides.map((s) => s.layout), ["strategy", "audience", "execution"]);
  assert.deepEqual(slides.map((s) => s.label), ["1. Strategy", "2. Audience", "3. Media & Measurement"]);
  assert.doesNotMatch(slides[0].text, /Audience Strategy/);
  assert.match(slides[1].text, /SECTION: Audience Strategy[\s\S]*Premium dog owners → Premium Pet Food Buyers\n    Proven spend\./);
  assert.match(slides[2].text, /SLIDE TITLE: Executive Summary: Media & Measurement/);
  assert.match(slides[2].text, /CTV \| 55% \| Awareness \| Builds reach\./);
  assert.deepEqual(slides.map((s) => s.text.includes("AT A GLANCE")), [true, false, false]);
  const withoutStrategy = buildBriefSlides(brief({ hiddenPanels: ["understanding", "strategicPov"] }), "full", context);
  assert.match(withoutStrategy[0].text, /AT A GLANCE/, "the glance strip moves to whichever slide comes first");
});

const channels = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ channelId: `c${i}`, channelName: `Channel ${i + 1}`, allocationPercent: 10, funnelRole: "Consideration" as const, role: "Does things." }));

test("the full summary keeps every persona, trimming their detail before dropping one", () => {
  const b = brief();
  const audience = b.sections.find((s) => s.key === "audience")!;
  audience.bullets = bullets(4, 24);
  audience.audienceMatches = Array.from({ length: 4 }, (_, i) => ({
    audience: `Persona ${i + 1}`, reachedWith: ["Segment A", "Segment B", "Segment C", "Segment D"], why: bullets(1, 22)[0].text,
  }));
  const slide = buildBriefSlides(b, "full", context).find((s) => s.layout === "audience")!;
  for (let i = 1; i <= 4; i++) assert.match(slide.text, new RegExp(`Persona ${i} → Segment A, Segment B, Segment C, Segment D`));
  assert.ok(countWords(slide.text) <= SLIDE_WORD_BUDGET.full, `${countWords(slide.text)} words`);
});

test("highlights shows every channel, dropping the % before the funnel role, and says when it rolls some up", () => {
  const withChannels = (n: number) => {
    const b = brief();
    b.sections.find((s) => s.key === "media")!.channels = channels(n);
    return buildBriefSlides(b, "highlights", {}).at(0)!.text;
  };
  const few = withChannels(3);
  assert.match(few, /Channel 3 \| 10% \| Consideration/);
  const ten = withChannels(10);
  for (let i = 1; i <= 10; i++) assert.match(ten, new RegExp(`Channel ${i} (\\| 10% )?\\| Consideration`), `Channel ${i}`);
  assert.doesNotMatch(ten, /more channel/);

  // A long brief forces the roll-up; the slide then says how many channels it left out.
  const long = brief();
  for (const section of long.sections) section.headline = bullets(1, 28)[0].text;
  long.sections.find((s) => s.key === "media")!.channels = channels(12);
  const rolled = buildBriefSlides(long, "highlights", {})[0].text;
  const shown = (rolled.match(/Channel \d+ \| Consideration/g) || []).length;
  assert.doesNotMatch(rolled, /10%/, "the % goes before the funnel role");
  assert.ok(shown < 12);
  assert.match(rolled, new RegExp(`\\+ ${12 - shown} more channels`));
});

test("slides stay inside the word budget by dropping whole lines, never cutting a sentence", () => {
  const long = brief();
  for (const section of long.sections) section.bullets = bullets(4, 24);
  for (const slide of buildBriefSlides(long, "full", context)) {
    assert.ok(countWords(slide.text) <= SLIDE_WORD_BUDGET.full, `${slide.label}: ${countWords(slide.text)} words`);
    assert.doesNotMatch(slide.text, /…/, `${slide.label} has a truncated line`);
  }
});

test("hand edits and sections hidden from the share link carry through, planner notes never do", () => {
  const edited = brief({
    edits: { media: { title: "How We Buy", content: "Our media headline.\n- Mix: CTV then search." } },
    hiddenPanels: ["measurement"],
  });
  const slides = buildBriefSlides(edited, "full", context);
  const execution = slides.find((s) => s.layout === "execution")!;
  assert.match(execution.text, /SLIDE TITLE: Executive Summary: Media Strategy/);
  assert.match(execution.text, /SECTION: How We Buy[\s\S]*HEADLINE: Our media headline\.\n• Mix: CTV then search\./);
  assert.doesNotMatch(execution.text, /CHANNEL \| ALLOCATION/, "an edited section replaces its generated rows");
  assert.doesNotMatch(slides.map((s) => s.text).join("\n"), /Measurement|Incrementality|73%/);
});

test("the image prompt asks for verbatim text, a title, and no logo or footer", () => {
  const [slide] = buildBriefSlides(brief(), "highlights", context);
  const prompt = buildSlideImagePrompt({ text: slide.text, layout: slide.layout, style: "corporate_light", aspectRatio: "9:16", size: "1440x2560" });
  assert.match(prompt, /ABSOLUTELY NO LOGO/);
  assert.match(prompt, /ABSOLUTELY NO FOOTER/);
  assert.match(prompt, /exactly as written, character for character/);
  assert.match(prompt, /Include the slide title/);
  assert.match(prompt, /vertical \(9:16\)/);
  assert.match(prompt, /\(Business impact\)" is printed as a tag ONLY on the items whose line contains it/);
  assert.ok(prompt.endsWith(slide.text + "\n"), "the slide text is passed through untouched");
});

test("the Google Slides prompt carries the same text, one block per slide, with the brand", () => {
  const slides = buildBriefSlides(brief(), "full", context);
  const prompt = buildGoogleSlidesPrompt(slides, { advertiserName: "Acme Pets" });
  assert.match(prompt, /^Create 3 slides for a client presentation: the executive summary of a media plan for Acme Pets\./);
  assert.match(prompt, /SLIDE 1 \(Strategy\)[\s\S]*SLIDE 2 \(Audience\)[\s\S]*SLIDE 3 \(Media & Measurement\)/);
  for (const slide of slides) assert.ok(prompt.includes(slide.text));
  assert.match(prompt, /Lexend/);
  assert.match(prompt, /#0e8f86/);
  assert.match(prompt, /Do not add a logo, footer/);
  assert.match(buildGoogleSlidesPrompt(buildBriefSlides(brief(), "highlights", context)), /^Create one slide/);
});

test("the proofread keeps real differences and drops ones that only differ in case", () => {
  assert.deepEqual(normalizeProofread({ issues: [] }), { status: "clean", issues: [] });
  const result = normalizeProofread({
    issues: [
      { type: "wrong_number", found: "71%", expected: "17%" },
      { type: "misspelling", found: "Seach", expected: "Search" },
      { type: "misspelling", found: "CTV", expected: "ctv" },
      { type: "made_up", found: "x", expected: "y" },
      { type: "logo_or_footer", found: "Page 1", expected: "" },
    ],
  });
  assert.equal(result.status, "issues");
  assert.deepEqual(result.issues.map((i) => i.type), ["wrong_number", "misspelling", "logo_or_footer"]);
  assert.equal(normalizeProofread(null).status, "unavailable");
});
