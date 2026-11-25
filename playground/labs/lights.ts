import type { Rgb } from "../internal.js";
import type { Bus } from "./bus.js";
import { css, ease, every, mean } from "./colors.js";

/**
 * The colors as data for real lamps, simulated here: a 24-LED strip around the
 * screen (WLED style) and four room lamps (Philips Hue style), both sent at the
 * 10 Hz a bridge accepts. No network involved.
 */

const LEDS = 24;
const BRIDGE_HZ = 10;

/** Hue's "xy" color from sRGB (the formula from Philips' developer docs). */
function toXy([r, g, b]: Rgb): [number, number] {
  const lin = (v: number) => {
    const c = v / 255;
    return c > 0.040_45 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92;
  };
  const [lr, lg, lb] = [lin(r), lin(g), lin(b)];
  const x = lr * 0.664_511 + lg * 0.154_324 + lb * 0.162_028;
  const y = lr * 0.283_881 + lg * 0.668_433 + lb * 0.047_685;
  const z = lr * 0.000_088 + lg * 0.072_31 + lb * 0.986_039;
  const sum = x + y + z || 1;
  return [x / sum, y / sum];
}

/** The strip, clockwise from the top left corner. */
function strip(top: Rgb[], right: Rgb[], bottom: Rgb[], left: Rgb[]): Rgb[] {
  const pick = (side: Rgb[], count: number, reverse = false) => {
    const out = Array.from({ length: count }, (_, i) => {
      const at = Math.round(((i + 0.5) * side.length) / count - 0.5);
      return (
        side[Math.min(side.length - 1, Math.max(0, at))] ?? ([0, 0, 0] as Rgb)
      );
    });
    return reverse ? out.reverse() : out;
  };
  return [
    ...pick(top, 8),
    ...pick(right, 4),
    ...pick(bottom, 8, true),
    ...pick(left, 4, true),
  ];
}

export function mountLights(
  host: HTMLElement,
  { bus }: { bus: Bus; video: HTMLVideoElement }
): () => void {
  host.classList.add("lights");
  host.innerHTML = `
    <div class="room">
      <div class="tv"></div>
      <div class="leds">${Array.from({ length: LEDS }, () => "<i></i>").join("")}</div>
      <b class="lamp l-top"></b><b class="lamp l-right"></b><b class="lamp l-bottom"></b><b class="lamp l-left"></b>
    </div>
    <pre class="payload"></pre>`;
  const leds = [...host.querySelectorAll<HTMLElement>(".leds i")];
  // 8 along the top, 4 down the right, 8 back along the bottom, 4 up the left.
  for (const [i, led] of leds.entries()) {
    let x = 0;
    let y = 0;
    if (i < 8) {
      x = (i + 0.5) / 8;
    } else if (i < 12) {
      x = 1;
      y = (i - 8 + 0.5) / 4;
    } else if (i < 20) {
      x = 1 - (i - 12 + 0.5) / 8;
      y = 1;
    } else {
      y = 1 - (i - 20 + 0.5) / 4;
    }
    led.style.left = `${x * 100}%`;
    led.style.top = `${y * 100}%`;
  }
  const lamps = {
    bottom: host.querySelector<HTMLElement>(".l-bottom"),
    left: host.querySelector<HTMLElement>(".l-left"),
    right: host.querySelector<HTMLElement>(".l-right"),
    top: host.querySelector<HTMLElement>(".l-top"),
  };
  const payload = host.querySelector<HTMLElement>(".payload");
  let current: Rgb[] = [];
  let lamp: Rgb[] = [];
  let sent = 0;
  let since = performance.now();

  const send = every(1000 / BRIDGE_HZ, () => {
    for (const [i, led] of leds.entries()) {
      led.style.background = css(current[i] ?? [0, 0, 0]);
    }
    for (const [i, side] of (
      ["top", "right", "bottom", "left"] as const
    ).entries()) {
      const color = lamp[i] ?? [0, 0, 0];
      lamps[side]?.style.setProperty("--lamp", css(color));
    }
    sent += 1;
    const seconds = (performance.now() - since) / 1000;
    if (payload && sent % 5 === 0) {
      const head = current
        .slice(0, 3)
        .map((c, i) => `${i},[${c.map(Math.round).join(",")}]`)
        .join(",");
      const [x, y] = toXy(lamp[0] ?? [0, 0, 0]);
      payload.textContent = `WLED  POST /json/state\n{"seg":[{"i":[${head},…]}]}  (${LEDS} LEDs)\n\nHue   PUT /lights/1/state\n{"on":true,"xy":[${x.toFixed(4)},${y.toFixed(4)}],"transitiontime":1}\n\n${(sent / seconds).toFixed(1)} updates/s`;
    }
  });

  const off = bus.subscribe((tick) => {
    const target = strip(
      tick.colors.top,
      tick.colors.right,
      tick.colors.bottom,
      tick.colors.left
    );
    current = target.map((c, i) => ease(current[i] ?? c, c, tick.dt, 0.12));
    const sides = [
      tick.colors.top,
      tick.colors.right,
      tick.colors.bottom,
      tick.colors.left,
    ].map((s) => mean(s));
    lamp = sides.map((c, i) => ease(lamp[i] ?? c, c, tick.dt, 0.5));
    send(tick.wall);
    since = since || performance.now();
  });
  return () => {
    off();
    host.classList.remove("lights");
    host.innerHTML = "";
  };
}
