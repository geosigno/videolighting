import type { MethodChoice, ReadMethod } from "./reader.js";
import {
  type EdgeColors,
  type EdgeLayout,
  SAMPLE_HEIGHT,
  SAMPLE_WIDTH,
  sampleEdges,
} from "./sample.js";
import type { SampleReply, SampleRequest } from "./sample.worker.js";
import SampleWorker from "./sample.worker.ts?worker&inline";

/** What a sample cost. */
export interface SampleCost {
  /** From the frame being requested to the colors being ready. */
  latencyMs: number;
  /** Time the main thread was actually busy for this sample. */
  mainMs: number;
  /** How the frame was read: through WebGL, or by drawing it to a canvas. */
  method: ReadMethod;
  /**
   * The frame was read both ways to compare the methods: its `latencyMs` and
   * `workerMs` are inflated, so leave it out of any statistic on speed.
   */
  probe: boolean;
  /** Time spent reading the frame inside the worker (0 on the main thread). */
  workerMs: number;
}

export interface WatchOptions extends EdgeLayout {
  /**
   * How the Worker reads the frame: `"auto"` (default) measures and picks,
   * `"webgl"` and `"canvas"` force one. The main-thread engine always uses the
   * canvas.
   */
  method?: MethodChoice;
  /** Called with the new colors and what sampling them cost. */
  onColors: (colors: EdgeColors, cost: SampleCost) => void;
  /**
   * Called once if the browser refuses to read the pixels (cross-origin video
   * without CORS); watching stops.
   */
  onError?: (error: unknown) => void;
  /**
   * Called when a frame is lost: it presented while the previous one was still
   * waiting for its turn (busy or over the main-thread budget). A frame that is
   * merely deferred, then read, does not count.
   */
  onSkip?: () => void;
  /**
   * Asked each time the video enters or leaves the viewport (and when the
   * returned function's `recheck` is called): whether the read may pause while
   * the video is off screen. Default: yes. A halo is only seen around its
   * video, so it says yes; a background or a theme can sit anywhere in the
   * page, so it says no.
   */
  pauseOffScreen?: () => boolean;
  /**
   * Read the pixels in a Web Worker (through a `VideoFrame`) so the main thread stays free. Defaults to
   * `true`; falls back to the main thread where the browser cannot do it.
   */
  worker?: boolean;
}

/** The worker itself failed (blocked by a CSP, say), not the reading of a frame. */
class WorkerFailure extends Error {
  constructor(cause: unknown) {
    super("videolighting: the worker failed", { cause });
  }
}

/** What the worker replied, plus the time the main thread spent on it. */
type Sample = SampleReply & { mainMs: number };

interface Sampler {
  dispose: () => void;
  sample: () => Promise<Sample>;
}

/** Reads the frame on the main thread: simple, but `drawImage` blocks ~1 ms. */
function mainThreadSampler(
  video: HTMLVideoElement,
  layout: EdgeLayout
): Sampler | undefined {
  const canvas = document.createElement("canvas");
  canvas.width = SAMPLE_WIDTH;
  canvas.height = SAMPLE_HEIGHT;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    return;
  }
  context.imageSmoothingQuality = "high";

  return {
    dispose: () => undefined,
    sample: () => {
      const start = performance.now();
      try {
        context.drawImage(video, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
        const { data } = context.getImageData(
          0,
          0,
          SAMPLE_WIDTH,
          SAMPLE_HEIGHT
        );
        const colors = sampleEdges(
          data,
          SAMPLE_WIDTH,
          SAMPLE_HEIGHT,
          layout,
          video.videoWidth > 0 && video.videoHeight > 0
            ? video.videoWidth / video.videoHeight
            : undefined
        );
        return Promise.resolve({
          colors,
          mainMs: performance.now() - start,
          method: "canvas",
          probe: false,
          workerMs: 0,
        });
      } catch (error) {
        return Promise.reject(error);
      }
    },
  };
}

interface Pending {
  reject: (error: unknown) => void;
  resolve: (sample: Sample) => void;
  timing: { mainMs: number };
}

/**
 * The main thread only wraps the current frame in a `VideoFrame` (a handle, no
 * copy) and hands it to a worker, which reads the pixels and reduces them to 24
 * colors. Measured on Chrome, Safari and iPhone: it leaves ~100 % of the main
 * thread free. `createImageBitmap` instead of `VideoFrame` was fine on Chrome
 * but cost 30-70 % of the main thread on Safari for files and native HLS.
 */
function workerSampler(
  video: HTMLVideoElement,
  layout: EdgeLayout,
  method: MethodChoice
): Sampler | undefined {
  if (
    typeof Worker === "undefined" ||
    typeof VideoFrame === "undefined" ||
    typeof OffscreenCanvas === "undefined"
  ) {
    return;
  }
  let worker: Worker;
  try {
    worker = new SampleWorker();
  } catch {
    // Blob workers blocked (CSP, sandbox): use the main thread instead.
    return;
  }

  let pending: Pending | undefined;
  worker.onmessage = (event: MessageEvent<SampleReply>) => {
    const current = pending;
    pending = undefined;
    current?.resolve({ ...event.data, mainMs: current.timing.mainMs });
  };
  let failure: WorkerFailure | undefined;
  worker.onerror = (event) => {
    failure = new WorkerFailure(event.error ?? new Error(event.message));
    const current = pending;
    pending = undefined;
    current?.reject(failure);
  };

  return {
    dispose: () => worker.terminate(),
    sample: () => {
      if (failure) {
        return Promise.reject(failure);
      }
      const start = performance.now();
      // Throws a SecurityError for a video the browser refuses to expose.
      const frame = new VideoFrame(video);
      const timing = { mainMs: performance.now() - start };

      const handoff = performance.now();
      const reply = new Promise<Sample>((resolve, reject) => {
        pending = { reject, resolve, timing };
      });
      const request: SampleRequest = { frame, layout, method };
      try {
        worker.postMessage(request, [frame]);
      } catch (error) {
        frame.close();
        pending = undefined;
        throw error;
      }
      timing.mainMs += performance.now() - handoff;
      return reply;
    },
  };
}

/**
 * Share of the main thread sampling may use. Past it, frames are skipped. The
 * Worker engine costs ~0.1 ms of main thread per sample, so it never reaches
 * it; the main-thread fallback (~1-3 ms) does on a slow machine.
 */
const MAIN_THREAD_BUDGET = 0.1;
/** Weight of the latest sample in the smoothed main-thread cost. */
const COST_SMOOTHING = 0.2;
/** A video this close to the viewport still counts as visible: its halo spills out of it. */
const VISIBLE_MARGIN = "200px";

/**
 * Sample the mean edge colors of `video` on every frame it presents, as far as
 * the main-thread budget allows, and, unless `pauseOffScreen` says otherwise,
 * only while it is (nearly) on screen.
 * Idle while the video is paused. Returns a function that stops watching.
 */
export function watchVideo(
  video: HTMLVideoElement,
  {
    depth,
    method = "auto",
    onColors,
    onError,
    onSkip,
    pauseOffScreen,
    points,
    worker = true,
  }: WatchOptions
): (() => void) & { recheck: () => void } {
  if (typeof video.requestVideoFrameCallback !== "function") {
    onError?.(
      new Error("videolighting: this browser has no requestVideoFrameCallback")
    );
    return Object.assign(() => undefined, { recheck: () => undefined });
  }
  const layout: EdgeLayout = { depth, points };
  const first =
    (worker ? workerSampler(video, layout, method) : undefined) ??
    mainThreadSampler(video, layout);
  if (!first) {
    onError?.(new Error("2D canvas context unavailable"));
    return Object.assign(() => undefined, { recheck: () => undefined });
  }
  let sampler: Sampler = first;

  let stopped = false;
  let busy = false;
  let visible = true;
  /** A frame went by unsampled: the current one still has to be read. */
  let behind = false;
  let lastStart = Number.NEGATIVE_INFINITY;
  /** Smoothed main-thread ms per sample. */
  let cost = 0;
  let frameHandle: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  /** Reading goes on while the video is on screen, or off screen if nothing needs it paused. */
  const wanted = () => visible || !(pauseOffScreen?.() ?? true);
  const gap = () => cost / MAIN_THREAD_BUDGET;
  const ready = () => video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;

  /** Read the current frame once the budget allows it. */
  const catchUp = () => {
    if (timer !== undefined || stopped || !wanted()) {
      return;
    }
    const wait = Math.max(0, lastStart + gap() - performance.now());
    timer = setTimeout(() => {
      timer = undefined;
      if (behind && !busy && !stopped && wanted() && ready()) {
        run();
      }
    }, wait);
  };

  /** A worker that cannot run (a CSP blocks it, say): carry on on the main thread. */
  const fallBack = () => {
    sampler.dispose();
    const next = mainThreadSampler(video, layout);
    if (next) {
      sampler = next;
    }
    return next !== undefined;
  };

  /** Never throws: a failure stops watching and is reported to `onError`. */
  const run = async () => {
    busy = true;
    behind = false;
    lastStart = performance.now();
    try {
      const { colors, ...read } = await sampler.sample();
      const { mainMs } = read;
      cost = cost === 0 ? mainMs : cost + (mainMs - cost) * COST_SMOOTHING;
      if (!stopped) {
        onColors(colors, { ...read, latencyMs: performance.now() - lastStart });
      }
    } catch (error) {
      if (error instanceof WorkerFailure && fallBack()) {
        busy = false;
        run();
        return;
      }
      // The video has no frame to hand out yet (just after `play()`, say): not
      // fatal, the next frame it presents is sampled.
      if (error instanceof DOMException && error.name === "InvalidStateError") {
        return;
      }
      if (!stopped) {
        stopped = true;
        sampler.dispose();
        onError?.(error);
      }
    } finally {
      busy = false;
    }
    if (behind) {
      catchUp();
    }
  };

  const onFrame: VideoFrameRequestCallback = () => {
    if (stopped || !wanted()) {
      return;
    }
    // Every frame is sampled, but one at a time and within the budget: a frame
    // that cannot be read now is caught up with right after, so the last frame
    // before a pause or a seek is never left out.
    if (busy || performance.now() - lastStart < gap()) {
      if (behind) {
        onSkip?.();
      }
      behind = true;
      catchUp();
    } else {
      run();
    }
    frameHandle = video.requestVideoFrameCallback(onFrame);
  };

  const start = () => {
    // A paused video presents no new frame: paint the current one right away.
    if (ready()) {
      run();
    }
    frameHandle = video.requestVideoFrameCallback(onFrame);
  };

  const pause = () => {
    if (frameHandle !== undefined) {
      video.cancelVideoFrameCallback(frameHandle);
      frameHandle = undefined;
    }
    clearTimeout(timer);
    timer = undefined;
    behind = false;
  };

  /** Start or pause the read to match what is wanted now. */
  const sync = () => {
    if (stopped) {
      return;
    }
    if (wanted()) {
      if (frameHandle === undefined) {
        start();
      }
    } else if (frameHandle !== undefined) {
      pause();
    }
  };

  const observer =
    typeof IntersectionObserver === "undefined"
      ? undefined
      : new IntersectionObserver(
          (entries) => {
            const next = entries.at(-1)?.isIntersecting ?? true;
            if (stopped || next === visible) {
              return;
            }
            visible = next;
            sync();
          },
          { rootMargin: VISIBLE_MARGIN }
        );
  observer?.observe(video);

  start();

  return Object.assign(
    () => {
      stopped = true;
      observer?.disconnect();
      pause();
      sampler.dispose();
    },
    { recheck: sync }
  );
}
