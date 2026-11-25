/** Small color helpers for themes: hex in, hex out, mixing in OKLab so blends stay even. */

type Triple = [number, number, number];

/** "#abc", "abc", "#aabbcc" → "#aabbcc"; anything else → null. */
export function normalizeHex(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const raw = input.trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{3}$/.test(raw)) return `#${[...raw].map((c) => c + c).join("")}`;
  return /^[0-9a-f]{6}$/.test(raw) ? `#${raw}` : null;
}

export function hexToRgb(hex: string): Triple {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(rgb: Triple): string {
  return `#${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;
}

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const fromLinear = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.max(0, v) ** (1 / 2.4) - 0.055);

function toOklab(hex: string): Triple {
  const [r, g, b] = hexToRgb(hex).map((v) => toLinear(v / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function fromOklab([L, a, b]: Triple): string {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return rgbToHex([
    fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s) * 255,
    fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s) * 255,
    fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s) * 255,
  ]);
}

/** `amount` 0 is all `from`, 1 is all `to`. */
export function mix(from: string, to: string, amount: number): string {
  const a = toOklab(from);
  const b = toOklab(to);
  const t = Math.max(0, Math.min(1, amount));
  return fromOklab([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
}

export function withAlpha(hex: string, alpha: number): string {
  return `rgb(${hexToRgb(hex).join(" ")} / ${Math.round(alpha * 1000) / 10}%)`;
}

export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => toLinear(v / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1 to 21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Moves `color` toward `toward` only as far as it takes to reach `target` against every background. */
export function ensureContrast(color: string, backgrounds: string[], target: number, toward: string): string {
  for (let t = 0; t <= 1; t += 0.04) {
    const candidate = mix(color, toward, t);
    if (backgrounds.every((bg) => contrast(candidate, bg) >= target)) return candidate;
  }
  return toward;
}

/** Text to put on a fill: white when it reads well, otherwise whichever of white and ink reads better. */
export function readableOn(fill: string): string {
  const ink = "#0b0b0c";
  const white = contrast("#ffffff", fill);
  return white >= 4 || white >= contrast(ink, fill) ? "#ffffff" : ink;
}

// ── HSV, for the color picker ────────────────────────────────────────────────────────────────

export interface Hsv {
  h: number;
  s: number;
  v: number;
}

export function hexToHsv(hex: string): Hsv {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d + 6) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  return { h: h * 60, s: max ? d / max : 0, v: max };
}

export function hsvToHex({ h, s, v }: Hsv): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255;
  };
  return rgbToHex([f(5), f(3), f(1)]);
}
