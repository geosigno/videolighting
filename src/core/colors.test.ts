import { describe, expect, it } from "bun:test";
import {
  contrast,
  createSmoother,
  css,
  forWhiteText,
  luminance,
  mean,
  palette,
  toHsl,
} from "./colors.js";
import type { Rgb } from "./sample.js";

const within = (actual: Rgb, expected: Rgb, tolerance: number) =>
  expected.every((value, i) => Math.abs((actual[i] ?? 0) - value) <= tolerance);

describe("wcag helpers", () => {
  it("gives 21:1 between black and white", () => {
    expect(contrast([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 0);
  });

  it("gives white a luminance of 1", () => {
    expect(luminance([255, 255, 255])).toBeCloseTo(1, 3);
  });
});

describe("forWhiteText", () => {
  it("darkens a bright colour until white reads on it, keeping its hue", () => {
    const yellow: Rgb = [255, 255, 0];
    const { bg, ratio } = forWhiteText(yellow);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
    expect(Math.abs(toHsl(bg)[0] - toHsl(yellow)[0])).toBeLessThan(2);
  });

  it("leaves a colour that already reads alone", () => {
    const dark: Rgb = [20, 20, 60];
    expect(forWhiteText(dark).bg).toEqual(dark);
  });

  it("applies no limit when the minimum is 1", () => {
    const yellow: Rgb = [255, 255, 0];
    expect(forWhiteText(yellow, 1).bg).toEqual(yellow);
  });

  it("asks for more with a higher minimum", () => {
    const blue: Rgb = [60, 90, 200];
    expect(forWhiteText(blue, 7).ratio).toBeGreaterThanOrEqual(7);
  });

  it("answers the same question with the same object", () => {
    expect(forWhiteText([200, 180, 40])).toBe(forWhiteText([200, 180, 40]));
  });
});

describe("palette", () => {
  it("returns the dominant colours by area, biggest first", () => {
    const red: Rgb = [250, 10, 10];
    const blue: Rgb = [10, 10, 250];
    const [first, second] = palette([red, red, red, blue]);
    expect(within(first ?? [0, 0, 0], red, 30)).toBe(true);
    expect(within(second ?? [0, 0, 0], blue, 30)).toBe(true);
  });

  it("gives two different colours even from a single colour", () => {
    const point: Rgb = [200, 50, 50];
    const [first, second] = palette(Array.from({ length: 12 }, () => point));
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(first).not.toEqual(second);
  });
});

describe("mean and css", () => {
  it("averages colours", () => {
    expect(
      mean([
        [0, 0, 0],
        [100, 50, 200],
      ])
    ).toEqual([50, 25, 100]);
  });

  it("writes colours with and without alpha", () => {
    expect(css([1.4, 2.6, 3])).toBe("rgb(1 3 3)");
    expect(css([1, 2, 3], 0.5)).toBe("rgb(1 2 3 / 0.5)");
  });
});

describe("createSmoother", () => {
  const goal: Rgb[] = [[100, 100, 100]];

  it("covers about 63 % of the distance in one time constant", () => {
    const smoother = createSmoother(0.12, [[0, 0, 0]]);
    smoother.step(goal, 120);
    expect(within(smoother.colors[0] ?? [0, 0, 0], [63, 63, 63], 2)).toBe(true);
  });

  it("reaches the goal exactly, then reports nothing to do", () => {
    const smoother = createSmoother(0.12, [[0, 0, 0]]);
    let steps = 0;
    while (smoother.step(goal, 16) && steps < 5000) {
      steps += 1;
    }
    expect(smoother.colors).toEqual(goal);
    const settled = smoother.colors;
    expect(smoother.step(goal, 16)).toBe(false);
    expect(smoother.colors).toBe(settled);
  });

  it("changes identity only when a value changes", () => {
    const smoother = createSmoother(0.12, [[0, 0, 0]]);
    const before = smoother.colors;
    expect(smoother.step([[0, 0, 0]], 16)).toBe(false);
    expect(smoother.colors).toBe(before);
    expect(smoother.step(goal, 16)).toBe(true);
    expect(smoother.colors).not.toBe(before);
  });

  it("jumps straight to a colour on snap", () => {
    const smoother = createSmoother(0.12, [[0, 0, 0]]);
    smoother.snap(goal);
    expect(smoother.colors).toEqual(goal);
  });
});
