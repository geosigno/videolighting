import { describe, expect, it } from "bun:test";
import { toHsl } from "../../src/core/colors.js";
import type { Rgb } from "../../src/core/sample.js";
import { vivid } from "../../src/core/vivid.js";

const W = 64;
const H = 36;

/** A frame filled with `base`, with a `size`×`size` square of `spot` in the middle. */
function frame(base: Rgb, spot?: Rgb, size = 0) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const inside =
        spot !== undefined &&
        Math.abs(x - W / 2) < size / 2 &&
        Math.abs(y - H / 2) < size / 2;
      data.set([...(inside ? spot : base), 255], (y * W + x) * 4);
    }
  }
  return data;
}

describe("vivid", () => {
  it("picks a small pink spot over a big beige background; a single hue has no other color", () => {
    const pink: Rgb = [240, 60, 150];
    const [primary, secondary] =
      vivid(frame([200, 185, 165], pink, 12), W, H) ?? [];
    expect(primary).toBeDefined();
    const hue = (color?: Rgb) => toHsl(color ?? [0, 0, 0])[0];
    expect(Math.abs(hue(primary) - hue(pink))).toBeLessThan(10);
    expect(secondary).toEqual(primary);
  });

  it("ignores a spot too small to be a color", () => {
    expect(
      vivid(frame([128, 128, 128], [240, 60, 150], 2), W, H)
    ).toBeUndefined();
  });

  it("finds nothing in a gray or a uniform beige frame", () => {
    expect(vivid(frame([128, 128, 128]), W, H)).toBeUndefined();
    expect(vivid(frame([200, 185, 165]), W, H)).toBeUndefined();
  });
});
