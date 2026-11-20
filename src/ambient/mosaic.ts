import { createSmoother } from "../core/colors.js";
import type { Layer } from "../core/layer.js";
import type { EdgeColors, Rgb } from "../core/sample.js";
import type { Watcher } from "../core/watcher.js";
import { COMPOSITOR_HINTS } from "./hints.js";

/** One pixel of the canvas per cell. */
export const MOSAIC_COLS = 8;
export const MOSAIC_ROWS = 5;

/** The blurred layer overflows the host by this much on every side, so the blur's own edges stay out of view. */
const OVERFLOW = "14%";
/** Blur radius as a share of the layer's width: 24 px for 900 px, kept between 8 and 48 px. */
const BLUR_PER_WIDTH = 0.027;
const BLUR_MIN = 8;
const BLUR_MAX = 48;
/** Time constant of the smoothing of the 40 colours, seconds (the core's default). */
const TAU = 0.12;
/** No sample for this long: the video has stopped, and the display frames finish the fade. */
const SETTLE_MS = 120;

/** The colour at `t` (0 to 1) along one side of the picture; black if the side has no colour. */
const along = (colors: Rgb[], t: number): Rgb =>
  colors[Math.round(t * (colors.length - 1))] ?? [0, 0, 0];

/**
 * The colour of the cell at (u, v), both 0 to 1 from the top left: the four
 * edges blended, the top and bottom ones by column, the left and right ones by
 * row, each weighted by how close the cell is to it. Channels are not rounded.
 */
export function cellColor(edges: EdgeColors, u: number, v: number): Rgb {
  const top = along(edges.top, u);
  const bottom = along(edges.bottom, u);
  const left = along(edges.left, v);
  const right = along(edges.right, v);
  const channel = (k: 0 | 1 | 2) =>
    ((1 - v) * top[k] + v * bottom[k] + (1 - u) * left[k] + u * right[k]) / 2;
  return [channel(0), channel(1), channel(2)];
}

/** The 40 colours the grid should show for these edges, row by row. */
function goalFor(edges: EdgeColors): Rgb[] {
  return Array.from({ length: MOSAIC_COLS * MOSAIC_ROWS }, (_, index) =>
    cellColor(
      edges,
      (index % MOSAIC_COLS) / (MOSAIC_COLS - 1),
      Math.floor(index / MOSAIC_COLS) / (MOSAIC_ROWS - 1)
    )
  );
}

/**
 * A soft picture of the video's surroundings: a canvas of 8 x 5 pixels, one per
 * cell, that the browser scales up smoothly and a CSS blur then softens. Fed by
 * the raw edge colours (`onSample`), smoothed here, one step per sample. It sets
 * no CSS variable: there is nothing to read from it but the picture.
 */
export function mountMosaic(layer: Layer, watcher: Watcher): () => void {
  const holder = document.createElement("div");
  holder.style.cssText = `position:absolute;inset:-${OVERFLOW}`;
  if (COMPOSITOR_HINTS) {
    holder.style.willChange = "transform";
  }
  const canvas = document.createElement("canvas");
  canvas.width = MOSAIC_COLS;
  canvas.height = MOSAIC_ROWS;
  canvas.style.cssText = "display:block;width:100%;height:100%";
  holder.append(canvas);
  layer.element.append(holder);
  // The blurred layer overflows the host on purpose; the host's own box cuts it, whatever the hints say.
  layer.element.style.overflow = "hidden";

  const context = canvas.getContext("2d");
  const image = new ImageData(MOSAIC_COLS, MOSAIC_ROWS);

  const blur = () => {
    const px = Math.min(
      BLUR_MAX,
      Math.max(BLUR_MIN, layer.element.clientWidth * BLUR_PER_WIDTH)
    );
    holder.style.filter = `blur(${Math.round(px)}px)`;
  };
  blur();
  const resize = new ResizeObserver(blur);
  resize.observe(layer.element);

  // The 40 colours move one step per sample. A video that stops (paused, seeked
  // then still) sends no more samples, so a fade in progress would freeze half
  // way: when samples stop, the display frames finish it. Nothing is drawn when
  // nothing moves.
  let goal: Rgb[] = [];
  let smoother: ReturnType<typeof createSmoother> | undefined;
  let last = performance.now();
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  let settleFrame: number | undefined;

  const paint = (colors: Rgb[]) => {
    colors.forEach(([r, g, b], index) => {
      image.data.set(
        [Math.round(r), Math.round(g), Math.round(b), 255],
        index * 4
      );
    });
    context?.putImageData(image, 0, 0);
  };
  /** One step toward the goal; draws it if anything moved. False once settled. */
  const advance = (): boolean => {
    if (!smoother) {
      return false;
    }
    const now = performance.now();
    const moved = smoother.step(goal, now - last);
    last = now;
    if (moved) {
      paint(smoother.colors);
    }
    return moved;
  };
  const settle = () => {
    settleFrame = undefined;
    if (advance()) {
      settleFrame = requestAnimationFrame(settle);
    }
  };
  const cancelSettle = () => {
    clearTimeout(settleTimer);
    if (settleFrame !== undefined) {
      cancelAnimationFrame(settleFrame);
      settleFrame = undefined;
    }
  };

  const stop = watcher.onSample((edges) => {
    goal = goalFor(edges);
    cancelSettle();
    if (smoother) {
      advance();
    } else {
      smoother = createSmoother(TAU, goal);
      last = performance.now();
      paint(smoother.colors);
    }
    settleTimer = setTimeout(settle, SETTLE_MS);
  });

  return () => {
    stop();
    cancelSettle();
    resize.disconnect();
  };
}
