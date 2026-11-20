import { type SampleCost, watchVideo } from "./capture.js";
import { createSmoother, mean, palette, type Smoother } from "./colors.js";
import type { MethodChoice, ReadMethod } from "./reader.js";
import type { EdgeColors, EdgeLayout, Rgb } from "./sample.js";

/**
 * One read of a video, shared by everything that wants its colours.
 *
 * `watch(video)` gives a handle; the first handle for a video starts the read,
 * the last `destroy()` stops it (after a short grace period, so a quick
 * unmount-then-remount, React StrictMode say, does not restart it). Two streams:
 *  - `onSample`: the raw edge colours, on every sampled frame;
 *  - `subscribe`: three smoothed colours, on every display frame, only while
 *    they are moving. The palette and the smoothing are not computed at all
 *    while nobody subscribes.
 * When the video leaves the viewport the read pauses, and so do both streams:
 * what was last painted stays.
 */

/** The video's colours, smoothed. */
export interface Colors {
  /** Mean of the colours along the video's edges. */
  mean: Rgb;
  /** Dominant colour, by area. */
  primary: Rgb;
  /** Second dominant colour, by area. */
  secondary: Rgb;
}

const NEUTRAL_RGB: Rgb = [24, 24, 30];
/** What `state()` gives before the first frame; also a server-side snapshot. */
export const NEUTRAL: Colors = Object.freeze({
  mean: NEUTRAL_RGB,
  primary: NEUTRAL_RGB,
  secondary: NEUTRAL_RGB,
});

export interface WatcherOptions extends EdgeLayout {
  /** How the Worker reads the frames. Default `"auto"`: measure and pick. */
  method?: MethodChoice;
  /** Called once if the browser refuses to read the pixels (no CORS, DRM). */
  onError?: (error: unknown) => void;
  /** Time constant of the smoothing, in seconds. Default 0.12. */
  tau?: number;
  /** `false` forces the main-thread engine. Default: the Worker engine. */
  worker?: boolean;
}

export interface WatcherStats {
  method: ReadMethod;
  /** Handles alive for this video: how many effects share the read. */
  references: number;
  samples: number;
  /** Frames lost to the main-thread budget (not merely deferred). */
  skipped: number;
  /**
   * Main-thread ms the watcher and its listeners used between one sampled frame
   * and the next (palette, smoothing, every `onSample` and `subscribe`
   * listener), smoothed over the last frames.
   */
  watcherMs: number;
}

export interface Watcher {
  /** Release this handle. The read stops when the last handle is released. Idempotent. */
  destroy: () => void;
  /** Raw edge colours of every sampled frame. Returns the unsubscribe function. */
  onSample: (
    listener: (edges: EdgeColors, cost: SampleCost) => void
  ) => () => void;
  /** The smoothed colours now; the same object until they change. */
  state: () => Colors;
  stats: () => WatcherStats;
  /**
   * Smoothed colours on every display frame while they move, and once right
   * away with the current ones. Returns the unsubscribe function.
   */
  subscribe: (listener: (colors: Colors) => void) => () => void;
  readonly video: HTMLVideoElement;
}

/** Wait this long before stopping a read nobody uses any more. */
export const GRACE_MS = 50;
const DEFAULT_TAU = 0.12;
const STATS_SMOOTHING = 0.1;

interface Shared {
  colors: Colors;
  errorListeners: Set<(error: unknown) => void>;
  /** Why the read stopped, until a new video gives it another chance. */
  failure: { error: unknown } | undefined;
  frameListeners: Set<(colors: Colors) => void>;
  goal: Rgb[];
  /** The last sampled frame, replayed to an effect that joins a paused video. */
  last: { cost: SampleCost; edges: EdgeColors } | undefined;
  lastTick: number;
  method: ReadMethod;
  /** Main-thread ms accumulated since the previous sampled frame. */
  pendingMs: number;
  raf: number | undefined;
  /** The read settings it was started with, as `readKey` gives them. */
  readKey: string;
  references: number;
  removeEvents: () => void;
  retarget: (edges: EdgeColors) => void;
  sampleListeners: Set<(edges: EdgeColors, cost: SampleCost) => void>;
  samples: number;
  skipped: number;
  smoother: Smoother;
  snapNext: boolean;
  stopRead: () => void;
  teardown: ReturnType<typeof setTimeout> | undefined;
  watcherMs: number;
}

const shared = new WeakMap<HTMLVideoElement, Shared>();

/**
 * Call a listener without letting it break the read for everyone else: a throw
 * is re-raised on its own, as an uncaught error, and nothing else is affected.
 */
function call<A extends unknown[]>(listener: (...args: A) => void, ...args: A) {
  try {
    listener(...args);
  } catch (error) {
    queueMicrotask(() => {
      throw error;
    });
  }
}

/** Whole-number channels, so a still picture gives the very same goal every sample. */
const whole = ([r, g, b]: Rgb): Rgb => [
  Math.round(r),
  Math.round(g),
  Math.round(b),
];

const distance = (a: Rgb, b: Rgb) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** The two dominant colours keep their roles from one frame to the next. */
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

function asColors([primary, secondary, average]: Rgb[]): Colors {
  const fallback = primary ?? NEUTRAL_RGB;
  return Object.freeze({
    mean: average ?? fallback,
    primary: fallback,
    secondary: secondary ?? fallback,
  });
}

/** The settings that shape a read (not `onError`), as a comparable string. */
export const readKey = ({
  depth,
  method,
  points,
  tau,
  worker,
}: WatcherOptions): string =>
  JSON.stringify([depth, method, points, tau, worker]);

function startRead(video: HTMLVideoElement, options: WatcherOptions): Shared {
  const state: Shared = {
    colors: NEUTRAL,
    errorListeners: new Set(),
    failure: undefined,
    frameListeners: new Set(),
    goal: [NEUTRAL_RGB, NEUTRAL_RGB, NEUTRAL_RGB],
    last: undefined,
    lastTick: 0,
    method: "canvas",
    pendingMs: 0,
    raf: undefined,
    readKey: readKey(options),
    references: 0,
    removeEvents: () => undefined,
    retarget: () => undefined,
    sampleListeners: new Set(),
    samples: 0,
    skipped: 0,
    smoother: createSmoother(options.tau ?? DEFAULT_TAU, [
      NEUTRAL_RGB,
      NEUTRAL_RGB,
      NEUTRAL_RGB,
    ]),
    snapNext: true,
    stopRead: () => undefined,
    teardown: undefined,
    watcherMs: 0,
  };

  const publish = () => {
    state.colors = asColors(state.smoother.colors);
  };

  const tick = (now: number) => {
    state.raf = undefined;
    const started = performance.now();
    const dt = state.lastTick === 0 ? 16 : Math.min(100, now - state.lastTick);
    state.lastTick = now;
    if (state.smoother.step(state.goal, dt)) {
      publish();
      for (const listener of state.frameListeners) {
        call(listener, state.colors);
      }
      schedule();
    } else {
      state.lastTick = 0;
    }
    state.pendingMs += performance.now() - started;
  };

  function schedule() {
    if (state.raf === undefined && state.frameListeners.size > 0) {
      state.raf = requestAnimationFrame(tick);
    }
  }

  const retarget = (edges: EdgeColors) => {
    const points = [
      ...edges.top,
      ...edges.right,
      ...edges.bottom,
      ...edges.left,
    ];
    const [first, second] = keepOrder(state.goal, palette(points, 2));
    const next = [
      whole(first ?? NEUTRAL_RGB),
      whole(second ?? first ?? NEUTRAL_RGB),
      whole(mean(points)),
    ];
    const unchanged = next.every((color, i) =>
      color.every((channel, c) => channel === state.goal[i]?.[c])
    );
    state.goal = next;
    if (state.snapNext) {
      state.snapNext = false;
      state.smoother.snap(state.goal);
      publish();
      for (const listener of state.frameListeners) {
        call(listener, state.colors);
      }
    }
    // A goal that did not move gives the loop nothing to do: no frame to schedule.
    if (!unchanged) {
      schedule();
    }
  };
  state.retarget = retarget;

  const begin = () =>
    watchVideo(video, {
      depth: options.depth,
      method: options.method,
      onColors: (edges, cost) => {
        const started = performance.now();
        state.samples += 1;
        state.method = cost.method;
        state.last = { cost, edges };
        for (const listener of state.sampleListeners) {
          call(listener, edges, cost);
        }
        if (state.frameListeners.size > 0) {
          retarget(edges);
        }
        const used = state.pendingMs + (performance.now() - started);
        state.pendingMs = 0;
        state.watcherMs += (used - state.watcherMs) * STATS_SMOOTHING;
      },
      onError: (error) => {
        state.failure = { error };
        for (const listener of state.errorListeners) {
          call(listener, error);
        }
      },
      onSkip: () => {
        state.skipped += 1;
      },
      points: options.points,
      worker: options.worker,
    });

  const rearm = () => {
    state.snapNext = true;
    if (state.failure) {
      // A new video: the read that failed on the old one gets another chance.
      state.failure = undefined;
      state.stopRead();
      state.stopRead = begin();
    }
  };
  video.addEventListener("loadstart", rearm);
  video.addEventListener("emptied", rearm);
  state.removeEvents = () => {
    video.removeEventListener("loadstart", rearm);
    video.removeEventListener("emptied", rearm);
  };

  state.stopRead = begin();
  return state;
}

function stopRead(video: HTMLVideoElement, state: Shared) {
  state.stopRead();
  state.removeEvents();
  if (state.raf !== undefined) {
    cancelAnimationFrame(state.raf);
  }
  shared.delete(video);
}

const statsOf = (read: Shared): WatcherStats => ({
  method: read.method,
  references: read.references,
  samples: read.samples,
  skipped: read.skipped,
  watcherMs: read.watcherMs,
});

/** Read-only view of a running read, for diagnostics: it holds no reference. */
export interface Inspector {
  onSample: (
    listener: (edges: EdgeColors, cost: SampleCost) => void
  ) => () => void;
  stats: () => WatcherStats;
}

/** The running read of `video`, if there is one, without joining it. */
export function inspect(video: HTMLVideoElement): Inspector | undefined {
  const read = shared.get(video);
  if (!read) {
    return undefined;
  }
  return {
    onSample: (listener) => {
      read.sampleListeners.add(listener);
      return () => read.sampleListeners.delete(listener);
    },
    stats: () => statsOf(read),
  };
}

/**
 * The smoothed colours of the running read of `video`, or `NEUTRAL` when there
 * is none. Like `inspect`, it holds no reference. It returns the same object
 * until the colours change, so it can serve as a `getSnapshot`.
 */
export function peekColors(video: HTMLVideoElement): Colors {
  return shared.get(video)?.colors ?? NEUTRAL;
}

/**
 * Start (or join) the shared read of `video`. Options only matter to the first
 * handle: a later handle with other options joins the read as it is. A read
 * nobody holds any more (in its grace period) is restarted instead when the
 * new handle asks for other read settings.
 */
export function watch(
  video: HTMLVideoElement,
  options: WatcherOptions = {}
): Watcher {
  let state = shared.get(video);
  if (state && state.references <= 0 && state.readKey !== readKey(options)) {
    clearTimeout(state.teardown);
    stopRead(video, state);
    state = undefined;
  }
  if (state) {
    clearTimeout(state.teardown);
    state.teardown = undefined;
  } else {
    state = startRead(video, options);
    shared.set(video, state);
  }
  const read = state;
  read.references += 1;

  const mine = {
    error: new Set<(error: unknown) => void>(),
    frame: new Set<(colors: Colors) => void>(),
    sample: new Set<(edges: EdgeColors, cost: SampleCost) => void>(),
  };
  let released = false;

  // Every handle hears about a failed read, also one that joins after it failed.
  const { onError } = options;
  if (onError) {
    // One wrapper per handle: the same callback given to several effects is
    // called once for each, and stopping one effect never silences another.
    const report = (error: unknown) => call(onError, error);
    mine.error.add(report);
    read.errorListeners.add(report);
    const { failure } = read;
    if (failure) {
      queueMicrotask(() => report(failure.error));
    }
  }

  const destroy = () => {
    if (released) {
      return;
    }
    released = true;
    for (const listener of mine.frame) {
      read.frameListeners.delete(listener);
    }
    for (const listener of mine.sample) {
      read.sampleListeners.delete(listener);
    }
    for (const listener of mine.error) {
      read.errorListeners.delete(listener);
    }
    read.references -= 1;
    if (read.references <= 0) {
      read.teardown = setTimeout(() => {
        if (read.references <= 0) {
          stopRead(video, read);
        }
      }, GRACE_MS);
    }
  };

  return {
    destroy,
    onSample: (listener) => {
      mine.sample.add(listener);
      read.sampleListeners.add(listener);
      if (read.last) {
        call(listener, read.last.edges, read.last.cost);
      }
      return () => {
        mine.sample.delete(listener);
        read.sampleListeners.delete(listener);
      };
    },
    state: () => read.colors,
    stats: () => statsOf(read),
    subscribe: (listener) => {
      mine.frame.add(listener);
      const first = read.frameListeners.size === 0;
      read.frameListeners.add(listener);
      if (first && read.last) {
        // Nobody smoothed so far, and a paused video sends no frame: use the last one.
        read.snapNext = true;
        read.retarget(read.last.edges);
      } else {
        call(listener, read.colors);
      }
      return () => {
        mine.frame.delete(listener);
        read.frameListeners.delete(listener);
      };
    },
    video,
  };
}
