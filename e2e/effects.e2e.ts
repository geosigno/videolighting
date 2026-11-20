import { expect, test as it, type Page, test } from "@playwright/test";
import { contrast } from "../src/core/colors.js";
import { budget, type Height } from "./budgets.js";
import {
  ALL,
  crashes,
  crossOriginClip,
  type EffectName,
  errors,
  metrics,
  open as openPage,
  SECURITY_ERROR,
  VIDEO,
} from "./page-helpers.js";

/**
 * The effects on the reference page, all on one video: each effect's own
 * behaviour, then the effects together, joining and failing, and the edges of
 * the contract. The page's components drive the effects; tests that start and
 * stop effects by hand use the vanilla API the page hands over (`glowApi`).
 */

/** The page with these effects (default: halo only) on this clip (default: the 360p one). */
async function open(
  page: Page,
  options: {
    effects?: EffectName[];
    ready?: boolean;
    src?: string;
    variant?: "blobs" | "mosaic";
  } = {}
) {
  const {
    effects = ["halo"],
    ready = true,
    src = "/quad-360.webm",
    variant,
  } = options;
  await openPage(page, { effects, src, variant }, { ready });
}

/**
 * How far the mosaic leans left to right, read from its canvas pixels: the
 * middle of the left column minus the middle of the right one, for red and blue.
 */
async function mosaicLean(page: Page) {
  const [left = [], right = []] = await Promise.all(
    [0, 7].map((x) =>
      page.evaluate((px) => {
        const canvas = document.querySelector<HTMLCanvasElement>(
          '[data-glow="ambient"] canvas'
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

const FRAME = '[data-testid="frame"]';
const CONTAINER = '[data-testid="container"]';
/** The element inside the card that wears the theme (the Theme component's own). */
const THEME_HOST = '[data-testid="theme-card"] > *';

/** The neutral colour every read starts from. */
const NEUTRAL = [24, 24, 30];
const far = (a: number[], b: number[]) =>
  Math.hypot(...b.map((v, i) => (a[i] ?? 0) - v));

/**
 * How many times the ambient layer's inline style is rewritten while the video's
 * clock goes from `from` to `to` seconds (a quiet stretch of the clip, or the swap).
 */
async function writesBetween(page: Page, from: number, to: number) {
  return await page.evaluate(
    async ({ from: start, selector, to: end }) => {
      const video = document.querySelector<HTMLVideoElement>(selector);
      const layer = document.querySelector('[data-glow="ambient"]');
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

/** Red, green, blue of every colour stop of an element's background gradient. */
async function stops(page: Page, selector: string, nth: number) {
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

/**
 * Turns `name` off through the page and checks the effect cleaned up the
 * element it ran on: the component's element goes with it, so it is kept
 * aside first and looked at once detached (a layer left in it = no cleanup).
 */
async function stopAndKeepHost(page: Page, name: EffectName) {
  await page.evaluate((effect) => {
    const target = window as Window & { kept?: Element };
    target.kept =
      document.querySelector(`[data-glow="${effect}"]`)?.parentElement ??
      undefined;
    target.glowPage?.setEffect(effect, false);
  }, name);
  await expect(page.locator(`[data-glow="${name}"]`)).toHaveCount(0);
  // The effect's cleanup runs once React has let go of the element.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const { kept } = window as unknown as { kept?: Element };
        return {
          detached: kept ? !kept.isConnected : false,
          layers: kept ? kept.querySelectorAll("[data-glow]").length : -1,
        };
      })
    )
    .toEqual({ detached: true, layers: 0 });
}

test.describe("halo", () => {
  it("shows the edge colour unchanged", async ({ page }) => {
    await open(page);
    // Bands are top, right, bottom, left: the left one runs down the red strip.
    await expect
      .poll(
        async () => (await stops(page, '[data-glow="halo"] > div', 3)).length
      )
      .toBeGreaterThan(6);
    const left = await stops(page, '[data-glow="halo"] > div', 3);
    const [r = 0, g = 0, b = 0] = left[Math.floor(left.length / 2)] ?? [];
    expect(r).toBeGreaterThan(200);
    expect(g).toBeLessThan(80);
    expect(b).toBeLessThan(80);
  });

  it("layer is added and removed", async ({ page }) => {
    await open(page);
    await expect(page.locator('[data-glow="halo"]')).toHaveCount(1);
    await stopAndKeepHost(page, "halo");
  });

  it("frames are delivered", async ({ page }) => {
    await open(page);
    // A full metrics window (3 s) after the first sample.
    await page.waitForTimeout(3500);
    const found = await metrics(page);
    expect(found.videoFps).toBeGreaterThan(15);
    expect(found.sampleFps).toBeGreaterThanOrEqual(0.9 * found.videoFps);
    expect(found.skipped).toBe(0);
  });
});

/** Channels of a CSS variable's `rgb(...)` value on the first element matching `selector`. */
async function channels(page: Page, selector: string, name: string) {
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

test.describe("ambient", () => {
  it("sets its colours", async ({ page }) => {
    await open(page, { effects: ["ambient"] });
    // Off the neutral start colour: the read has painted.
    await expect
      .poll(async () =>
        far(
          await channels(page, '[data-glow="ambient"]', "--glow-primary"),
          NEUTRAL
        )
      )
      .toBeGreaterThan(40);
    // The mean of the clip's edges: a bit of red, more green, little blue (red,
    // green, yellow and blue strips), unboosted.
    const [mr = 0, mg = 0, mb = 0] = await channels(
      page,
      '[data-glow="ambient"]',
      "--glow-mean"
    );
    expect(Math.abs(mr - 128)).toBeLessThan(40);
    expect(Math.abs(mg - 152)).toBeLessThan(40);
    expect(Math.abs(mb - 43)).toBeLessThan(40);
  });

  it("stays still with reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page, { effects: ["ambient"] });
    const animations = await page.evaluate(
      () =>
        document
          .querySelector('[data-glow="ambient"]')
          ?.getAnimations({ subtree: true }).length
    );
    expect(animations).toBe(0);
  });

  it("drifts when motion is allowed", async ({ page }) => {
    await open(page, { effects: ["ambient"] });
    const animations = await page.evaluate(
      () =>
        document
          .querySelector('[data-glow="ambient"]')
          ?.getAnimations({ subtree: true }).length
    );
    expect(animations).toBeGreaterThan(0);
  });

  // Timed by the video's own clock from the start: not waiting for the read first.
  it("does not write unchanged values", async ({ page }) => {
    await open(page, {
      effects: ["ambient"],
      ready: false,
      src: "/shift-360.webm",
    });
    // Video time 0.6 s to 1.6 s: the clip is one steady red, so once the colours
    // have settled nothing is written.
    expect(await writesBetween(page, 0.6, 1.6)).toBe(0);
  });

  it("writes when the picture changes", async ({ page }) => {
    await open(page, {
      effects: ["ambient"],
      ready: false,
      src: "/shift-360.webm",
    });
    // The clip goes from red to blue at 2 s: the control that the count can be above 0.
    expect(await writesBetween(page, 1.9, 3)).toBeGreaterThan(0);
  });

  it("layer is removed on stop", async ({ page }) => {
    await open(page, { effects: ["ambient"] });
    await expect(page.locator('[data-glow="ambient"]')).toHaveCount(1);
    await stopAndKeepHost(page, "ambient");
  });

  it("the mosaic follows the picture from left to right", async ({ page }) => {
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

  it("the mosaic finishes its fade when the video is paused", async ({
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

  it("the mosaic does not redraw a picture that does not change", async ({
    page,
  }) => {
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
    // The clip is one steady red from 0.6 s to 1.6 s: settled well before 1 s.
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
      await until(1);
      const before = puts();
      await until(1.5);
      return puts() - before;
    }, VIDEO);
    expect(redraws).toBe(0);
  });

  it("switching the variant leaves one ambient layer", async ({ page }) => {
    await open(page, { effects: ["ambient"] });
    const layers = page.locator('[data-glow="ambient"]');
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

test.describe("theme", () => {
  it("keeps white text readable", async ({ page }) => {
    await open(page, { effects: ["theme"] });
    const both = () =>
      Promise.all(
        ["--video-primary", "--video-secondary"].map((name) =>
          channels(page, THEME_HOST, name)
        )
      );
    // Both set, off black.
    await expect
      .poll(async () =>
        (await both()).every(
          (c) => c.length === 3 && (c[0] ?? 0) + (c[1] ?? 0) + (c[2] ?? 0) > 0
        )
      )
      .toBe(true);
    for (const [r = 0, g = 0, b = 0] of await both()) {
      expect(r + g + b).toBeGreaterThan(0);
      expect(contrast([r, g, b], [255, 255, 255])).toBeGreaterThanOrEqual(4.4);
    }
  });

  // The page has no `minContrast` input: the vanilla `theme` runs with it on
  // the card's element, next to the page's ambient.
  it("keeps the video colour when there is no limit", async ({ page }) => {
    await open(page, { effects: ["ambient"] });
    await page.evaluate(
      ([video, host]) => {
        const { glowApi } = window;
        const element = document.querySelector<HTMLVideoElement>(video);
        const card = document.querySelector<HTMLElement>(host);
        if (element && card) {
          glowApi?.theme(element, card, { minContrast: 1 });
        }
      },
      [VIDEO, THEME_HOST] as const
    );
    const read = async () => ({
      shown: await channels(page, '[data-glow="ambient"]', "--glow-primary"),
      themed: await channels(page, THEME_HOST, "--video-primary"),
    });
    await expect.poll(async () => (await read()).themed).toHaveLength(3);
    await expect
      .poll(async () => {
        const { shown, themed } = await read();
        return themed.join() === shown.join();
      })
      .toBe(true);
  });

  it("removes its variables on stop", async ({ page }) => {
    await open(page, { effects: ["theme"] });
    await expect
      .poll(() => channels(page, THEME_HOST, "--video-primary"))
      .toHaveLength(3);
    // The Theme's own element: kept aside, since turning it off replaces it.
    await page.evaluate((host) => {
      const target = window as Window & { kept?: Element };
      target.kept = document.querySelector(host) ?? undefined;
      target.glowPage?.setEffect("theme", false);
    }, THEME_HOST);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const { kept } = window as unknown as { kept?: HTMLElement };
          return [
            kept?.isConnected ?? true,
            kept?.style.getPropertyValue("--video-primary") ?? "?",
            kept?.style.getPropertyValue("--video-secondary") ?? "?",
          ];
        })
      )
      .toEqual([false, "", ""]);
    expect(await channels(page, THEME_HOST, "--video-primary")).toEqual([]);
  });
});

/** Size the page's resizable container, as a user dragging its corner would. */
async function resizeContainer(page: Page, width: number, height: number) {
  await page.evaluate(
    ({ height: h, selector, width: w }) => {
      const container = document.querySelector<HTMLElement>(selector);
      if (container) {
        container.style.width = `${w}px`;
        container.style.height = `${h}px`;
      }
    },
    { height, selector: CONTAINER, width }
  );
}

/** The visible bands of the letterbox layer, with their size and first-to-last colours. */
async function bands(page: Page) {
  return await page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLElement>(
        '[data-glow="letterbox"] > [data-side]'
      ),
    ]
      .filter((band) => getComputedStyle(band).display !== "none")
      .map((band) => {
        const box = band.getBoundingClientRect();
        const colours = [
          ...band.style.backgroundImage.matchAll(
            /rgb\((?<r>\d+)[, ]+(?<g>\d+)[, ]+(?<b>\d+)\)/gu
          ),
        ].map((m) => [
          Number(m.groups?.r),
          Number(m.groups?.g),
          Number(m.groups?.b),
        ]);
        return {
          height: box.height,
          middle: colours[Math.floor(colours.length / 2)] ?? [],
          side: band.dataset.side,
          width: box.width,
        };
      })
  );
}

/** The sides of the visible bands, once they are painted (sorted). */
const bandSides = async (page: Page) =>
  (await bands(page))
    .filter((band) => band.middle.length === 3)
    .map((band) => band.side)
    .sort();

test.describe("letterbox", () => {
  it("fills the sides of a container wider than the video", async ({
    page,
  }) => {
    await open(page, { effects: ["letterbox"] });
    await resizeContainer(page, 600, 300);
    await expect.poll(() => bandSides(page)).toEqual(["left", "right"]);
    const found = await bands(page);
    // 640x360 in 600x300: the video is 533 px wide, so two bars of about 33 px.
    expect(found.map((band) => band.side).sort()).toEqual(["left", "right"]);
    for (const band of found) {
      expect(Math.abs(band.width - 33.3)).toBeLessThan(2);
      expect(band.height).toBeGreaterThan(290);
    }
    const left = found.find((band) => band.side === "left")?.middle ?? [];
    const right = found.find((band) => band.side === "right")?.middle ?? [];
    expect(left[0]).toBeGreaterThan(200); // red strip
    expect(left[2]).toBeLessThan(80);
    expect(right[2]).toBeGreaterThan(200); // blue strip
    expect(right[0]).toBeLessThan(80);
  });

  it("follows a resize", async ({ page }) => {
    await open(page, { effects: ["letterbox"] });
    await resizeContainer(page, 600, 300);
    await expect.poll(() => bandSides(page)).toEqual(["left", "right"]);
    await resizeContainer(page, 300, 600);
    await expect.poll(() => bandSides(page)).toEqual(["bottom", "top"]);
    const found = await bands(page);
    expect(found.map((band) => band.side).sort()).toEqual(["bottom", "top"]);
    const top = found.find((band) => band.side === "top")?.middle ?? [];
    const bottom = found.find((band) => band.side === "bottom")?.middle ?? [];
    expect(top[1]).toBeGreaterThan(150); // green strip
    expect(top[0]).toBeLessThan(80);
    expect(bottom[0]).toBeGreaterThan(200); // yellow strip
    expect(bottom[1]).toBeGreaterThan(200);
    expect(bottom[2]).toBeLessThan(80);
  });

  it("shows no band when the video fills the container", async ({ page }) => {
    await open(page, { effects: ["letterbox"] });
    await expect(page.locator('[data-glow="letterbox"]')).toHaveCount(1);
    // Bands first (the layer is live), then a box of the video's own shape.
    await resizeContainer(page, 600, 300);
    await expect.poll(() => bandSides(page)).toEqual(["left", "right"]);
    await resizeContainer(page, 480, 270);
    await expect.poll(() => bands(page)).toEqual([]);
  });

  it("layer is removed on stop", async ({ page }) => {
    await open(page, { effects: ["letterbox"] });
    await expect(page.locator('[data-glow="letterbox"]')).toHaveCount(1);
    await stopAndKeepHost(page, "letterbox");
  });
});

/** In-page: the number of samples of the page video's read (-1: no read). */
const samplesOf = (page: Page) =>
  page.evaluate((selector) => {
    const { glowApi } = window;
    const video = document.querySelector<HTMLVideoElement>(selector);
    return video ? (glowApi?.inspect(video)?.stats().samples ?? -1) : -1;
  }, VIDEO);

test.describe("all effects together", () => {
  it("share one read", async ({ page }) => {
    await open(page, { effects: ALL });
    // A full metrics window (3 s) after the first sample.
    await page.waitForTimeout(3500);
    const found = await metrics(page);
    expect(found.references).toBe(4);
    expect(found.ratio).toBeLessThanOrEqual(1.05);
    expect(found.ratio).toBeGreaterThan(0.8);
  });

  it("deliver the frames with every effect on", async ({ page }) => {
    await open(page, { effects: ALL });
    // A full metrics window (3 s) after the first sample.
    await page.waitForTimeout(3500);
    const found = await metrics(page);
    expect(found.videoFps).toBeGreaterThan(15);
    expect(found.sampleFps).toBeGreaterThanOrEqual(0.9 * found.videoFps);
    expect(found.skipped).toBe(0);
  });

  it("jump to the colours of a new video instead of fading from the old one", async ({
    page,
  }) => {
    await open(page, { effects: ["ambient"], src: "/shift-360.webm" });
    // Settled on the clip's steady red (0.6 s to 1.6 s, as the writes tests
    // use it) before the swap: past the first frames, off the neutral start.
    await expect
      .poll(() =>
        page.evaluate(
          (selector) =>
            document.querySelector<HTMLVideoElement>(selector)?.currentTime ??
            0,
          VIDEO
        )
      )
      .toBeGreaterThanOrEqual(0.6);
    expect(
      far(await channels(page, '[data-glow="ambient"]', "--glow-mean"), NEUTRAL)
    ).toBeGreaterThan(40);
    const intermediates = await page.evaluate(async (selector) => {
      const video = document.querySelector<HTMLVideoElement>(selector);
      const layer = document.querySelector<HTMLElement>(
        '[data-glow="ambient"]'
      );
      if (!(video && layer)) {
        return -1;
      }
      const mean = () =>
        (layer.style.getPropertyValue("--glow-mean").match(/\d+/gu) ?? []).map(
          Number
        );
      const before = mean();
      // The quad clip's edges average to about (128, 152, 43): far from shift's red.
      video.src = "/quad-360.webm";
      video.play().catch(() => undefined);
      const target = [128, 152, 43];
      const dist = (a: number[], b: number[]) =>
        Math.hypot(...a.map((v, i) => v - (b[i] ?? 0)));
      let between = 0;
      const end = performance.now() + 2500;
      while (performance.now() < end) {
        // biome-ignore lint/performance/noAwaitInLoops: one display frame at a time
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const now = mean();
        if (dist(now, before) > 45 && dist(now, target) > 45) {
          between += 1;
        }
      }
      return between;
    }, VIDEO);
    expect(intermediates).toBe(0);
  });

  it("stopping twice is harmless", async ({ page }) => {
    await open(page, { effects: [] });
    const result = await page.evaluate(
      ([selector, frameSelector, containerSelector]) => {
        const { glowApi } = window;
        const video = document.querySelector<HTMLVideoElement>(selector);
        const frame = document.querySelector<HTMLElement>(frameSelector);
        const other = document.querySelector<HTMLElement>(containerSelector);
        if (!(glowApi && video && frame && other)) {
          return "missing";
        }
        glowApi.letterbox(video, other); // still running afterwards
        const stop = glowApi.halo(video, frame);
        stop();
        stop();
        return "ok";
      },
      [VIDEO, FRAME, CONTAINER] as const
    );
    expect(result).toBe("ok");
    // One effect left: a second stop() must not have released it too.
    await expect.poll(async () => (await metrics(page)).references).toBe(1);
  });

  it("a quick remount reuses the read", async ({ page }) => {
    await open(page, { effects: [] });
    await page.evaluate(
      ([selector, frameSelector]) => {
        const { glowApi } = window;
        const video = document.querySelector<HTMLVideoElement>(selector);
        const frame = document.querySelector<HTMLElement>(frameSelector);
        if (glowApi && video && frame) {
          (window as unknown as { first: () => void }).first = glowApi.halo(
            video,
            frame
          );
        }
      },
      [VIDEO, FRAME] as const
    );
    await expect.poll(() => samplesOf(page)).toBeGreaterThan(20);
    const result = await page.evaluate(
      ([selector, frameSelector]) => {
        const { glowApi } = window;
        const video = document.querySelector<HTMLVideoElement>(selector);
        const frame = document.querySelector<HTMLElement>(frameSelector);
        if (!(glowApi && video && frame)) {
          return { after: -1, before: -1, references: -1 };
        }
        const before = glowApi.inspect(video)?.stats().samples ?? -1;
        (window as unknown as { first: () => void }).first();
        glowApi.halo(video, frame); // remounted in the same tick, like StrictMode
        const after = glowApi.inspect(video)?.stats().samples ?? -1;
        const references = glowApi.inspect(video)?.stats().references ?? -1;
        return { after, before, references };
      },
      [VIDEO, FRAME] as const
    );
    expect(result.before).toBeGreaterThan(20);
    expect(result.after).toBeGreaterThanOrEqual(result.before);
    expect(result.references).toBe(1);
  });

  it("restore the host when stopped in either order", async ({ page }) => {
    await open(page, { effects: [] });
    const results = await page.evaluate((selector) => {
      const { glowApi } = window;
      const video = document.querySelector<HTMLVideoElement>(selector);
      if (!(glowApi && video)) {
        return [];
      }
      // A plain, statically positioned host: the effects have to change it and give it back.
      const host = document.createElement("div");
      document.body.append(host);
      const read = () => `${host.style.position}|${host.style.isolation}`;
      const out: string[][] = [];
      for (const first of ["halo", "letterbox"] as const) {
        const states = [read()];
        const running = {
          halo: glowApi.halo(video, host),
          letterbox: glowApi.letterbox(video, host),
        };
        states.push(read());
        running[first]();
        states.push(read());
        running[first === "halo" ? "letterbox" : "halo"]();
        states.push(read());
        out.push(states);
      }
      return out;
    }, VIDEO);
    // before, both on, one left, both stopped: in each order.
    const expected = ["|", "relative|isolate", "relative|isolate", "|"];
    expect(results).toEqual([expected, expected]);
  });

  it("stop sampling once every effect is stopped", async ({ page }) => {
    await open(page, { effects: ALL });
    await expect.poll(async () => (await metrics(page)).references).toBe(4);
    // Every effect off at once; the read must be gone within 400 ms.
    const goneMs = await page.evaluate(async (selector) => {
      const { glowApi, glowPage } = window;
      const video = document.querySelector<HTMLVideoElement>(selector);
      if (!(glowApi && glowPage && video)) {
        return -1;
      }
      for (const name of ["halo", "ambient", "theme", "letterbox"] as const) {
        glowPage.setEffect(name, false);
      }
      const started = performance.now();
      while (glowApi.inspect(video) && performance.now() - started < 2000) {
        // biome-ignore lint/performance/noAwaitInLoops: polling the read
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      return glowApi.inspect(video) ? -1 : performance.now() - started;
    }, VIDEO);
    expect(goneMs).toBeGreaterThanOrEqual(0);
    expect(goneMs).toBeLessThan(400);
    await expect.poll(async () => (await metrics(page)).references).toBe(0);
  });

  it("report a video the browser will not let them read", async ({ page }) => {
    const url = await crossOriginClip(page);
    const crashed = crashes(page);
    await open(page, { effects: ALL, ready: false, src: url });
    // One callback per effect, four effects: each one is told.
    await expect.poll(async () => (await errors(page)).length).toBe(4);
    // And no more: a late second report would land within this window.
    await page.waitForTimeout(1500);
    const found = await errors(page);
    expect(found).toHaveLength(4);
    expect(found[0]).toMatch(SECURITY_ERROR);
    expect(crashed).toEqual([]);
  });

  for (const height of [360, 1080, 2160] as const satisfies readonly Height[]) {
    it(`stay under their time budget at ${height}p`, async ({ page }) => {
      await open(page, { effects: ALL, src: `/quad-${height}.webm` });
      // A full metrics window (3 s) after the first sample.
      await page.waitForTimeout(3500);
      const found = await metrics(page);
      it.info().annotations.push(
        {
          description: `${found.latencyP50.toFixed(1)} ms (budget ${budget.latencyMs(height)})`,
          type: "latency p50",
        },
        {
          description: `${found.watcherMs.toFixed(2)} ms (budget ${budget.watcherMs(height)})`,
          type: "watcher main thread",
        }
      );
      expect(found.sampleFps).toBeGreaterThan(0);
      expect(found.latencyP50).toBeLessThan(budget.latencyMs(height));
      expect(found.watcherMs).toBeLessThan(budget.watcherMs(height));
    });
  }
});

test.describe("joining and failing", () => {
  // The page's ambient is off, so the test gives the vanilla `ambient` a
  // full-window backdrop of its own, as the old page had.
  it("a late effect on a paused video paints at once", async ({ page }) => {
    await open(page, { effects: [] });
    const out = await page.evaluate(
      async ([selector, frameSelector]) => {
        const { glowApi } = window;
        const video = document.querySelector<HTMLVideoElement>(selector);
        const frame = document.querySelector<HTMLElement>(frameSelector);
        if (!(glowApi && video && frame)) {
          return { band: "missing", primary: "missing" };
        }
        const backdrop = document.createElement("div");
        backdrop.style.cssText = "position:fixed;inset:0;z-index:-1";
        document.body.prepend(backdrop);
        const wait = (ms: number) =>
          new Promise((resolve) => setTimeout(resolve, ms));
        glowApi.halo(video, frame); // a read exists, nobody smooths yet
        // Some frames read before the pause.
        while ((glowApi.inspect(video)?.stats().samples ?? 0) < 5) {
          // biome-ignore lint/performance/noAwaitInLoops: polling the read
          await wait(20);
        }
        video.pause();
        await wait(300);
        glowApi.ambient(video, backdrop); // joins a paused video: no frame will come
        const second = document.createElement("div");
        document.body.append(second);
        glowApi.halo(video, second);
        await wait(200);
        const layer = backdrop.querySelector<HTMLElement>(
          '[data-glow="ambient"]'
        );
        const band = second.querySelector<HTMLElement>(
          '[data-glow="halo"] > div:nth-child(4)'
        );
        return {
          band: band?.style.backgroundImage ?? "",
          primary: layer?.style.getPropertyValue("--glow-primary") ?? "",
        };
      },
      [VIDEO, FRAME] as const
    );
    expect(out.primary.startsWith("rgb(")).toBe(true);
    expect(out.primary).not.toBe("rgb(24 24 30)");
    expect(out.band).toContain("linear-gradient");
  });

  it("each effect hears about a failed read", async ({ page }) => {
    const url = await crossOriginClip(page);
    await open(page, { effects: ALL, ready: false, src: url });
    // Four effects, four callbacks: every effect's onError is called, not only the first one's.
    await expect.poll(async () => (await errors(page)).length).toBe(4);
    // And no more: a late second report would land within this window.
    await page.waitForTimeout(1500);
    const reported = await errors(page);
    expect(reported).toHaveLength(4);
    for (const error of reported) {
      expect(error).toMatch(SECURITY_ERROR);
    }
    // An effect that joins after the failure is told too, once.
    await page.evaluate(
      ([selector, frameSelector]) => {
        const target = window as Window & {
          heard?: string[];
        };
        const video = document.querySelector<HTMLVideoElement>(selector);
        const frame = document.querySelector<HTMLElement>(frameSelector);
        const heard: string[] = [];
        target.heard = heard;
        if (video && frame) {
          target.glowApi?.halo(video, frame, {
            onError: (e) => heard.push(String(e)),
          });
        }
      },
      [VIDEO, FRAME] as const
    );
    const heard = () =>
      page.evaluate(
        () => (window as unknown as { heard?: string[] }).heard?.length
      );
    await expect.poll(heard).toBe(1);
    // A second report would come within a microtask or two.
    await page.waitForTimeout(300);
    expect(await heard()).toBe(1);
  });

  it("recovers when the source is replaced by a readable video", async ({
    page,
  }) => {
    const url = await crossOriginClip(page);
    await open(page, { ready: false, src: url });
    await expect
      .poll(async () => (await errors(page)).length)
      .toBeGreaterThan(0);
    await page.evaluate((selector) => {
      const video = document.querySelector<HTMLVideoElement>(selector);
      if (video) {
        video.src = "/quad-360.webm";
        video.play().catch(() => undefined);
      }
    }, VIDEO);
    await expect
      .poll(async () => (await metrics(page)).sampleFps)
      .toBeGreaterThan(10);
  });

  it("a listener that throws does not stop the read", async ({ page }) => {
    const crashed = crashes(page);
    await open(page);
    const before = await samplesOf(page);
    await page.evaluate((selector) => {
      const { glowApi } = window;
      const video = document.querySelector<HTMLVideoElement>(selector);
      if (glowApi && video) {
        glowApi.watch(video).onSample(() => {
          throw new Error("boom");
        });
      }
    }, VIDEO);
    // 2.5 s of a 25 fps clip read on, past the throwing listener.
    await expect
      .poll(async () => (await samplesOf(page)) - before, { timeout: 10_000 })
      .toBeGreaterThanOrEqual(60);
    const found = await metrics(page);
    expect(found.sampleFps).toBeGreaterThan(15);
    expect(crashed.some((message) => message.includes("boom"))).toBe(true);
    expect(await errors(page)).toEqual([]);
  });

  // Timed by the video's own clock from the start: not waiting for the read first.
  it("is quiet while a still picture stays still", async ({ page }) => {
    await open(page, { effects: [], ready: false, src: "/shift-360.webm" });
    const quiet = await page.evaluate(async (selector) => {
      const { glowApi } = window;
      const video = document.querySelector<HTMLVideoElement>(selector);
      if (!(glowApi && video)) {
        return { calls: -1, frames: -1, same: false };
      }
      let frames = 0;
      const nativeFrame = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (callback) => {
        frames += 1;
        return nativeFrame(callback);
      };
      let calls = 0;
      const handle = glowApi.watch(video);
      handle.subscribe(() => {
        calls += 1;
      });
      const reached = (seconds: number) =>
        new Promise<void>((resolve) => {
          const check = () =>
            video.currentTime >= seconds
              ? resolve()
              : video.requestVideoFrameCallback(check);
          check();
        });
      await reached(0.8);
      const before = { calls, frames, state: handle.state() };
      await reached(1.8);
      // The clip is one steady red here: nothing should be published or scheduled.
      return {
        calls: calls - before.calls,
        frames: frames - before.frames,
        same: handle.state() === before.state,
      };
    }, VIDEO);
    expect(quiet.calls).toBe(0);
    expect(quiet.same).toBe(true);
    expect(quiet.frames).toBe(0);
  });
});

test.describe("edges of the contract", () => {
  it("says so when an effect is given no video", async ({ page }) => {
    await open(page, { effects: [] });
    const message = await page.evaluate((frameSelector) => {
      const { glowApi } = window;
      const host = document.querySelector<HTMLElement>(frameSelector);
      if (!(glowApi && host)) {
        return "missing";
      }
      try {
        glowApi.halo(document.createElement("div"), host);
        return "no error";
      } catch (error) {
        return String(error);
      }
    }, FRAME);
    expect(message).toContain("glow: no <video> found");
  });

  it("letterbox survives a container with no size", async ({ page }) => {
    const crashed = crashes(page);
    await open(page, { effects: ["letterbox"] });
    // Bands first: the layer is live and follows the box.
    await resizeContainer(page, 600, 300);
    await expect.poll(() => bandSides(page)).toEqual(["left", "right"]);
    // The page keeps its box at least 120x80: lift that to really reach no size.
    await page.evaluate((selector) => {
      const container = document.querySelector<HTMLElement>(selector);
      if (container) {
        container.style.minWidth = "0";
        container.style.minHeight = "0";
      }
    }, CONTAINER);
    await resizeContainer(page, 0, 0);
    await expect.poll(() => bands(page)).toEqual([]);
    const style = await page.evaluate(
      () => document.querySelector('[data-glow="letterbox"]')?.innerHTML ?? ""
    );
    expect(style).not.toContain("NaN");
    expect(crashed).toEqual([]);
  });

  it("ambient stays still when asked to", async ({ page }) => {
    await open(page, { effects: [] });
    const animations = await page.evaluate((selector) => {
      const { glowApi } = window;
      const video = document.querySelector<HTMLVideoElement>(selector);
      if (!(glowApi && video)) {
        return -1;
      }
      // A full-window backdrop of the test's own: the page's ambient is off.
      const backdrop = document.createElement("div");
      backdrop.style.cssText = "position:fixed;inset:0;z-index:-1";
      document.body.prepend(backdrop);
      glowApi.ambient(video, backdrop, { animate: false });
      return (
        backdrop
          .querySelector('[data-glow="ambient"]')
          ?.getAnimations({ subtree: true }).length ?? -1
      );
    }, VIDEO);
    expect(animations).toBe(0);
  });

  // On a video of the test's own: removing the page's `<video>` from under
  // React would break the page rather than test the effect.
  it("stopping after the video left the page is harmless", async ({ page }) => {
    const crashed = crashes(page);
    await open(page, { effects: [] });
    const result = await page.evaluate(async (frameSelector) => {
      const { glowApi } = window;
      const frame = document.querySelector<HTMLElement>(frameSelector);
      if (!(glowApi && frame)) {
        return "missing";
      }
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.src = "/quad-360.webm";
      document.body.append(video);
      await video.play();
      const stop = glowApi.halo(video, frame);
      video.remove();
      stop();
      return "ok";
    }, FRAME);
    expect(result).toBe("ok");
    expect(crashed).toEqual([]);
  });

  it("keeps its last colours when the video is out of view", async ({
    page,
  }) => {
    const crashed = crashes(page);
    await open(page, { effects: ["ambient"] });
    const primary = () =>
      channels(page, '[data-glow="ambient"]', "--glow-primary");
    await expect
      .poll(async () => far(await primary(), NEUTRAL))
      .toBeGreaterThan(40);
    await page.evaluate((selector) => {
      const frame = document.querySelector<HTMLElement>(selector);
      if (frame) {
        frame.style.marginTop = "4000px";
      }
    }, FRAME);
    // Out of view for a while: whatever the read does then, the colours stay.
    await page.waitForTimeout(800);
    const kept = await primary();
    expect(kept).toHaveLength(3);
    expect(far(kept, NEUTRAL)).toBeGreaterThan(40);
    expect(crashed).toEqual([]);
  });
});
