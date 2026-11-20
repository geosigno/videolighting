/**
 * Time budgets of the core, in ms, per video height. They are ceilings, not
 * targets: 2.5 to 3 times what the slowest of the three engines measured on a
 * laptop with a GPU (Firefox, whose main thread pays for creating the frame),
 * so that a real regression fails and noise does not. Measured there:
 *
 *   p50 latency   360p  1080p  2160p        main thread   360p  1080p  2160p
 *   Chromium       1.9    3.2    8.9         Chromium      0.10   0.07   0.05
 *   Firefox        3.0    5.0   13.0         Firefox       1.59   3.36   6.94
 *   WebKit         2.0    2.0    3.0         WebKit        0.18   0.10   0.05
 *
 * A CI runner has no GPU and shares its CPU: they are multiplied there (`scale`).
 */
export const base = {
  /**
   * Main-thread time the watcher and all its listeners use per sampled frame
   * (palette, smoothing, every effect's writes; not the sampler itself, which
   * `mainThreadMs` covers), with all four effects on. Measured at 360p / 1080p /
   * 2160p: Chromium 0.15 / 0.26 / 0.24, Firefox 0.07 / 0.43 / 0.15, WebKit
   * 0.17 / 0.35 / 0.19 ms. Budget: 3x the slowest.
   */
  watcherMs: { 360: 1.5, 1080: 1.5, 2160: 1.5 },
  /** Mean main-thread time per sample. */
  mainThreadMs: { 360: 4, 1080: 8, 2160: 16 },
  /** Median time from asking for a frame to having its colours. */
  latencyMs: { 360: 10, 1080: 20, 2160: 40 },
} as const;

export type Height = keyof typeof base.latencyMs;

/**
 * The scale of the budgets for where the tests run: a CI runner has no GPU and
 * shares its CPU, so they are multiplied there. Override with
 * GLOW_BUDGET_SCALE (e.g. GLOW_BUDGET_SCALE=3 bun run test:e2e).
 */
export const scale = Number(
  process.env.GLOW_BUDGET_SCALE ?? (process.env.CI ? 4 : 1)
);

export const budget = {
  latencyMs: (height: Height) => base.latencyMs[height] * scale,
  mainThreadMs: (height: Height) => base.mainThreadMs[height] * scale,
  watcherMs: (height: Height) => base.watcherMs[height] * scale,
};
