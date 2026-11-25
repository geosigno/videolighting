import { vivid } from "./vivid.js";

export type Rgb = [number, number, number];

export interface EdgeColors {
  bottom: Rgb[];
  left: Rgb[];
  right: Rgb[];
  top: Rgb[];
  /** The two most vivid colors of the whole frame, if it has any. */
  vivid?: [Rgb, Rgb];
}

/** Default number of colors read along the longer sides. */
export const EDGE_POINTS = 12;

/** Size the video frame is squashed into before its edges are read. */
export const SAMPLE_WIDTH = 256;
export const SAMPLE_HEIGHT = 144;

/** Default depth of the sampled border, as a share of the frame's smaller side. */
export const STRIP_RATIO = 0.15;

/** Mean color of the pixels in [x0, x1) × [y0, y1). */
function mean(
  data: Uint8ClampedArray,
  width: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): Rgb {
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (y * width + x) * 4;
      r += data[i] ?? 0;
      g += data[i + 1] ?? 0;
      b += data[i + 2] ?? 0;
      count += 1;
    }
  }
  if (count === 0) {
    return [0, 0, 0];
  }
  return [Math.round(r / count), Math.round(g / count), Math.round(b / count)];
}

/** Segment `i` of `points` over `length`, never empty. */
function segment(i: number, length: number, points: number): [number, number] {
  const start = Math.min(length - 1, Math.floor((i * length) / points));
  const end = Math.max(start + 1, Math.floor(((i + 1) * length) / points));
  return [start, Math.min(end, length)];
}

/** What is read along the edges of the frame. */
export interface EdgeLayout {
  /** Depth of the sampled border, as a share of the frame's smaller side. */
  depth?: number;
  /**
   * Colors read along the longer sides of the frame (default 12). The shorter
   * sides get proportionally fewer, so a zone is the same size on all four
   * sides whatever the video's ratio.
   */
  points?: number;
}

const finite = (value: number | undefined): value is number =>
  value !== undefined && Number.isFinite(value) && value > 0;

/**
 * Zones along the top and bottom (`across`) and along the left and right
 * (`down`) of a frame `aspect` times wider than high: `points` along the
 * longer sides, proportionally fewer along the shorter ones (never under one).
 * An unusable aspect ratio gives `points` on every side.
 */
export function zonesFor(
  points: number,
  aspect: number | undefined
): { across: number; down: number } {
  const count = Math.max(1, Math.floor(points));
  if (!finite(aspect)) {
    return { across: count, down: count };
  }
  const shorter = (ratio: number) =>
    Math.min(count, Math.max(1, Math.round(count * ratio)));
  return aspect >= 1
    ? { across: count, down: shorter(1 / aspect) }
    : { across: shorter(aspect), down: count };
}

/**
 * Mean color of the zones along each side of an RGBA frame, ordered
 * left→right (top/bottom) and top→bottom (left/right). `aspect` is the video's
 * own width over height (the frame may be squashed into another shape before
 * it gets here): it sets how many zones each side gets and how deep the border
 * is on each axis. Without it, the frame's own width over height is used.
 */
export function sampleEdges(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  { depth: depthRatio = STRIP_RATIO, points = EDGE_POINTS }: EdgeLayout = {},
  aspect?: number
): EdgeColors {
  const ratio = finite(aspect) ? aspect : width / height;
  const { across, down } = zonesFor(points, ratio);
  // The border is `depthRatio` of the video's smaller side. The video is
  // `ratio` wide and 1 high in these units; the frame holds it on `width` by
  // `height` pixels, so the same depth is a different number of pixels per axis.
  const depthInVideo = depthRatio * Math.min(ratio, 1);
  const depthX = Math.min(
    Math.floor(width / 2),
    Math.max(1, Math.floor((depthInVideo * width) / ratio))
  );
  const depthY = Math.min(
    Math.floor(height / 2),
    Math.max(1, Math.floor(depthInVideo * height))
  );

  const alongX = (y0: number, y1: number) =>
    Array.from({ length: across }, (_, i) => {
      const [x0, x1] = segment(i, width, across);
      return mean(data, width, x0, y0, x1, y1);
    });
  const alongY = (x0: number, x1: number) =>
    Array.from({ length: down }, (_, i) => {
      const [y0, y1] = segment(i, height, down);
      return mean(data, width, x0, y0, x1, y1);
    });

  return {
    bottom: alongX(height - depthY, height),
    left: alongY(0, depthX),
    right: alongY(width - depthX, width),
    top: alongX(0, depthY),
    vivid: vivid(data, width, height),
  };
}
