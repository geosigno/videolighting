import { expect, test as it, test } from "@playwright/test";
import { budget, type Height } from "./budgets.js";
import {
  BLUE,
  crossOriginClip,
  expectColor,
  expectFirstPicture,
  expectMethod,
  firstPicture,
  mean,
  median,
  metrics,
  open,
  pageSamples,
  RED,
  runCore,
  type Sample,
  SECURITY_ERROR,
  side,
  YELLOW,
} from "./page-helpers.js";

/**
 * What the core must do, in every browser. Only the essentials: the colours
 * are right, they follow the picture, every frame is read, it is fast enough,
 * stopping stops it, and a video it cannot read is reported. Run on the
 * reference page with no effect on, through `glowApi.watchVideo`.
 */

const FPS = 25;

const clip = (height: Height) => `/quad-${height}.webm`;

/** Skip the first samples: the engine is still choosing its method. */
const WARM_UP = 15;

test.describe("core", () => {
  it("reports the colour of each edge", async ({ page }) => {
    const { samples, error } = await runCore(page, {
      ms: 1800,
      src: clip(360),
    });
    expect(error).toBeUndefined();
    expectFirstPicture(samples);
  });

  it("reports the same colours from the main thread", async ({ page }) => {
    const { samples, error } = await runCore(page, {
      ms: 1800,
      src: clip(360),
      worker: false,
    });
    expect(error).toBeUndefined();
    expectFirstPicture(samples);
  });

  it("follows the picture when it changes", async ({ page }) => {
    const { samples } = await runCore(page, { ms: 3600, src: clip(360) });
    const before = firstPicture(samples);
    const after = samples.filter((s) => s.time > 2.6).at(-1);
    expect(after, "no sample taken after the picture changed").toBeDefined();
    expectColor(side(before, "left"), RED);
    expectColor(side(after as Sample, "left"), BLUE);
    expectColor(side(after as Sample, "right"), RED);
    expectColor(side(after as Sample, "top"), YELLOW);
  });

  it("reads every frame of a 25 fps video", async ({ page }) => {
    const { samples } = await runCore(page, { ms: 3000, src: clip(360) });
    const seconds = ((samples.at(-1)?.at ?? 0) - (samples[0]?.at ?? 0)) / 1000;
    const rate = (samples.length - 1) / seconds;
    it.info().annotations.push({
      type: "samples/s",
      description: rate.toFixed(1),
    });
    expect(rate).toBeGreaterThan(FPS * 0.8);
  });

  for (const height of [360, 1080, 2160] as const) {
    it(`stays under its time budget at ${height}p`, async ({ page }) => {
      const { samples, width } = await runCore(page, {
        ms: 3000,
        src: clip(height),
      });
      expect(width).toBe((height * 16) / 9);
      const steady = samples.slice(WARM_UP);
      expect(steady.length).toBeGreaterThan(10);
      const latency = median(steady.map((s) => s.cost.latencyMs));
      const mainThread = mean(steady.map((s) => s.cost.mainMs));
      it.info().annotations.push(
        {
          type: "latency p50",
          description: `${latency.toFixed(1)} ms (budget ${budget.latencyMs(height)})`,
        },
        {
          type: "main thread avg",
          description: `${mainThread.toFixed(2)} ms (budget ${budget.mainThreadMs(height)})`,
        }
      );
      expect(latency).toBeLessThan(budget.latencyMs(height));
      expect(mainThread).toBeLessThan(budget.mainThreadMs(height));
    });
  }

  it("stops reading when stopped", async ({ page }) => {
    const { afterStop, samples } = await runCore(page, {
      ms: 1000,
      src: clip(360),
    });
    expect(samples.length).toBeGreaterThan(5);
    expect(afterStop).toBe(0);
  });

  it("reports a video it is not allowed to read", async ({ page }) => {
    // Same clip, served from another origin and without CORS headers.
    const url = await crossOriginClip(page);
    const { error, samples } = await runCore(page, { ms: 1500, src: url });
    expect(error).toMatch(SECURITY_ERROR);
    expect(samples).toHaveLength(0);
  });
});

/**
 * The same essentials with the read method forced through the page's URL
 * (`?method=`), all four effects on the 1080p clip: the read uses that method
 * (a forced WebGL the browser's Worker cannot do falls back to the canvas, and
 * says so), and the colours, the frame rate and the cost hold.
 */
for (const forced of ["webgl", "canvas"] as const) {
  test.describe(`method ${forced}`, () => {
    const HEIGHT = 1080;
    const query = { method: forced, src: clip(HEIGHT) };

    it("reports the colour of each edge", async ({ page }) => {
      await open(page, query);
      const expected = await expectMethod(page, it.info(), forced);
      // At most one loop of the clip (4 s), until a sample inside the first picture.
      const samples = await pageSamples(page, 6000, {
        untilFirstPicture: true,
      });
      expectFirstPicture(samples);
      // Every one of these samples was read the way asked.
      expect(new Set(samples.map((s) => s.cost.method))).toEqual(
        new Set([expected])
      );
    });

    it("frames are delivered", async ({ page }) => {
      await open(page, query);
      await expectMethod(page, it.info(), forced);
      // A full metrics window (3 s) after the first sample.
      await page.waitForTimeout(3500);
      const found = await metrics(page);
      it.info().annotations.push({
        description: `${found.sampleFps.toFixed(1)} / ${found.videoFps.toFixed(1)} fps, skipped ${found.skipped}`,
        type: "samples / video",
      });
      expect(found.videoFps).toBeGreaterThan(15);
      expect(found.sampleFps).toBeGreaterThanOrEqual(0.9 * found.videoFps);
      expect(found.skipped).toBe(0);
    });

    it(`stays under its time budget at ${HEIGHT}p`, async ({ page }) => {
      await open(page, query);
      const expected = await expectMethod(page, it.info(), forced);
      const samples = await pageSamples(page, 3000);
      const steady = samples.slice(WARM_UP);
      expect(steady.length).toBeGreaterThan(10);
      // The cost measured is the cost of the method asked for.
      expect(new Set(steady.map((s) => s.cost.method))).toEqual(
        new Set([expected])
      );
      const latency = median(steady.map((s) => s.cost.latencyMs));
      const mainThread = mean(steady.map((s) => s.cost.mainMs));
      const { watcherMs } = await metrics(page);
      it.info().annotations.push(
        {
          type: "latency p50",
          description: `${latency.toFixed(1)} ms (budget ${budget.latencyMs(HEIGHT)})`,
        },
        {
          type: "main thread avg",
          description: `${mainThread.toFixed(2)} ms (budget ${budget.mainThreadMs(HEIGHT)})`,
        },
        {
          type: "watcher main thread",
          description: `${watcherMs.toFixed(2)} ms (budget ${budget.watcherMs(HEIGHT)})`,
        }
      );
      expect(latency).toBeLessThan(budget.latencyMs(HEIGHT));
      expect(mainThread).toBeLessThan(budget.mainThreadMs(HEIGHT));
      expect(watcherMs).toBeLessThan(budget.watcherMs(HEIGHT));
    });
  });
}
