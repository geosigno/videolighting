import { type Inspector, inspect } from "../../src/core/watcher.js";

/**
 * The numbers the reference page shows: how many frames the video presents, how
 * many are read, and what the read costs. Plain values, no React: the page
 * subscribes to it.
 */

export interface Metrics {
  latencyP50: number;
  latencyP95: number;
  method: string;
  /** Samples per presented video frame: 1 means every frame read once. */
  ratio: number;
  references: number;
  sampleFps: number;
  /** Frames lost to the budget over the window, not since the page loaded. */
  skipped: number;
  videoFps: number;
  watcherMs: number;
}

/** What the store reads the world through, so tests can replace it. */
export interface MetricsDeps {
  inspect: (video: HTMLVideoElement) => Inspector | undefined;
  now: () => number;
  /** Calls `callback` for every presented video frame; returns how to stop. */
  onVideoFrame: (video: HTMLVideoElement, callback: () => void) => () => void;
  /** Calls `callback` every `ms`; returns how to stop. */
  schedule: (callback: () => void, ms: number) => () => void;
}

const WINDOW_MS = 3000;
const TICK_MS = 500;

const EMPTY: Metrics = {
  latencyP50: 0,
  latencyP95: 0,
  method: "-",
  ratio: 0,
  references: 0,
  sampleFps: 0,
  skipped: 0,
  videoFps: 0,
  watcherMs: 0,
};

/** Events per second among `timestamps` (ms) that fall in the last `windowMs` before `now`. */
export function rate(
  timestamps: number[],
  windowMs: number,
  now: number
): number {
  const from = now - windowMs;
  let count = 0;
  for (const time of timestamps) {
    if (time > from && time <= now) {
      count += 1;
    }
  }
  return (count * 1000) / windowMs;
}

const percentile = (values: number[], fraction: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return (
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ??
    0
  );
};

const defaults: MetricsDeps = {
  inspect,
  now: () => performance.now(),
  onVideoFrame: (video, callback) => {
    let handle = 0;
    const next: VideoFrameRequestCallback = () => {
      callback();
      handle = video.requestVideoFrameCallback(next);
    };
    handle = video.requestVideoFrameCallback(next);
    return () => video.cancelVideoFrameCallback(handle);
  },
  schedule: (callback, ms) => {
    const timer = setInterval(callback, ms);
    return () => clearInterval(timer);
  },
};

const dropOlderThan = (list: number[], from: number) => {
  while (list.length > 0 && (list[0] ?? from) <= from) {
    list.shift();
  }
};

export function createMetricsStore(
  video: HTMLVideoElement,
  overrides: Partial<MetricsDeps> = {}
) {
  const deps = { ...defaults, ...overrides };
  const videoTimes: number[] = [];
  const sampleTimes: number[] = [];
  const costs: { at: number; ms: number }[] = [];
  /** `skipped` as the read counted it, one entry per tick. */
  let counts: { at: number; skipped: number }[] = [];
  const listeners = new Set<(metrics: Metrics) => void>();
  let current = EMPTY;
  let stopFrames: (() => void) | undefined;
  let stopTicking: (() => void) | undefined;
  let stopListening: (() => void) | undefined;

  const onSample = (cost: { latencyMs: number; probe: boolean }) => {
    const at = deps.now();
    sampleTimes.push(at);
    // A frame read twice to compare the methods is slow by design: it counts as
    // a sample, not as a latency.
    if (!cost.probe) {
      costs.push({ at, ms: cost.latencyMs });
    }
  };

  // An inspector goes stale when the read restarts, so take a fresh one each
  // tick and move the listener over; nothing runs in between.
  const rebind = (next: Inspector | undefined) => {
    const previous = stopListening;
    stopListening = next?.onSample((_edges, cost) => onSample(cost));
    previous?.();
  };

  const windowedSkipped = (now: number, skipped: number | undefined) => {
    if (skipped === undefined) {
      counts = [];
      return 0;
    }
    if (skipped < (counts.at(-1)?.skipped ?? 0)) {
      counts = [];
    }
    counts.push({ at: now, skipped });
    // Keep one entry at or before the window start as the baseline.
    while ((counts[1]?.at ?? Number.POSITIVE_INFINITY) <= now - WINDOW_MS) {
      counts.shift();
    }
    return skipped - (counts[0]?.skipped ?? skipped);
  };

  const tick = () => {
    const next = deps.inspect(video);
    rebind(next);
    const now = deps.now();
    const from = now - WINDOW_MS;
    dropOlderThan(videoTimes, from);
    dropOlderThan(sampleTimes, from);
    while (costs.length > 0 && (costs[0]?.at ?? from) <= from) {
      costs.shift();
    }
    const latencies = costs.map((cost) => cost.ms);
    const stats = next?.stats();
    current = {
      latencyP50: percentile(latencies, 0.5),
      latencyP95: percentile(latencies, 0.95),
      method: stats?.method ?? "-",
      ratio: videoTimes.length > 0 ? sampleTimes.length / videoTimes.length : 0,
      references: stats?.references ?? 0,
      sampleFps: rate(sampleTimes, WINDOW_MS, now),
      skipped: windowedSkipped(now, stats?.skipped),
      videoFps: rate(videoTimes, WINDOW_MS, now),
      watcherMs: stats?.watcherMs ?? 0,
    };
    for (const listener of listeners) {
      listener(current);
    }
  };

  return {
    metrics: () => current,
    start: () => {
      if (stopTicking) {
        return;
      }
      rebind(deps.inspect(video));
      stopFrames = deps.onVideoFrame(video, () => videoTimes.push(deps.now()));
      stopTicking = deps.schedule(tick, TICK_MS);
    },
    stop: () => {
      stopFrames?.();
      stopTicking?.();
      stopListening?.();
      stopFrames = undefined;
      stopTicking = undefined;
      stopListening = undefined;
    },
    subscribe: (listener: (metrics: Metrics) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
