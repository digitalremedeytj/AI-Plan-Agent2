// The illustrated headshot style: one fixed art direction shared by every persona, so a plan's
// set reads as a single campaign portrait series rather than four unrelated drawings. The
// wording is the creative team's brief; change it there first, then here.
export const ILLUSTRATION_STYLE = [
  "Create the persona as a stylized editorial vector portrait with a bold mid-century-modern / retro advertising aesthetic.",
  "Use simplified geometric shapes, clean flat-color areas, and soft organic curves rather than realistic rendering.",
  "Facial features should be minimal and graphic, with slightly exaggerated fashion-illustration proportions and a confident, expressive pose.",
  "Use a limited, cohesive color palette with warm muted tones and a few contrasting accent colors.",
  "Hair, clothing, accessories, and facial features should be represented as large, clean shapes with very little internal detail.",
  "Add subtle tonal variation or gentle gradient shading for depth, but avoid realistic textures, photographic lighting, or fine detail.",
  "The overall look should feel sophisticated, fashionable, playful, and contemporary—similar to an upscale editorial magazine illustration or modernized 1960s–1970s advertising artwork.",
  "Composition: centered head-and-shoulders portrait, front-facing or slight three-quarter view, cropped around the upper torso.",
  "Background: always one flat, solid slate-teal #006987 filling the whole frame, with no gradient, pattern, or second color. No scenery, text, logos, borders, or unnecessary objects.",
  "Color the person with the other brand colors, #5856fd, #00B3AA and #b2cb3b, alongside natural skin and hair tones, so the subject stands out clearly against the #006987 background.",
  "Maintain this exact illustration language across every persona so the full set feels like one consistent campaign portrait series.",
].join(" ");

export type HeadshotStyle = "photo" | "illustration";

export function isHeadshotStyle(value: unknown): value is HeadshotStyle {
  return value === "photo" || value === "illustration";
}

const clean = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 240);

/**
 * With a reference (the persona's current headshot) the same person is redrawn, so illustrating
 * a plan keeps the faces planners already chose. Without one, the person is cast from the
 * persona and its casting brief, minus the photo setting: the style fixes a solid background.
 */
export function buildIllustrationPrompt(persona: any, opts: { hasReference: boolean; instruction?: string }): string {
  const instruction = clean(opts.instruction);
  if (opts.hasReference) {
    return [
      "Redraw the person in this image as an illustration.",
      "It must remain recognisably the same individual: keep their apparent age, skin tone, face shape, hairstyle and overall look.",
      instruction && `Apply this change: ${instruction}.`,
      ILLUSTRATION_STYLE,
      "1:1 square, a single subject.",
    ].filter(Boolean).join(" ");
  }
  const portrait = persona?.portrait && typeof persona.portrait === "object" ? persona.portrait : null;
  const gender = clean(portrait?.gender) || clean(String(persona?.gender ?? "").replace(/Skews\s+/i, "").replace(/\(\d+%\)/g, "")) || "person";
  const age = clean(portrait?.apparentAge) || clean(persona?.age) || "35";
  return [
    `A 1:1 square illustrated portrait of a ${age} year old ${clean(portrait?.ethnicity)} ${gender}`.replace(/\s+/g, " ") + ".",
    clean(portrait?.appearance) && `Appearance: ${clean(portrait?.appearance)}.`,
    clean(portrait?.wardrobe) && `Wearing: ${clean(portrait?.wardrobe)}.`,
    clean(portrait?.expression) && `Expression: ${clean(portrait?.expression)}.`,
    instruction && `Creative direction: ${instruction}.`,
    ILLUSTRATION_STYLE,
  ].filter(Boolean).join(" ");
}
