/**
 * Gives `run` the latest value at most once every `ms`. The last value is
 * always delivered, also when the calls stop (a video that pauses). `cancel`
 * drops a delivery still waiting.
 */
export function throttle<T>(
  run: (value: T) => void,
  ms: number
): ((value: T) => void) & { cancel: () => void } {
  let latest: T;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let last = Number.NEGATIVE_INFINITY;
  const deliver = () => {
    timer = undefined;
    last = performance.now();
    run(latest);
  };
  const push = (value: T) => {
    latest = value;
    const wait = last + ms - performance.now();
    if (wait <= 0) {
      deliver();
    } else {
      timer ??= setTimeout(deliver, wait);
    }
  };
  return Object.assign(push, { cancel: () => clearTimeout(timer) });
}
