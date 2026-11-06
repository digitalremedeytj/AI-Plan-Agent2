// How partner logos are sized next to each other. Logos arrive in every shape (Resonate is about
// 7:1, Census about 2.5:1) and with different amounts of empty margin, so giving them all the same
// height makes the wide ones look twice the size of the rest. Instead each logo is trimmed to its
// visible pixels and given the same area, capped by the box it sits in: the usual way to make a
// row of mixed logos read as equal. Pure, so the rules are tested without a browser.

export interface Box { width: number; height: number }
export interface Crop { x: number; y: number; width: number; height: number }

/** The aspect ratio the size presets are tuned for: a typical wordmark (MediaRadar, GWI, Statista). */
export const REFERENCE_ASPECT = 3.7;

/**
 * The display size of a logo of this aspect ratio: the area a REFERENCE_ASPECT logo `refHeight`
 * tall would have, scaled down to fit `box`. Wide logos come out shorter, squat ones taller.
 */
export function fitLogo(aspect: number, refHeight: number, box: Box): Box {
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : REFERENCE_ASPECT;
  const area = refHeight * refHeight * REFERENCE_ASPECT;
  let height = Math.sqrt(area / a);
  let width = height * a;
  const shrink = Math.min(1, box.width / width, box.height / height);
  height *= shrink;
  width *= shrink;
  return { width: Math.round(width * 10) / 10, height: Math.round(height * 10) / 10 };
}

/**
 * The rectangle of an RGBA image that holds the logo, without its empty margin. The margin is
 * transparency, or, for a logo saved on a solid background, the colour of its top-left corner.
 * Returns null for an image with nothing in it.
 */
export function trimBox(data: ArrayLike<number>, width: number, height: number, tolerance = 16): Crop | null {
  const transparent = data[3] < 8;
  const [r0, g0, b0] = [data[0], data[1], data[2]];
  const isBackground = (i: number) => {
    if (data[i + 3] < 8) return true;
    if (transparent) return false;
    return Math.abs(data[i] - r0) <= tolerance && Math.abs(data[i + 1] - g0) <= tolerance && Math.abs(data[i + 2] - b0) <= tolerance;
  };
  let top = height, left = width, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (isBackground((y * width + x) * 4)) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < 0) return null;
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}
