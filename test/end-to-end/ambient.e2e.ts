import { expect, type Page, test } from "@playwright/test";
import {
  channels,
  far,
  NEUTRAL,
  open,
  stopAndKeepHost,
  VIDEO,
} from "./helpers.js";

/** The ambient background on the reference page, in both variants (blobs, mosaic). */

/**
 * How far the mosaic leans left to right, read from its canvas pixels: the
 * middle of the left column minus the middle of the right one, for red and blue.
 */
async function mosaicLean(page: Page) {
  const [left = [], right = []] = await Promise.all(
    [0, 7].map((x) =>
      page.evaluate((px) => {
        const canvas = document.querySelector<HTMLCanvasElement>(
          '[data-vl="ambient"] canvas'
        );
        return Array.from(
          canvas?.getContext("2d")?.getImageData(px, 2, 1, 1).data ?? []
        );
      }, x)
    )
  );
  return {
    blue: (left[2] ?? 0) - (right[2] ?? 0),
    red: (left[0] ?? 0) - (right[0] ?? 0),
  };
}

/**
 * How many times the ambient layer's inline style is rewritten while the video's
 * clock goes from `from` to `to` seconds (a quiet stretch of the clip, or the swap).
 */
async function writesBetween(page: Page, from: number, to: number) {
  return await page.evaluate(
    async ({ from: start, selector, to: end }) => {
      const video = document.querySelector<HTMLVideoElement>(selector);
      const layer = document.querySelector('[data-vl="ambient"]');
      if (!(video && layer)) {
        return -1;
      }
      const reached = (seconds: number) =>
        new Promise<void>((resolve) => {
          const check = () =>
            video.currentTime >= seconds
              ? resolve()
              : video.requestVideoFrameCallback(check);
          check();
        });
      await reached(start);
      let writes = 0;
      const observer = new MutationObserver((records) => {
        writes += records.length;
      });
      observer.observe(layer, { attributeFilter: ["style"], attributes: true });
      await reached(end);
      observer.disconnect();
      return writes;
    },
    { from, selector: VIDEO, to }
  );
}

test.describe("ambient", () => {
  test("sets its colours", async ({ page }) => {
    await open(page, { effects: ["ambient"] });
    // Off the neutral start colour: the read has painted.
    await expect
      .poll(async () =>
        far(
          await channels(page, '[data-vl="ambient"]', "--vl-primary"),
          NEUTRAL
        )
      )
      .toBeGreaterThan(40);
    // The mean of the clip's edges: a bit of red, more green, little blue (red,
    // green, yellow and blue strips), unboosted.
    const [mr = 0, mg = 0, mb = 0] = await channels(
      page,
      '[data-vl="ambient"]',
      "--vl-mean"
    );
    expect(Math.abs(mr - 128)).toBeLessThan(40);
    expect(Math.abs(mg - 152)).toBeLessThan(40);
    expect(Math.abs(mb - 43)).toBeLessThan(40);
  });

  // Each write repaints the three blobs: a soft colour does not need the
  // display's frame rate.
  test("blobs change colour at most 30 times a second", async ({ page }) => {
    // Red for 2 s, then blue: the colours move after each change.
    await open(page, { effects: ["ambient"], src: "/shift-360.webm" });
    const gaps = await page.evaluate(async () => {
      const times: number[] = [];
      const layer = document.querySelector('[data-vl="ambient"]');
      if (!layer) {
        return [];
      }
      const observer = new MutationObserver(() =>
        times.push(performance.now())
      );
      observer.observe(layer, { attributeFilter: ["style"] });
      await new Promise((resolve) => setTimeout(resolve, 4500));
      observer.disconnect();
      return times.slice(1).map((time, i) => time - (times[i] ?? 0));
    });
    expect(gaps.length).toBeGreaterThan(3);
    // Never faster than every 33 ms (a little slack for the timers).
    expect(Math.min(...gaps)).toBeGreaterThan(25);
  });

  test("drifts when motion is allowed, and stays still with reduced motion or animate: false", async ({
    page,
  }) => {
    const animations = () =>
      page.evaluate(
        () =>
          document
            .querySelector('[data-vl="ambient"]')
            ?.getAnimations({ subtree: true }).length
      );
    await open(page, { effects: ["ambient"] });
    expect(await animations()).toBeGreaterThan(0);

    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page, { effects: ["ambient"] });
    expect(await animations()).toBe(0);

    // The vanilla option, with motion allowed: the page's ambient is off, so
    // the test gives `ambient` a full-window backdrop of its own.
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await open(page, { effects: [] });
    const still = await page.evaluate((selector) => {
      const { glowApi } = window;
      const video = document.querySelector<HTMLVideoElement>(selector);
      if (!(glowApi && video)) {
        return -1;
      }
      const backdrop = document.createElement("div");
      backdrop.style.cssText = "position:fixed;inset:0;z-index:-1";
      document.body.prepend(backdrop);
      glowApi.ambient(video, backdrop, { animate: false });
      return (
        backdrop
          .querySelector('[data-vl="ambient"]')
          ?.getAnimations({ subtree: true }).length ?? -1
      );
    }, VIDEO);
    expect(still).toBe(0);
  });

  // Timed by the video's own clock from the start: not waiting for the read first.
  test("writes only when the picture changes @perf", async ({ page }) => {
    await open(
      page,
      { effects: ["ambient"], src: "/shift-360.webm" },
      { ready: false }
    );
    // Video time 0.6 s to 1.6 s: the clip is one steady red, so once the colours
    // have settled nothing is written.
    expect(await writesBetween(page, 0.6, 1.6)).toBe(0);
    // The clip goes from red to blue at 2 s: the control that the count can be above 0.
    expect(await writesBetween(page, 1.9, 3)).toBeGreaterThan(0);
  });

  test("layer is added and removed", async ({ page }) => {
    await open(page, { effects: ["ambient"] });
    await expect(page.locator('[data-vl="ambient"]')).toHaveCount(1);
    await stopAndKeepHost(page, "ambient");
  });

  test("the mosaic follows the picture from left to right", async ({
    page,
  }) => {
    await open(page, { effects: ["ambient"], variant: "mosaic" });
    // The clip has a red strip on one side and a blue one on the other, and swaps them every 2 s.
    const clear = (lead: { blue: number; red: number }) =>
      Math.abs(lead.red) >= 80 &&
      Math.abs(lead.blue) >= 60 &&
      Math.sign(lead.red) === -Math.sign(lead.blue);
    let first = 0;
    await expect
      .poll(
        async () => {
          const found = await mosaicLean(page);
          first = clear(found) ? Math.sign(found.red) : 0;
          return first !== 0;
        },
        { message: "the left and right columns differ", timeout: 8000 }
      )
      .toBe(true);
    await expect
      .poll(
        async () => {
          const found = await mosaicLean(page);
          return clear(found) && Math.sign(found.red) === -first;
        },
        { message: "the columns swap with the picture", timeout: 8000 }
      )
      .toBe(true);
  });

  test("the mosaic finishes its fade when the video is paused", async ({
    page,
  }) => {
    await open(page, { effects: ["ambient"], variant: "mosaic" });
    // Settled on the first half of the clip (red on the left, blue on the right), paused.
    await page.evaluate(async (selector) => {
      const video = document.querySelector<HTMLVideoElement>(selector);
      if (!video) {
        return;
      }
      video.pause();
      video.currentTime = 1.9;
      await new Promise((resolve) =>
        video.addEventListener("seeked", resolve, { once: true })
      );
    }, VIDEO);
    await expect
      .poll(async () => (await mosaicLean(page)).red, {
        message: "settled on the first half",
      })
      .toBeGreaterThanOrEqual(80);
    // Play through the swap of the strips (at 2 s), pause on the first frame after it.
    await page.evaluate(async (selector) => {
      const video = document.querySelector<HTMLVideoElement>(selector);
      if (!video) {
        return;
      }
      await video.play();
      await new Promise<void>((resolve) => {
        const check = () => {
          if (video.currentTime >= 2) {
            video.pause();
            resolve();
          } else {
            requestAnimationFrame(check);
          }
        };
        check();
      });
    }, VIDEO);
    // Paused: no sample comes any more, and the colours still have to arrive.
    await expect
      .poll(async () => (await mosaicLean(page)).red, {
        message: "the fade ends on the second half",
        timeout: 3000,
      })
      .toBeLessThanOrEqual(-80);
  });

  test("the mosaic redraws only when the picture changes", async ({ page }) => {
    await page.addInitScript(() => {
      const original = CanvasRenderingContext2D.prototype.putImageData;
      const counted = window as Window & { puts?: number };
      counted.puts = 0;
      CanvasRenderingContext2D.prototype.putImageData = function (
        this: CanvasRenderingContext2D,
        ...args: unknown[]
      ) {
        counted.puts = (counted.puts ?? 0) + 1;
        return Reflect.apply(original, this, args);
      } as typeof original;
    });
    await open(page, {
      effects: ["ambient"],
      src: "/shift-360.webm",
      variant: "mosaic",
    });
    const redraws = await page.evaluate(async (selector) => {
      const video = document.querySelector<HTMLVideoElement>(selector);
      const puts = () => (window as Window & { puts?: number }).puts ?? 0;
      const until = (time: number) =>
        new Promise<void>((resolve) => {
          const check = () => {
            if ((video?.currentTime ?? 0) >= time) {
              resolve();
            } else {
              requestAnimationFrame(check);
            }
          };
          check();
        });
      // The clip is one steady red from 0.6 s to 1.6 s: settled well before 1 s.
      await until(1);
      const first = puts();
      await until(1.5);
      const steady = puts() - first;
      // It goes from red to blue at 2 s: the control that the count can be above 0.
      await until(1.9);
      const second = puts();
      await until(3);
      return { changing: puts() - second, steady };
    }, VIDEO);
    expect(redraws.steady).toBe(0);
    expect(redraws.changing).toBeGreaterThan(0);
  });

  test("switching the variant leaves one ambient layer", async ({ page }) => {
    await open(page, { effects: ["ambient"] });
    const layers = page.locator('[data-vl="ambient"]');
    await expect(layers).toHaveCount(1);
    await expect(layers.locator("canvas")).toHaveCount(0);
    await page.selectOption('[data-testid="variant-select"]', "mosaic");
    await expect(layers).toHaveCount(1);
    await expect(layers.locator("canvas")).toHaveCount(1);
    await page.selectOption('[data-testid="variant-select"]', "blobs");
    await expect(layers).toHaveCount(1);
    await expect(layers.locator("canvas")).toHaveCount(0);
  });
});
