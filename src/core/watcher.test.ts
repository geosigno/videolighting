import { describe, expect, test as it } from "bun:test";
import { readKey } from "./watcher.js";

describe("readKey", () => {
  it("is the same for the same read settings", () => {
    expect(readKey({ depth: 0.2, method: "canvas" })).toBe(
      readKey({ method: "canvas", depth: 0.2 })
    );
  });

  it("ignores onError", () => {
    expect(readKey({ onError: () => undefined, tau: 0.3 })).toBe(
      readKey({ tau: 0.3 })
    );
  });

  it("differs when a read setting differs", () => {
    expect(readKey({ method: "canvas" })).not.toBe(
      readKey({ method: "webgl" })
    );
    expect(readKey({ worker: false })).not.toBe(readKey({}));
  });
});
