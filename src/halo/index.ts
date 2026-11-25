import { saturate } from "../core/colors.js";
import { acquire, type Effect } from "../core/effect.js";
import { createBlurGlow, createGlow } from "../core/glow.js";
import type { EdgeColors } from "../core/sample.js";

/** Under `prefers-reduced-motion`, the halo changes at most this often (ms): no flicker. */
const CALM_MS = 1000;

/** Corner radius in px of the first of `elements` that has a round one (`px` only). */
function radiusOf(...elements: HTMLElement[]): number {
  for (const element of elements) {
    const radius = getComputedStyle(element).borderTopLeftRadius;
    if (radius.includes("px") && Number.parseFloat(radius) > 0) {
      return Number.parseFloat(radius);
    }
  }
  return 0;
}

/** How far the natural halo's color goes before the blur, when nothing sets it. */
const BLUR_REACH = "20px";

/** The same edges with every color's saturation pushed. */
const pushed = (edges: EdgeColors): EdgeColors => ({
  ...edges,
  bottom: edges.bottom.map(saturate),
  left: edges.left.map(saturate),
  right: edges.right.map(saturate),
  top: edges.top.map(saturate),
});

export interface HaloOptions {
  /** `"natural"` only: radius of the blur, in px. Default 40. */
  blur?: number;
  /** Strength of the halo at the video's edge, 0 to 1. Default 0.85. */
  opacity?: number;
  /**
   * How far the bands reach from the video, in px. Default 140. With
   * `"natural"`: how far the color goes before the blur spreads it, default 20.
   */
  reach?: number;
  /**
   * `"vibrant"` (default): bands that fade with the distance, each color
   * straight out from its edge, saturation pushed. `"natural"`: the edges' own
   * colors as one soft cloud, drawn with a CSS blur.
   */
  variant?: "natural" | "vibrant";
}

/**
 * The glow around the video, in the colors of its edges: bands fading into
 * nothing (`"vibrant"`) or one blurred cloud (`"natural"`).
 * It draws every sampled frame as it comes (raw edge colors, no smoothing).
 * `reach`, `opacity` and `blur` set the CSS variables `--vl-reach`,
 * `--vl-opacity` and `--vl-blur` on its layer, which win over the same
 * variables set higher up; use those for a length that is not in px. The corners follow the video's
 * `border-radius` (read once from the video, else from its element, in px); set
 * `--vl-radius` yourself when it is set elsewhere. Under
 * `prefers-reduced-motion` it repaints at most once a second.
 */
export const halo: Effect<HaloOptions> = (source, element, options) => {
  const {
    element: host,
    release,
    video,
    watcher,
  } = acquire(source, element, options, true);
  const blurred = options?.variant === "natural";
  const glow = blurred ? createBlurGlow(host) : createGlow(host);
  const draw = (edges: EdgeColors) =>
    glow.update(blurred ? edges : pushed(edges));
  glow.element.dataset.vl = "halo";
  if (
    blurred &&
    !getComputedStyle(glow.element).getPropertyValue("--vl-reach").trim()
  ) {
    glow.element.style.setProperty("--vl-reach", BLUR_REACH);
  }
  if (options?.blur !== undefined) {
    glow.element.style.setProperty("--vl-blur", `${options.blur}px`);
  }
  // The corners follow the video's rounded shape: read its radius once, unless
  // the page sets `--vl-radius` itself.
  if (!getComputedStyle(glow.element).getPropertyValue("--vl-radius").trim()) {
    glow.element.style.setProperty("--vl-radius", `${radiusOf(video, host)}px`);
  }
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
      draw(latest);
    }
  };
  const stopSamples = watcher.onSample((edges) => {
    if (!calm.matches) {
      draw(edges);
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
