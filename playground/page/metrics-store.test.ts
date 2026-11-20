import { describe, expect, it } from "bun:test";
import type { Inspector } from "../../src/core/watcher.js";
import { createMetricsStore, rate } from "./metrics-store.js";

describe("rate", () => {
  it("counts events per second over the window", () => {
    const now = 10_000;
    const events = Array.from({ length: 25 }, (_, i) => now - i * 40);
    expect(rate(events, 1000, now)).toBeCloseTo(25, 0);
  });

  it("ignores events older than the window", () => {
    expect(rate([0, 100, 9900], 1000, 10_000)).toBeCloseTo(1, 0);
  });

  it("is 0 without events", () => {
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
  let current: Inspector | undefined;
  const calls = {
    cancelled: 0,
    framesCancelled: 0,
    frameSubscriptions: 0,
    inspect: 0,
    scheduled: 0,
  };

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
      calls.frameSubscriptions += 1;
      let active = true;
      frame = () => {
        if (active) {
          callback();
        }
      };
      return () => {
        active = false;
        calls.framesCancelled += 1;
      };
    },
    schedule: (callback) => {
      calls.scheduled += 1;
      tick = callback;
      timerActive = true;
      return () => {
        timerActive = false;
        calls.cancelled += 1;
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
    listenersOf: (index: number) => sets[index]?.size ?? 0,
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
    setInspector: (next: Inspector | undefined) => {
      current = next;
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
  it("starts with zeroed metrics", () => {
    const { store } = setup();
    expect(store.metrics()).toMatchObject({
      method: "-",
      ratio: 0,
      sampleFps: 0,
      skipped: 0,
      videoFps: 0,
    });
  });

  it("derives fps and the reads per frame ratio over the window", () => {
    const t = setup();
    t.store.start();
    t.play(75, 40); // 3 s at 25 fps, every frame read
    t.tick();
    const m = t.store.metrics();
    expect(m.videoFps).toBeCloseTo(25, 0);
    expect(m.sampleFps).toBeCloseTo(25, 0);
    expect(m.ratio).toBeCloseTo(1, 1);
    expect(m.references).toBe(2);
    expect(m.method).toBe("webgl");
    expect(m.watcherMs).toBe(0.5);
  });

  it("reports a ratio above 1 when frames are read twice", () => {
    const t = setup();
    t.store.start();
    t.play(20, 100);
    t.read(20); // a second read of each frame, with no new frame
    t.tick();
    expect(t.store.metrics().ratio).toBeCloseTo(2, 1);
  });

  it("is 0 when no frame is presented", () => {
    const t = setup();
    t.store.start();
    t.wait(500);
    t.tick();
    expect(t.store.metrics().ratio).toBe(0);
  });

  it("computes latency percentiles over the window", () => {
    const t = setup();
    t.store.start();
    t.play(10, 100); // latencies 10..19
    t.tick();
    const m = t.store.metrics();
    expect(m.latencyP50).toBe(15);
    expect(m.latencyP95).toBe(19);
  });

  it("leaves the frames read twice out of the latency, but not out of the sample count", () => {
    const t = setup();
    t.store.start();
    t.play(10, 100); // latencies 10..19
    t.probe(5, 200);
    t.tick();
    const m = t.store.metrics();
    expect(m.latencyP95).toBe(19);
    expect(m.latencyP50).toBe(15);
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

  it("notifies subscribers on every tick until they unsubscribe", () => {
    const t = setup();
    const seen: number[] = [];
    const off = t.store.subscribe((m) => seen.push(m.sampleFps));
    t.store.start();
    t.tick();
    t.tick();
    expect(seen).toHaveLength(2);
    off();
    t.tick();
    expect(seen).toHaveLength(2);
  });

  it("calls inspect afresh on every tick", () => {
    const t = setup();
    t.store.start();
    const before = t.calls.inspect;
    t.tick();
    t.tick();
    t.tick();
    expect(t.calls.inspect - before).toBe(3);
  });

  it("keeps exactly one listener across ticks, without double counting", () => {
    const t = setup();
    t.store.start();
    for (let i = 0; i < 5; i += 1) {
      t.tick();
    }
    expect(t.liveListeners()).toBe(1);
    t.play(30, 100); // 3 s, every frame read once
    t.tick();
    expect(t.liveListeners()).toBe(1);
    expect(t.store.metrics().sampleFps).toBeCloseTo(10, 5);
    expect(t.store.metrics().ratio).toBeCloseTo(1, 5);
  });

  it("moves the listener to the new inspector after the read restarts", () => {
    const t = setup();
    t.store.start();
    t.tick();
    t.restart(); // the old inspector goes stale
    t.tick();
    t.tick();
    expect(t.listenersOf(0)).toBe(0);
    expect(t.listenersOf(1)).toBe(1);
    expect(t.liveListeners()).toBe(1);
    t.play(30, 100);
    t.tick();
    expect(t.liveListeners()).toBe(1);
    expect(t.store.metrics().sampleFps).toBeCloseTo(10, 5);
    expect(t.store.metrics().ratio).toBeCloseTo(1, 5);
  });

  it("drops the listener when the read disappears, then attaches again", () => {
    const t = setup();
    t.store.start();
    t.tick();
    expect(t.liveListeners()).toBe(1);
    t.setInspector(undefined);
    t.tick();
    expect(t.liveListeners()).toBe(0);
    expect(t.store.metrics().method).toBe("-");
    t.restart();
    t.tick();
    t.tick();
    expect(t.listenersOf(0)).toBe(0);
    expect(t.listenersOf(1)).toBe(1);
    expect(t.liveListeners()).toBe(1);
    t.play(30, 100);
    t.tick();
    expect(t.store.metrics().sampleFps).toBeCloseTo(10, 5);
    expect(t.store.metrics().method).toBe("webgl");
  });

  it("releases everything on stop()", () => {
    const t = setup();
    const seen: number[] = [];
    t.store.subscribe((m) => seen.push(m.sampleFps));
    t.store.start();
    t.tick();
    expect(t.liveListeners()).toBe(1);
    t.store.stop();
    expect(t.liveListeners()).toBe(0);
    expect(t.calls.framesCancelled).toBe(1);
    expect(t.calls.cancelled).toBe(1);
    const ticks = seen.length;
    const inspects = t.calls.inspect;
    t.advance(500);
    t.advance(500);
    t.play(5, 100); // frames after stop are not counted either
    expect(seen).toHaveLength(ticks);
    expect(t.calls.inspect).toBe(inspects);
  });

  it("subscribes once when start() is called twice", () => {
    const t = setup();
    t.store.start();
    t.store.start();
    expect(t.calls.scheduled).toBe(1);
    expect(t.calls.frameSubscriptions).toBe(1);
    expect(t.liveListeners()).toBe(1);
  });

  it("works again after start, stop, start", () => {
    const t = setup();
    t.store.start();
    t.store.stop();
    t.store.start();
    expect(t.calls.scheduled).toBe(2);
    expect(t.calls.frameSubscriptions).toBe(2);
    expect(t.liveListeners()).toBe(1);
    t.tick();
    t.play(30, 100);
    t.tick();
    expect(t.liveListeners()).toBe(1);
    expect(t.store.metrics().sampleFps).toBeCloseTo(10, 5);
    expect(t.store.metrics().videoFps).toBeCloseTo(10, 5);
  });
});
