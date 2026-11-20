import { useEffect, useRef } from "react";
import type { createMetricsStore, Metrics } from "./metrics-store.js";

type Store = ReturnType<typeof createMetricsStore>;

/** Each line: its label and how it is written from the metrics. */
const FIELDS: [key: string, label: string, text: (m: Metrics) => string][] = [
  ["method", "read method", (m) => m.method],
  ["references", "effects sharing the read", (m) => String(m.references)],
  ["video-fps", "video frames/s", (m) => m.videoFps.toFixed(1)],
  ["sample-fps", "frames read/s", (m) => m.sampleFps.toFixed(1)],
  ["ratio", "reads per frame", (m) => m.ratio.toFixed(2)],
  ["skipped", "frames lost (3 s)", (m) => String(m.skipped)],
  [
    "latency",
    "latency p50 / p95",
    (m) => `${m.latencyP50.toFixed(1)} / ${m.latencyP95.toFixed(1)} ms`,
  ],
  ["watcher-ms", "watcher ms / sample", (m) => m.watcherMs.toFixed(2)],
];

/**
 * Fixed nodes whose text the store's 2 Hz tick writes directly: no React
 * render per tick, and `contain: strict` keeps the writes from reaching the
 * rest of the page's layout.
 */
export function MetricsPanel({
  forced,
  store,
}: {
  forced: boolean;
  store: Store | null;
}) {
  const root = useRef<HTMLDListElement>(null);
  useEffect(() => {
    const element = root.current;
    if (!(store && element)) {
      return;
    }
    const nodes = FIELDS.map(([key, , text]) => {
      const node = element.querySelector(`[data-metric="${key}"]`);
      return (m: Metrics) => {
        if (node) {
          node.textContent =
            key === "method"
              ? `${text(m)} (${forced ? "forced" : "auto"})`
              : text(m);
        }
      };
    });
    return store.subscribe((m) => {
      for (const write of nodes) {
        write(m);
      }
    });
  }, [forced, store]);
  return (
    <dl className="pg-metrics" data-testid="metrics" ref={root}>
      {FIELDS.map(([key, label]) => (
        <div key={key}>
          <dt>{label}</dt>
          <dd data-metric={key} data-testid={`metric-${key}`}>
            -
          </dd>
        </div>
      ))}
    </dl>
  );
}
