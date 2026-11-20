import type { Glow } from "../src/core/glow.js";
import type { EdgeColors } from "../src/index.js";

/**
 * The previous construction, kept only as the baseline of the CSS benchmark:
 * four bands, each blurred (60px) with a saturate filter, composited with one
 * group opacity. Same cost profile as what shipped before the fade.
 */

const SIDES = ["top", "bottom", "left", "right"] as const;
type Side = (typeof SIDES)[number];

const SIZE = 40;
const BLUR = 60;

const POSITION: Record<Side, string> = {
  bottom: `left:-${SIZE}px;right:-${SIZE}px;bottom:-${SIZE}px;height:${2 * SIZE}px`,
  left: `top:0;bottom:0;left:-${SIZE}px;width:${2 * SIZE}px`,
  right: `top:0;bottom:0;right:-${SIZE}px;width:${2 * SIZE}px`,
  top: `left:-${SIZE}px;right:-${SIZE}px;top:-${SIZE}px;height:${2 * SIZE}px`,
};

const DIRECTION: Record<Side, string> = {
  bottom: "to right",
  left: "to bottom",
  right: "to bottom",
  top: "to right",
};

export function createLegacyGlow(host: HTMLElement): Glow {
  const previous = {
    isolation: host.style.isolation,
    position: host.style.position,
  };
  if (getComputedStyle(host).position === "static") {
    host.style.position = "relative";
  }
  host.style.isolation = "isolate";

  const element = document.createElement("div");
  element.style.cssText =
    "position:absolute;inset:0;z-index:-1;pointer-events:none;opacity:0.85";

  const bands = {} as Record<Side, HTMLElement>;
  for (const side of SIDES) {
    const band = document.createElement("div");
    band.style.cssText = `position:absolute;${POSITION[side]};filter:blur(${BLUR}px) saturate(1.6)`;
    element.append(band);
    bands[side] = band;
  }
  host.prepend(element);

  return {
    destroy: () => {
      element.remove();
      host.style.isolation = previous.isolation;
      host.style.position = previous.position;
    },
    element,
    update: (colors: EdgeColors) => {
      for (const side of SIDES) {
        const stops = colors[side].map(([r, g, b], i) => {
          const position = (((i + 0.5) / colors[side].length) * 100).toFixed(2);
          return `rgb(${r} ${g} ${b}) ${position}%`;
        });
        bands[side].style.backgroundImage =
          `linear-gradient(${DIRECTION[side]}, ${stops.join(", ")})`;
      }
    },
  };
}
