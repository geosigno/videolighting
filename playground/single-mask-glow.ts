import { falloffAlpha, type Glow } from "../src/core/glow.js";
import type { EdgeColors, Rgb } from "../src/index.js";

/**
 * Experiment: the whole glow on ONE element with ONE mask.
 *  - 8 background layers (4 ribbons + 4 solid corners) on a box that overflows
 *    the video by the reach on every side;
 *  - 2 mask layers combined with `mask-composite: intersect` (= multiplied):
 *    a horizontal fade and a vertical fade. On a side the other fade is 1; in a
 *    corner both apply, so the corner falls off as fx * fy (squarer than the
 *    round patch of the shipped version).
 * Per frame: one `backgroundImage` write.
 */

const REACH = "var(--glow-reach, 140px)";
const OPACITY = "var(--glow-opacity, 0.85)";
const STEPS = 10;
const UNDER_VIDEO_PX = 4;

const css = ([r, g, b]: Rgb) => `rgb(${r} ${g} ${b})`;
const middle = (a: Rgb, b: Rgb): Rgb => [
  Math.round((a[0] + b[0]) / 2),
  Math.round((a[1] + b[1]) / 2),
  Math.round((a[2] + b[2]) / 2),
];

/** Stop positions for a ribbon of `count` zones: 0, the centre of each zone, 1. */
const fractionsFor = (count: number) => [
  0,
  ...Array.from({ length: count }, (_, i) => (i + 0.5) / count),
  1,
];

/** Fade along one axis: curve in, opaque over the video, curve out. */
function axisMask(direction: string, exponent: number, opacity: boolean) {
  const peak = opacity ? OPACITY : "1";
  const alpha = (distance: number) =>
    `rgb(0 0 0 / calc(${peak} * ${falloffAlpha(distance, exponent).toFixed(4)}))`;
  const stops: string[] = [];
  for (let step = STEPS; step >= 0; step -= 1) {
    const distance = step / STEPS;
    stops.push(
      `${alpha(distance)} calc(${REACH} * ${(1 - distance).toFixed(3)})`
    );
  }
  for (let step = 0; step <= STEPS; step += 1) {
    const distance = step / STEPS;
    stops.push(
      `${alpha(distance)} calc(100% - ${REACH} + ${REACH} * ${distance.toFixed(3)})`
    );
  }
  return `linear-gradient(${direction}, ${stops.join(", ")})`;
}

function ribbon(direction: string, start: Rgb, points: Rgb[], end: Rgb) {
  const fractions = fractionsFor(points.length);
  const stops = [start, ...points, end].map(
    (color, i) => `${css(color)} ${((fractions[i] ?? 0) * 100).toFixed(2)}%`
  );
  return `linear-gradient(${direction}, ${stops.join(", ")})`;
}

const solid = (color: Rgb) => `linear-gradient(${css(color)}, ${css(color)})`;

export function createSingleMaskGlow(host: HTMLElement, exponent = 2.5): Glow {
  const previous = {
    isolation: host.style.isolation,
    position: host.style.position,
  };
  if (getComputedStyle(host).position === "static") {
    host.style.position = "relative";
  }
  host.style.isolation = "isolate";

  const depth = `calc(${REACH} + ${UNDER_VIDEO_PX}px)`;
  const across = `calc(100% - 2 * ${REACH})`;
  // Order matches the layers written in `update`.
  const positions = [
    `${REACH} 0`,
    `${REACH} 100%`,
    `0 ${REACH}`,
    `100% ${REACH}`,
    "0 0",
    "100% 0",
    "0 100%",
    "100% 100%",
  ];
  const sizes = [
    `${across} ${depth}`,
    `${across} ${depth}`,
    `${depth} ${across}`,
    `${depth} ${across}`,
    ...Array.from({ length: 4 }, () => `${REACH} ${REACH}`),
  ];
  const mask = `${axisMask("to right", exponent, false)}, ${axisMask("to bottom", exponent, true)}`;

  const element = document.createElement("div");
  element.setAttribute("aria-hidden", "true");
  element.style.cssText = [
    "position:absolute",
    `inset:calc(-1 * ${REACH})`,
    "z-index:-1",
    "pointer-events:none",
    "background-repeat:no-repeat",
    `background-position:${positions.join(", ")}`,
    `background-size:${sizes.join(", ")}`,
    `-webkit-mask-image:${mask}`,
    `mask-image:${mask}`,
    "-webkit-mask-composite:source-in",
    "mask-composite:intersect",
  ].join(";");
  host.prepend(element);

  return {
    destroy: () => {
      element.remove();
      host.style.isolation = previous.isolation;
      host.style.position = previous.position;
    },
    element,
    update: (colors: EdgeColors) => {
      const { bottom, left, right, top } = colors;
      const black: Rgb = [0, 0, 0];
      const tl = middle(top.at(0) ?? black, left.at(0) ?? black);
      const tr = middle(top.at(-1) ?? black, right.at(0) ?? black);
      const bl = middle(bottom.at(0) ?? black, left.at(-1) ?? black);
      const br = middle(bottom.at(-1) ?? black, right.at(-1) ?? black);
      element.style.backgroundImage = [
        ribbon("to right", tl, top, tr),
        ribbon("to right", bl, bottom, br),
        ribbon("to bottom", tl, left, bl),
        ribbon("to bottom", tr, right, br),
        solid(tl),
        solid(tr),
        solid(bl),
        solid(br),
      ].join(", ");
    },
  };
}
