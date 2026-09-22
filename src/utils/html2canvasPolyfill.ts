import html2canvas from 'html2canvas';

// Helper to convert oklch(...) to standard rgb(...) or rgba(...) color strings
export const oklchToRgb = (oklchStr: string): string => {
  try {
    const regex = /oklch\s*\(\s*([\d.]+%?)\s+([\d.]+%?)\s+([\d.]+(?:deg|rad|grad|turn)?|none)\s*(?:\/\s*([\d.]+%?))?\s*\)/i;
    const match = oklchStr.match(regex);
    if (!match) return oklchStr;

    const [, lStr, cStr, hStr, aStr] = match;

    const L = lStr.endsWith('%') ? parseFloat(lStr) / 100 : parseFloat(lStr);
    const C = cStr.endsWith('%') ? parseFloat(cStr) / 100 : parseFloat(cStr);

    let H = 0;
    if (hStr !== 'none') {
      if (hStr.endsWith('deg')) H = parseFloat(hStr);
      else if (hStr.endsWith('rad')) H = parseFloat(hStr) * (180 / Math.PI);
      else if (hStr.endsWith('grad')) H = parseFloat(hStr) * 0.9;
      else if (hStr.endsWith('turn')) H = parseFloat(hStr) * 360;
      else H = parseFloat(hStr);
    }

    let alpha = 1;
    if (aStr) {
      alpha = aStr.endsWith('%') ? parseFloat(aStr) / 100 : parseFloat(aStr);
    }

    // Convert OKLCH to OKLab coordinates
    const hRad = (H * Math.PI) / 180;
    const aVal = C * Math.cos(hRad);
    const bVal = C * Math.sin(hRad);

    // OKLab to LMS
    const L_ = L + 0.3963377774 * aVal + 0.2158037573 * bVal;
    const M_ = L - 0.1055613458 * aVal - 0.0638541728 * bVal;
    const S_ = L - 0.0894841775 * aVal - 1.291485548 * bVal;

    // LMS to linear RGB (cubing coordinates)
    const l = Math.pow(Math.max(0, L_), 3);
    const m = Math.pow(Math.max(0, M_), 3);
    const s = Math.pow(Math.max(0, S_), 3);

    // Linear LMS to linear sRGB
    const r_lin = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
    const g_lin = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
    const b_lin = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

    // Linear sRGB to standard sRGB (gamma correction)
    const r = r_lin <= 0.0031308 ? 12.92 * r_lin : 1.055 * Math.pow(r_lin, 1 / 2.4) - 0.055;
    const g = g_lin <= 0.0031308 ? 12.92 * g_lin : 1.055 * Math.pow(g_lin, 1 / 2.4) - 0.055;
    const b = b_lin <= 0.0031308 ? 12.92 * b_lin : 1.055 * Math.pow(b_lin, 1 / 2.4) - 0.055;

    const R = Math.round(Math.max(0, Math.min(1, r)) * 255);
    const G = Math.round(Math.max(0, Math.min(1, g)) * 255);
    const B = Math.round(Math.max(0, Math.min(1, b)) * 255);

    if (aStr) {
      return `rgba(${R}, ${G}, ${B}, ${alpha})`;
    } else {
      return `rgb(${R}, ${G}, ${B})`;
    }
  } catch (e) {
    console.warn('Failed to convert oklch to rgb:', e);
    return oklchStr;
  }
};

// Helper to convert oklab(...) to standard rgb(...) or rgba(...) color strings
export const oklabToRgb = (oklabStr: string): string => {
  try {
    const regex = /oklab\s*\(\s*([\d.]+%?)\s+([-+\d.]+%?)\s+([-+\d.]+%?)\s*(?:\/\s*([\d.]+%?))?\s*\)/i;
    const match = oklabStr.match(regex);
    if (!match) return oklabStr;

    const [, lStr, aStr, bStr, alphaStr] = match;

    const L = lStr.endsWith('%') ? parseFloat(lStr) / 100 : parseFloat(lStr);
    const aVal = aStr.endsWith('%') ? parseFloat(aStr) / 100 : parseFloat(aStr);
    const bVal = bStr.endsWith('%') ? parseFloat(bStr) / 100 : parseFloat(bStr);

    let alpha = 1;
    if (alphaStr) {
      alpha = alphaStr.endsWith('%') ? parseFloat(alphaStr) / 100 : parseFloat(alphaStr);
    }

    // OKLab to LMS
    const L_ = L + 0.3963377774 * aVal + 0.2158037573 * bVal;
    const M_ = L - 0.1055613458 * aVal - 0.0638541728 * bVal;
    const S_ = L - 0.0894841775 * aVal - 1.291485548 * bVal;

    // LMS to linear RGB (cubing coordinates)
    const l = Math.pow(Math.max(0, L_), 3);
    const m = Math.pow(Math.max(0, M_), 3);
    const s = Math.pow(Math.max(0, S_), 3);

    // Linear LMS to linear sRGB
    const r_lin = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
    const g_lin = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
    const b_lin = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

    // Linear sRGB to standard sRGB (gamma correction)
    const r = r_lin <= 0.0031308 ? 12.92 * r_lin : 1.055 * Math.pow(r_lin, 1 / 2.4) - 0.055;
    const g = g_lin <= 0.0031308 ? 12.92 * g_lin : 1.055 * Math.pow(g_lin, 1 / 2.4) - 0.055;
    const b = b_lin <= 0.0031308 ? 12.92 * b_lin : 1.055 * Math.pow(b_lin, 1 / 2.4) - 0.055;

    const R = Math.round(Math.max(0, Math.min(1, r)) * 255);
    const G = Math.round(Math.max(0, Math.min(1, g)) * 255);
    const B = Math.round(Math.max(0, Math.min(1, b)) * 255);

    if (alphaStr) {
      return `rgba(${R}, ${G}, ${B}, ${alpha})`;
    } else {
      return `rgb(${R}, ${G}, ${B})`;
    }
  } catch (e) {
    console.warn('Failed to convert oklab to rgb:', e);
    return oklabStr;
  }
};

/**
 * Runs a callback while temporarily proxying window.getComputedStyle to translate
 * modern CSS oklch() and oklab() colors into standard rgb() strings.
 * This guarantees html2canvas does not throw color parsing errors on Tailwind v4 styles.
 */
export async function withOklchColorPolyfill<T>(fn: () => Promise<T>): Promise<T> {
  const originalGetComputedStyle = window.getComputedStyle;

  window.getComputedStyle = function (elt: Element, pseudoElt?: string | null) {
    const style = originalGetComputedStyle.call(this, elt, pseudoElt);
    return new Proxy(style, {
      get(target, prop, _receiver) {
        // Pass target as the receiver context so WebIDL getters don't throw "Illegal invocation"
        let val: any;
        try {
          val = Reflect.get(target, prop, target);
        } catch {
          val = (target as any)[prop];
        }

        if (typeof val === 'string' && (val.includes('oklch(') || val.includes('oklab('))) {
          let replaced = val;
          if (replaced.includes('oklch(')) {
            replaced = replaced.replace(/oklch\s*\([^)]+\)/gi, (m) => oklchToRgb(m));
          }
          if (replaced.includes('oklab(')) {
            replaced = replaced.replace(/oklab\s*\([^)]+\)/gi, (m) => oklabToRgb(m));
          }
          return replaced;
        }
        if (typeof val === 'function') {
          if (prop === 'getPropertyValue') {
            return function (propertyName: string) {
              const rawVal = target.getPropertyValue(propertyName);
              if (typeof rawVal === 'string' && (rawVal.includes('oklch(') || rawVal.includes('oklab('))) {
                let replaced = rawVal;
                if (replaced.includes('oklch(')) {
                  replaced = replaced.replace(/oklch\s*\([^)]+\)/gi, (m) => oklchToRgb(m));
                }
                if (replaced.includes('oklab(')) {
                  replaced = replaced.replace(/oklab\s*\([^)]+\)/gi, (m) => oklabToRgb(m));
                }
                return replaced;
              }
              return rawVal;
            };
          }
          return val.bind(target);
        }
        return val;
      },
    });
  };

  try {
    return await fn();
  } finally {
    window.getComputedStyle = originalGetComputedStyle;
  }
}

/**
 * Pre-decodes all img tags inside an element to ensure images are fully rasterized
 * before html2canvas takes a snapshot.
 */
export async function preDecodeImages(container: HTMLElement): Promise<void> {
  const images = Array.from(container.querySelectorAll('img'));
  await Promise.all(
    images.map(async (img) => {
      try {
        if (!img.complete) {
          await new Promise((resolve) => {
            const timeout = setTimeout(resolve, 600);
            img.onload = () => {
              clearTimeout(timeout);
              resolve(null);
            };
            img.onerror = () => {
              clearTimeout(timeout);
              resolve(null);
            };
          });
        }
        if (typeof img.decode === 'function') {
          await img.decode();
        }
      } catch {
        // Fall back gracefully if decoding fails
      }
    })
  );
}

/**
 * Captures an HTML element as a PNG image with high-DPI scaling,
 * automatically handling Tailwind color polyfills and image pre-decoding.
 */
export async function captureElementToCanvas(
  element: HTMLElement,
  options?: {
    scale?: number;
    backgroundColor?: string;
    width?: number;
    height?: number;
  }
): Promise<HTMLCanvasElement> {
  await preDecodeImages(element);
  // Ensure all web fonts are fully loaded to prevent baseline miscalculations and text clipping
  if (typeof document !== 'undefined' && 'fonts' in document && document.fonts.ready) {
    try {
      await document.fonts.ready;
    } catch {
      // Continue if fonts check fails
    }
  }
  // Short pause to allow DOM layout and fonts to settle
  await new Promise((resolve) => setTimeout(resolve, 150));

  const targetWidth = options?.width ?? (element.offsetWidth || 1920);
  const targetHeight = options?.height ?? (element.offsetHeight || 1080);

  // Find any ancestor that has negative left positioning (e.g. -99999px off-screen container)
  // and temporarily bring to (0, 0) behind the application (z-index: -9999)
  // so html2canvas computes perfect (0, 0) bounding client rect without clipping or blank canvases
  const offscreenContainers: { el: HTMLElement; origLeft: string; origTop: string; origZIndex: string }[] = [];
  let curr: HTMLElement | null = element;
  while (curr && curr !== document.body) {
    const leftVal = curr.style?.left || '';
    if (leftVal.includes('-')) {
      offscreenContainers.push({
        el: curr,
        origLeft: curr.style.left,
        origTop: curr.style.top,
        origZIndex: curr.style.zIndex,
      });
      curr.style.left = '0px';
      curr.style.top = '0px';
      curr.style.zIndex = '-9999';
    }
    curr = curr.parentElement;
  }

  try {
    return await withOklchColorPolyfill(async () => {
      return await html2canvas(element, {
        scale: options?.scale ?? 2,
        useCORS: true,
        allowTaint: true,
        logging: false,
        backgroundColor: options?.backgroundColor ?? '#f8fafc',
        width: targetWidth,
        height: targetHeight,
        windowWidth: targetWidth,
        windowHeight: targetHeight,
        x: 0,
        y: 0,
        scrollX: 0,
        scrollY: 0,
        onclone: (clonedDoc) => {
          // In cloned document, ensure cloned element is positioned cleanly at (0, 0)
          const clonedTarget = element.id ? clonedDoc.getElementById(element.id) : null;
          if (clonedTarget) {
            clonedTarget.style.position = 'fixed';
            clonedTarget.style.left = '0px';
            clonedTarget.style.top = '0px';
            clonedTarget.style.margin = '0px';
            clonedTarget.style.width = `${targetWidth}px`;
            clonedTarget.style.height = `${targetHeight}px`;
            clonedTarget.style.display = 'block';
            clonedTarget.style.visibility = 'visible';
          }
        },
      });
    });
  } finally {
    // Restore all offscreen containers to their original off-screen position
    offscreenContainers.forEach(({ el, origLeft, origTop, origZIndex }) => {
      el.style.left = origLeft;
      el.style.top = origTop;
      el.style.zIndex = origZIndex;
    });
  }
}
