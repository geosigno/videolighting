import { describe, expect, it } from "bun:test";
import {
  DEFAULTS,
  nonDefault,
  type PageState,
  parseState,
  toSearch,
} from "./state.js";

describe("DEFAULTS", () => {
  it("has the documented values", () => {
    expect(DEFAULTS).toEqual({
      aspect: "16:9",
      effects: ["halo", "ambient", "theme", "letterbox"],
      mainThread: false,
      method: "auto",
      panel: true,
      src: "mire.mp4",
      strict: true,
      variant: "blobs",
    });
  });
});

describe("parseState", () => {
  it("returns the defaults for an empty search", () => {
    expect(parseState("")).toEqual(DEFAULTS);
    expect(parseState("?")).toEqual(DEFAULTS);
  });

  it("parses every parameter", () => {
    expect(
      parseState(
        "?src=foo.mp4&effects=halo,theme&method=canvas&aspect=4:3&variant=mosaic&main=1&panel=0&strict=0"
      )
    ).toEqual({
      aspect: "4:3",
      effects: ["halo", "theme"],
      mainThread: true,
      method: "canvas",
      panel: false,
      src: "foo.mp4",
      strict: false,
      variant: "mosaic",
    });
  });

  it("falls back to the default method on an unknown value", () => {
    expect(parseState("?method=foo").method).toBe("auto");
  });

  it("parses aspect, and falls back to the default on an unknown value", () => {
    expect(parseState("?aspect=4:3").aspect).toBe("4:3");
    expect(parseState("?aspect=21:9").aspect).toBe("21:9");
    expect(parseState("?aspect=9:16").aspect).toBe("9:16");
    expect(parseState("?aspect=1:1").aspect).toBe("16:9");
    expect(parseState("?aspect=").aspect).toBe("16:9");
    expect(parseState("").aspect).toBe("16:9");
  });

  it("ignores unknown effects", () => {
    expect(parseState("?effects=halo,nope").effects).toEqual(["halo"]);
  });

  it("treats an explicitly empty effects as no effects", () => {
    expect(parseState("?effects=").effects).toEqual([]);
  });

  it("keeps the default effects when the parameter is absent", () => {
    expect(parseState("?method=webgl").effects).toEqual(DEFAULTS.effects);
  });

  it("normalises effects order and removes duplicates", () => {
    expect(
      parseState("?effects=theme,halo,theme,letterbox,halo").effects
    ).toEqual(["halo", "theme", "letterbox"]);
  });

  it("accepts only 1/0 for booleans", () => {
    expect(parseState("?main=1").mainThread).toBe(true);
    expect(parseState("?main=0").mainThread).toBe(false);
    expect(parseState("?main=true").mainThread).toBe(false);
    expect(parseState("?panel=0").panel).toBe(false);
    expect(parseState("?panel=1").panel).toBe(true);
    expect(parseState("?panel=false").panel).toBe(true);
    expect(parseState("?strict=0").strict).toBe(false);
    expect(parseState("?strict=yes").strict).toBe(true);
    expect(parseState("?strict=").strict).toBe(true);
  });

  it("uses the default src when src is empty or absent", () => {
    expect(parseState("?src=").src).toBe("mire.mp4");
    expect(parseState("?src=mux").src).toBe("mux");
  });

  it("decodes an encoded src", () => {
    expect(parseState("?src=https%3A%2F%2Fa.b%2Fc.mp4%3Fx%3D1").src).toBe(
      "https://a.b/c.mp4?x=1"
    );
  });

  it("never throws on garbage", () => {
    for (const garbage of [
      "garbage",
      "?%",
      "?%E0%A4%A",
      "?&&&===",
      "?effects=,,,",
      "?method=&main=&panel=",
      "?=1",
      "#x?y",
    ]) {
      expect(() => parseState(garbage)).not.toThrow();
    }
    expect(parseState("?effects=,,,").effects).toEqual([]);
    expect(parseState("?&&&===")).toEqual(DEFAULTS);
  });
});

describe("toSearch", () => {
  it("is empty for the defaults", () => {
    expect(toSearch(DEFAULTS)).toBe("");
  });

  it("writes only what differs, in fixed order", () => {
    expect(
      toSearch({
        aspect: "4:3",
        effects: ["halo", "theme"],
        mainThread: true,
        method: "canvas",
        panel: false,
        src: "foo.mp4",
        strict: false,
        variant: "mosaic",
      })
    ).toBe(
      "?src=foo.mp4&effects=halo%2Ctheme&method=canvas&aspect=4%3A3&variant=mosaic&main=1&panel=0&strict=0"
    );
  });

  it("writes single differences", () => {
    expect(toSearch({ ...DEFAULTS, method: "webgl" })).toBe("?method=webgl");
    expect(toSearch({ ...DEFAULTS, mainThread: true })).toBe("?main=1");
    expect(toSearch({ ...DEFAULTS, panel: false })).toBe("?panel=0");
    expect(toSearch({ ...DEFAULTS, strict: false })).toBe("?strict=0");
    expect(toSearch({ ...DEFAULTS, src: "mux" })).toBe("?src=mux");
    expect(toSearch({ ...DEFAULTS, aspect: "9:16" })).toBe("?aspect=9%3A16");
  });

  it("omits effects equal to the default and writes empty as effects=", () => {
    expect(toSearch({ ...DEFAULTS, effects: [...DEFAULTS.effects] })).toBe("");
    expect(toSearch({ ...DEFAULTS, effects: [] })).toBe("?effects=");
  });

  it("URL-encodes src", () => {
    expect(toSearch({ ...DEFAULTS, src: "https://a.b/c.mp4?x=1" })).toBe(
      "?src=https%3A%2F%2Fa.b%2Fc.mp4%3Fx%3D1"
    );
  });
});

describe("round trip", () => {
  const states: PageState[] = [
    DEFAULTS,
    { ...DEFAULTS, effects: [] },
    { ...DEFAULTS, effects: ["ambient", "letterbox"], method: "webgl" },
    { ...DEFAULTS, aspect: "21:9" },
    {
      aspect: "9:16",
      effects: ["theme"],
      mainThread: true,
      method: "canvas",
      panel: false,
      src: "https://a.b/c d.mp4?x=1&y=2",
      strict: false,
      variant: "mosaic",
    },
  ];
  for (const state of states) {
    it(`parseState(toSearch(s)) equals s for ${JSON.stringify(state)}`, () => {
      expect(parseState(toSearch(state))).toEqual(state);
    });
  }
});

describe("nonDefault", () => {
  it("lists nothing for the defaults", () => {
    expect(nonDefault(DEFAULTS)).toEqual([]);
  });

  it("lists method and main thread", () => {
    expect(
      nonDefault({ ...DEFAULTS, mainThread: true, method: "webgl" })
    ).toEqual(["method: webgl", "main thread"]);
  });

  it("lists every deviation with its label", () => {
    expect(
      nonDefault({
        aspect: "4:3",
        effects: ["halo", "theme"],
        mainThread: true,
        method: "canvas",
        panel: false,
        src: "foo.mp4",
        strict: false,
        variant: "mosaic",
      })
    ).toEqual([
      "source: foo.mp4",
      "effects: halo, theme",
      "method: canvas",
      "format: 4:3",
      "variant: mosaic",
      "main thread",
      "panel off",
      "StrictMode off",
    ]);
  });

  it("lists a non-default format", () => {
    expect(nonDefault({ ...DEFAULTS, aspect: "4:3" })).toEqual(["format: 4:3"]);
  });

  it("labels an empty effects list", () => {
    expect(nonDefault({ ...DEFAULTS, effects: [] })).toEqual(["effects: none"]);
  });
});

describe("a page's own defaults", () => {
  const own: PageState = { ...DEFAULTS, effects: ["halo"], src: "mux" };

  it("start from them when the URL says nothing", () => {
    expect(parseState("", own)).toEqual(own);
  });

  it("let the URL override them", () => {
    const state = parseState("?src=mire.mp4&effects=halo,theme", own);
    expect(state.src).toBe("mire.mp4");
    expect(state.effects).toEqual(["halo", "theme"]);
  });

  it("write nothing for them and everything else", () => {
    expect(toSearch(own, own)).toBe("");
    expect(nonDefault(own, own)).toEqual([]);
    expect(toSearch({ ...own, effects: [...DEFAULTS.effects] }, own)).toBe(
      "?effects=halo%2Cambient%2Ctheme%2Cletterbox"
    );
  });

  it("round-trip an empty effects list", () => {
    const none = { ...own, effects: [] };
    expect(parseState(toSearch(none, own), own)).toEqual(none);
  });
});

describe("variant", () => {
  it("falls back to the default on an unknown value", () => {
    expect(parseState("?variant=nope").variant).toBe("blobs");
  });
});
