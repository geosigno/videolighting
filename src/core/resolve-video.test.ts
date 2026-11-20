import { describe, expect, it } from "bun:test";
import { locate, resolveVideo } from "./resolve-video.js";

const video = { parentElement: { tagName: "DIV" }, tagName: "VIDEO" };

describe("resolveVideo", () => {
  it("returns a video as it is", () => {
    expect(resolveVideo(video)).toBe(video as never);
  });

  it("finds the video inside a container", () => {
    const container = { querySelector: () => video, tagName: "DIV" };
    expect(resolveVideo(container)).toBe(video as never);
  });

  it("finds nothing in a container without a video", () => {
    expect(
      resolveVideo({ querySelector: () => null, tagName: "DIV" })
    ).toBeUndefined();
    expect(resolveVideo(null)).toBeUndefined();
  });
});

describe("locate", () => {
  it("says so when there is no video", () => {
    const empty = { querySelector: () => null, tagName: "DIV" };
    expect(() => locate(empty)).toThrow("glow: no <video> found");
  });

  it("applies to the video's parent by default", () => {
    expect(locate(video).element).toBe(video.parentElement as never);
  });

  it("applies to the element it is given", () => {
    const element = { tagName: "SECTION" };
    expect(locate(video, element as never).element).toBe(element as never);
  });

  it("needs an element when the video has no parent", () => {
    expect(() => locate({ parentElement: null, tagName: "VIDEO" })).toThrow(
      "glow: the effect needs an element to apply to"
    );
  });
});
