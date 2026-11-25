import { readFileSync } from "node:fs";
import { expect, type Page, type TestInfo, test } from "@playwright/test";
import type { EdgeColors, SampleCost } from "../../playground/internal.js";
import type { Metrics } from "../../playground/page/metrics-store.js";
import type { EffectName } from "../../playground/page/state.js";

/**
 * What every end-to-end test shares: opening the reference page with its URL
 * as input, reading `window.glowPage`, and a few measures of the page.
 */

export type { EffectName } from "../../playground/page/state.js";

export const ALL: EffectName[] = ["halo", "ambient", "theme"];

/** The page's test ids, as selectors. */
export const FRAME = '[data-testid="frame"]';
export const CONTAINER = '[data-testid="container"]';
/** The element inside the card that wears the theme (the Theme component's own). */
export const THEME_HOST = '[data-testid="theme-card"] > *';

/** The page's own `<video>` (other tests add videos of their own). */
export const VIDEO = '[data-testid="video"]';

/** The page's URL input. Unset keys keep the page's defaults. */
export interface PageQuery {
  ambient?: "natural" | "vibrant";
  aspect?: "16:9" | "21:9" | "4:3" | "9:16";
  effects?: EffectName[];
  main?: boolean;
  method?: "auto" | "canvas" | "webgl";
  panel?: boolean;
  src?: string;
  strict?: boolean;
}

export function pageQuery(query: PageQuery): string {
  const params = new URLSearchParams();
  if (query.src !== undefined) {
    params.set("src", query.src);
  }
  if (query.effects !== undefined) {
    params.set("effects", query.effects.join(","));
  }
  if (query.method !== undefined) {
    params.set("method", query.method);
  }
  if (query.aspect !== undefined) {
    params.set("aspect", query.aspect);
  }
  if (query.main !== undefined) {
    params.set("main", query.main ? "1" : "0");
  }
  if (query.panel !== undefined) {
    params.set("panel", query.panel ? "1" : "0");
  }
  if (query.strict !== undefined) {
    params.set("strict", query.strict ? "1" : "0");
  }
  if (query.ambient !== undefined) {
    params.set("ambient", query.ambient);
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

/**
 * Opens `/page.html` with `query` (a string, or the URL input as an object)
 * and, unless `ready: false`, waits until the video plays and, with an effect
 * on, its read delivered a sample.
 */
export async function open(
  page: Page,
  query: string | PageQuery = "",
  { ready = true }: { ready?: boolean } = {}
) {
  const search = typeof query === "string" ? query : pageQuery(query);
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") {
      problems.push(message.text());
    }
  });
  await page.goto(`/page.html${search}`);
  try {
    await page.waitForFunction(() => Boolean(window.glowPage), undefined, {
      timeout: 30_000,
    });
  } catch (error) {
    throw new Error(
      `the page did not start (${problems.join(" | ") || "no error on the page"})`,
      { cause: error }
    );
  }
  if (ready) {
    await page.evaluate(() => window.glowPage?.ready());
  }
}

export async function metrics(page: Page): Promise<Metrics> {
  const found = await page.evaluate(() => window.glowPage?.metrics());
  expect(found).toBeDefined();
  return found as Metrics;
}

export const method = async (page: Page) => (await metrics(page)).method;

/** WebGL where the engine gives it to the Worker; Firefox may refuse it. */
export const webglOr = (browserName: string) =>
  browserName === "firefox" ? ["webgl", "canvas"] : ["webgl"];

export const errors = async (page: Page) =>
  (await page.evaluate(() => window.glowPage?.errors())) ?? [];

/** What each browser calls a refusal to read a cross-origin video. */
export const SECURITY_ERROR = /Security|tainted|cross-origin/iu;

/**
 * Serves the 360p clip from another origin without CORS headers: a video the
 * browser plays but will not let the page read. Returns its URL.
 */
export async function crossOriginClip(page: Page): Promise<string> {
  const body = readFileSync(new URL("./public/quad-360.webm", import.meta.url));
  // The same server under another host name: another origin.
  const origin = new URL(String(test.info().project.use.baseURL));
  origin.hostname = "127.0.0.1";
  const url = new URL("/other-origin/quad.webm", origin).href;
  await page.route(url, (route) =>
    route.fulfill({ body, contentType: "video/webm", status: 200 })
  );
  return url;
}

/** Page errors (uncaught exceptions), collected from now on. */
export function crashes(page: Page): string[] {
  const found: string[] = [];
  page.on("pageerror", (error) => found.push(error.message));
  return found;
}

/**
 * Whether a Worker of this browser can upload a frame of the page's video to
 * WebGL2, as the Worker engine would. A forced `webgl` read may only fall back
 * to the canvas where this fails.
 */
export async function workerWebgl(page: Page): Promise<string> {
  return await page.evaluate(async (selector) => {
    const video = document.querySelector<HTMLVideoElement>(selector);
    if (!video || typeof VideoFrame === "undefined") {
      return "no VideoFrame";
    }
    const source = `onmessage = ({ data }) => {
      let result = "ok";
      try {
        const gl = new OffscreenCanvas(4, 4).getContext("webgl2");
        if (!gl) {
          result = "no webgl2 context";
        } else {
          gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, data);
          const code = gl.getError();
          if (code !== 0) {
            result = "upload error " + code;
          }
        }
      } catch (error) {
        result = String(error);
      }
      data.close();
      postMessage(result);
    };`;
    const url = URL.createObjectURL(new Blob([source]));
    const worker = new Worker(url);
    const frame = new VideoFrame(video);
    try {
      return await new Promise<string>((resolve) => {
        worker.onmessage = ({ data }) => resolve(String(data));
        worker.postMessage(frame, [frame as unknown as Transferable]);
      });
    } finally {
      worker.terminate();
      URL.revokeObjectURL(url);
    }
  }, VIDEO);
}

/** How many samples of the read `expectMethod` looks at. */
const METHOD_SAMPLES = 10;

/**
 * The read uses the method asked for, judged on its samples (`cost.method`),
 * not on the page's 2 Hz snapshot nor on the read's state before its first
 * sample. Only a forced `webgl` this browser's Worker cannot do (see
 * `workerWebgl`) may fall back to the canvas, and that is reported as an
 * annotation, never silently. Returns the method the read must be using.
 */
export async function expectMethod(
  page: Page,
  info: TestInfo,
  requested: "canvas" | "webgl"
): Promise<string> {
  const methods = await page.evaluate(
    async ([selector, count]) => {
      const { glowApi } = window;
      const video = document.querySelector<HTMLVideoElement>(selector);
      const started = performance.now();
      let read = video ? glowApi?.inspect(video) : undefined;
      while (!read && performance.now() - started < 10_000) {
        // biome-ignore lint/performance/noAwaitInLoops: waiting for the read
        await new Promise((resolve) => setTimeout(resolve, 20));
        read = video ? glowApi?.inspect(video) : undefined;
      }
      if (!read) {
        return [];
      }
      const inspector = read;
      const seen: string[] = [];
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 10_000);
        const stop = inspector.onSample((_edges, cost) => {
          seen.push(cost.method);
          if (seen.length >= count) {
            clearTimeout(timer);
            stop();
            resolve();
          }
        });
      });
      return seen;
    },
    [VIDEO, METHOD_SAMPLES] as const
  );
  expect(methods.length).toBeGreaterThanOrEqual(METHOD_SAMPLES);
  const used = [...new Set(methods)].join("|");
  // Why WebGL failed in a Worker here ("ok": it works), asked only on a fallback.
  const webgl =
    requested === "webgl" && used === "canvas"
      ? await workerWebgl(page)
      : "not asked";
  const fellBack = webgl !== "not asked" && webgl !== "ok";
  if (fellBack) {
    info.annotations.push({
      description: `webgl asked, canvas used: ${webgl}`,
      type: "webgl fallback",
    });
  }
  const expected = fellBack ? "canvas" : requested;
  // Every sample read the way asked, or the canvas only where WebGL fails in a Worker.
  expect({ used, webgl }).toEqual({ used: expected, webgl });
  // And the page's snapshot, taken now the read has samples, says the same.
  await expect.poll(() => method(page)).toBe(expected);
  return expected;
}

/** One sample of a read, as the tests look at it. */
export interface Sample {
  /** performance.now() when it was reported. */
  at: number;
  colors: EdgeColors;
  cost: SampleCost;
  /** video.currentTime when it was reported. */
  time: number;
}

export type Side = "bottom" | "left" | "right" | "top";

/** Mean color of the middle of a side (the ends overlap the neighboring strip). */
export function side({ colors }: Sample, name: Side): number[] {
  const points = colors[name];
  // The zones whose center lies in the middle half of the side: the sides have
  // different numbers of zones (the shorter ones fewer), so not a fixed slice.
  const middle = points.filter((_, i) => {
    const center = (i + 0.5) / points.length;
    return center >= 0.25 && center <= 0.75;
  });
  return [0, 1, 2].map(
    (channel) =>
      middle.reduce((sum, rgb) => sum + (rgb[channel] ?? 0), 0) / middle.length
  );
}

/** Colors of the clips (see make-fixtures.sh), first half then second half. */
export const RED = [255, 0, 0];
export const BLUE = [0, 0, 255];
export const GREEN = [0, 200, 0];
export const YELLOW = [255, 255, 0];
/** Per channel, out of 255: video compression and each browser's own color conversion. */
const TOLERANCE = 40;

export function expectColor(actual: number[], expected: number[]) {
  for (const [channel, value] of expected.entries()) {
    expect(Math.abs((actual[channel] ?? 0) - value)).toBeLessThan(TOLERANCE);
  }
}

/** The last sample taken while the first picture was on screen. */
export function firstPicture(samples: Sample[]): Sample {
  const found = samples.filter((s) => s.time > 0.3 && s.time < 1.8).at(-1);
  expect(found, "no sample taken during the first picture").toBeDefined();
  return found as Sample;
}

/** The four edges of the first picture: red left, blue right, green top, yellow bottom. */
export function expectFirstPicture(samples: Sample[]) {
  const sample = firstPicture(samples);
  expectColor(side(sample, "left"), RED);
  expectColor(side(sample, "right"), BLUE);
  expectColor(side(sample, "top"), GREEN);
  expectColor(side(sample, "bottom"), YELLOW);
}

export const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
export const mean = (values: number[]) =>
  values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);

/**
 * The samples of the page's own read (whatever method it was given), through
 * `inspect().onSample`, for `ms`; with `untilFirstPicture`, it stops early at
 * the first sample taken well inside the first picture (1 s to 1.8 s), with
 * `ms` as the ceiling.
 */
export async function pageSamples(
  page: Page,
  ms: number,
  { untilFirstPicture = false } = {}
): Promise<Sample[]> {
  return await page.evaluate(
    async ([selector, duration, early]) => {
      const { glowApi } = window;
      const video = document.querySelector<HTMLVideoElement>(selector);
      const read = video && glowApi?.inspect(video);
      if (!(video && read)) {
        return [];
      }
      const samples: Sample[] = [];
      let stop: () => void = () => undefined;
      const done = new Promise<void>((resolve) => {
        stop = resolve;
      });
      const timer = setTimeout(stop, duration);
      const unsubscribe = read.onSample((colors, cost) => {
        samples.push({
          at: performance.now(),
          colors,
          cost,
          time: video.currentTime,
        });
        if (early && video.currentTime >= 1 && video.currentTime < 1.8) {
          stop();
        }
      });
      await done;
      clearTimeout(timer);
      unsubscribe();
      return samples;
    },
    [VIDEO, ms, untilFirstPicture] as const
  );
}

/** What `glowApi.watchVideo` reported over a run (the core alone, no effect). */
export interface Run {
  /** Samples reported in the 400 ms after stop() was called. */
  afterStop: number;
  error?: string;
  samples: Sample[];
  /** Width of the video, in px. */
  width: number;
}

/**
 * The core on its own: opens the page with no effect on `src` (so the page
 * reads nothing), rewinds its video to the start and plays it, then runs
 * `glowApi.watchVideo` on it for `ms`, stops it, and counts what still came
 * in the 400 ms after.
 */
export async function runCore(
  page: Page,
  { ms, src, worker }: { ms: number; src: string; worker?: boolean }
): Promise<Run> {
  await open(page, { effects: [], src });
  return await page.evaluate(
    async ([selector, duration, inWorker]) => {
      const { glowApi } = window;
      const video = document.querySelector<HTMLVideoElement>(selector);
      if (!(video && glowApi)) {
        return { afterStop: -1, error: "no page", samples: [], width: 0 };
      }
      const sleep = (wait: number) =>
        new Promise((resolve) => setTimeout(resolve, wait));
      // From the first frame, as a freshly played clip.
      if (video.currentTime > 0) {
        const seeked = new Promise((resolve) =>
          video.addEventListener("seeked", resolve, { once: true })
        );
        video.currentTime = 0;
        await seeked;
      }
      await video.play();
      const samples: Sample[] = [];
      let error: string | undefined;
      const stop = glowApi.watchVideo(video, {
        onColors: (colors, cost) =>
          samples.push({
            at: performance.now(),
            colors,
            cost,
            time: video.currentTime,
          }),
        onError: (reason) => {
          error =
            reason instanceof Error
              ? `${reason.name}: ${reason.message}`
              : String(reason);
        },
        worker: inWorker,
      });
      await sleep(duration);
      stop();
      const reported = samples.length;
      await sleep(400);
      return {
        afterStop: samples.length - reported,
        error,
        samples,
        width: video.videoWidth,
      };
    },
    [VIDEO, ms, worker] as const
  );
}

/** The neutral color every read starts from. */
export const NEUTRAL = [24, 24, 30];
export const far = (a: number[], b: number[]) =>
  Math.hypot(...b.map((v, i) => (a[i] ?? 0) - v));

/** Red, green, blue of every color stop of an element's background gradient. */
export async function stops(page: Page, selector: string, nth: number) {
  return await page.evaluate(
    ({ nth: which, selector: query }) => {
      const element = document.querySelectorAll<HTMLElement>(query)[which];
      const image = element ? element.style.backgroundImage : "";
      return [
        ...image.matchAll(/rgb\((?<r>\d+)[, ]+(?<g>\d+)[, ]+(?<b>\d+)\)/gu),
      ].map((m) => [
        Number(m.groups?.r),
        Number(m.groups?.g),
        Number(m.groups?.b),
      ]);
    },
    { nth, selector }
  );
}

/** Channels of a CSS variable's `rgb(...)` value on the first element matching `selector`. */
export async function channels(page: Page, selector: string, name: string) {
  return await page.evaluate(
    ({ name: variable, selector: query }) =>
      (
        document
          .querySelector<HTMLElement>(query)
          ?.style.getPropertyValue(variable) ?? ""
      )
        .match(/\d+/gu)
        ?.map(Number) ?? [],
    { name, selector }
  );
}

/** In-page: the number of samples of the page video's read (-1: no read). */
export const samplesOf = (page: Page) =>
  page.evaluate((selector) => {
    const { glowApi } = window;
    const video = document.querySelector<HTMLVideoElement>(selector);
    return video ? (glowApi?.inspect(video)?.stats().samples ?? -1) : -1;
  }, VIDEO);

/** Handles on the read of the video matching `selector` (the page's own by default). */
export const referencesOf = (page: Page, selector = VIDEO) =>
  page.evaluate((sel) => {
    const video = document.querySelector<HTMLVideoElement>(sel);
    const { glowApi } = window;
    return video ? glowApi?.inspect(video)?.stats().references : undefined;
  }, selector);

/**
 * Turns `name` off through the page and checks the effect cleaned up the
 * element it ran on: the component's element goes with it, so it is kept
 * aside first and looked at once detached (a layer left in it = no cleanup).
 */
export async function stopAndKeepHost(page: Page, name: EffectName) {
  await page.evaluate((effect) => {
    const target = window as Window & { kept?: Element };
    target.kept =
      document.querySelector(`[data-vl="${effect}"]`)?.parentElement ??
      undefined;
    target.glowPage?.setEffect(effect, false);
  }, name);
  await expect(page.locator(`[data-vl="${name}"]`)).toHaveCount(0);
  // The effect's cleanup runs once React has let go of the element.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const { kept } = window as unknown as { kept?: Element };
        return {
          detached: kept ? !kept.isConnected : false,
          layers: kept ? kept.querySelectorAll("[data-vl]").length : -1,
        };
      })
    )
    .toEqual({ detached: true, layers: 0 });
}
