import type { Rgb } from "../internal.js";
import type { Bus } from "./bus.js";
import { css, ease, luminance } from "./colors.js";

/**
 * Flash safety: a glow that mirrors a strobing scene would flash too (WCAG 2.3.1
 * allows at most 3 flashes a second). Counts luminance flashes in the raw
 * colour and in a protected one that slows its changes down.
 */

interface Sample {
  protectedY: number;
  rawY: number;
  t: number;
}

const WINDOW_MS = 1000;
const HISTORY_MS = 6000;
/** A flash: lightness swings by this much and comes back. */
const SWING = 0.1;

function flashes(values: { t: number; y: number }[], now: number): number {
  let count = 0;
  let direction = 0;
  let extreme: number | undefined;
  for (const { t, y } of values) {
    if (now - t > WINDOW_MS) {
      continue;
    }
    if (extreme === undefined) {
      extreme = y;
      continue;
    }
    const delta = y - extreme;
    const dir = Math.sign(delta);
    if (Math.abs(delta) >= SWING && dir !== 0 && dir !== direction) {
      count += direction === 0 ? 0 : 1;
      direction = dir;
      extreme = y;
    } else if (dir === direction) {
      extreme = y;
    }
  }
  return Math.ceil(count / 2);
}

export function mountSafety(
  host: HTMLElement,
  { bus }: { bus: Bus; video: HTMLVideoElement }
): () => void {
  host.classList.add("safety");
  host.innerHTML = `
    <div class="pair">
      <div><i class="raw"></i><b>raw</b><span class="rawcount">0 flashes/s</span></div>
      <div><i class="safe"></i><b>protected</b><span class="safecount">0 flashes/s</span></div>
    </div>
    <canvas width="480" height="90"></canvas>
    <p>Try the “strobe” source. Raw above 3 flashes/s is flagged.</p>`;
  const rawSwatch = host.querySelector<HTMLElement>(".raw");
  const safeSwatch = host.querySelector<HTMLElement>(".safe");
  const rawCount = host.querySelector<HTMLElement>(".rawcount");
  const safeCount = host.querySelector<HTMLElement>(".safecount");
  const canvas = host.querySelector<HTMLCanvasElement>("canvas");
  const g = canvas?.getContext("2d");
  const history: Sample[] = [];
  let safe: Rgb = [30, 30, 30];

  const off = bus.subscribe((tick) => {
    // Slower than a flash (about 3 per second can pass, not more).
    safe = ease(safe, tick.mean, tick.dt, 0.45);
    history.push({
      protectedY: luminance(safe),
      rawY: luminance(tick.mean),
      t: tick.wall,
    });
    while (
      history.length > 0 &&
      tick.wall - (history[0]?.t ?? tick.wall) > HISTORY_MS
    ) {
      history.shift();
    }
    const raw = flashes(
      history.map((h) => ({ t: h.t, y: h.rawY })),
      tick.wall
    );
    const guarded = flashes(
      history.map((h) => ({ t: h.t, y: h.protectedY })),
      tick.wall
    );
    if (rawSwatch) {
      rawSwatch.style.background = css(tick.mean);
    }
    if (safeSwatch) {
      safeSwatch.style.background = css(safe);
    }
    if (rawCount) {
      rawCount.textContent = `${raw} flashes/s`;
      rawCount.dataset.bad = String(raw > 3);
    }
    if (safeCount) {
      safeCount.textContent = `${guarded} flashes/s`;
    }
    if (g && canvas) {
      g.clearRect(0, 0, canvas.width, canvas.height);
      const line = (pick: (s: Sample) => number, color: string) => {
        g.strokeStyle = color;
        g.beginPath();
        for (const [i, s] of history.entries()) {
          const x =
            ((s.t - (tick.wall - HISTORY_MS)) / HISTORY_MS) * canvas.width;
          const y = canvas.height - pick(s) * (canvas.height - 6) - 3;
          if (i === 0) {
            g.moveTo(x, y);
          } else {
            g.lineTo(x, y);
          }
        }
        g.stroke();
      };
      line((s) => s.rawY, "#888");
      line((s) => s.protectedY, "#4ade80");
    }
  });
  return () => {
    off();
    host.classList.remove("safety");
    host.innerHTML = "";
  };
}
