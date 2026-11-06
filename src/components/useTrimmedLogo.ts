import React from "react";
import { trimBox } from "../utils/logoFit";

// A partner logo trimmed to its visible pixels, with its real aspect ratio. Done in the browser
// when the logo is shown rather than at upload, so the logos already in Settings are trimmed too
// without anyone uploading them again. The result is a data URL, which the slide capture can draw
// like any image. Cached per source, so each logo is read once per page.

export interface TrimmedLogo { src: string; aspect: number }

// Big enough for a logo on a 2560px slide; keeps the data URL small.
const MAX_WIDTH = 1200;
const cache = new Map<string, Promise<TrimmedLogo>>();

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // Uploaded logos are data URLs or /api/images on this origin; asking for CORS keeps a
    // logo from elsewhere readable when its host allows it.
    if (!url.startsWith("data:") && !url.startsWith("/")) img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("logo failed to load"));
    img.src = url;
  });
}

async function trim(url: string): Promise<TrimmedLogo> {
  const img = await loadImage(url);
  const w = img.naturalWidth, h = img.naturalHeight;
  const whole = { src: url, aspect: w && h ? w / h : 0 };
  try {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return whole;
    ctx.drawImage(img, 0, 0);
    const crop = trimBox(ctx.getImageData(0, 0, w, h).data, w, h);
    if (!crop) return whole;
    // A pixel of margin so antialiased edges are not shaved.
    const x = Math.max(0, crop.x - 1), y = Math.max(0, crop.y - 1);
    const cw = Math.min(w - x, crop.width + 2), ch = Math.min(h - y, crop.height + 2);
    const scale = Math.min(1, MAX_WIDTH / cw);
    const out = document.createElement("canvas");
    out.width = Math.round(cw * scale);
    out.height = Math.round(ch * scale);
    out.getContext("2d")?.drawImage(canvas, x, y, cw, ch, 0, 0, out.width, out.height);
    return { src: out.toDataURL("image/png"), aspect: cw / ch };
  } catch {
    // A cross-origin logo without CORS cannot be read; show it untrimmed.
    return whole;
  }
}

/** Resolves once the logo is trimmed; the slide export waits on this before capturing. */
export function prepareLogo(url: string): Promise<TrimmedLogo> {
  let p = cache.get(url);
  if (!p) {
    p = trim(url).catch(() => ({ src: url, aspect: 0 }));
    cache.set(url, p);
  }
  return p;
}

export function useTrimmedLogo(url: string | undefined): TrimmedLogo | null {
  const [logo, setLogo] = React.useState<TrimmedLogo | null>(null);
  React.useEffect(() => {
    setLogo(null);
    if (!url) return;
    let live = true;
    prepareLogo(url).then((l) => { if (live) setLogo(l); });
    return () => { live = false; };
  }, [url]);
  return logo;
}
