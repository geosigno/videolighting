import { describe, expect, it } from "bun:test";
import {
  createMetricsStore,
  rate,
} from "../../playground/page/metrics-store.js";
import type { Inspector } from "../../src/core/watcher.js";

describe("rate", () => {
  it("counts events per second over the window, ignoring older ones", () => {
    const now = 10_000;
    const events = Array.from({ length: 25 }, (_, i) => now - i * 40);
    expect(rate(events, 1000, now)).toBeCloseTo(25, 0);
    expect(rate([0, 100, 9900], 1000, 10_000)).toBeCloseTo(1, 0);
    expect(rate([], 1000, 10_000)).toBe(0);
  });
});

type SampleListener = Parameters<Inspector["onSample"]>[0];

/** A fake clock, video-frame source and inspector, driven by hand. */
function setup() {
  let time = 0;
  let tick: () => void = () => undefined;
  let timerActive = false;
  let frame: () => void = () => undefined;
  let skipped = 0;
  let listeners = new Set<SampleListener>();
  /** Every listener set ever handed out, so stale ones can be inspected. */
  const sets = [listeners];
  let current: Inspector;
  const calls = { inspect: 0 };

  const makeInspector = (): Inspector => {
    const mine = listeners;
    return {
      onSample: (listener) => {
        mine.add(listener);
        return () => mine.delete(listener);
      },
      stats: () => ({
        method: "webgl",
        references: 2,
        samples: 0,
        skipped,
        watcherMs: 0.5,
      }),
    };
  };
  current = makeInspector();

  const store = createMetricsStore({} as HTMLVideoElement, {
    inspect: () => {
      calls.inspect += 1;
      return current;
    },
    now: () => time,
    onVideoFrame: (_video, callback) => {
      let active = true;
      frame = () => {
        if (active) {
          callback();
        }
      };
      return () => {
        active = false;
      };
    },
    schedule: (callback) => {
      tick = callback;
      timerActive = true;
      return () => {
        timerActive = false;
      };
    },
  });

  return {
    /** Moves the clock and fires the timer, as long as it has not been cancelled. */
    advance: (ms: number) => {
      time += ms;
      if (timerActive) {
        tick();
      }
    },
    calls,
    /** Listeners attached across every inspector the fake ever handed out. */
    liveListeners: () => sets.reduce((sum, set) => sum + set.size, 0),
    read(count: number) {
      for (let i = 0; i < count; i += 1) {
        for (const listener of [...listeners]) {
          listener({} as never, { latencyMs: 1 } as never);
        }
      }
    },
    /** Reads `count` frames that were read twice to compare the methods. */
    probe(count: number, latencyMs: number) {
      for (let i = 0; i < count; i += 1) {
        for (const listener of [...listeners]) {
          listener({} as never, { latencyMs, probe: true } as never);
        }
      }
    },
    /** Presents a video frame and reads it, `ms` apart. */
    play(frames: number, ms: number, reads = frames) {
      for (let i = 0; i < frames; i += 1) {
        time += ms;
        frame();
        if (i < reads) {
          for (const listener of [...listeners]) {
            listener({} as never, { latencyMs: 10 + i } as never);
          }
        }
      }
    },
    restart() {
      listeners = new Set();
      sets.push(listeners);
      current = makeInspector();
    },
    setSkipped: (value: number) => {
      skipped = value;
    },
    store,
    tick: () => tick(),
    wait: (ms: number) => {
      time += ms;
    },
  };
}

describe("createMetricsStore", () => {
  it("derives fps and the reads per frame ratio over the window", () => {
    const t = setup();
    t.store.start();
    t.play(75, 40); // 3 s at 25 fps, every frame read
    t.tick();
    const m = t.store.metrics();
    expect(m.videoFps).toBeCloseTo(25, 0);
    expect(m.sampleFps).toBeCloseTo(25, 0);
    expect(m.ratio).toBeCloseTo(1, 1);

    // A ratio above 1 when frames are read twice, 0 when no frame is presented.
    const twice = setup();
    twice.store.start();
    twice.play(20, 100);
    twice.read(20); // a second read of each frame, with no new frame
    twice.tick();
    expect(twice.store.metrics().ratio).toBeCloseTo(2, 1);
    const idle = setup();
    idle.store.start();
    idle.wait(500);
    idle.tick();
    expect(idle.store.metrics().ratio).toBe(0);
  });

  it("computes latency percentiles, leaving the frames read twice out of them but not out of the sample count", () => {
    const t = setup();
    t.store.start();
    t.play(10, 100); // latencies 10..19
    t.probe(5, 200);
    t.tick();
    const m = t.store.metrics();
    expect(m.latencyP50).toBe(15);
    expect(m.latencyP95).toBe(19);
    // 10 + 5 samples in the 3 s window.
    expect(m.sampleFps).toBeCloseTo(5, 5);
  });

  it("windows skipped frames instead of accumulating them", () => {
    const t = setup();
    t.store.start();
    t.setSkipped(100); // already skipped before the page looked
    t.tick();
    expect(t.store.metrics().skipped).toBe(0);
    t.wait(500);
    t.setSkipped(104);
    t.tick();
    expect(t.store.metrics().skipped).toBe(4);
    // 4 stays in the window, then ages out with no new losses
    for (let i = 0; i < 8; i += 1) {
      t.wait(500);
      t.tick();
    }
    expect(t.store.metrics().skipped).toBe(0);
  });

  it("keeps counting when the read restarts, and releases everything on stop()", () => {
    const t = setup();
    t.store.start();
    t.tick();
    t.restart(); // the old inspector goes stale
    t.tick();
    t.play(30, 100);
    t.tick();
    expect(t.liveListeners()).toBe(1);
    expect(t.store.metrics().sampleFps).toBeCloseTo(10, 5);
    expect(t.store.metrics().ratio).toBeCloseTo(1, 5);

    t.store.stop();
    expect(t.liveListeners()).toBe(0);
    const inspects = t.calls.inspect;
    t.advance(500);
    t.play(5, 100); // frames after stop are not counted either
    expect(t.calls.inspect).toBe(inspects);
  });
});
