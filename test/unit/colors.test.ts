import { describe, expect, it } from "bun:test";
import {
  contrast,
  createSmoother,
  forWhiteText,
  palette,
  toHsl,
} from "../../src/core/colors.js";
import type { Rgb } from "../../src/core/sample.js";

const within = (actual: Rgb, expected: Rgb, tolerance: number) =>
  expected.every((value, i) => Math.abs((actual[i] ?? 0) - value) <= tolerance);

describe("wcag helpers", () => {
  it("gives 21:1 between black and white", () => {
    expect(contrast([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 0);
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

  it("asks for more with a higher minimum", () => {
    const blue: Rgb = [60, 90, 200];
    expect(forWhiteText(blue, 7).ratio).toBeGreaterThanOrEqual(7);
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
});
