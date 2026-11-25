import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { type Colors, NEUTRAL, peekColors, watch } from "../core/watcher.js";
import { useGlowContext } from "./provider.js";

const serverSnapshot = () => NEUTRAL;

/**
 * The video's smoothed colors as React state (default: the provider's
 * video). One render per display frame while they move, at most `maxFps`
 * per second when given: the cost is that of the component using it.
 */
export function useColors(
  video?: HTMLVideoElement | null,
  options?: { maxFps?: number }
): Colors {
  const context = useGlowContext();
  const target = video ?? context.video;
  const interval = options?.maxFps ? 1000 / options.maxFps : 0;
  const { read } = context;
  const subscribe = useMemo(
    () => (onChange: () => void) => {
      if (!target) {
        return () => undefined;
      }
      // Its own handle: the colors only move while someone listens.
      const handle = watch(target, read);
      let last = Number.NEGATIVE_INFINITY;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const notify = () => {
        timer = undefined;
        last = performance.now();
        onChange();
      };
      handle.subscribe(() => {
        if (timer !== undefined) {
          return;
        }
        const wait = last + interval - performance.now();
        if (wait <= 0) {
          notify();
        } else {
          timer = setTimeout(notify, wait);
        }
      });
      return () => {
        clearTimeout(timer);
        handle.destroy();
      };
    },
    [interval, read, target]
  );
  const getSnapshot = useMemo(
    () => () => (target ? peekColors(target) : NEUTRAL),
    [target]
  );
  return useSyncExternalStore(subscribe, getSnapshot, serverSnapshot);
}

/**
 * Calls `callback` with the smoothed colors on every display frame while they
 * move, without ever rendering (for what animates). A new `callback` each
 * render does not resubscribe.
 */
export function useColorsEvent(
  video: HTMLVideoElement | null,
  callback: (colors: Colors) => void
): void {
  const context = useGlowContext();
  const target = video ?? context.video;
  const { read } = context;
  const latest = useRef(callback);
  useEffect(() => {
    latest.current = callback;
  });
  useEffect(() => {
    if (!target) {
      return;
    }
    const handle = watch(target, read);
    handle.subscribe((colors) => latest.current(colors));
    return handle.destroy;
  }, [read, target]);
}
