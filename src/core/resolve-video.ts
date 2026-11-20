/**
 * Finding the `<video>` an effect is about, and the element it applies to.
 * Kept free of the sampling engine so it can be tested without a browser.
 * Detection is by `tagName`, not `instanceof`, for the same reason.
 */

const isVideo = (source: unknown): source is HTMLVideoElement =>
  typeof source === "object" &&
  source !== null &&
  (source as { tagName?: string }).tagName === "VIDEO";

/** The video itself, or the first `<video>` inside `source`. */
export function resolveVideo(source: unknown): HTMLVideoElement | undefined {
  if (isVideo(source)) {
    return source;
  }
  const found = (
    source as { querySelector?: (selector: string) => unknown } | null
  )?.querySelector?.("video");
  return isVideo(found) ? found : undefined;
}

/** The video and the element an effect applies to (default: the video's parent). */
export function locate(
  source: unknown,
  element?: HTMLElement
): { element: HTMLElement; video: HTMLVideoElement } {
  const video = resolveVideo(source);
  if (!video) {
    throw new Error(
      "glow: no <video> found in the element passed to the effect"
    );
  }
  const target = element ?? video.parentElement;
  if (!target) {
    throw new Error("glow: the effect needs an element to apply to");
  }
  return { element: target, video };
}
