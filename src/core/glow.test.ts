import { describe, expect, test as it } from "bun:test";
import { falloffAlpha } from "./glow.js";

describe("falloffAlpha", () => {
  it("is fully opaque at the video's edge and gone at the reach", () => {
    expect(falloffAlpha(0, 2.5)).toBe(1);
    expect(falloffAlpha(1, 2.5)).toBe(0);
  });

  it("decreases with distance, so the glow only ever fades out", () => {
    let previous = 1;
    for (let step = 1; step <= 10; step += 1) {
      const alpha = falloffAlpha(step / 10, 2.5);
      expect(alpha).toBeLessThan(previous);
      previous = alpha;
    }
  });

  it("a higher exponent is stronger near the edge relative to its tail", () => {
    // At half the reach, a steeper curve has already lost more intensity.
    expect(falloffAlpha(0.5, 3)).toBeLessThan(falloffAlpha(0.5, 1.5));
  });

  it("stays in range outside [0, 1]", () => {
    expect(falloffAlpha(-0.5, 2)).toBe(1);
    expect(falloffAlpha(2, 2)).toBe(0);
  });
});
