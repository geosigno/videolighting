import { type EdgeColors, type Rgb, watchVideo } from "../internal.js";
import { flat, mean, palette } from "./colors.js";

/** What every lab receives for each sampled frame. */
export interface Tick {
  colors: EdgeColors;
  /** Milliseconds since the previous tick. */
  dt: number;
  /** Mean of all the edge colors. */
  mean: Rgb;
  /** Two dominant colors, most important first. */
  palette: Rgb[];
  /** `video.currentTime` when the frame was sampled. */
  time: number;
  /** `performance.now()` when the tick was made. */
  wall: number;
}

export interface Bus {
  start: () => void;
  subscribe: (listener: (tick: Tick) => void) => () => void;
}

/**
 * One `watchVideo` shared by every lab: the library is used as it is, the labs
 * only add what they need on top of the colors it returns.
 */
export function createBus(video: HTMLVideoElement): Bus {
  const listeners = new Set<(tick: Tick) => void>();
  let stop: () => void = () => undefined;
  let last = performance.now();
  return {
    start: () => {
      stop();
      stop = watchVideo(video, {
        onColors: (colors) => {
          const wall = performance.now();
          const points = flat(colors);
          const tick: Tick = {
            colors,
            dt: wall - last,
            mean: mean(points),
            palette: palette(points, 2),
            time: video.currentTime,
            wall,
          };
          last = wall;
          for (const listener of listeners) {
            listener(tick);
          }
        },
      });
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
