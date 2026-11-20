import { css } from "./colors.js";
import { createLayer } from "./layer.js";
import type { EdgeColors, Rgb } from "./sample.js";

/**
 * The glow, as plain CSS, with no filter:
 *  - 4 bands along the video's edges, each a color gradient through the sampled
 *    colors, multiplied by a mask that fades with the distance to the video;
 *  - 4 corner patches, radial, that follow the very same fade, so the corners
 *    are round and meet the bands without a seam.
 * The fade is what makes it "strong at the edge, gone further away": it is an
 * explicit curve (`falloffAlpha`), not a by-product of a blur.
 */

const SIDES = ["top", "right", "bottom", "left"] as const;
type Side = (typeof SIDES)[number];

const CORNERS = ["topLeft", "topRight", "bottomLeft", "bottomRight"] as const;
type Corner = (typeof CORNERS)[number];

const BLACK: Rgb = [0, 0, 0];

/** Tunables, as CSS variables with a fallback. */
const REACH = "var(--glow-reach, 140px)";
const OPACITY = "var(--glow-opacity, 0.85)";

/** How the intensity decays: (1 - distance) ^ exponent. */
const DEFAULT_EXPONENT = 2.5;
/** Stops used to draw the curve. */
const CURVE_STEPS = 10;
/** Bands slip this far under the video, so no sub-pixel gap shows at its edge. */
const UNDER_VIDEO_PX = 4;

type Curve = (distance: number) => number;

export interface GlowConfig {
  /** Blur radius in px applied to every piece. 0 (default): no filter at all. */
  blur?: number;
  /** Benchmark only: false draws the corner patches' absence (cost ablation). */
  corners?: boolean;
  /**
   * Lab only: the fade as a function of the distance (0 at the video's edge, 1
   * at the reach) giving an intensity from 1 to 0. Replaces `exponent`.
   */
  curve?: (distance: number) => number;
  /** Steepness of the fade. Higher: stronger at the edge, fainter tail. */
  exponent?: number;
  /** Benchmark only: false drops the fade masks (cost ablation, ugly on purpose). */
  masks?: boolean;
  /** Lab only: stops used to draw the fade (default 10). */
  steps?: number;
}

/**
 * Intensity at `distance` from the video's edge: 1 right at the edge, 0 at the
 * reach. `distance` is a share of the reach, from 0 to 1.
 */
export function falloffAlpha(distance: number, exponent: number): number {
  return (1 - Math.min(1, Math.max(0, distance))) ** exponent;
}

const middle = (a: Rgb, b: Rgb): Rgb => [
  Math.round((a[0] + b[0]) / 2),
  Math.round((a[1] + b[1]) / 2),
  Math.round((a[2] + b[2]) / 2),
];

// --- Geometry -------------------------------------------------------------------

/** Gradient direction along each band. */
const ALONG: Record<Side, string> = {
  bottom: "to right",
  left: "to bottom",
  right: "to bottom",
  top: "to right",
};

/** Direction of the fade, from the far side of the band toward the video. */
const TOWARD_VIDEO: Record<Side, string> = {
  bottom: "to top",
  left: "to right",
  right: "to left",
  top: "to bottom",
};

/** Where each corner's radial fade is centered (the video's corner). */
const CORNER_CENTER: Record<Corner, string> = {
  bottomLeft: "100% 0%",
  bottomRight: "0% 0%",
  topLeft: "100% 100%",
  topRight: "0% 100%",
};

function bandPosition(side: Side, inset: number): string {
  const depth = `calc(${REACH} + ${inset}px)`;
  const outside = `calc(-1 * ${REACH})`;
  switch (side) {
    case "top":
      return `left:0;right:0;top:${outside};height:${depth}`;
    case "bottom":
      return `left:0;right:0;bottom:${outside};height:${depth}`;
    case "left":
      return `top:0;bottom:0;left:${outside};width:${depth}`;
    default:
      return `top:0;bottom:0;right:${outside};width:${depth}`;
  }
}

function cornerPosition(corner: Corner): string {
  const outside = `calc(-1 * ${REACH})`;
  const size = `width:${REACH};height:${REACH}`;
  switch (corner) {
    case "topLeft":
      return `left:${outside};top:${outside};${size}`;
    case "topRight":
      return `right:${outside};top:${outside};${size}`;
    case "bottomLeft":
      return `left:${outside};bottom:${outside};${size}`;
    default:
      return `right:${outside};bottom:${outside};${size}`;
  }
}

// --- Painting -------------------------------------------------------------------

/**
 * Mask of a band: transparent on the far side, as opaque as `--glow-opacity`
 * at the video's edge. Stops are laid out along the band, far side first.
 */
function maskGradient(side: Side, curve: Curve, steps: number): string {
  const stops: string[] = [];
  for (let step = steps; step >= 0; step -= 1) {
    const distance = step / steps;
    const alpha = curve(distance).toFixed(4);
    stops.push(
      `rgb(0 0 0 / calc(${OPACITY} * ${alpha})) calc(${REACH} * ${(1 - distance).toFixed(3)})`
    );
  }
  return `linear-gradient(${TOWARD_VIDEO[side]}, ${stops.join(", ")})`;
}

/**
 * Radial fade of a corner patch, set once: the patch itself is a plain
 * background color, rewritten on every frame (a short string), while this mask
 * shapes it with the same curve as the bands.
 */
function cornerMask(corner: Corner, curve: Curve, steps: number): string {
  const stops: string[] = [];
  for (let step = 0; step <= steps; step += 1) {
    const distance = step / steps;
    const alpha = curve(distance).toFixed(4);
    stops.push(
      `rgb(0 0 0 / calc(${OPACITY} * ${alpha})) calc(${REACH} * ${distance.toFixed(3)})`
    );
  }
  return `radial-gradient(circle ${REACH} at ${CORNER_CENTER[corner]}, ${stops.join(", ")})`;
}

/**
 * Positions of a band's color stops: 0, the center of each of the `count`
 * segments, and 1. The two ends hold the shared corner colors. Cached by count:
 * a frame that is not square has two (along the long sides and the short ones).
 */
const positionCache = new Map<number, string[]>();

function positionsFor(count: number): string[] {
  let positions = positionCache.get(count);
  if (!positions) {
    positions = [
      0,
      ...Array.from({ length: count }, (_, i) => (i + 0.5) / count),
      1,
    ].map((fraction) => `${(fraction * 100).toFixed(2)}%`);
    positionCache.set(count, positions);
  }
  return positions;
}

function paintBand(
  band: HTMLElement,
  side: Side,
  start: Rgb,
  points: Rgb[],
  end: Rgb
) {
  const positions = positionsFor(points.length);
  const stops = [start, ...points, end].map(
    (color, i) => `${css(color)} ${positions[i] ?? "0%"}`
  );
  band.style.backgroundImage = `linear-gradient(${ALONG[side]}, ${stops.join(", ")})`;
}

export interface Glow {
  /** Remove the layer and restore the host's styles. */
  destroy: () => void;
  /** The glow layer. Toggle its `hidden` attribute to show or hide it. */
  element: HTMLElement;
  /** Paint new colors, on every video frame. */
  update: (colors: EdgeColors) => void;
}

/**
 * Same as `createGlow` with a tuning object: used to compare variants in the
 * CSS benchmark. Not part of the public API.
 */
export function createGlowWith(host: HTMLElement, config: GlowConfig): Glow {
  const exponent = config.exponent ?? DEFAULT_EXPONENT;
  const curve: Curve =
    config.curve ?? ((distance) => falloffAlpha(distance, exponent));
  const steps = config.steps ?? CURVE_STEPS;
  const blur = config.blur ?? 0;
  const withMasks = config.masks ?? true;
  const withCorners = config.corners ?? true;
  const filter = blur > 0 ? `;filter:blur(${blur}px)` : "";
  // With a blur, the fade must start further under the video.
  const inset = UNDER_VIDEO_PX + 2 * blur;

  const layer = createLayer(host);
  const { element } = layer;

  const bands = {} as Record<Side, HTMLElement>;
  for (const side of SIDES) {
    const band = document.createElement("div");
    const mask = maskGradient(side, curve, steps);
    const masking = withMasks
      ? `;-webkit-mask-image:${mask};mask-image:${mask}`
      : "";
    band.style.cssText = `position:absolute;${bandPosition(side, inset)}${masking}${filter}`;
    element.append(band);
    bands[side] = band;
  }

  const patches = {} as Partial<Record<Corner, HTMLElement>>;
  for (const corner of withCorners ? CORNERS : []) {
    const patch = document.createElement("div");
    const mask = cornerMask(corner, curve, steps);
    const masking = withMasks
      ? `;-webkit-mask-image:${mask};mask-image:${mask}`
      : "";
    patch.style.cssText = `position:absolute;${cornerPosition(corner)}${masking}${filter}`;
    element.append(patch);
    patches[corner] = patch;
  }

  return {
    destroy: layer.destroy,
    element,
    update: ({ bottom, left, right, top }) => {
      // Each corner is shared by two bands: the mean of their two end samples.
      const topLeft = middle(top.at(0) ?? BLACK, left.at(0) ?? BLACK);
      const topRight = middle(top.at(-1) ?? BLACK, right.at(0) ?? BLACK);
      const bottomLeft = middle(bottom.at(0) ?? BLACK, left.at(-1) ?? BLACK);
      const bottomRight = middle(bottom.at(-1) ?? BLACK, right.at(-1) ?? BLACK);

      paintBand(bands.top, "top", topLeft, top, topRight);
      paintBand(bands.bottom, "bottom", bottomLeft, bottom, bottomRight);
      paintBand(bands.left, "left", topLeft, left, bottomLeft);
      paintBand(bands.right, "right", topRight, right, bottomRight);

      const cornerColors: Record<Corner, Rgb> = {
        bottomLeft,
        bottomRight,
        topLeft,
        topRight,
      };
      for (const corner of CORNERS) {
        const patch = patches[corner];
        if (patch) {
          patch.style.backgroundColor = css(cornerColors[corner]);
        }
      }
    },
  };
}

/**
 * Add the glow layer behind the children of `host` (the element wrapping the
 * video). Tune it with the CSS variables `--glow-reach` (how far it extends
 * from the video, default 140px) and `--glow-opacity` (at the video's edge,
 * default 0.85).
 */
export function createGlow(host: HTMLElement): Glow {
  return createGlowWith(host, {});
}
