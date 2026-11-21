import { css } from "../core/colors.js";
import { acquire, type Effect } from "../core/effect.js";
import { createLayer, type Layer } from "../core/layer.js";
import { throttle } from "../core/throttle.js";
import type { Colors, Watcher } from "../core/watcher.js";
import { COMPOSITOR_HINTS } from "./hints.js";
import { mountMosaic } from "./mosaic.js";

export interface AmbientOptions {
  /** Let the blobs drift. Default true, and always false under `prefers-reduced-motion`. */
  animate?: boolean;
  /**
   * `"blobs"` (default): three soft blobs drifting slowly. `"mosaic"`: a soft
   * picture of the video's surroundings. Not called `style`: `<Ambient style>`
   * is already the CSS style of the React component.
   */
  variant?: "blobs" | "mosaic";
}

/** Neutral dark base the blobs glow on. */
const BASE = "#101018";

/**
 * Three soft blobs in the video's own colours (dominant, second dominant, mean)
 * drifting slowly, like a music player's background. The colours are CSS
 * custom properties on the layer (`--vl-primary`, `--vl-secondary`,
 * `--vl-mean`); each blob is one radial gradient from its colour to
 * transparent. A gradient with no mask measured about 40 % less GPU than a flat
 * colour under a fixed radial mask, for the same picture.
 */
const BLOBS = [
  {
    color: "--vl-primary",
    drift: "translate(40%, 25%) scale(1.25)",
    duration: 23_000,
    place: "left:-20%;top:-30%",
  },
  {
    color: "--vl-secondary",
    drift: "translate(-35%, 30%) scale(0.85)",
    duration: 29_000,
    place: "right:-25%;top:10%",
  },
  {
    color: "--vl-mean",
    drift: "translate(30%, -35%) scale(1.15)",
    duration: 19_000,
    place: "left:15%;bottom:-45%",
  },
] as const;

/**
 * The blobs change colour at most every this many ms (30 times a second), not
 * on every display frame: each write repaints the three gradients. Measured on
 * a 120 Hz screen (Chrome): 6 points of a core less in the page's process and 8
 * less in the GPU's, for a colour that fades over a tenth of a second anyway.
 */
const WRITE_MS = 33;

const HINT = COMPOSITOR_HINTS ? ";will-change:transform" : "";

function mountBlobs(
  layer: Layer,
  watcher: Watcher,
  options?: AmbientOptions
): () => void {
  const still =
    options?.animate === false ||
    matchMedia("(prefers-reduced-motion: reduce)").matches;
  for (const blob of BLOBS) {
    const dot = document.createElement("div");
    dot.style.cssText = `position:absolute;${blob.place};width:85%;aspect-ratio:1;border-radius:50%;background:radial-gradient(closest-side,var(${blob.color}),transparent)${HINT}`;
    layer.element.append(dot);
    if (!still) {
      dot.animate(
        [{ transform: "translate(0, 0) scale(1)" }, { transform: blob.drift }],
        {
          direction: "alternate",
          duration: blob.duration,
          easing: "ease-in-out",
          iterations: Number.POSITIVE_INFINITY,
        }
      );
    }
  }

  const write = throttle(({ mean, primary, secondary }: Colors) => {
    layer.setVar("--vl-primary", css(primary));
    layer.setVar("--vl-secondary", css(secondary));
    layer.setVar("--vl-mean", css(mean));
  }, WRITE_MS);
  const stop = watcher.subscribe(write);
  return () => {
    write.cancel();
    stop();
  };
}

export const ambient: Effect<AmbientOptions> = (source, element, options) => {
  const { element: host, release, watcher } = acquire(source, element, options);
  const layer = createLayer(host);
  layer.element.dataset.vl = "ambient";
  layer.element.style.background = BASE;
  if (COMPOSITOR_HINTS) {
    layer.element.style.contain = "paint";
  }
  const stop =
    options?.variant === "mosaic"
      ? mountMosaic(layer, watcher)
      : mountBlobs(layer, watcher, options);
  return () => {
    stop();
    layer.destroy();
    release();
  };
};
