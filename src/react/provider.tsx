import { createContext, type ReactNode, useContext, useMemo } from "react";
import type { WatcherOptions } from "../core/watcher.js";
import { useLatest, useShallowStable } from "./shallow.js";

interface GlowContextValue {
  /** How the video is read: the provider's settings, or the defaults. */
  read: WatcherOptions;
  video: HTMLVideoElement | null;
}

const GlowContext = createContext<GlowContextValue>({ read: {}, video: null });

/** The provider's video and read settings, or `null` and the defaults without one. */
export const useGlowContext = (): GlowContextValue => useContext(GlowContext);

export interface GlowProviderProps {
  children?: ReactNode;
  /** How the video is read: `method`, `depth`, `points`, `tau`, `worker`, `onError`. */
  options?: WatcherOptions;
  video: HTMLVideoElement | null;
}

/**
 * Optional: the video and how it is read (`method`, `depth`, `points`, `tau`,
 * `worker`), once for the whole tree. A read is shared per video and set by
 * its first handle; every hook below holds one with these settings, so they
 * win whatever the mount order among them. Changing them restarts every hook
 * below with the new settings: their handles are released first, so the read
 * starts afresh (no key needed). `onError` may change freely: it restarts nothing.
 *
 * Both hold only while every handle on that video lives under this provider:
 * - a handle held elsewhere (a vanilla effect such as `halo(video)`, a
 *   `useColors(video)` outside the provider, a kept `watch()` handle) keeps
 *   the read alive, so a change of `method` or any other setting silently
 *   does nothing: the first handle's settings stay;
 * - a handle without this provider that arrives while the read waits out its
 *   50 ms grace period (between the hooks' release and their restart)
 *   restarts the read with its own settings, the defaults.
 */
export function GlowProvider({ children, options, video }: GlowProviderProps) {
  const { onError, ...settings } = options ?? {};
  const stableSettings = useShallowStable(settings);
  const stableOnError = useLatest(onError);
  const value = useMemo(
    () => ({
      // Always the same wrapper, a no-op without `onError`: it may come and go.
      read: { ...stableSettings, onError: stableOnError },
      video,
    }),
    [stableOnError, stableSettings, video]
  );
  return <GlowContext.Provider value={value}>{children}</GlowContext.Provider>;
}
