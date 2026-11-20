import type { EdgeColors, Rgb } from "../../src/index.js";

/**
 * Throwaway colour helpers for the labs. Nothing here is part of the library.
 */

export const flat = (colors: EdgeColors): Rgb[] => [
  ...colors.top,
  ...colors.right,
  ...colors.bottom,
  ...colors.left,
];

export function mean(colors: Rgb[]): Rgb {
  let r = 0;
  let g = 0;
  let b = 0;
  for (const [cr, cg, cb] of colors) {
    r += cr;
    g += cg;
    b += cb;
  }
  const count = Math.max(1, colors.length);
  return [r / count, g / count, b / count];
}

export const css = ([r, g, b]: Rgb, alpha = 1) =>
  alpha === 1
    ? `rgb(${Math.round(r)} ${Math.round(g)} ${Math.round(b)})`
    : `rgb(${Math.round(r)} ${Math.round(g)} ${Math.round(b)} / ${alpha})`;

/** [hue 0-360, saturation 0-1, lightness 0-1] */
export function toHsl([r, g, b]: Rgb): Rgb {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) {
    return [0, 0, l];
  }
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === rn) {
    h = ((gn - bn) / d) % 6;
  } else if (max === gn) {
    h = (bn - rn) / d + 2;
  } else {
    h = (rn - gn) / d + 4;
  }
  return [(h * 60 + 360) % 360, s, l];
}

export function fromHsl([h, s, l]: Rgb): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const sector = Math.floor((((h % 360) + 360) % 360) / 60);
  const parts: Rgb[] = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ];
  const [r, g, b] = parts[sector] ?? [0, 0, 0];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/** The same hue pushed into a saturation and lightness range, for backgrounds. */
export function tone(
  rgb: Rgb,
  saturation: [number, number],
  light: [number, number]
): Rgb {
  const [h, s, l] = toHsl(rgb);
  return fromHsl([
    h,
    Math.min(saturation[1], Math.max(saturation[0], s)),
    Math.min(light[1], Math.max(light[0], l)),
  ]);
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance([r, g, b]: Rgb): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.039_28 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const WHITE: Rgb = [255, 255, 255];

/**
 * A background colour for white text: darkened (same hue and saturation) until
 * white on it reaches `min`:1 contrast. White text never changes; the colour
 * is the one that gives way, so a bright yellow becomes an olive or a gold.
 */
export function forWhiteText(bg: Rgb, min = 4.5): { bg: Rgb; ratio: number } {
  const [h, s, l0] = toHsl(bg);
  let l = l0;
  let out = bg;
  while (contrast(out, WHITE) < min && l > 0.04) {
    l -= 0.01;
    out = fromHsl([h, s, l]);
  }
  return { bg: out, ratio: contrast(out, WHITE) };
}

const distance = (a: Rgb, b: Rgb) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * `count` dominant colours of a set of colours, most important first, by area:
 * each is the mean of the colours that belong to it, so it is a colour that is
 * really in the picture. With `vivid`, saturated mid-tones weigh more than
 * greys (a dark scene with one red lamp gives the red), which is not faithful.
 */
export function palette(points: Rgb[], count = 2, vivid = false): Rgb[] {
  if (points.length === 0) {
    return Array.from({ length: count }, () => [20, 20, 28] as Rgb);
  }
  const weighted = points.map((p) => {
    const [, s, l] = toHsl(p);
    return { p, w: vivid ? 0.15 + s * (1 - Math.abs(2 * l - 1)) : 1 };
  });
  // Seeds: the point farthest from the overall mean, then the one farthest
  // from the seeds so far.
  const centre = mean(points);
  const first = weighted.reduce((a, b) =>
    b.w * distance(b.p, centre) > a.w * distance(a.p, centre) ? b : a
  );
  const centres: Rgb[] = [first.p];
  while (centres.length < count) {
    const next = weighted.reduce((a, b) => {
      const score = (x: { p: Rgb; w: number }) =>
        x.w * Math.min(...centres.map((c) => distance(x.p, c)));
      return score(b) > score(a) ? b : a;
    });
    centres.push(next.p);
  }
  const weights = centres.map(() => 0);
  for (let round = 0; round < 6; round += 1) {
    const sums = centres.map(() => ({ r: 0, g: 0, b: 0, w: 0 }));
    for (const { p, w } of weighted) {
      let best = 0;
      for (const [i, c] of centres.entries()) {
        if (distance(p, c) < distance(p, centres[best] ?? c)) {
          best = i;
        }
      }
      const sum = sums[best];
      if (sum) {
        sum.r += p[0] * w;
        sum.g += p[1] * w;
        sum.b += p[2] * w;
        sum.w += w;
      }
    }
    for (const [i, sum] of sums.entries()) {
      if (sum.w > 0) {
        centres[i] = [sum.r / sum.w, sum.g / sum.w, sum.b / sum.w];
      }
      weights[i] = sum.w;
    }
  }
  const order = centres
    .map((c, i) => ({ c, w: weights[i] ?? 0 }))
    .sort((a, b) => b.w - a.w)
    .map(({ c }) => c);
  // Two colours that are nearly the same make a dull pair: shift the hue.
  const [top, second] = order;
  if (top && second && count >= 2 && distance(top, second) < 45) {
    const [h, s, l] = toHsl(top);
    order[1] = fromHsl([(h + 40) % 360, s, l]);
  }
  return order;
}

/** One step of exponential smoothing; `tau` in seconds, `dt` in milliseconds. */
export function ease(current: Rgb, target: Rgb, dt: number, tau: number): Rgb {
  const k = 1 - Math.exp(-dt / 1000 / tau);
  return [
    current[0] + (target[0] - current[0]) * k,
    current[1] + (target[1] - current[1]) * k,
    current[2] + (target[2] - current[2]) * k,
  ];
}

/** Calls `fn` at most every `ms`. */
export function every(ms: number, fn: (now: number) => void) {
  let last = Number.NEGATIVE_INFINITY;
  return (now = performance.now()) => {
    if (now - last >= ms) {
      last = now;
      fn(now);
    }
  };
}

export const mmss = (seconds: number) => {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}.${Math.floor((seconds % 1) * 10)}`;
};
