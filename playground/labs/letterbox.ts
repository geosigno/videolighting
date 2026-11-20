import type { Rgb } from "../../src/index.js";
import type { Bus } from "./bus.js";
import { css, ease, every } from "./colors.js";

/**
 * A 16:9 video in a tall box: the black bars take the colours of the video's
 * top and bottom edges instead.
 */
export function mountLetterbox(
  host: HTMLElement,
  { bus, video }: { bus: Bus; video: HTMLVideoElement }
): () => void {
  host.classList.add("letterbox");
  host.innerHTML =
    '<div class="lb lb-top"></div><canvas width="360" height="203"></canvas><div class="lb lb-bottom"></div>';
  const top = host.querySelector<HTMLElement>(".lb-top");
  const bottom = host.querySelector<HTMLElement>(".lb-bottom");
  const canvas = host.querySelector<HTMLCanvasElement>("canvas");
  const context = canvas?.getContext("2d");
  let upper: Rgb[] = [];
  let lower: Rgb[] = [];

  const gradient = (colors: Rgb[]) =>
    `linear-gradient(to right, ${colors.map((c) => css(c)).join(", ")})`;
  const paint = every(100, () => {
    if (top && upper.length > 0) {
      top.style.background = gradient(upper);
    }
    if (bottom && lower.length > 0) {
      bottom.style.background = gradient(lower);
    }
  });
  const mirror = every(40, () => {
    if (canvas && context && video.readyState >= 2) {
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
    }
  });

  const off = bus.subscribe((tick) => {
    const follow = (current: Rgb[], next: Rgb[]) =>
      next.map((c, i) => ease(current[i] ?? c, c, tick.dt, 0.25));
    upper = follow(upper, tick.colors.top);
    lower = follow(lower, tick.colors.bottom);
    paint(tick.wall);
    mirror(tick.wall);
  });
  return () => {
    off();
    host.classList.remove("letterbox");
    host.innerHTML = "";
  };
}
