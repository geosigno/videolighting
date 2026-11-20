import { css } from "../core/colors.js";
import { acquire, type Effect } from "../core/effect.js";
import { createLayer, type Layer } from "../core/layer.js";
import type { Watcher } from "../core/watcher.js";
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

  return watcher.subscribe(({ mean, primary, secondary }) => {
    layer.setVar("--vl-primary", css(primary));
    layer.setVar("--vl-secondary", css(secondary));
    layer.setVar("--vl-mean", css(mean));
  });
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
