import { css } from "../core/colors.js";
import { acquire, type Effect } from "../core/effect.js";
import { createLayer } from "../core/layer.js";
import type { EdgeColors } from "../core/sample.js";
import { fitRect, type Rect, type Size } from "./fit.js";

type Side = "bottom" | "left" | "right" | "top";
const SIDES: Side[] = ["top", "right", "bottom", "left"];

/** Gradient direction along each band, following the video's edge it borders. */
const ALONG: Record<Side, string> = {
  bottom: "to right",
  left: "to bottom",
  right: "to bottom",
  top: "to right",
};

/** The veil darkens a band away from the video: from the outer edge toward the video. */
const VEIL: Record<Side, string> = {
  bottom: "to bottom",
  left: "to right",
  right: "to left",
  top: "to top",
};
const VEIL_IMAGE = (side: Side) =>
  `linear-gradient(${VEIL[side]}, rgb(0 0 0 / 0.65), transparent 70%)`;

/** The empty strip of the container a band covers, given the video's rectangle. */
function strip(side: Side, size: Size, rect: Rect): Rect {
  switch (side) {
    case "top":
      return { height: rect.y, width: size.width, x: 0, y: 0 };
    case "bottom":
      return {
        height: size.height - (rect.y + rect.height),
        width: size.width,
        x: 0,
        y: rect.y + rect.height,
      };
    case "left":
      return { height: size.height, width: rect.x, x: 0, y: 0 };
    default:
      return {
        height: size.height,
        width: size.width - (rect.x + rect.width),
        x: rect.x + rect.width,
        y: 0,
      };
  }
}

/**
 * Fills the empty space around the video, inside `element` (default: the
 * video's parent), with the colours of the video's edges: where a 16:9 video
 * sits in a taller or wider box, the bars take the colours of the edge they
 * border instead of black. The video is expected to fill `element` with
 * `object-fit: contain`. It follows the box when it is resized and the video
 * when its size changes, and draws every sampled frame (raw edge colours).
 */
export const letterbox: Effect = (source, element, options) => {
  const {
    element: host,
    release,
    video,
    watcher,
  } = acquire(source, element, options);
  const layer = createLayer(host);
  layer.element.dataset.glow = "letterbox";

  const bands = {} as Record<Side, HTMLElement>;
  for (const side of SIDES) {
    const band = document.createElement("div");
    band.dataset.side = side;
    band.style.cssText = "position:absolute;display:none";
    layer.element.append(band);
    bands[side] = band;
  }

  let size: Size = { height: host.clientHeight, width: host.clientWidth };
  let latest: EdgeColors | undefined;
  const painted = new Map<Side, string>();

  const paint = () => {
    if (!latest) {
      return;
    }
    for (const side of SIDES) {
      const band = bands[side];
      if (band.style.display === "none") {
        continue;
      }
      const image = `${VEIL_IMAGE(side)}, linear-gradient(${ALONG[side]}, ${latest[side].map((c) => css(c)).join(", ")})`;
      if (painted.get(side) !== image) {
        painted.set(side, image);
        band.style.backgroundImage = image;
      }
    }
  };

  const layout = () => {
    const rect = fitRect(size, {
      height: video.videoHeight,
      width: video.videoWidth,
    });
    for (const side of SIDES) {
      const area = strip(side, size, rect);
      const band = bands[side];
      if (area.width < 1 || area.height < 1 || rect.width === 0) {
        band.style.display = "none";
        painted.delete(side);
      } else {
        band.style.cssText = `position:absolute;left:${area.x}px;top:${area.y}px;width:${area.width}px;height:${area.height}px`;
        painted.delete(side);
      }
    }
    paint();
  };

  const observer = new ResizeObserver((entries) => {
    const box = entries.at(-1)?.contentRect;
    if (box) {
      size = { height: box.height, width: box.width };
      layout();
    }
  });
  observer.observe(host);
  video.addEventListener("loadedmetadata", layout);
  video.addEventListener("resize", layout);
  layout();

  const stopSamples = watcher.onSample((edges) => {
    latest = edges;
    paint();
  });
  return () => {
    stopSamples();
    observer.disconnect();
    video.removeEventListener("loadedmetadata", layout);
    video.removeEventListener("resize", layout);
    layer.destroy();
    release();
  };
};
