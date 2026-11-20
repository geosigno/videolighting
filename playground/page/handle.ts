import type { ProfilerOnRenderCallback } from "react";
import { inspect, peekColors } from "../../src/core/watcher.js";
import {
  ambient,
  halo,
  letterbox,
  theme,
  watch,
  watchVideo,
} from "../../src/index.js";
import type { Metrics } from "./metrics-store.js";
import type { EffectName } from "./state.js";

/** What the tests drive the page through. */
export interface GlowPageHandle {
  /** What effect components got through their own `onError` (the Halo's, inline). */
  componentErrors: () => string[];
  /** Everything given to the provider's `onError`, as text. */
  errors: () => string[];
  /** Calls of the `useColorsEvent` demo's callback (Checks section). */
  eventCalls: () => number;
  /** `?lateVideo`: what the page held just before its `<video>` was added. */
  lateVideo: () => LateVideoRecord | undefined;
  metrics: () => Metrics;
  /** Resolves once the video plays and, if an effect is on, a sample came in. */
  ready: () => Promise<void>;
  /** Commits of each effect component, counted by `<Profiler>`. */
  renders: () => Record<string, number>;
  setEffect: (name: EffectName, on: boolean) => void;
}

const api = {
  ambient,
  halo,
  inspect,
  letterbox,
  peekColors,
  theme,
  watch,
  watchVideo,
};

/** The library, as the tests reach it from the page. */
export type GlowApi = typeof api;

declare global {
  interface Window {
    glowApi?: GlowApi;
    glowPage?: GlowPageHandle;
  }
}

const renderCounts: Record<string, number> = {};
const errorLog: string[] = [];
let eventCount = 0;

export interface LateVideoRecord {
  /** `[data-glow]` layers in the page then. */
  layers: number;
  /** Commits of each effect component by then: they were mounted. */
  renders: Record<string, number>;
  videos: number;
}
let lateVideoRecord: LateVideoRecord | undefined;

/** Called just before the late `<video>` is added. */
export const recordLateVideo = () => {
  lateVideoRecord = {
    layers: document.querySelectorAll("[data-glow]").length,
    renders: { ...renderCounts },
    videos: document.querySelectorAll("video").length,
  };
};

/** The `useColorsEvent` demo's callback. */
export const countEvent = (_colors: unknown) => {
  eventCount += 1;
};

export const countRender: ProfilerOnRenderCallback = (id) => {
  renderCounts[id] = (renderCounts[id] ?? 0) + 1;
};

const componentErrorLog: string[] = [];

const asText = (error: unknown) =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error);

export const recordError = (error: unknown) => {
  errorLog.push(asText(error));
};

export const recordComponentError = (name: string, error: unknown) => {
  componentErrorLog.push(`${name}: ${asText(error)}`);
};

const POLL_MS = 50;

/** Playing, and, when some effect is on, its read has delivered a sample. */
function whenReady(
  video: HTMLVideoElement,
  anyEffect: () => boolean
): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      const samples = inspect(video)?.stats().samples ?? 0;
      if (!video.paused && (samples > 0 || !anyEffect())) {
        resolve();
      } else {
        setTimeout(check, POLL_MS);
      }
    };
    check();
  });
}

export function installHandle(
  video: HTMLVideoElement,
  metrics: () => Metrics,
  setEffect: GlowPageHandle["setEffect"],
  anyEffect: () => boolean
): void {
  window.glowApi = api;
  window.glowPage = {
    componentErrors: () => [...componentErrorLog],
    errors: () => [...errorLog],
    eventCalls: () => eventCount,
    lateVideo: () => lateVideoRecord,
    metrics,
    ready: () => whenReady(video, anyEffect),
    renders: () => ({ ...renderCounts }),
    setEffect,
  };
}
