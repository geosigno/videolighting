import { css, forWhiteText } from "../core/colors.js";
import { acquire, type Effect } from "../core/effect.js";
import { createVarWriter } from "../core/layer.js";
import { throttle } from "../core/throttle.js";
import type { Colors } from "../core/watcher.js";

export interface ThemeOptions {
  /**
   * Contrast white text must reach on the colours, as a ratio. The colour is
   * darkened, only as much as needed, to get there. Default 4.5 (WCAG AA);
   * 1 leaves the video's colours as they are.
   */
  minContrast?: number;
  /**
   * `"vibrant"` (default): the two most vivid colours of the picture, with
   * their saturation pushed. `"natural"`: the two dominant colours along the
   * video's edges, as they are.
   */
  variant?: "natural" | "vibrant";
}

/**
 * The variables are written at most every this many ms (10 times a second),
 * not on every display frame. They are inherited: each write makes the browser
 * work out again the style of every element under the one they are set on.
 * Measured on a page of 777 elements under the theme (Chrome, 120 Hz screen):
 * a write per frame cost half a core of style calculation and left gigabytes
 * of dead style objects for the browser to collect.
 */
const WRITE_MS = 100;

/**
 * Design tokens from the video: `--video-primary` and `--video-secondary` on
 * `element`, ready for buttons, badges and bars with white text. Use them as
 * `background: var(--video-primary)`.
 */
export const theme: Effect<ThemeOptions> = (source, element, options) => {
  const { element: host, release, watcher } = acquire(source, element, options);
  const writer = createVarWriter(host);
  const minimum = options?.minContrast ?? 4.5;
  const variant = options?.variant ?? "vibrant";
  const write = throttle((colors: Colors) => {
    const { primary, secondary } = colors[variant];
    writer.set("--video-primary", css(forWhiteText(primary, minimum).bg));
    writer.set("--video-secondary", css(forWhiteText(secondary, minimum).bg));
  }, WRITE_MS);
  const stopColors = watcher.subscribe(write);
  return () => {
    write.cancel();
    stopColors();
    writer.clear();
    release();
  };
};
