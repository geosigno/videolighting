import type { GlReader } from "./gl-reader.js";
import {
  type EdgeColors,
  type EdgeLayout,
  SAMPLE_HEIGHT,
  SAMPLE_WIDTH,
  sampleEdges,
} from "./sample.js";

/** How the colors of a frame were read. */
export type ReadMethod = "canvas" | "webgl";

export interface FrameRead {
  colors: EdgeColors;
  method: ReadMethod;
  /** The frame was read both ways to compare them: its read cost is inflated. */
  probe?: boolean;
}

/** "auto" measures and picks; the others force a method. */
export type MethodChoice = "auto" | "webgl" | "canvas";

export interface Readers {
  /** Draws the frame to a canvas and reads it: the reference colors. */
  canvas: (frame: VideoFrame) => Uint8ClampedArray;
  /** The GPU one, if the browser has it. */
  gl?: GlReader;
  /** Default "auto". */
  method?: MethodChoice;
  now?: () => number;
}

/**
 * Mean gap (per 255) past which the WebGL colors are taken to be wrong rather
 * than slightly different. Browsers convert the video's colors a little
 * differently between the two paths (up to ~10 measured on Safari, invisible
 * in a halo); a flipped or scrambled picture is off by 45 or more.
 */
const MAX_GAP = 20;
/**
 * A picture has to have something in it to prove anything: a black frame reads
 * the same flipped. Spread = highest minus lowest channel value.
 */
const MIN_SPREAD = 40;
/**
 * Frames read both ways to compare the two methods, each time it is done. The
 * median of 5 shrugs off the slow first frames and a 1 ms timer.
 */
const PROBES = 5;
/**
 * The other method has to be this much faster than the one in use to replace
 * it. Both ways: the canvas colors are the reference, and a method that is only
 * a little faster is not worth a switch.
 */
const MUST_TAKE = 0.7;
/** The comparison is redone this often, as a safety net. */
const RECHECK_MS = 60_000;
/**
 * ...and at once when the method in use gets this much slower or faster than
 * it was: the machine's load changed, so the ranking may have too.
 */
const DRIFT = 1.5;
/** ...and when it goes over this many ms (once, until it has been under again). */
const LIMIT_MS = 10;
/** Frames the method in use is timed over before a change is judged. */
const DRIFT_WINDOW = 15;
/** No two comparisons closer than this. */
const MIN_RECHECK_GAP_MS = 10_000;

const flatten = (colors: EdgeColors): number[] =>
  [colors.top, colors.right, colors.bottom, colors.left].flatMap((side) =>
    side.flat()
  );

/** The frame's own width over height, if it says: the sample is squashed to 16:9 whatever the video is. */
const aspectOf = (frame: VideoFrame): number | undefined =>
  frame.displayWidth > 0 && frame.displayHeight > 0
    ? frame.displayWidth / frame.displayHeight
    : undefined;

const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;

/**
 * Reads the colors of frames with whichever method is faster right now on this
 * browser, this machine and this video size.
 *
 * Which one wins differs between browsers (4K frame, worker side: Chrome WebGL
 * 3 ms against canvas 14; Safari 3 against 33; Firefox 22 against 6) and
 * between versions of the same browser, so nothing is assumed: the first
 * frames with something in them are read both ways and timed, then the faster
 * one serves. The comparison runs again at once when the video changes size,
 * when the method in use gets 50 % slower or faster than it was (the load on
 * the machine changed) or goes over 10 ms, and every minute as a safety net.
 * A method replaces the one in use only if it is 30 % faster.
 *
 * `method: "canvas"` never uses WebGL; `method: "webgl"` uses it with no probe
 * and no check of its colors (the caller asked), falling back to the canvas for
 * good only if it is missing or throws.
 *
 * Safeguards: if WebGL's colors are ever grossly off the canvas ones (flipped
 * picture, scrambled channels), or WebGL throws, it is dropped for good.
 */
export function createReader({
  canvas,
  gl,
  now = () => performance.now(),
  method = "auto",
}: Readers): (frame: VideoFrame, layout: EdgeLayout) => FrameRead {
  let fast = gl;
  let using: ReadMethod = "canvas";
  let probing = true;
  let probes: Record<ReadMethod, number[]> = { canvas: [], webgl: [] };
  let probedWidth: number | undefined;
  let probedAt = Number.NEGATIVE_INFINITY;
  let baseline = 0;
  let recent: number[] = [];
  /** Over the limit and already compared: no new comparison until it is under again. */
  let limitLatched = false;

  const read = (
    data: Uint8ClampedArray,
    layout: EdgeLayout,
    frame: VideoFrame
  ) => sampleEdges(data, SAMPLE_WIDTH, SAMPLE_HEIGHT, layout, aspectOf(frame));
  const timed = <T>(fn: () => T): [T, number] => {
    const start = now();
    const value = fn();
    return [value, now() - start];
  };
  const viaCanvas = (frame: VideoFrame, layout: EdgeLayout): FrameRead => ({
    colors: read(canvas(frame), layout, frame),
    method: "canvas",
  });
  /** No probe, no check: the caller chose. WebGL missing or throwing ends it. */
  const forced = (
    choice: "canvas" | "webgl",
    frame: VideoFrame,
    layout: EdgeLayout
  ): FrameRead => {
    const glRead = fast;
    if (choice === "webgl" && glRead) {
      try {
        return { colors: read(glRead(frame), layout, frame), method: "webgl" };
      } catch {
        fast = undefined;
      }
    }
    return viaCanvas(frame, layout);
  };
  const startProbing = () => {
    probing = true;
    probes = { canvas: [], webgl: [] };
  };
  const windowFull = () => recent.length >= DRIFT_WINDOW;
  /** Much slower or much faster than when the method was chosen (2 ms at least: timers are coarse). */
  const drifted = () => {
    if (!windowFull()) {
      return false;
    }
    const typical = median(recent);
    return (
      typical > Math.max(baseline * DRIFT, baseline + 2) ||
      typical < Math.min(baseline / DRIFT, baseline - 2)
    );
  };
  const overLimit = () =>
    windowFull() && !limitLatched && median(recent) > LIMIT_MS;

  /** Both methods on one frame; the one in use is what is served. */
  const probe = (
    glRead: GlReader,
    frame: VideoFrame,
    layout: EdgeLayout
  ): FrameRead => {
    let raw: EdgeColors;
    let glMs: number;
    try {
      [raw, glMs] = timed(() => read(glRead(frame), layout, frame));
    } catch {
      fast = undefined;
      return viaCanvas(frame, layout);
    }
    const [reference, canvasMs] = timed(() =>
      read(canvas(frame), layout, frame)
    );
    const served = (): FrameRead =>
      using === "webgl"
        ? { colors: raw, method: "webgl", probe: true }
        : { colors: reference, method: "canvas", probe: true };
    const expected = flatten(reference);
    if (Math.max(...expected) - Math.min(...expected) < MIN_SPREAD) {
      return served();
    }
    const actual = flatten(raw);
    const gap =
      expected.reduce(
        (sum, value, i) => sum + Math.abs(value - (actual[i] ?? 0)),
        0
      ) / expected.length;
    if (gap > MAX_GAP) {
      fast = undefined;
      return { colors: reference, method: "canvas", probe: true };
    }
    probes.webgl.push(glMs);
    probes.canvas.push(canvasMs);
    if (probes.webgl.length >= PROBES) {
      const webgl = median(probes.webgl);
      const plain = median(probes.canvas);
      if (using === "canvas" && webgl < plain * MUST_TAKE) {
        using = "webgl";
      } else if (using === "webgl" && plain < webgl * MUST_TAKE) {
        using = "canvas";
      }
      baseline = using === "webgl" ? webgl : plain;
      recent = [];
      // Still over the limit after comparing: nothing better, stay quiet.
      limitLatched = baseline > LIMIT_MS;
      probing = false;
      probedAt = now();
    }
    return served();
  };

  /** Time to compare the methods again, whatever the reason. */
  const dueForProbe = () =>
    !probing &&
    now() - probedAt >= MIN_RECHECK_GAP_MS &&
    (now() - probedAt >= RECHECK_MS || drifted() || overLimit());

  /** Keeps the cost of the method in use, to notice when it changes. */
  const remember = (ms: number) => {
    recent.push(ms);
    if (recent.length > DRIFT_WINDOW) {
      recent.shift();
    }
    if (windowFull() && median(recent) <= LIMIT_MS) {
      limitLatched = false;
    }
  };

  return (frame, layout) => {
    if (method !== "auto") {
      return forced(method, frame, layout);
    }
    const glRead = fast;
    if (!glRead) {
      return viaCanvas(frame, layout);
    }
    if (frame.displayWidth !== probedWidth) {
      probedWidth = frame.displayWidth;
      using = "canvas";
      startProbing();
    } else if (dueForProbe()) {
      startProbing();
    }
    if (probing) {
      return probe(glRead, frame, layout);
    }
    try {
      const [colors, ms] = timed(() =>
        read(using === "webgl" ? glRead(frame) : canvas(frame), layout, frame)
      );
      remember(ms);
      return { colors, method: using };
    } catch (error) {
      if (using === "canvas") {
        throw error;
      }
      // GPU trouble (lost context, unsupported upload): never use it again.
      fast = undefined;
      return viaCanvas(frame, layout);
    }
  };
}
