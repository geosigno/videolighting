import { useCallback, useRef } from "react";

/** Equal when both hold the same keys with `Object.is`-equal values (one level deep). */
export function shallowEqual(
  a: object | undefined,
  b: object | undefined
): boolean {
  if (Object.is(a, b)) {
    return true;
  }
  if (!(a && b)) {
    return false;
  }
  const keysA = Object.keys(a);
  if (keysA.length !== Object.keys(b).length) {
    return false;
  }
  return keysA.every(
    (key) =>
      Object.hasOwn(b, key) &&
      Object.is(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key]
      )
  );
}

/** The previous value as long as the new one is shallowly equal: an identity React can compare. */
export function useShallowStable<T extends object | undefined>(value: T): T {
  const stable = useRef(value);
  if (!shallowEqual(stable.current, value)) {
    stable.current = value;
  }
  return stable.current;
}

/**
 * A stable function that calls the latest `fn` (and does nothing while there
 * is none), so a callback written inline, or one that comes and goes, does
 * not count as a change.
 */
export function useLatest<A extends unknown[]>(
  fn: ((...args: A) => void) | undefined
): (...args: A) => void {
  const latest = useRef(fn);
  latest.current = fn;
  return useCallback((...args: A) => latest.current?.(...args), []);
}
