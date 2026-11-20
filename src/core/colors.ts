import type { EdgeColors, Rgb } from "./sample.js";

/**
 * Pure colour helpers shared by the effects. Colours are the video's own: nothing
 * here adds saturation. `Rgb` channels are 0-255 and may be fractional while
 * being smoothed.
 */

export function mean(points: Rgb[]): Rgb {
  let r = 0;
  let g = 0;
  let b = 0;
  for (const [cr, cg, cb] of points) {
    r += cr;
    g += cg;
    b += cb;
  }
  const count = Math.max(1, points.length);
  return [r / count, g / count, b / count];
}

/** `rgb(r g b)` or `rgb(r g b / a)`, channels rounded. */
export const css = ([r, g, b]: Rgb, alpha?: number): string =>
  alpha === undefined
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

interface WhiteText {
  bg: Rgb;
  ratio: number;
}

const memo = new Map<string, WhiteText>();
const MEMO_LIMIT = 512;

/**
 * A background colour for white text: darkened (same hue and saturation) until
 * white on it reaches `min`:1 contrast; never lightened, so a colour that already
 * reads is returned as it is. The lightness is found by bisection (about 7
 * steps), and the answer for a given input is remembered.
 */
export function forWhiteText(bg: Rgb, min = 4.5): WhiteText {
  const key = `${Math.round(bg[0])},${Math.round(bg[1])},${Math.round(bg[2])},${min}`;
  const known = memo.get(key);
  if (known) {
    return known;
  }
  let result: WhiteText;
  if (min <= 1 || contrast(bg, WHITE) >= min) {
    result = { bg, ratio: contrast(bg, WHITE) };
  } else {
    const [h, s, l0] = toHsl(bg);
    let low = 0;
    let high = l0;
    for (let step = 0; step < 7; step += 1) {
      const middle = (low + high) / 2;
      if (contrast(fromHsl([h, s, middle]), WHITE) >= min) {
        low = middle;
      } else {
        high = middle;
      }
    }
    const darkened = fromHsl([h, s, low]);
    result = { bg: darkened, ratio: contrast(darkened, WHITE) };
  }
  if (memo.size >= MEMO_LIMIT) {
    memo.clear();
  }
  memo.set(key, result);
  return result;
}

const distance = (a: Rgb, b: Rgb) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Seeds: the point farthest from the overall mean, then the farthest from the seeds so far. */
function seeds(points: Rgb[], count: number): Rgb[] {
  const centre = mean(points);
  const farthest = (score: (p: Rgb) => number) =>
    points.reduce((a, b) => (score(b) > score(a) ? b : a));
  const found: Rgb[] = [farthest((p) => distance(p, centre))];
  while (found.length < count) {
    found.push(farthest((p) => Math.min(...found.map((c) => distance(p, c)))));
  }
  return found;
}

function nearest(point: Rgb, centres: Rgb[]): number {
  let best = 0;
  for (const [i, c] of centres.entries()) {
    if (distance(point, c) < distance(point, centres[best] ?? c)) {
      best = i;
    }
  }
  return best;
}

/** One k-means round: each point joins its nearest centre, each centre becomes the mean of its points. */
function refine(points: Rgb[], centres: Rgb[]) {
  const groups = centres.map(() => [] as Rgb[]);
  for (const point of points) {
    groups[nearest(point, centres)]?.push(point);
  }
  return {
    centres: centres.map((c, i) => {
      const group = groups[i] ?? [];
      return group.length > 0 ? mean(group) : c;
    }),
    sizes: groups.map((group) => group.length),
  };
}

/**
 * `count` dominant colours of a set of colours, by area, biggest first. Each is
 * the mean of the colours that belong to it, so it really is in the picture.
 */
export function palette(points: Rgb[], count = 2): Rgb[] {
  if (points.length === 0) {
    return Array.from({ length: count }, () => [20, 20, 28] as Rgb);
  }
  let state = { centres: seeds(points, count), sizes: [] as number[] };
  for (let round = 0; round < 6; round += 1) {
    state = refine(points, state.centres);
  }
  return state.centres
    .map((c, i) => ({ c, n: state.sizes[i] ?? 0 }))
    .sort((a, b) => b.n - a.n)
    .map(({ c }) => c);
}

/** The two dominant colours keep their roles from one frame to the next. */
function keepOrder(previous: Rgb[], next: Rgb[]): Rgb[] {
  const [p0, p1] = previous;
  const [n0, n1] = next;
  if (p0 && p1 && n0 && n1) {
    const straight = distance(p0, n0) + distance(p1, n1);
    const crossed = distance(p0, n1) + distance(p1, n0);
    if (crossed < straight) {
      return [n1, n0];
    }
  }
  return next;
}

/** Whole-number channels, so a still picture gives the very same goal every sample. */
const whole = ([r, g, b]: Rgb): Rgb => [
  Math.round(r),
  Math.round(g),
  Math.round(b),
];

/**
 * The three colours a watcher aims at: `primary`, `secondary`, `average`. The two
 * most vivid colours of the picture when it has them (and `vibrant` allows),
 * else the dominant colours of its edges, kept in the same order as `previous`.
 * `secondary` falls back to `primary`, `primary` to `neutral`.
 */
export function pickGoal(
  edges: EdgeColors,
  previous: Rgb[],
  vibrant: boolean,
  neutral: Rgb
): Rgb[] {
  const points = [...edges.top, ...edges.right, ...edges.bottom, ...edges.left];
  const [first, second] =
    (vibrant ? edges.vivid : undefined) ??
    keepOrder(previous, palette(points, 2));
  return [
    whole(first ?? neutral),
    whole(second ?? first ?? neutral),
    whole(mean(points)),
  ];
}

export interface Smoother {
  /** The smoothed colours; a new array only when one of them changed. */
  colors: Rgb[];
  /** Jump straight to `goal`. */
  snap: (goal: Rgb[]) => void;
  /** Move toward `goal` by `dtMs` milliseconds; `true` if `colors` changed. */
  step: (goal: Rgb[], dtMs: number) => boolean;
}

const round = (rgb: Rgb) =>
  `${Math.round(rgb[0])},${Math.round(rgb[1])},${Math.round(rgb[2])}`;

/**
 * Exponential smoothing with time constant `tauSeconds`. An exponential never
 * reaches its goal, so once every colour rounds to the goal's, the goal itself
 * is taken and `step` reports `false` from then on: callers can stop their loop.
 */
export function createSmoother(tauSeconds: number, initial: Rgb[]): Smoother {
  const smoother: Smoother = {
    colors: initial,
    snap: (goal) => {
      smoother.colors = goal;
    },
    step: (goal, dtMs) => {
      const settled = goal.every(
        (g, i) => round(smoother.colors[i] ?? g) === round(g)
      );
      if (settled) {
        const exact = goal.every(
          (g, i) =>
            smoother.colors[i]?.[0] === g[0] &&
            smoother.colors[i]?.[1] === g[1] &&
            smoother.colors[i]?.[2] === g[2]
        );
        if (exact) {
          return false;
        }
        smoother.colors = goal;
        return true;
      }
      const k = 1 - Math.exp(-dtMs / 1000 / tauSeconds);
      smoother.colors = goal.map((g, i) => {
        const c = smoother.colors[i] ?? g;
        return [
          c[0] + (g[0] - c[0]) * k,
          c[1] + (g[1] - c[1]) * k,
          c[2] + (g[2] - c[2]) * k,
        ] as Rgb;
      });
      return true;
    },
  };
  return smoother;
}
