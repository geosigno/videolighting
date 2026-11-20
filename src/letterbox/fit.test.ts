import { describe, expect, it } from "bun:test";
import { fitRect } from "./fit.js";

describe("fitRect", () => {
  it("puts bars on the sides of a container wider than the video", () => {
    const rect = fitRect(
      { height: 500, width: 1000 },
      { height: 900, width: 1600 }
    );
    expect(rect.height).toBe(500);
    expect(rect.width).toBeCloseTo(888.9, 1);
    expect(rect.x).toBeCloseTo(55.6, 1);
    expect(rect.y).toBe(0);
  });

  it("puts bars above and below in a container taller than the video", () => {
    const rect = fitRect(
      { height: 600, width: 300 },
      { height: 900, width: 1600 }
    );
    expect(rect.width).toBe(300);
    expect(rect.height).toBeCloseTo(168.75, 2);
    expect(rect.x).toBe(0);
    expect(rect.y).toBeCloseTo(215.6, 1);
  });

  it("fills a container that has the video's ratio", () => {
    expect(
      fitRect({ height: 270, width: 480 }, { height: 1080, width: 1920 })
    ).toEqual({
      height: 270,
      width: 480,
      x: 0,
      y: 0,
    });
  });

  it("gives an empty rectangle for an empty container, with no NaN", () => {
    expect(
      fitRect({ height: 0, width: 0 }, { height: 900, width: 1600 })
    ).toEqual({
      height: 0,
      width: 0,
      x: 0,
      y: 0,
    });
  });

  it("gives an empty rectangle for a video without metadata, with no NaN", () => {
    expect(
      fitRect({ height: 300, width: 600 }, { height: 0, width: 0 })
    ).toEqual({
      height: 0,
      width: 0,
      x: 0,
      y: 0,
    });
  });
});
