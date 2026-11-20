import { describe, expect, it } from "bun:test";
import { createReader, type MethodChoice } from "./reader.js";
import { SAMPLE_HEIGHT, SAMPLE_WIDTH } from "./sample.js";

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
const ramp = (offset = 0) =>
  picture((_x, y) => {
    const level = Math.min(255, Math.round((y / SAMPLE_HEIGHT) * 255) + offset);
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

  it("keeps the canvas where WebGL is slower, and stops trying WebGL", () => {
    const { read, calls } = setup({ canvasMs: 6, glMs: 22 });
    expect(methods(read, 8).every((method) => method === "canvas")).toBe(true);
    expect(calls.gl).toBe(5);
  });

  it("keeps the canvas when WebGL is not clearly faster", () => {
    const { read } = setup({ canvasMs: 5, glMs: 4 });
    expect(methods(read, 5).at(-1)).toBe("canvas");
  });

  it("returns the WebGL colors as they are, without correction", () => {
    const { read } = setup({ glPicture: () => ramp(8) });
    methods(read, 5);
    const {
      colors: {
        top: [[fast = 0] = []],
      },
    } = read(frame(), layout);
    const {
      colors: {
        top: [[reference = 0] = []],
      },
    } = setup().read(frame(), layout);
    expect(fast).toBe(reference + 8);
  });

  it("reads fewer zones along the short sides, from the frame's own ratio", () => {
    const { read } = setup({ canvasMs: 14, glMs: 3 });
    const tall = { displayHeight: 1920, displayWidth: 1080 } as VideoFrame;
    const { colors } = read(tall, { points: 12 });
    expect(colors.top).toHaveLength(7);
    expect(colors.left).toHaveLength(12);
  });

  it("keeps WebGL on a frame that is not 16:9: both methods read the same zones", () => {
    const { read } = setup({ canvasMs: 14, glMs: 3 });
    const tall = { displayHeight: 1920, displayWidth: 1080 } as VideoFrame;
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

  it("switches when, a minute later, the other method has become much faster", () => {
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
  });

  it("does not switch for a gain under 30 %", () => {
    const { read, cost, wait } = setup({ canvasMs: 14, glMs: 3 });
    methods(read, 8);
    cost.glMs = 10;
    cost.canvasMs = 8;
    wait(61_000);
    methods(read, 5);
    expect(read(frame(), layout).method).toBe("webgl");
  });

  it("measures again as soon as the method in use slows down by half", () => {
    const { read, cost, wait } = setup({ canvasMs: 14, glMs: 3 });
    methods(read, 8);
    cost.glMs = 30;
    cost.canvasMs = 6;
    // Not a minute yet, but past the minimum gap: the slowdown is what triggers.
    wait(11_000);
    methods(read, 20);
    expect(read(frame(), layout).method).toBe("canvas");
  });

  it("measures again as soon as the method in use gets much faster", () => {
    // WebGL is slower here, so the canvas serves.
    const { read, cost, wait } = setup({ canvasMs: 14, glMs: 20 });
    methods(read, 8);
    expect(read(frame(), layout).method).toBe("canvas");
    // The machine frees up: both get quicker, and WebGL now wins by far.
    cost.canvasMs = 8;
    cost.glMs = 3;
    // Not a minute yet, but past the minimum gap: the speed-up is what triggers.
    wait(11_000);
    methods(read, 20);
    expect(read(frame(), layout).method).toBe("webgl");
  });

  it("measures again when the method in use crosses 10 ms, without a 50 % drift", () => {
    const { read, cost, wait } = setup({ canvasMs: 20, glMs: 8 });
    methods(read, 8);
    expect(read(frame(), layout).method).toBe("webgl");
    // 8 -> 11 ms is under +50 %, but it crosses the 10 ms mark; the canvas is quick now.
    cost.glMs = 11;
    cost.canvasMs = 5;
    wait(11_000);
    methods(read, 20);
    expect(read(frame(), layout).method).toBe("canvas");
  });

  it("stays quiet while both methods stay over 10 ms", () => {
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

  it("measures again when it crosses 10 ms a second time, after dropping under", () => {
    const { read, cost, wait } = setup({ canvasMs: 20, glMs: 8 });
    methods(read, 8);
    cost.glMs = 11;
    cost.canvasMs = 30;
    wait(11_000);
    methods(read, 20);
    // Probed, still WebGL (11 against 30). It dips under 10 ms (a small move:
    // no new measure), then goes over again, and the canvas is quick now.
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

  it("flags the frames read both ways to compare, and only those", () => {
    const { read } = setup({ canvasMs: 14, glMs: 3 });
    const flags = Array.from(
      { length: 8 },
      () => read(frame(), layout).probe === true
    );
    expect(flags).toEqual([true, true, true, true, true, false, false, false]);
  });

  it("does not flag the frames of a forced method", () => {
    const { read } = setup({ method: "webgl" });
    expect(read(frame(), layout).probe).not.toBe(true);
  });

  it("does not measure again while nothing changes", () => {
    const { read, calls, wait } = setup({ canvasMs: 14, glMs: 3 });
    methods(read, 8);
    const before = calls.canvas;
    wait(20_000);
    methods(read, 10);
    expect(calls.canvas).toBe(before);
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

  it("never uses a GPU reader that throws", () => {
    let calls = 0;
    const read = createReader({
      canvas: () => ramp(),
      gl: () => {
        calls += 1;
        throw new Error("context lost");
      },
    });
    expect(read(frame(), layout).method).toBe("canvas");
    expect(read(frame(), layout).method).toBe("canvas");
    expect(calls).toBe(1);
  });

  it("drops WebGL when it throws after having been chosen", () => {
    const failFrom = { call: Number.POSITIVE_INFINITY };
    let calls = 0;
    let time = 0;
    const read = createReader({
      canvas: () => {
        time += 14;
        return ramp();
      },
      gl: () => {
        calls += 1;
        time += 3;
        if (calls >= failFrom.call) {
          throw new Error("context lost");
        }
        return ramp();
      },
      now: () => time,
    });
    methods(read, 6);
    failFrom.call = 7;
    expect(read(frame(), layout).method).toBe("canvas");
    expect(read(frame(), layout).method).toBe("canvas");
    expect(calls).toBe(7);
  });

  it("works without a GPU reader", () => {
    const read = createReader({ canvas: () => ramp() });
    expect(read(frame(), layout).method).toBe("canvas");
  });

  describe("forced method", () => {
    it('never calls WebGL when method is "canvas"', () => {
      const { read, calls } = setup({ method: "canvas" });
      expect(methods(read, 6).every((method) => method === "canvas")).toBe(
        true
      );
      expect(calls).toEqual({ canvas: 6, gl: 0 });
    });

    it('reads with WebGL from the first frame when method is "webgl"', () => {
      const { read, calls } = setup({ method: "webgl" });
      expect(methods(read, 6).every((method) => method === "webgl")).toBe(true);
      expect(calls).toEqual({ canvas: 0, gl: 6 });
    });

    it('keeps WebGL on a picture that "auto" would reject', () => {
      const { read, calls } = setup({ glPicture: flipped, method: "webgl" });
      expect(methods(read, 6).every((method) => method === "webgl")).toBe(true);
      expect(calls.canvas).toBe(0);
    });

    it('falls back to the canvas for good when WebGL throws and method is "webgl"', () => {
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

    it('uses the canvas when method is "webgl" but there is no GPU reader', () => {
      const read = createReader({ canvas: () => ramp(), method: "webgl" });
      expect(read(frame(), layout).method).toBe("canvas");
    });
  });
});
