import { describe, expect, test as it } from "bun:test";
import { shallowEqual } from "./shallow.js";

describe("shallowEqual", () => {
  it("same values are equal", () => {
    expect(shallowEqual({ a: 1 }, { a: 1 })).toBe(true);
  });

  it("a different value is not equal", () => {
    expect(shallowEqual({ a: 1 }, { a: 2 })).toBe(false);
  });

  it("undefined against undefined is equal", () => {
    expect(shallowEqual(undefined, undefined)).toBe(true);
  });

  it("arrays with the same content are equal", () => {
    expect(shallowEqual([1, 2], [1, 2])).toBe(true);
  });
});
