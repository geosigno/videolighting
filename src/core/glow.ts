import { light } from "./colors.js";
import { createLayer } from "./layer.js";
import type { EdgeColors, Rgb } from "./sample.js";

/**
 * The glow, as plain CSS, with no filter:
 *  - 4 bands along the straight parts of the video's edges, each a color
 *    gradient through the sampled colors, multiplied by a mask that fades with
 *    the distance to the video;
 *  - 4 corner patches, one per rounded corner: a mask centered on the center of
 *    the corner's arc (opaque up to the radius, then the same fade), and the
 *    frame's corner zone as one plain color. The bands start and end on that
 *    same color, so nothing turns around a corner.
 * Every color is painted as a light (`light`, in `colors.ts`): the darker it is,
 * the more transparent, so the halo is the same over a dark page and does not
 * look like a shadow over a light one.
 * The fade is what makes it "strong at the edge, gone further away": it is an
 * explicit curve (`falloffAlpha`), not a by-product of a blur. It is measured
 * from the rounded shape, so each corner's radius matters (see `RADIUS`).
 */

const SIDES = ["top", "right", "bottom", "left"] as const;
type Side = (typeof SIDES)[number];

const CORNERS = ["topLeft", "topRight", "bottomLeft", "bottomRight"] as const;
type Corner = (typeof CORNERS)[number];

const BLACK: Rgb = [0, 0, 0];

/** Tunables, as CSS variables with a fallback. */
const REACH = "var(--vl-reach, 140px)";
const OPACITY = "var(--vl-opacity, 0.85)";
/**
 * A corner's radius: the one `halo` measured for that corner, clamped as the
 * browser clamps a `border-radius`.
 */
const radius = (corner: string) =>
  `min(var(--vl-radius-${corner}, 0px), 50cqmin)`;
const RADIUS: Record<Corner, string> = {
  bottomLeft: radius("bottom-left"),
  bottomRight: radius("bottom-right"),
  topLeft: radius("top-left"),
  topRight: radius("top-right"),
};

/** How the intensity decays: (1 - distance) ^ exponent. */
const DEFAULT_EXPONENT = 2.5;
/** Stops used to draw the curve. */
const CURVE_STEPS = 10;

type Curve = (distance: number) => number;

export interface GlowConfig {
  /**
   * One blur of this CSS length over the whole layer (default: no filter). The
   * bands then run twice that far under the video, so the blur has color to
   * draw from on both sides of the edge. One filter for the layer, not one per
   * piece: per piece measured three times the GPU time of the plain halo, and
   * stalls of over a second under load.
   */
  blur?: string;
  /** Benchmark only: false draws the corner patches' absence (cost ablation). */
  corners?: boolean;
  /**
   * Lab only: the fade as a function of the distance (0 at the video's edge, 1
   * at the reach) giving an intensity from 1 to 0. Replaces `exponent`.
   */
  curve?: (distance: number) => number;
  /** Steepness of the fade. Higher: stronger at the edge, fainter tail. */
  exponent?: number;
  /**
   * false drops the fade masks: the pieces are plain color as far as the
   * reach, and the layer takes `--vl-opacity`. What `blur` is made for.
   */
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

const mix = (a: Rgb, b: Rgb, share: number): Rgb => [
  a[0] + (b[0] - a[0]) * share,
  a[1] + (b[1] - a[1]) * share,
  a[2] + (b[2] - a[2]) * share,
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

/** Where the center of each corner's arc is inside its patch. */
const PATCH: Record<Corner, string> = {
  bottomLeft: "100% 0%",
  bottomRight: "0% 0%",
  topLeft: "100% 100%",
  topRight: "0% 100%",
};

/**
 * The bands cover the straight parts of the edges: they start where the arcs
 * do (a corner's radius in from each end). The top and bottom bands also run under
 * the video, over half its height (more than any corner radius): with the
 * radius known that part is hidden by the video, and with no radius known a
 * rounded video shows the glow, not a hole, in its corners. The side bands stop
 * at the video's edge, so no two bands overlap.
 */
function bandPosition(side: Side, inset: string): string {
  const depth = `calc(${REACH} + ${inset})`;
  const deep = `calc(${REACH} + 50% + ${inset})`;
  const outside = `calc(-1 * ${REACH})`;
  switch (side) {
    case "top":
      return `left:${RADIUS.topLeft};right:${RADIUS.topRight};top:${outside};height:${deep}`;
    case "bottom":
      return `left:${RADIUS.bottomLeft};right:${RADIUS.bottomRight};bottom:${outside};height:${deep}`;
    case "left":
      return `top:${RADIUS.topLeft};bottom:${RADIUS.bottomLeft};left:${outside};width:${depth}`;
    default:
      return `top:${RADIUS.topRight};bottom:${RADIUS.bottomRight};right:${outside};width:${depth}`;
  }
}

/** Patches reach past the video's corner by `--vl-reach`, and cover the arc's square. */
function cornerPosition(corner: Corner): string {
  const outside = `calc(-1 * ${REACH})`;
  const size = `width:calc(${REACH} + ${RADIUS[corner]});height:calc(${REACH} + ${RADIUS[corner]})`;
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
 * Mask of a band: transparent on the far side, as opaque as `--vl-opacity`
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
 * Radial fade of a corner patch, set once: opaque up to the radius (the part of
 * the square the rounded video does not cover), then the same curve as the
 * bands. The patch itself is one color, rewritten on every frame.
 */
function cornerMask(corner: Corner, curve: Curve, steps: number): string {
  const stops: string[] = [];
  for (let step = 0; step <= steps; step += 1) {
    const distance = step / steps;
    const alpha = curve(distance).toFixed(4);
    stops.push(
      `rgb(0 0 0 / calc(${OPACITY} * ${alpha})) calc(${RADIUS[corner]} + ${REACH} * ${distance.toFixed(3)})`
    );
  }
  return `radial-gradient(circle at ${PATCH[corner]}, ${stops.join(", ")})`;
}

/**
 * Positions of a band's color stops: 0, the center of each of the `count`
 * segments, and 1. Cached by count: a frame that is not square has two (along
 * the long sides and the short ones).
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

/**
 * Paints a band. The two end zones of the frame live in the corner patches:
 * the band starts and ends on its corners' colors and keeps the zones in
 * between. (The band spans the straight part of the edge only, so its stops
 * are a little closer together than the zones they come from: the colors are
 * soft enough for it not to show.)
 */
function paintBand(
  band: HTMLElement,
  side: Side,
  start: Rgb,
  points: Rgb[],
  end: Rgb
) {
  const positions = positionsFor(points.length);
  const stops = [
    `${light(start)} 0%`,
    ...points
      .slice(1, -1)
      .map((color, i) => `${light(color)} ${positions[i + 2] ?? "50%"}`),
    `${light(end)} 100%`,
  ];
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
  const { blur } = config;
  const withMasks = config.masks ?? true;
  const withCorners = config.corners ?? true;
  // With a blur, the side bands must start further under the video.
  const inset = blur ? `2 * ${blur}` : "0px";

  const layer = createLayer(host);
  const { element } = layer;
  // `cqmin` in the radius clamp is a share of the layer, i.e. of the video.
  element.style.containerType = "size";
  if (blur) {
    element.style.filter = `blur(${blur})`;
    // Its own compositing layer, so the blur is applied to the layer as a whole.
    // Without it, Safari sometimes repaints only the area of the bands when the
    // colors change: a sharp rectangle inside the blur of the previous frame.
    element.style.willChange = "filter";
  }
  if (!withMasks) {
    // The masks carry the opacity; without them the layer does.
    element.style.opacity = OPACITY;
  }

  const bands = {} as Record<Side, HTMLElement>;
  for (const side of SIDES) {
    const band = document.createElement("div");
    const mask = maskGradient(side, curve, steps);
    const masking = withMasks
      ? `;-webkit-mask-image:${mask};mask-image:${mask}`
      : "";
    band.style.cssText = `position:absolute;${bandPosition(side, inset)}${masking}`;
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
    patch.style.cssText = `position:absolute;${cornerPosition(corner)}${masking}`;
    element.append(patch);
    patches[corner] = patch;
  }

  return {
    destroy: layer.destroy,
    element,
    update: ({ bottom, left, right, top }) => {
      // The two samples of a corner are the same zone: one color per corner.
      const zones: Record<Corner, Rgb> = {
        bottomLeft: mix(bottom.at(0) ?? BLACK, left.at(-1) ?? BLACK, 0.5),
        bottomRight: mix(bottom.at(-1) ?? BLACK, right.at(-1) ?? BLACK, 0.5),
        topLeft: mix(top.at(0) ?? BLACK, left.at(0) ?? BLACK, 0.5),
        topRight: mix(top.at(-1) ?? BLACK, right.at(0) ?? BLACK, 0.5),
      };
      paintBand(bands.top, "top", zones.topLeft, top, zones.topRight);
      paintBand(bands.right, "right", zones.topRight, right, zones.bottomRight);
      paintBand(
        bands.bottom,
        "bottom",
        zones.bottomLeft,
        bottom,
        zones.bottomRight
      );
      paintBand(bands.left, "left", zones.topLeft, left, zones.bottomLeft);
      for (const corner of CORNERS) {
        const patch = patches[corner];
        if (patch) {
          patch.style.backgroundColor = light(zones[corner]);
        }
      }
    },
  };
}

/**
 * Add the glow layer behind the children of `host` (the element wrapping the
 * video). Tune it with the CSS variables `--vl-reach` (how far it extends
 * from the video, default 140px) and `--vl-opacity` (at the video's edge,
 * default 0.85).
 */
export function createGlow(host: HTMLElement): Glow {
  return createGlowWith(host, {});
}

/**
 * The blurred glow: the same bands and corners in plain color, softened by one
 * blur. `--vl-blur` (default 40px) is its radius, `--vl-reach` how far the
 * color goes before the blur, `--vl-opacity` the strength of the whole.
 */
export function createBlurGlow(host: HTMLElement): Glow {
  return createGlowWith(host, { blur: "var(--vl-blur, 40px)", masks: false });
}
