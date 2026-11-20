import { acquire, type Effect } from "../core/effect.js";
import { createGlow } from "../core/glow.js";
import type { EdgeColors } from "../core/sample.js";

/** Under `prefers-reduced-motion`, the halo changes at most this often (ms): no flicker. */
const CALM_MS = 1000;

export interface HaloOptions {
  /** Strength of the bands at the video's edge, 0 to 1. Default 0.85. */
  opacity?: number;
  /** How far the bands reach from the video, in px. Default 140. */
  reach?: number;
}

/**
 * The glow around the video: colour bands along its edges, fading into nothing.
 * It draws every sampled frame as it comes (raw edge colours, no smoothing).
 * `reach` and `opacity` set the CSS variables `--vl-reach` and
 * `--vl-opacity` on its layer, which win over the same variables set higher
 * up; use those for a length that is not in px. Under `prefers-reduced-motion`
 * it repaints at most once a second.
 */
export const halo: Effect<HaloOptions> = (source, element, options) => {
  const {
    element: host,
    release,
    watcher,
  } = acquire(source, element, options, true);
  const glow = createGlow(host);
  glow.element.dataset.vl = "halo";
  if (options?.reach !== undefined) {
    glow.element.style.setProperty("--vl-reach", `${options.reach}px`);
  }
  if (options?.opacity !== undefined) {
    glow.element.style.setProperty("--vl-opacity", String(options.opacity));
  }
  const calm = matchMedia("(prefers-reduced-motion: reduce)");
  let latest: EdgeColors | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let last = Number.NEGATIVE_INFINITY;
  const paint = () => {
    timer = undefined;
    last = performance.now();
    if (latest) {
      glow.update(latest);
    }
  };
  const stopSamples = watcher.onSample((edges) => {
    if (!calm.matches) {
      glow.update(edges);
      return;
    }
    latest = edges;
    timer ??= setTimeout(
      paint,
      Math.max(0, last + CALM_MS - performance.now())
    );
  });
  return () => {
    clearTimeout(timer);
    stopSamples();
    glow.destroy();
    release();
  };
};
