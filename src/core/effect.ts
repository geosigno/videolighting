import { locate } from "./resolve-video.js";
import { type Watcher, watch } from "./watcher.js";

/** What every effect accepts besides its own settings. */
export interface EffectOptions {
  /** Called once if the browser refuses to read the pixels (no CORS, DRM). */
  onError?: (error: unknown) => void;
}

/**
 * The one shape of an effect: `source` is the `<video>` (or a container that
 * holds one), `element` is where the effect applies (default: the video's
 * parent). It returns the function that stops it.
 */
export type Effect<O = object> = (
  source: HTMLElement,
  element?: HTMLElement,
  options?: O & EffectOptions
) => () => void;

/** What every effect starts with: find the video and the element, join the shared read. */
export function acquire(
  source: HTMLElement,
  element?: HTMLElement,
  options?: EffectOptions,
  /** `true` for an effect that only draws around the video: it may let the read pause off screen. */
  aroundVideo = false
): {
  element: HTMLElement;
  release: () => void;
  video: HTMLVideoElement;
  watcher: Watcher;
} {
  const located = locate(source, element);
  // Only `onError` goes along: how the video is read is set by `watch()`, not by an effect.
  const watcher = watch(located.video, {
    aroundVideo,
    onError: options?.onError,
  });
  return { ...located, release: watcher.destroy, watcher };
}
