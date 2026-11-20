import { acquire, type Effect } from "../core/effect.js";
import { createGlow } from "../core/glow.js";

/**
 * The glow around the video: colour bands along its edges, fading into nothing.
 * It draws every sampled frame as it comes (raw edge colours, no smoothing).
 * Tune it with the CSS variables `--glow-reach` and `--glow-opacity`.
 */
export const halo: Effect = (source, element, options) => {
  const { element: host, release, watcher } = acquire(source, element, options);
  const glow = createGlow(host);
  glow.element.dataset.glow = "halo";
  const stopSamples = watcher.onSample((edges) => glow.update(edges));
  return () => {
    stopSamples();
    glow.destroy();
    release();
  };
};
