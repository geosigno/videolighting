import { describe, expect, it } from "bun:test";
import {
  DEFAULTS,
  type PageState,
  parseState,
  toSearch,
} from "../../playground/page/state.js";

// The page is driven by its URL: the end-to-end tests open it this way.

describe("page state in the URL", () => {
  const states: PageState[] = [
    DEFAULTS,
    { ...DEFAULTS, effects: [] },
    { ...DEFAULTS, effects: ["ambient", "theme"], method: "webgl" },
    { ...DEFAULTS, aspect: "21:9" },
    {
      ambient: "natural",
      aspect: "9:16",
      effects: ["theme"],
      halo: "natural",
      mainThread: true,
      method: "canvas",
      panel: false,
      src: "https://a.b/c d.mp4?x=1&y=2",
      strict: false,
      theme: "natural",
    },
  ];

  it("is the same after being written and read back", () => {
    for (const state of states) {
      expect(parseState(toSearch(state))).toEqual(state);
    }
  });

  it("falls back to the defaults on a value it does not know, and never throws", () => {
    expect(parseState("")).toEqual(DEFAULTS);
    expect(parseState("?method=foo").method).toBe("auto");
    expect(parseState("?aspect=1:1").aspect).toBe("16:9");
    expect(parseState("?ambient=nope").ambient).toBe("vibrant");
    // Booleans are 1 or 0 only.
    expect(parseState("?main=true").mainThread).toBe(false);
    expect(parseState("?panel=false").panel).toBe(true);
    for (const garbage of ["garbage", "?%", "?%E0%A4%A", "?&&&===", "#x?y"]) {
      expect(parseState(garbage)).toEqual(DEFAULTS);
    }
  });

  it("reads the effects list: empty is not absent, order is fixed, duplicates and unknown names go", () => {
    expect(parseState("?effects=").effects).toEqual([]);
    expect(parseState("?method=webgl").effects).toEqual(DEFAULTS.effects);
    expect(parseState("?effects=theme,halo,theme,nope").effects).toEqual([
      "halo",
      "theme",
    ]);
  });

  it("lets a page bring its own defaults, written nowhere unless the URL changes them", () => {
    const own: PageState = { ...DEFAULTS, effects: ["halo"], src: "mux" };
    expect(parseState("", own)).toEqual(own);
    expect(parseState("?src=mire.mp4", own).src).toBe("mire.mp4");
    expect(toSearch(own, own)).toBe("");
    const none = { ...own, effects: [] };
    expect(parseState(toSearch(none, own), own)).toEqual(none);
  });
});
