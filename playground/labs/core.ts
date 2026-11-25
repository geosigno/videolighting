import type { Rgb } from "../internal.js";
import type { Bus } from "./bus.js";
import { ease } from "./colors.js";

/**
 * The one place where the video's colors are decided. Everything that wants
 * "the color of the video" (the background, the components, soon the rest)
 * reads it from here, so they always agree. The colors are the video's own:
 * no saturation boost, no lightness change. A consumer that has to bend a
 * color (text contrast, say) does it on its own side and says so.
 */

export interface Colors {
  /** Mean of the colors along the video's edges. */
  mean: Rgb;
  /** Dominant color, by area. */
  primary: Rgb;
  /** Second dominant color, by area. */
  secondary: Rgb;
}

export interface ColorCore {
  destroy: () => void;
  settings: { tau: number };
  state: () => Colors;
  /** Called on every display frame with the smoothed colors. */
  subscribe: (listener: (colors: Colors) => void) => () => void;
}

export interface LabContext {
  bus: Bus;
  core: ColorCore;
  video: HTMLVideoElement;
}

const distance = (a: Rgb, b: Rgb) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** The two dominant colors keep their roles from one frame to the next. */
function keepOrder(previous: Rgb[], next: Rgb[]): Rgb[] {
  const [p0, p1] = previous;
  const [n0, n1] = next;
  if (p0 && p1 && n0 && n1) {
    const straight = distance(p0, n0) + distance(p1, n1);
    const crossed = distance(p0, n1) + distance(p1, n0);
    if (crossed < straight) {
      return [n1, n0];
    }
  }
  return next;
}

export function createColorCore(bus: Bus): ColorCore {
  const neutral: Rgb = [24, 24, 30];
  let shown: Colors = { mean: neutral, primary: neutral, secondary: neutral };
  let goal: Colors = shown;
  let palette: Rgb[] = [];
  const settings = { tau: 0.12 };
  const listeners = new Set<(colors: Colors) => void>();

  const off = bus.subscribe((tick) => {
    palette = keepOrder(palette, tick.palette);
    const primary = palette[0] ?? tick.mean;
    goal = { mean: tick.mean, primary, secondary: palette[1] ?? primary };
  });

  let last = performance.now();
  let frame = 0;
  const step = (now: number) => {
    const dt = Math.min(100, now - last);
    last = now;
    shown = {
      mean: ease(shown.mean, goal.mean, dt, settings.tau),
      primary: ease(shown.primary, goal.primary, dt, settings.tau),
      secondary: ease(shown.secondary, goal.secondary, dt, settings.tau),
    };
    for (const listener of listeners) {
      listener(shown);
    }
    frame = requestAnimationFrame(step);
  };
  frame = requestAnimationFrame(step);

  return {
    destroy: () => {
      off();
      cancelAnimationFrame(frame);
    },
    settings,
    state: () => shown,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
