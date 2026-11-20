export type { AmbientOptions } from "./ambient/index.js";
export { ambient } from "./ambient/index.js";
export type { SampleCost, WatchOptions } from "./core/capture.js";
export { watchVideo } from "./core/capture.js";
export type { Effect, EffectOptions } from "./core/effect.js";
export type { Glow } from "./core/glow.js";
export { createGlow } from "./core/glow.js";
export type { MethodChoice } from "./core/reader.js";
export type { EdgeColors, Rgb } from "./core/sample.js";
export { EDGE_POINTS, sampleEdges } from "./core/sample.js";
export type {
  Colors,
  Watcher,
  WatcherOptions,
  WatcherStats,
} from "./core/watcher.js";
export { watch } from "./core/watcher.js";
export { halo } from "./halo/index.js";
export { letterbox } from "./letterbox/index.js";
export type { ThemeOptions } from "./theme/index.js";
export { theme } from "./theme/index.js";
