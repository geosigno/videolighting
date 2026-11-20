import { describe, expect, it } from "bun:test";
import { createReader, type MethodChoice } from "../../src/core/reader.js";
import { SAMPLE_HEIGHT, SAMPLE_WIDTH } from "../../src/core/sample.js";

const layout = { points: 2 };
const frame = (displayWidth = 3840) => ({ displayWidth }) as VideoFrame;

/** An RGBA picture of the given size built from a color per pixel. */
function picture(
  color: (x: number, y: number) => [number, number, number]
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(SAMPLE_WIDTH * SAMPLE_HEIGHT * 4);
  for (let y = 0; y < SAMPLE_HEIGHT; y += 1) {
    for (let x = 0; x < SAMPLE_WIDTH; x += 1) {
      const [r, g, b] = color(x, y);
      const i = (y * SAMPLE_WIDTH + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return data;
}

/** Dark at the top, bright at the bottom: not the same upside down. */
const ramp = () =>
  picture((_x, y) => {
    const level = Math.round((y / SAMPLE_HEIGHT) * 255);
    return [level, level, level];
  });
const flipped = () =>
  picture((_x, y) => {
    const level = Math.round(((SAMPLE_HEIGHT - 1 - y) / SAMPLE_HEIGHT) * 255);
    return [level, level, level];
  });
const black = () => picture(() => [0, 0, 0]);

/** A reader whose two methods take a set time on a fake clock. */
function setup(
  options: {
    canvasMs?: number;
    glMs?: number;
    glPicture?: () => Uint8ClampedArray;
    mainPicture?: () => Uint8ClampedArray;
    method?: MethodChoice;
  } = {}
) {
  const { glPicture = ramp, mainPicture = ramp } = options;
  /** Mutable: a test can slow a method down mid-way. */
  const cost = { canvasMs: options.canvasMs ?? 14, glMs: options.glMs ?? 3 };
  let time = 0;
  const calls = { canvas: 0, gl: 0 };
  const read = createReader({
    canvas: () => {
      calls.canvas += 1;
      time += cost.canvasMs;
      return mainPicture();
    },
    gl: () => {
      calls.gl += 1;
      time += cost.glMs;
      return glPicture();
    },
    now: () => time,
    method: options.method,
  });
  return {
    calls,
    cost,
    read,
    wait: (ms: number) => {
      time += ms;
    },
  };
}

const methods = (
  read: ReturnType<typeof setup>["read"],
  count: number,
  width = 3840
) => Array.from({ length: count }, () => read(frame(width), layout).method);

describe("reader", () => {
  it("probes with both methods on 5 frames, then uses the faster one", () => {
    const { read, calls } = setup({ canvasMs: 14, glMs: 3 });
    // The frame that completes the probe is already served by the winner.
    expect(methods(read, 7)).toEqual([
      "canvas",
      "canvas",
      "canvas",
      "canvas",
      "webgl",
      "webgl",
      "webgl",
    ]);
    expect(calls).toEqual({ canvas: 5, gl: 7 });
  });

  it("keeps the canvas where WebGL is slower or not clearly faster", () => {
    const slower = setup({ canvasMs: 6, glMs: 22 });
    expect(methods(slower.read, 8).every((m) => m === "canvas")).toBe(true);
    // Stops trying WebGL once it has lost.
    expect(slower.calls.gl).toBe(5);
    const close = setup({ canvasMs: 5, glMs: 4 });
    expect(methods(close.read, 5).at(-1)).toBe("canvas");
  });

  it("reads fewer zones along the short sides of a frame that is not 16:9, and keeps WebGL", () => {
    const tall = { displayHeight: 1920, displayWidth: 1080 } as VideoFrame;
    const { read } = setup({ canvasMs: 14, glMs: 3 });
    const { colors } = read(tall, { points: 12 });
    expect(colors.top).toHaveLength(7);
    expect(colors.left).toHaveLength(12);
    // Both methods read the same zones: WebGL is still compared fairly.
    const used = Array.from({ length: 8 }, () => read(tall, layout).method);
    expect(used.at(-1)).toBe("webgl");
  });

  it("probes again when the video changes size", () => {
    const { read } = setup({ canvasMs: 14, glMs: 3 });
    methods(read, 6, 640);
    expect(read(frame(640), layout).method).toBe("webgl");
    expect(read(frame(3840), layout).method).toBe("canvas");
    methods(read, 4, 3840);
    expect(read(frame(3840), layout).method).toBe("webgl");
  });

  it("a minute later, switches for a much faster method but not for a gain under 30 %", () => {
    const { read, cost, wait } = setup({ canvasMs: 14, glMs: 3 });
    methods(read, 8);
    expect(read(frame(), layout).method).toBe("webgl");
    // A browser update: WebGL gets slow, the canvas gets quick.
    cost.glMs = 30;
    cost.canvasMs = 6;
    wait(61_000);
    // 5 frames of probing (served by the method in use), then the new winner.
    expect(methods(read, 5)).toEqual([
      "webgl",
      "webgl",
      "webgl",
      "webgl",
      "canvas",
    ]);
    expect(read(frame(), layout).method).toBe("canvas");

    const small = setup({ canvasMs: 14, glMs: 3 });
    methods(small.read, 8);
    small.cost.glMs = 10;
    small.cost.canvasMs = 8;
    small.wait(61_000);
    methods(small.read, 5);
    expect(small.read(frame(), layout).method).toBe("webgl");
  });

  it("measures again as soon as the method in use slows down by half or gets much faster", () => {
    // Not a minute yet, but past the minimum gap: the drift is what triggers.
    const slowed = setup({ canvasMs: 14, glMs: 3 });
    methods(slowed.read, 8);
    slowed.cost.glMs = 30;
    slowed.cost.canvasMs = 6;
    slowed.wait(11_000);
    methods(slowed.read, 20);
    expect(slowed.read(frame(), layout).method).toBe("canvas");

    // WebGL is slower here, so the canvas serves; the machine then frees up.
    const faster = setup({ canvasMs: 14, glMs: 20 });
    methods(faster.read, 8);
    expect(faster.read(frame(), layout).method).toBe("canvas");
    faster.cost.canvasMs = 8;
    faster.cost.glMs = 3;
    faster.wait(11_000);
    methods(faster.read, 20);
    expect(faster.read(frame(), layout).method).toBe("webgl");
  });

  it("measures again when the method in use crosses 10 ms, even without a 50 % drift", () => {
    // 8 -> 11 ms is under +50 %, but it crosses the 10 ms mark; the canvas is quick now.
    const first = setup({ canvasMs: 20, glMs: 8 });
    methods(first.read, 8);
    expect(first.read(frame(), layout).method).toBe("webgl");
    first.cost.glMs = 11;
    first.cost.canvasMs = 5;
    first.wait(11_000);
    methods(first.read, 20);
    expect(first.read(frame(), layout).method).toBe("canvas");

    // Again a second time, after dropping under 10 ms (a small move: no new measure).
    const { read, cost, wait } = setup({ canvasMs: 20, glMs: 8 });
    methods(read, 8);
    cost.glMs = 11;
    cost.canvasMs = 30;
    wait(11_000);
    methods(read, 20);
    expect(read(frame(), layout).method).toBe("webgl");
    cost.glMs = 9;
    wait(11_000);
    methods(read, 20);
    cost.glMs = 11.5;
    cost.canvasMs = 4;
    wait(11_000);
    methods(read, 20);
    expect(read(frame(), layout).method).toBe("canvas");
  });

  it("does not measure again while nothing changes, nor while both methods stay over 10 ms", () => {
    const steady = setup({ canvasMs: 14, glMs: 3 });
    methods(steady.read, 8);
    const before = steady.calls.canvas;
    steady.wait(20_000);
    methods(steady.read, 10);
    expect(steady.calls.canvas).toBe(before);

    // Nothing better exists: measuring again every 10 s would only cost.
    const { read, calls, wait } = setup({ canvasMs: 11, glMs: 26 });
    methods(read, 8);
    wait(11_000);
    methods(read, 20);
    const after = calls.gl;
    wait(11_000);
    methods(read, 20);
    wait(11_000);
    methods(read, 20);
    expect(calls.gl).toBe(after);
  });

  it("flags the frames read both ways to compare, and only those", () => {
    const { read } = setup({ canvasMs: 14, glMs: 3 });
    const flags = Array.from(
      { length: 8 },
      () => read(frame(), layout).probe === true
    );
    expect(flags).toEqual([true, true, true, true, true, false, false, false]);
  });

  it("does not count probes made on a black picture", () => {
    const { read, calls } = setup({ mainPicture: black, glPicture: flipped });
    expect(methods(read, 5).every((method) => method === "canvas")).toBe(true);
    expect(calls.gl).toBe(5);
  });

  it("drops WebGL for good when its picture is flipped", () => {
    const { read, calls } = setup({ glPicture: flipped });
    expect(methods(read, 5).every((method) => method === "canvas")).toBe(true);
    expect(calls.gl).toBe(1);
  });

  it("never uses a GPU reader that throws, at the start or after having been chosen", () => {
    let calls = 0;
    const broken = createReader({
      canvas: () => ramp(),
      gl: () => {
        calls += 1;
        throw new Error("context lost");
      },
    });
    expect(broken(frame(), layout).method).toBe("canvas");
    expect(broken(frame(), layout).method).toBe("canvas");
    expect(calls).toBe(1);

    let glCalls = 0;
    let failFrom = Number.POSITIVE_INFINITY;
    let time = 0;
    const read = createReader({
      canvas: () => {
        time += 14;
        return ramp();
      },
      gl: () => {
        glCalls += 1;
        time += 3;
        if (glCalls >= failFrom) {
          throw new Error("context lost");
        }
        return ramp();
      },
      now: () => time,
    });
    methods(read, 6);
    failFrom = 7;
    expect(read(frame(), layout).method).toBe("canvas");
    expect(read(frame(), layout).method).toBe("canvas");
    expect(glCalls).toBe(7);
  });

  it("works without a GPU reader, even when WebGL is forced", () => {
    expect(createReader({ canvas: () => ramp() })(frame(), layout).method).toBe(
      "canvas"
    );
    expect(
      createReader({ canvas: () => ramp(), method: "webgl" })(frame(), layout)
        .method
    ).toBe("canvas");
  });

  describe("forced method", () => {
    it("never calls WebGL when forced to canvas; reads with WebGL from the first frame, unflagged, when forced to webgl", () => {
      const canvas = setup({ method: "canvas" });
      expect(methods(canvas.read, 6).every((m) => m === "canvas")).toBe(true);
      expect(canvas.calls).toEqual({ canvas: 6, gl: 0 });

      const webgl = setup({ method: "webgl" });
      expect(webgl.read(frame(), layout).probe).not.toBe(true);
      expect(methods(webgl.read, 5).every((m) => m === "webgl")).toBe(true);
      expect(webgl.calls).toEqual({ canvas: 0, gl: 6 });
    });

    it('keeps WebGL on a picture that "auto" would reject', () => {
      const { read, calls } = setup({ glPicture: flipped, method: "webgl" });
      expect(methods(read, 6).every((method) => method === "webgl")).toBe(true);
      expect(calls.canvas).toBe(0);
    });

    it("falls back to the canvas for good when WebGL throws", () => {
      let calls = 0;
      const read = createReader({
        canvas: () => ramp(),
        gl: () => {
          calls += 1;
          throw new Error("context lost");
        },
        method: "webgl",
      });
      expect(read(frame(), layout).method).toBe("canvas");
      expect(read(frame(), layout).method).toBe("canvas");
      expect(calls).toBe(1);
    });
  });
});
