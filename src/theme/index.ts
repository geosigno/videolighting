import { css, forWhiteText } from "../core/colors.js";
import { acquire, type Effect } from "../core/effect.js";
import { createVarWriter } from "../core/layer.js";

export interface ThemeOptions {
  /**
   * Contrast white text must reach on the colours, as a ratio. The colour is
   * darkened, only as much as needed, to get there. Default 4.5 (WCAG AA);
   * 1 leaves the video's colours as they are.
   */
  minContrast?: number;
}

/**
 * Design tokens from the video: `--video-primary` and `--video-secondary` on
 * `element`, ready for buttons, badges and bars with white text. Use them as
 * `background: var(--video-primary)`.
 */
export const theme: Effect<ThemeOptions> = (source, element, options) => {
  const { element: host, release, watcher } = acquire(source, element, options);
  const writer = createVarWriter(host);
  const minimum = options?.minContrast ?? 4.5;
  const stopColors = watcher.subscribe(({ primary, secondary }) => {
    writer.set("--video-primary", css(forWhiteText(primary, minimum).bg));
    writer.set("--video-secondary", css(forWhiteText(secondary, minimum).bg));
  });
  return () => {
    stopColors();
    writer.clear();
    release();
  };
};
