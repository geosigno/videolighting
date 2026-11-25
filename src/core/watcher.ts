import { type SampleCost, watchVideo } from "./capture.js";
import { createSmoother, pickGoal, type Smoother } from "./colors.js";
import { posterShown, watchPoster } from "./poster.js";
import type { MethodChoice, ReadMethod } from "./reader.js";
import type { EdgeColors, EdgeLayout, Rgb } from "./sample.js";

/**
 * One read of a video, shared by everything that wants its colors.
 *
 * `watch(video)` gives a handle; the first handle for a video starts the read,
 * the last `destroy()` stops it (after a short grace period, so a quick
 * unmount-then-remount, React StrictMode say, does not restart it). Two streams:
 *  - `onSample`: the raw edge colors, on every sampled frame;
 *  - `subscribe`: the smoothed colors, on every display frame, only while
 *    they are moving. The palette and the smoothing are not computed at all
 *    while nobody subscribes.
 * When the video leaves the viewport the read pauses, and so do both streams
 * (what was last painted stays), but only if every handle merely draws around
 * the video (`aroundVideo`: halo). A background, a theme or a plain
 * `watch()` can be anywhere in the page: they keep the read going.
 */

/** Two colors of the video: the main one and a second one. */
export interface ColorPair {
  primary: Rgb;
  secondary: Rgb;
}

/** The video's colors, smoothed. */
export interface Colors {
  /** Mean of the colors along the video's edges. */
  mean: Rgb;
  /** The two dominant colors along the edges, by area, as they are. */
  natural: ColorPair;
  /**
   * The two most vivid colors of the whole picture (a pink shirt on a beige
   * scene), with their saturation pushed. The dominant ones, pushed, when the
   * picture has nothing vivid.
   */
  vibrant: ColorPair;
}

const NEUTRAL_RGB: Rgb = [24, 24, 30];
/** The five colors of a read before its first frame, in `pickGoal`'s order. */
const STILL: Rgb[] = Array.from({ length: 5 }, () => NEUTRAL_RGB);
/** What `state()` gives before the first frame; also a server-side snapshot. */
export const NEUTRAL: Colors = Object.freeze({
  mean: NEUTRAL_RGB,
  natural: { primary: NEUTRAL_RGB, secondary: NEUTRAL_RGB },
  vibrant: { primary: NEUTRAL_RGB, secondary: NEUTRAL_RGB },
});

export interface WatcherOptions extends EdgeLayout {
  /**
   * This handle only draws around the video (a halo), so it has
   * no use for the colors while the video is off screen. The read pauses there
   * only if every handle says so. Default `false`: the colors are wanted
   * wherever the video is in the page (a background, a theme, `watch()`).
   */
  aroundVideo?: boolean;
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
  /** Raw edge colors of every sampled frame. Returns the unsubscribe function. */
  onSample: (
    listener: (edges: EdgeColors, cost: SampleCost) => void
  ) => () => void;
  /** The smoothed colors now; the same object until they change. */
  state: () => Colors;
  stats: () => WatcherStats;
  /**
   * Smoothed colors on every display frame while they move, and once right
   * away with the current ones. Returns the unsubscribe function.
   */
  subscribe: (listener: (colors: Colors) => void) => () => void;
  readonly video: HTMLVideoElement;
}

/** Wait this long before stopping a read nobody uses any more. */
export const GRACE_MS = 50;
const DEFAULT_TAU = 0.12;
const STATS_SMOOTHING = 0.1;
/** What a poster costs the listeners: nothing measured, it is read once on the main thread. */
const POSTER_COST: SampleCost = {
  latencyMs: 0,
  mainMs: 0,
  method: "canvas",
  probe: false,
  workerMs: 0,
};

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
  /** Handles that want the colors even while the video is off screen. */
  pageWide: number;
  /** Main-thread ms accumulated since the previous sampled frame. */
  pendingMs: number;
  raf: number | undefined;
  /** The read settings it was started with, as `readKey` gives them. */
  readKey: string;
  /** Ask the read to look again at whether it may pause off screen. */
  recheck: () => void;
  references: number;
  removeEvents: () => void;
  retarget: (edges: EdgeColors) => void;
  sampleListeners: Set<(edges: EdgeColors, cost: SampleCost) => void>;
  samples: number;
  skipped: number;
  smoother: Smoother;
  snapNext: boolean;
  stopPoster: () => void;
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

function asColors([
  first = NEUTRAL_RGB,
  second = first,
  average = first,
  vivid = first,
  other = vivid,
]: Rgb[]): Colors {
  return Object.freeze({
    mean: average,
    natural: { primary: first, secondary: second },
    vibrant: { primary: vivid, secondary: other },
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
    goal: STILL,
    last: undefined,
    lastTick: 0,
    method: "canvas",
    pageWide: 0,
    pendingMs: 0,
    raf: undefined,
    recheck: () => undefined,
    readKey: readKey(options),
    references: 0,
    removeEvents: () => undefined,
    retarget: () => undefined,
    sampleListeners: new Set(),
    samples: 0,
    skipped: 0,
    smoother: createSmoother(options.tau ?? DEFAULT_TAU, STILL),
    snapNext: true,
    stopPoster: () => undefined,
    stopRead: () => undefined,
    teardown: undefined,
    watcherMs: 0,
  };

  /** Publish the smoothed colors and tell the frame listeners. */
  const emit = () => {
    state.colors = asColors(state.smoother.colors);
    for (const listener of state.frameListeners) {
      call(listener, state.colors);
    }
  };

  const tick = (now: number) => {
    state.raf = undefined;
    const started = performance.now();
    const dt = state.lastTick === 0 ? 16 : Math.min(100, now - state.lastTick);
    state.lastTick = now;
    if (state.smoother.step(state.goal, dt)) {
      emit();
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
    const next = pickGoal(edges, state.goal, NEUTRAL_RGB);
    const unchanged = next.every((color, i) =>
      color.every((channel, c) => channel === state.goal[i]?.[c])
    );
    state.goal = next;
    if (state.snapNext) {
      state.snapNext = false;
      state.smoother.snap(state.goal);
      emit();
    }
    // A goal that did not move gives the loop nothing to do: no frame to schedule.
    if (!unchanged) {
      schedule();
    }
  };
  state.retarget = retarget;

  /** Give listeners a new set of edge colors: a frame, or the poster before the first frame. */
  const deliver = (edges: EdgeColors, cost: SampleCost, fromFrame: boolean) => {
    const started = performance.now();
    if (fromFrame) {
      state.samples += 1;
      state.method = cost.method;
    }
    state.last = { cost, edges };
    for (const listener of state.sampleListeners) {
      call(listener, edges, cost);
    }
    if (state.frameListeners.size > 0) {
      retarget(edges);
    }
    if (fromFrame) {
      const used = state.pendingMs + (performance.now() - started);
      state.pendingMs = 0;
      state.watcherMs += (used - state.watcherMs) * STATS_SMOOTHING;
    }
  };

  const watchRead = () =>
    watchVideo(video, {
      pauseOffScreen: () => state.pageWide === 0,
      depth: options.depth,
      method: options.method,
      onColors: (edges, cost) => {
        // The video still shows its poster: its colors are the poster's.
        if (!posterShown(video)) {
          deliver(edges, cost, true);
        }
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

  /** Start the read, keeping `stopRead` and `recheck` pointed at it. */
  const begin = () => {
    const stop = watchRead();
    state.recheck = stop.recheck;
    return stop;
  };

  const poster = watchPoster(
    video,
    { depth: options.depth, points: options.points },
    (edges) => deliver(edges, POSTER_COST, false)
  );
  state.stopPoster = poster.stop;

  const rearm = () => {
    state.snapNext = true;
    poster.refresh();
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
  state.stopPoster();
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
 * The smoothed colors of the running read of `video`, or `NEUTRAL` when there
 * is none. Like `inspect`, it holds no reference. It returns the same object
 * until the colors change, so it can serve as a `getSnapshot`.
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
  const pageWide = !options.aroundVideo;
  if (pageWide) {
    read.pageWide += 1;
  }
  read.recheck();

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
    if (pageWide) {
      read.pageWide -= 1;
    }
    read.recheck();
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
