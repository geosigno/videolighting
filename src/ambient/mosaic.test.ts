import { describe, expect, it } from "bun:test";
import type { EdgeColors, Rgb } from "../core/sample.js";
import { cellColor } from "./mosaic.js";

const side = (color: Rgb): Rgb[] => Array.from({ length: 12 }, () => color);

describe("cellColor", () => {
  it("gives the colour of the edges when they all agree", () => {
    const edges: EdgeColors = {
      bottom: side([10, 20, 30]),
      left: side([10, 20, 30]),
      right: side([10, 20, 30]),
      top: side([10, 20, 30]),
    };
    for (const [u, v] of [
      [0, 0],
      [0.5, 0.5],
      [1, 1],
      [1, 0],
    ] as const) {
      expect(cellColor(edges, u, v)).toEqual([10, 20, 30]);
    }
  });

  it("blends the two edges a corner touches, and does not throw on an empty side", () => {
    const edges: EdgeColors = {
      bottom: side([0, 0, 255]),
      left: side([0, 255, 0]),
      right: side([255, 255, 0]),
      top: side([255, 0, 0]),
    };
    expect(cellColor(edges, 0, 0)).toEqual([127.5, 127.5, 0]);
    const noLeft = cellColor({ ...edges, left: [] }, 0, 0);
    expect(noLeft).toEqual([127.5, 0, 0]);
    expect(noLeft.some(Number.isNaN)).toBe(false);
  });
});
