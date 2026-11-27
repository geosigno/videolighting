/**
 * The halo's corners follow the rounded shape the eye sees on the video: its
 * own `border-radius`, else that of the first ancestor that clips it to a
 * rounded shape (a player's card with `overflow: hidden`). Each corner's radius
 * is written in px to `--vl-radius-*` on the halo's layer, where `glow.ts`
 * reads it. There is no setting to force a radius: the page's own shape is the
 * only source.
 */

/** The corners, as CSS names them in `border-*-radius` and here in `--vl-radius-*`. */
const CORNERS = ["top-left", "top-right", "bottom-right", "bottom-left"];

/** A computed radius in px: a `%` is a share of `size`. */
const px = (radius: string, size: number) =>
  Number.parseFloat(radius) * (radius.endsWith("%") ? size / 100 : 1) || 0;

/**
 * The corner radii of `element` in px, in the order of `CORNERS`. An elliptical
 * corner counts as its smaller radius: the halo's corners are arcs of a circle.
 */
function radiiOf(element: HTMLElement): number[] {
  const style = getComputedStyle(element);
  return CORNERS.map((corner) => {
    const [x = "", y = x] = style
      .getPropertyValue(`border-${corner}-radius`)
      .split(" ");
    return Math.min(px(x, element.offsetWidth), px(y, element.offsetHeight));
  });
}

/**
 * The element whose rounded corners show on the video: the video when it is
 * rounded itself, else its first ancestor that clips it to a rounded shape. The
 * search stops at `host`: a clip from further up cuts the halo too.
 */
function shapeOf(video: HTMLVideoElement, host: HTMLElement): HTMLElement {
  const rounded = (element: HTMLElement) =>
    radiiOf(element).some((radius) => radius > 0);
  if (rounded(video)) {
    return video;
  }
  for (let a = video.parentElement; a && a !== host; a = a.parentElement) {
    if (getComputedStyle(a).overflowX !== "visible" && rounded(a)) {
      return a;
    }
  }
  return video;
}

/**
 * Keeps the corner radii of `layer` on those of the shape around `video`, with
 * no read per frame: the observer gives the first radii, then a resize (a
 * radius in `%`, a player that folds) or the end of a transition on the shape
 * gives the next ones. Returns the function that stops it.
 */
export function followCorners(
  video: HTMLVideoElement,
  host: HTMLElement,
  layer: HTMLElement
): () => void {
  const shape = shapeOf(video, host);
  const round = () => {
    for (const [corner, radius] of radiiOf(shape).entries()) {
      layer.style.setProperty(`--vl-radius-${CORNERS[corner]}`, `${radius}px`);
    }
  };
  // Transitions of the shape's children bubble up here: only its own count.
  const transitioned = (event: Event) => {
    if (event.target === shape) {
      round();
    }
  };
  const resized = new ResizeObserver(round);
  resized.observe(shape);
  shape.addEventListener("transitionend", transitioned);
  return () => {
    resized.disconnect();
    shape.removeEventListener("transitionend", transitioned);
  };
}
