import { toHsl } from "./colors.js";
import type { Rgb } from "./sample.js";

/**
 * A pixel counts only if its vividness (chroma × √brightness, 0-255) reaches this:
 * grays and beiges do not. The brightness term is soft: a dark neon still counts,
 * a dark brown counts less than a pink.
 */
const VIVID_FLOOR = 40;
/** A hue must cover this share of the picture to count: a logo or a reflet is not a color. */
const MIN_SHARE = 0.01;
/** Hue slices of 30°. */
const BINS = 12;
/** `secondary` must sit at least this far from `primary` on the hue wheel. */
const MIN_HUE_GAP = 40;
/** Failing that, the closest hue that still reads as another color. */
const CLOSE_HUE_GAP = 15;
/** One pixel in this many on each axis: the frame is already averaged by its downscale. */
const STEP = 4;

interface Bin {
  count: number;
  score: number;
  sum: Rgb;
}

const hueGap = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
};

/**
 * The two most vivid colors of a whole RGBA frame, or `undefined` when nothing
 * in it is vivid. Area is only a gate (a hue needs `MIN_SHARE` of the picture);
 * among the hues that pass, the most saturated wins. So a pink t-shirt on a
 * picture that is 90 % beige is `primary`.
 */
export function vivid(
  data: Uint8ClampedArray,
  width: number,
  height: number
): [Rgb, Rgb] | undefined {
  const bins: Bin[] = Array.from({ length: BINS }, () => ({
    score: 0,
    count: 0,
    sum: [0, 0, 0],
  }));
  let total = 0;
  for (let y = 0; y < height; y += STEP) {
    for (let x = 0; x < width; x += STEP) {
      total += 1;
      const i = (y * width + x) * 4;
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? 0;
      const b = data[i + 2] ?? 0;
      const top = Math.max(r, g, b);
      const score = (top - Math.min(r, g, b)) * Math.sqrt(top / 255);
      if (score < VIVID_FLOOR) {
        continue;
      }
      const [hue] = toHsl([r, g, b]);
      const bin = bins[Math.floor((hue / 360) * BINS) % BINS];
      if (bin) {
        bin.count += 1;
        bin.score += score;
        // Weighted by vividness, so the vivid pixels of a hue lead its color.
        bin.sum[0] += r * score;
        bin.sum[1] += g * score;
        bin.sum[2] += b * score;
      }
    }
  }

  const ranked = bins
    .filter((bin) => bin.count >= MIN_SHARE * total)
    .sort((a, b) => b.score / b.count - a.score / a.count)
    .map(
      (bin): Rgb => [
        bin.sum[0] / bin.score,
        bin.sum[1] / bin.score,
        bin.sum[2] / bin.score,
      ]
    );
  const [primary] = ranked;
  if (!primary) {
    return undefined;
  }
  const [hue] = toHsl(primary);
  const apart = (gap: number) =>
    ranked.find((c) => hueGap(toHsl(c)[0], hue) >= gap);
  // A real color of the picture, far from `primary`, then merely different;
  // a picture with a single hue has only `primary`.
  return [primary, apart(MIN_HUE_GAP) ?? apart(CLOSE_HUE_GAP) ?? primary];
}
