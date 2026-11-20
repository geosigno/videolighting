import { describe, expect, test as it } from "bun:test";
import { EDGE_POINTS, sampleEdges, zonesFor } from "./sample.js";

type Rgb = [number, number, number];

/** Build an RGBA frame where `pixel(x, y)` gives the color of each pixel. */
function frame(
  width: number,
  height: number,
  pixel: (x: number, y: number) => Rgb
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = pixel(x, y);
      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return data;
}

const RED: Rgb = [255, 0, 0];
const BLUE: Rgb = [0, 0, 255];

describe("sampleEdges", () => {
  it("reads EDGE_POINTS zones along the long sides and fewer along the short ones", () => {
    // No aspect ratio given: the frame's own, 32 x 18 (16:9).
    const edges = sampleEdges(
      frame(32, 18, () => RED),
      32,
      18
    );
    expect(edges.top).toHaveLength(EDGE_POINTS);
    expect(edges.bottom).toHaveLength(EDGE_POINTS);
    expect(edges.left).toHaveLength(7);
    expect(edges.right).toHaveLength(7);
  });

  it("a uniform frame yields that color everywhere", () => {
    const edges = sampleEdges(
      frame(32, 18, () => BLUE),
      32,
      18
    );
    for (const side of [edges.top, edges.right, edges.bottom, edges.left]) {
      for (const color of side) {
        expect(color).toEqual(BLUE);
      }
    }
  });

  it("points follow the frame left→right and top→bottom", () => {
    // Left half red, right half blue.
    const edges = sampleEdges(
      frame(32, 18, (x) => (x < 16 ? RED : BLUE)),
      32,
      18
    );
    expect(edges.top[0]).toEqual(RED);
    expect(edges.top.at(-1)).toEqual(BLUE);
    expect(edges.bottom[0]).toEqual(RED);
    expect(edges.bottom.at(-1)).toEqual(BLUE);
    expect(edges.left.every((c) => c[0] === 255)).toBe(true);
    expect(edges.right.every((c) => c[2] === 255)).toBe(true);
  });

  it("only the edge strips count, not the center", () => {
    // Blue center on a red border: the halo must stay red.
    const edges = sampleEdges(
      frame(32, 18, (x, y) =>
        x > 6 && x < 25 && y > 4 && y < 13 ? BLUE : RED
      ),
      32,
      18
    );
    expect(edges.top[2]).toEqual(RED);
    expect(edges.left[2]).toEqual(RED);
  });

  it("reads as many colors along the long sides as asked", () => {
    for (const [points, short] of [
      [1, 1],
      [5, 3],
      [12, 7],
    ] as const) {
      const edges = sampleEdges(
        frame(64, 36, () => RED),
        64,
        36,
        { points }
      );
      expect(edges.top).toHaveLength(points);
      expect(edges.left).toHaveLength(short);
    }
  });

  it("a deeper border reaches further into the picture", () => {
    // Red frame with a blue band 8 rows down from the top edge.
    const picture = frame(64, 36, (_x, y) => (y >= 4 && y < 10 ? BLUE : RED));
    const shallow = sampleEdges(picture, 64, 36, { depth: 0.1 });
    const deep = sampleEdges(picture, 64, 36, { depth: 0.3 });
    expect(shallow.top[0]).toEqual(RED);
    expect(deep.top[0][2]).toBeGreaterThan(0);
  });

  it("stays valid at extreme depths", () => {
    const edges = sampleEdges(
      frame(64, 36, () => RED),
      64,
      36,
      { depth: 5 }
    );
    expect(edges.top[0]).toEqual(RED);
    const thin = sampleEdges(
      frame(64, 36, () => RED),
      64,
      36,
      { depth: 0 }
    );
    expect(thin.top[0]).toEqual(RED);
  });

  it("takes the border depth in the video's own space, one value per axis", () => {
    // Red where x < 30, blue elsewhere, on a 256 x 144 sample.
    const picture = frame(256, 144, (x) => (x < 30 ? RED : BLUE));
    // 16:9: the border is 21 px deep in x, inside the red strip.
    const wide = sampleEdges(picture, 256, 144, {}, 16 / 9);
    expect(wide.left.every((c) => c[0] === 255 && c[2] === 0)).toBe(true);
    // 9:16 squashed into the same sample: 15 % of the video's width is 38 px in x.
    const tall = sampleEdges(picture, 256, 144, {}, 9 / 16);
    expect(tall.left[0][2]).toBeGreaterThan(0);
    expect(tall.top).toHaveLength(7);
    expect(tall.left).toHaveLength(12);
  });

  it("keeps the border inside the frame on each axis, whatever the ratio", () => {
    const edges = sampleEdges(
      frame(64, 36, () => RED),
      64,
      36,
      { depth: 5 },
      1 / 4
    );
    expect(edges.top[0]).toEqual(RED);
    expect(edges.left.at(-1)).toEqual(RED);
  });
});

describe("zonesFor", () => {
  it("gives `points` zones along the longer side and proportionally fewer along the shorter", () => {
    expect(zonesFor(12, 16 / 9)).toEqual({ across: 12, down: 7 });
    expect(zonesFor(12, 4 / 3)).toEqual({ across: 12, down: 9 });
    expect(zonesFor(12, 1)).toEqual({ across: 12, down: 12 });
    expect(zonesFor(12, 21 / 9)).toEqual({ across: 12, down: 5 });
    expect(zonesFor(12, 9 / 16)).toEqual({ across: 7, down: 12 });
  });

  it("makes zones of the same size on all four sides, within 10 %", () => {
    for (const ratio of [16 / 9, 4 / 3, 1, 21 / 9, 9 / 16, 3 / 4, 4, 1 / 4]) {
      const { across, down } = zonesFor(12, ratio);
      // The video is `ratio` wide and 1 high: a zone along the top is `ratio / across` wide, a zone down a side is `1 / down` high.
      const topZone = ratio / across;
      const sideZone = 1 / down;
      expect(Math.abs(topZone / sideZone - 1)).toBeLessThan(0.1);
    }
  });

  it("never goes under one zone, and falls back on a square for a ratio it cannot use", () => {
    expect(zonesFor(1, 4)).toEqual({ across: 1, down: 1 });
    expect(zonesFor(2, 10)).toEqual({ across: 2, down: 1 });
    expect(zonesFor(12, 0)).toEqual({ across: 12, down: 12 });
    expect(zonesFor(12, Number.NaN)).toEqual({ across: 12, down: 12 });
  });
});
