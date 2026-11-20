import { useEffect } from "react";
import type { Effect, EffectOptions } from "../core/effect.js";
import { watch } from "../core/watcher.js";
import { useGlowContext } from "./provider.js";
import { useLatest, useShallowStable } from "./shallow.js";

export interface GlowTargets {
  /** Where the effect applies; `undefined`: the video's parent; `null`: not yet. */
  element?: HTMLElement | null;
  video: HTMLVideoElement | null;
}

/**
 * Runs `effect` while mounted. It restarts only when the video, the element,
 * the effect or an option value changes (options are compared by value).
 * It first joins the read with the provider's settings, so they hold even
 * though children mount before their provider, and lets go of that handle
 * once the effect holds its own: one handle per effect.
 */
export function useGlow<O>(
  effect: Effect<O>,
  { element, video }: GlowTargets,
  options?: O & EffectOptions
): void {
  const { read } = useGlowContext();
  // `onError` is held aside, so an inline callback does not restart the effect.
  const { onError, ...settings } = options ?? {};
  const stableSettings = useShallowStable(settings);
  const stableOnError = useLatest(onError);
  useEffect(() => {
    if (!video || element === null) {
      return;
    }
    // This handle only fixes the read settings: the effect's own handle keeps
    // the read alive, so it is released at once and `references` counts effects.
    // Without `onError`: joining a read that already failed would replay the
    // failure to it too. The provider's `onError` rides on the effect's handle.
    const { onError: providerOnError, ...readSettings } = read;
    const handle = watch(video, readSettings);
    // Always given (both are stable, no-ops without a callback): an `onError`
    // that comes and goes changes nothing the effect sees.
    const onEffectError = (error: unknown) => {
      stableOnError(error);
      providerOnError?.(error);
    };
    try {
      return effect(video, element, {
        ...stableSettings,
        onError: onEffectError,
      } as O & EffectOptions);
    } finally {
      handle.destroy();
    }
  }, [effect, element, read, stableOnError, stableSettings, video]);
}
