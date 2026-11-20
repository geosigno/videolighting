import { expect, test as it, type Page, test } from "@playwright/test";
import {
  crossOriginClip,
  method,
  metrics,
  open,
  VIDEO,
  webglOr,
} from "./page-helpers.js";

/**
 * Smoke tests of the reference page: the four React components on one video,
 * the URL as input, `window.glowPage` as output.
 */

test("the page mounts every effect on one video", async ({ page }) => {
  // StrictMode off: the same count, so its double mount leaks no handle.
  await open(page, "?strict=0");
  await expect.poll(async () => (await metrics(page)).references).toBe(4);
  await open(page);
  await expect.poll(async () => (await metrics(page)).references).toBe(4);
  await expect(page.locator("video")).toHaveCount(1);
  // Halo, ambient and letterbox draw a layer; theme writes variables only.
  for (const name of ["halo", "ambient", "letterbox"]) {
    // biome-ignore lint/performance/noAwaitInLoops: one locator at a time, clearer failures
    await expect(page.locator(`[data-glow="${name}"]`)).toHaveCount(1);
  }
  await expect(page.locator("[data-glow]")).toHaveCount(3);
  await expect
    .poll(() =>
      page
        .getByTestId("theme-card")
        .evaluate((card) =>
          getComputedStyle(card.firstElementChild ?? card).getPropertyValue(
            "--video-primary"
          )
        )
    )
    .not.toBe("");
  const errors = await page.evaluate(() => window.glowPage?.errors());
  expect(errors).toEqual([]);
});

test("the method control forces the read", async ({ browserName, page }) => {
  await open(page, "?method=canvas");
  await expect.poll(() => method(page)).toBe("canvas");
  await open(page, "?method=webgl");
  await expect
    .poll(async () => webglOr(browserName).includes(await method(page)))
    .toBe(true);
});

test("changing the method on a live video restarts the read on the same video", async ({
  browserName,
  page,
}) => {
  await open(page);
  await page.evaluate(() => {
    (window as unknown as { first: unknown }).first =
      document.querySelector("video");
  });
  await page.getByTestId("method-select").selectOption("webgl");
  await expect
    .poll(async () => webglOr(browserName).includes(await method(page)))
    .toBe(true);
  await page.getByTestId("method-select").selectOption("canvas");
  await expect.poll(() => method(page)).toBe("canvas");
  expect(page.url()).toContain("method=canvas");
  const video = await page.evaluate(async () => {
    const element = document.querySelector("video");
    const start = element?.currentTime ?? 0;
    await new Promise((resolve) => setTimeout(resolve, 300));
    return {
      advanced: (element?.currentTime ?? 0) !== start,
      same: element === (window as unknown as { first: unknown }).first,
    };
  });
  expect(video).toEqual({ advanced: true, same: true });
  // The read keeps delivering samples after the restart.
  await expect
    .poll(async () => (await metrics(page)).sampleFps)
    .toBeGreaterThan(0);
  await expect.poll(async () => (await metrics(page)).references).toBe(4);
});

test("the metrics panel does not change what it measures", async ({ page }) => {
  const runs: Record<string, number>[] = [];
  for (const panel of ["0", "1"]) {
    // biome-ignore lint/performance/noAwaitInLoops: the two runs must not overlap
    await open(page, `?panel=${panel}`);
    await expect(page.getByTestId("metrics")).toHaveCount(
      panel === "1" ? 1 : 0
    );
    // A full metrics window (3 s) after the first sample.
    await page.waitForTimeout(3500);
    const { ratio } = await metrics(page);
    expect(ratio).toBeGreaterThan(0);
    expect(ratio).toBeLessThanOrEqual(1.05);
    const renders = await page.evaluate(() => window.glowPage?.renders());
    runs.push(renders ?? {});
  }
  const [off = {}, on = {}] = runs;
  expect(Object.keys(on).sort()).toEqual([
    "ambient",
    "halo",
    "letterbox",
    "theme",
  ]);
  for (const name of Object.keys(on)) {
    expect(Math.abs((on[name] ?? 0) - (off[name] ?? 0))).toBeLessThanOrEqual(1);
  }
});

test("a setting off its default is flagged", async ({ page }) => {
  await open(page);
  await expect(page.getByTestId("non-default")).toHaveCount(0);
  await open(page, "?method=webgl");
  await expect(page.getByTestId("non-default")).toBeVisible();
  await expect(page.getByTestId("non-default")).toContainText("method: webgl");
});

test("the read counts one handle per effect", async ({ page }) => {
  await open(page);
  await page.waitForTimeout(2000);
  const references = await page.evaluate(() => {
    const video = document.querySelector("video");
    const { glowApi } = window;
    return video ? glowApi?.inspect(video)?.stats().references : undefined;
  });
  expect(references).toBe(4);
});

test("with no effect on, the page is ready once the video plays", async ({
  page,
}) => {
  await open(page, "?effects=");
  expect(
    await page.evaluate(() => document.querySelector("video")?.paused)
  ).toBe(false);
  await expect.poll(async () => (await metrics(page)).references).toBe(0);
  await expect(page.locator("[data-glow]")).toHaveCount(0);
});

test("an effect turned on after the read failed reports it once", async ({
  page,
}) => {
  // The same clip from another origin, without CORS headers: unreadable.
  const url = await crossOriginClip(page);
  await page.goto(`/page.html?src=${encodeURIComponent(url)}&effects=halo`);
  const errorCount = () =>
    page.evaluate(() => window.glowPage?.errors().length);
  await expect.poll(errorCount).toBe(1);
  await page.evaluate(() => window.glowPage?.setEffect("ambient", true));
  await expect.poll(errorCount).toBe(2);
  // Nothing late: a second report would come within a microtask or two.
  await page.waitForTimeout(500);
  expect(await errorCount()).toBe(2);
});

/**
 * Behaviour of the React layer, driven through the page's collapsed "Checks"
 * section (test-only fixtures that cost nothing until used) and `?lateVideo=1`.
 */
test.describe("react layer", () => {
  type TestWindow = Window & Record<string, unknown>;

  const openChecks = (page: Page) =>
    page.getByTestId("checks").locator("summary").click();

  /** Handles on the read of the video matching `selector` (the page's own by default). */
  const referencesOf = (page: Page, selector = '[data-testid="video"]') =>
    page.evaluate((sel) => {
      const video = document.querySelector<HTMLVideoElement>(sel);
      const { glowApi } = window;
      return video ? glowApi?.inspect(video)?.stats().references : undefined;
    }, selector);

  const renders = async (page: Page) =>
    (await page.evaluate(() => window.glowPage?.renders())) ?? {};

  const EFFECT_NAMES = ["ambient", "halo", "letterbox", "theme"] as const;

  it("provider settings win whatever the mount order", async ({
    browserName,
    page,
  }) => {
    // All four at once.
    await open(page, "?method=canvas");
    await expect.poll(() => method(page)).toBe("canvas");
    for (const forced of ["canvas", "webgl"]) {
      // biome-ignore lint/performance/noAwaitInLoops: one page at a time
      await open(page, `?method=${forced}&effects=`);
      await openChecks(page);
      // A `useColors` consumer first, then the effects in reverse order.
      await page.getByTestId("check-colors").check();
      await expect.poll(() => referencesOf(page)).toBe(1);
      for (const name of ["letterbox", "theme", "ambient", "halo"]) {
        // biome-ignore lint/performance/noAwaitInLoops: the mount order is the point
        await page.getByTestId(`effect-${name}`).check();
      }
      await expect.poll(() => referencesOf(page)).toBe(5);
      const expected = forced === "canvas" ? ["canvas"] : webglOr(browserName);
      await expect
        .poll(async () => expected.includes(await method(page)))
        .toBe(true);
      await page.getByTestId("check-colors").uncheck();
      await expect.poll(() => referencesOf(page)).toBe(4);
    }
  });

  it("strict mode mounts once", async ({ page }) => {
    await open(page);
    await expect.poll(() => referencesOf(page)).toBe(4);
    // One read: it keeps up with the video once the 3 s window is full.
    await page.waitForTimeout(3000);
    await expect
      .poll(
        async () => {
          const m = await metrics(page);
          return m.videoFps > 0 && m.sampleFps >= 0.9 * m.videoFps;
        },
        { timeout: 10_000 }
      )
      .toBe(true);
    expect(await referencesOf(page)).toBe(4);
  });

  /** Counts the Workers the page creates: install before the page loads. */
  const countWorkers = (page: Page) =>
    page.addInitScript(() => {
      const Native = window.Worker;
      const counter = window as unknown as { workersCreated: number };
      counter.workersCreated = 0;
      window.Worker = class extends Native {
        constructor(...args: ConstructorParameters<typeof Worker>) {
          super(...args);
          counter.workersCreated += 1;
        }
      };
    });

  const workersCreated = (page: Page) =>
    page.evaluate(
      () => (window as unknown as { workersCreated: number }).workersCreated
    );

  it("strict mode: useGlow with the video there at mount starts one read", async ({
    page,
  }) => {
    // No other effect: the fixture's read is the only one, so a read stopped
    // and started again by StrictMode's second mount would show.
    await countWorkers(page);
    await open(page, "?effects=");
    await openChecks(page);
    const start = {
      layers: await page.locator("[data-glow]").count(),
      references: (await referencesOf(page)) ?? 0,
      workers: await workersCreated(page),
    };
    await page.getByTestId("check-direct").check();
    await expect.poll(() => referencesOf(page)).toBe(start.references + 1);
    await expect(
      page.getByTestId("direct-host").locator("[data-glow]")
    ).toHaveCount(1);
    await expect(page.locator("[data-glow]")).toHaveCount(start.layers + 1);
    // Well past the grace period: one Worker, one handle.
    await page.waitForTimeout(500);
    expect(await workersCreated(page)).toBe(start.workers + 1);
    expect(await referencesOf(page)).toBe(start.references + 1);

    await page.getByTestId("check-direct").uncheck();
    await expect
      .poll(async () => (await referencesOf(page)) ?? 0)
      .toBe(start.references);
    await expect(page.locator("[data-glow]")).toHaveCount(start.layers);
  });

  it("an onError that comes and goes restarts nothing", async ({ page }) => {
    await open(page);
    await openChecks(page);
    await page.getByTestId("check-onerror").check();
    const layer = page.getByTestId("onerror-check").locator("[data-glow]");
    await expect(layer).toHaveCount(1);
    await expect.poll(() => referencesOf(page)).toBe(5);
    await layer.evaluate((node) => {
      (window as unknown as TestWindow).onErrorLayer = node;
    });
    const sameLayer = () =>
      page.evaluate(() => {
        const node = document.querySelector(
          '[data-testid="onerror-check"] [data-glow]'
        );
        return (
          node !== null &&
          node === (window as unknown as TestWindow).onErrorLayer
        );
      });
    const toggle = page.getByTestId("check-onerror-toggle");
    for (const pressed of ["true", "false"]) {
      // biome-ignore lint/performance/noAwaitInLoops: one change at a time
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-pressed", pressed);
      // Past the grace period: a restart would have replaced the layer.
      await page.waitForTimeout(300);
      expect(await sameLayer()).toBe(true);
      expect(await referencesOf(page)).toBe(5);
    }
  });

  it("a video that arrives late starts the effects", async ({ page }) => {
    await open(page, "?lateVideo=1");
    // What the page held just before the video was added (recorded in-page,
    // so no race): the four effects mounted, no video, no layer.
    const before = await page.evaluate(() => window.glowPage?.lateVideo());
    expect(before).toBeDefined();
    expect(before?.videos).toBe(0);
    expect(before?.layers).toBe(0);
    for (const name of EFFECT_NAMES) {
      expect(before?.renders[name] ?? 0).toBeGreaterThan(0);
    }
    // Once it is there, they start on it.
    await expect.poll(() => referencesOf(page)).toBe(4);
    await expect(page.locator("[data-glow]")).toHaveCount(3);
  });

  it("a child video that arrives late or is swapped is picked up", async ({
    page,
  }) => {
    await open(page);
    await openChecks(page);
    await page.getByTestId("check-child").check();
    const child = page.getByTestId("child-check");
    // A Halo with no `video` prop, under a provider without a video.
    await expect(child).toHaveCount(1);
    await expect(child.locator("video")).toHaveCount(0);
    await expect(child.locator("[data-glow]")).toHaveCount(0);
    // The video appears later, through state.
    await page.getByTestId("check-child-add").click();
    await expect(child.locator("video")).toHaveCount(1);
    await expect
      .poll(() => referencesOf(page, '[data-testid="child-check"] video'))
      .toBe(1);
    await expect(child.locator('[data-glow="halo"]')).toHaveCount(1);
    await page.evaluate(() => {
      (window as unknown as TestWindow).oldChild = document.querySelector(
        '[data-testid="child-check"] video'
      );
    });
    // Swapped for another <video>: the effect moves, the old read goes.
    await page.getByTestId("check-child-swap").click();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const old = (window as unknown as TestWindow).oldChild as
            | HTMLVideoElement
            | undefined;
          const now = document.querySelector<HTMLVideoElement>(
            '[data-testid="child-check"] video'
          );
          const { glowApi } = window;
          return {
            newRefs: now ? glowApi?.inspect(now)?.stats().references : -1,
            oldRead: old ? glowApi?.inspect(old) !== undefined : true,
            swapped: Boolean(now && old && now !== old),
          };
        })
      )
      .toEqual({ newRefs: 1, oldRead: false, swapped: true });
    await expect(child.locator('[data-glow="halo"]')).toHaveCount(1);
    expect(await referencesOf(page)).toBe(4);
  });

  it("inline options do not restart anything", async ({ page }) => {
    await open(page);
    await expect.poll(() => referencesOf(page)).toBe(4);
    await expect
      .poll(() =>
        page
          .getByTestId("theme-card")
          .evaluate((card) =>
            getComputedStyle(card.firstElementChild ?? card).getPropertyValue(
              "--video-primary"
            )
          )
      )
      .not.toBe("");
    await openChecks(page);
    // 30 parent renders, each with a fresh provider options object and fresh
    // inline `onError` functions (provider and Halo), all in one click.
    const result = await page.evaluate(() => {
      const { glowApi } = window;
      const video = document.querySelector<HTMLVideoElement>(
        '[data-testid="video"]'
      );
      const card = document.querySelector('[data-testid="theme-card"]');
      const host = card?.firstElementChild ?? card;
      const read = () => ({
        layer: document.querySelector('[data-glow="halo"]'),
        primary: host
          ? getComputedStyle(host).getPropertyValue("--video-primary")
          : "",
        references: video ? glowApi?.inspect(video)?.stats().references : -1,
      });
      const before = read();
      (window as unknown as TestWindow).haloLayer = before.layer;
      document
        .querySelector<HTMLButtonElement>('[data-testid="check-rerender"]')
        ?.click();
      const after = read();
      return {
        layerKept: before.layer !== null && before.layer === after.layer,
        primaryKept: before.primary !== "" && before.primary === after.primary,
        references: [before.references, after.references],
      };
    });
    expect(result).toEqual({
      layerKept: true,
      primaryKept: true,
      references: [4, 4],
    });
    expect(await page.getByTestId("check-rerender-count").textContent()).toBe(
      "30"
    );
    // And nothing restarts later either.
    const start = await renders(page);
    await page.waitForTimeout(10_000);
    const end = await renders(page);
    for (const name of EFFECT_NAMES) {
      expect((end[name] ?? 0) - (start[name] ?? 0)).toBeLessThanOrEqual(2);
    }
    expect(
      await page.evaluate(
        () =>
          document.querySelector('[data-glow="halo"]') ===
          (window as unknown as TestWindow).haloLayer
      )
    ).toBe(true);
    expect(await referencesOf(page)).toBe(4);
  });

  it("unmounting everything leaves nothing", async ({ page }) => {
    await open(page);
    await expect.poll(() => referencesOf(page)).toBe(4);
    await openChecks(page);
    const tornDownMs = await page.evaluate(async () => {
      const { glowApi } = window;
      const video = document.querySelector<HTMLVideoElement>(
        '[data-testid="video"]'
      );
      if (!(video && glowApi)) {
        return -1;
      }
      document
        .querySelector<HTMLButtonElement>('[data-testid="check-toggle-all"]')
        ?.click();
      const started = performance.now();
      while (glowApi.inspect(video) && performance.now() - started < 2000) {
        // biome-ignore lint/performance/noAwaitInLoops: polling the read
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      return glowApi.inspect(video) ? -1 : performance.now() - started;
    });
    expect(tornDownMs).toBeGreaterThanOrEqual(0);
    expect(tornDownMs).toBeLessThan(300);
    await expect(page.locator("[data-glow]")).toHaveCount(0);
    await expect.poll(async () => (await metrics(page)).references).toBe(0);
  });

  it("mounting and unmounting 50 times leaks nothing", async ({ page }) => {
    await open(page);
    await expect.poll(() => referencesOf(page)).toBe(4);
    await expect(page.locator("[data-glow]")).toHaveCount(3);
    await openChecks(page);
    await page.evaluate(async () => {
      const button = document.querySelector<HTMLButtonElement>(
        '[data-testid="check-toggle-all"]'
      );
      for (let i = 0; i < 100; i += 1) {
        button?.click();
        // biome-ignore lint/performance/noAwaitInLoops: one frame per toggle
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
    });
    await expect.poll(() => referencesOf(page)).toBe(4);
    await expect.poll(async () => (await metrics(page)).references).toBe(4);
    await expect(page.locator("[data-glow]")).toHaveCount(3);
    await expect(page.locator("video")).toHaveCount(1);
    // Settled: still four, and the read still delivers.
    await page.waitForTimeout(500);
    expect(await referencesOf(page)).toBe(4);
    await expect
      .poll(async () => (await metrics(page)).sampleFps)
      .toBeGreaterThan(0);
  });

  it("renders: effect components stay quiet", async ({ page }) => {
    await open(page);
    await expect.poll(() => referencesOf(page)).toBe(4);
    const start = await renders(page);
    await page.waitForTimeout(10_000);
    const end = await renders(page);
    for (const name of EFFECT_NAMES) {
      expect(start[name]).toBeGreaterThan(0);
      expect((end[name] ?? 0) - (start[name] ?? 0)).toBeLessThanOrEqual(2);
    }
  });

  /** Counts the read's smoothed-colour updates for `ms`, through a raw handle, with the demos' counts. */
  /**
   * Counts the read's smoothed-colour updates through a raw handle, with the
   * demos' counts, for at least `ms` and until `minFrames` updates (the clip
   * loops), up to 30 s.
   */
  const countColourFrames = (page: Page, ms: number, minFrames = 0) =>
    page.evaluate(
      async ([duration, enough]) => {
        const { glowApi, glowPage } = window;
        const video = document.querySelector<HTMLVideoElement>(
          '[data-testid="video"]'
        );
        if (!(video && glowApi && glowPage)) {
          return;
        }
        const handle = glowApi.watch(video);
        let frames = -1; // `subscribe` calls back once at once
        handle.subscribe(() => {
          frames += 1;
        });
        const rendersStart = glowPage.renders();
        const callsStart = glowPage.eventCalls();
        const started = performance.now();
        while (
          performance.now() - started < duration ||
          (frames < enough && performance.now() - started < 30_000)
        ) {
          // biome-ignore lint/performance/noAwaitInLoops: polling the count
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        const rendersEnd = glowPage.renders();
        const delta = (id: string) =>
          Number(rendersEnd[id] as number | undefined) -
          Number(rendersStart[id] as number | undefined);
        const result = {
          calls: glowPage.eventCalls() - callsStart,
          colorsRenders: delta("colors-demo"),
          eventRenders: delta("event-demo"),
          frames,
        };
        handle.destroy();
        return result;
      },
      [ms, minFrames] as const
    );

  /** Within 20 % (at least 3): a double render or an extra state is ~2x off. */
  const near = (value: number, reference: number) =>
    Math.abs(value - reference) <= Math.max(0.2 * reference, 3);
  const MIN_UPDATES = 40;

  it("useColors renders once per colour update", async ({ page }) => {
    // A clip whose overall colour changes (red, then blue, in a loop).
    await open(page, "?src=%2Fshift-360.webm");
    await openChecks(page);
    await page.getByTestId("check-colors").check();
    await expect.poll(() => referencesOf(page)).toBe(5);
    const counts = await countColourFrames(page, 4500, MIN_UPDATES);
    expect(counts).toBeDefined();
    const { colorsRenders = 0, frames = 0 } = counts ?? {};
    it.info().annotations.push({
      description: `renders ${colorsRenders} / updates ${frames}`,
      type: "counts",
    });
    expect(frames).toBeGreaterThanOrEqual(MIN_UPDATES);
    expect(near(colorsRenders, frames)).toBe(true);
  });

  it("useColorsEvent never renders", async ({ page }) => {
    await open(page, "?src=%2Fshift-360.webm");
    await openChecks(page);
    await page.getByTestId("check-event").check();
    await expect.poll(() => referencesOf(page)).toBe(5);
    const counts = await countColourFrames(page, 4500, MIN_UPDATES);
    const { calls = 0, eventRenders = -1, frames = 0 } = counts ?? {};
    it.info().annotations.push({
      description: `calls ${calls} / updates ${frames}, renders ${eventRenders}`,
      type: "counts",
    });
    expect(eventRenders).toBe(0);
    expect(frames).toBeGreaterThanOrEqual(MIN_UPDATES);
    expect(near(calls, frames)).toBe(true);
    // A new callback on each of 30 parent renders: no resubscription (one
    // would call back at once, synchronously) and the same handle count.
    const churn = await page.evaluate(() => {
      const { glowApi, glowPage } = window;
      const video = document.querySelector<HTMLVideoElement>(
        '[data-testid="video"]'
      );
      if (!(video && glowApi && glowPage)) {
        return;
      }
      const references = () => glowApi.inspect(video)?.stats().references;
      const before = { calls: glowPage.eventCalls(), references: references() };
      document
        .querySelector<HTMLButtonElement>('[data-testid="check-rerender"]')
        ?.click();
      return {
        calls: glowPage.eventCalls() - before.calls,
        references: [before.references, references()],
      };
    });
    expect(churn).toEqual({ calls: 0, references: [5, 5] });
    expect(await page.getByTestId("check-rerender-count").textContent()).toBe(
      "30"
    );
    // Still called with the latest callback afterwards.
    const after = await countColourFrames(page, 2500);
    expect(after?.calls ?? 0).toBeGreaterThan(0);
  });

  it("turning the main thread on for a live video restarts the read", async ({
    page,
  }) => {
    await open(page);
    const samples = () =>
      page.evaluate(() => {
        const video = document.querySelector<HTMLVideoElement>(
          '[data-testid="video"]'
        );
        const { glowApi } = window;
        return video ? (glowApi?.inspect(video)?.stats().samples ?? 0) : 0;
      });
    await expect.poll(samples, { timeout: 10_000 }).toBeGreaterThan(40);
    const before = await samples();
    await page.getByTestId("advanced").locator("summary").click();
    await page.getByTestId("main-thread").check();
    // A fresh read: its sample count starts again from zero.
    await expect.poll(samples).toBeLessThan(before);
    expect(page.url()).toContain("main=1");
    await expect.poll(samples).toBeGreaterThan(0);
    await expect.poll(() => referencesOf(page)).toBe(4);
  });
});

/**
 * The format presets: the clip is 16:9, so any other container format shows
 * bands of the letterbox; at 16:9 there are none.
 */
test.describe("container formats", () => {
  type Side = "bottom" | "left" | "right" | "top";
  type Bands = Partial<Record<Side, number>>;

  const CONTAINER = '[data-testid="container"]';

  const containerSize = (page: Page) =>
    page.locator(CONTAINER).evaluate((el) => {
      const box = el.getBoundingClientRect();
      return { height: Math.round(box.height), width: Math.round(box.width) };
    });

  /** Thickness of each visible band of the letterbox layer (absent: no band). */
  const bands = (page: Page): Promise<Bands> =>
    page.evaluate(() => {
      const found: Record<string, number> = {};
      for (const band of document.querySelectorAll<HTMLElement>(
        '[data-glow="letterbox"] > [data-side]'
      )) {
        if (getComputedStyle(band).display === "none") {
          continue;
        }
        const box = band.getBoundingClientRect();
        const side = band.dataset.side ?? "";
        const bar = side === "top" || side === "bottom";
        found[side] = bar ? box.height : box.width;
      }
      return found;
    });

  const CASES: {
    aspect: "16:9" | "21:9" | "4:3" | "9:16";
    bands: Bands;
    height: number;
    tolerance: number;
    width: number;
  }[] = [
    { aspect: "16:9", bands: {}, height: 270, tolerance: 0, width: 480 },
    {
      aspect: "4:3",
      bands: { bottom: 45, top: 45 },
      height: 360,
      tolerance: 3,
      width: 480,
    },
    {
      aspect: "21:9",
      bands: { left: 57, right: 57 },
      height: 206,
      tolerance: 3,
      width: 480,
    },
    {
      aspect: "9:16",
      bands: { bottom: 164, top: 164 },
      height: 480,
      tolerance: 4,
      width: 270,
    },
  ];

  for (const { aspect, bands: expected, height, tolerance, width } of CASES) {
    it(`?aspect=${aspect} sizes the container ${width}x${height} and shows the matching bands`, async ({
      page,
    }) => {
      await open(page, { aspect });
      expect(await containerSize(page)).toEqual({ height, width });
      await expect
        .poll(async () => Object.keys(await bands(page)).sort())
        .toEqual(Object.keys(expected).sort());
      const found = await bands(page);
      for (const [side, size] of Object.entries(expected)) {
        expect(Math.abs((found[side as Side] ?? 0) - size)).toBeLessThanOrEqual(
          tolerance
        );
      }
      await expect(page.getByTestId(`aspect-${aspect}`)).toHaveAttribute(
        "aria-pressed",
        "true"
      );
    });
  }

  it("flags a non-default format and an unknown one is the default", async ({
    page,
  }) => {
    await open(page, "?aspect=4:3");
    await expect(page.getByTestId("non-default")).toContainText("format: 4:3");
    await open(page, "?aspect=1:1");
    await expect(page.getByTestId("non-default")).toHaveCount(0);
    expect(await containerSize(page)).toEqual({ height: 270, width: 480 });
  });

  it("choosing a format resizes the container, the URL and the bands, on the same video", async ({
    page,
  }) => {
    await open(page);
    await page.evaluate(() => {
      (window as unknown as { first: unknown }).first =
        document.querySelector("video");
      (window as unknown as { container: unknown }).container =
        document.querySelector('[data-testid="container"]');
    });
    const time = () =>
      page.locator(VIDEO).evaluate((v: HTMLVideoElement) => v.currentTime);
    const same = () =>
      page.evaluate(
        () =>
          document.querySelector("video") ===
            (window as unknown as { first: unknown }).first &&
          document.querySelector('[data-testid="container"]') ===
            (window as unknown as { container: unknown }).container
      );

    await page.getByTestId("aspect-4:3").click();
    await expect
      .poll(() => containerSize(page))
      .toEqual({
        height: 360,
        width: 480,
      });
    await expect
      .poll(() => decodeURIComponent(page.url()))
      .toContain("aspect=4:3");
    await expect
      .poll(async () => (await bands(page)).top ?? 0)
      .toBeGreaterThan(40);
    expect(await same()).toBe(true);
    const before = await time();
    await expect.poll(time).toBeGreaterThan(before);

    await page.getByTestId("aspect-9:16").click();
    await expect
      .poll(() => containerSize(page))
      .toEqual({
        height: 480,
        width: 270,
      });
    expect(await same()).toBe(true);

    // Back to the default: no parameter any more.
    await page.getByTestId("aspect-16:9").click();
    await expect
      .poll(() => containerSize(page))
      .toEqual({
        height: 270,
        width: 480,
      });
    await expect.poll(() => page.url()).not.toContain("aspect");
    await expect(page.getByTestId("non-default")).toHaveCount(0);
    expect(await same()).toBe(true);
    await expect.poll(async () => Object.keys(await bands(page))).toEqual([]);
  });

  it("clicking the current format after a drag resets its size, on the same video", async ({
    page,
  }) => {
    await open(page, { aspect: "4:3" });
    await page.evaluate(() => {
      (window as unknown as { first: unknown }).first =
        document.querySelector("video");
    });
    // What a drag of the resize grip does: an inline size of its own.
    await page.locator(CONTAINER).evaluate((el) => {
      (el as HTMLElement).style.width = "400px";
      (el as HTMLElement).style.height = "300px";
    });
    expect(await containerSize(page)).toEqual({ height: 300, width: 400 });
    await page.getByTestId("aspect-4:3").click();
    await expect
      .poll(() => containerSize(page))
      .toEqual({ height: 360, width: 480 });
    expect(
      await page.evaluate(
        () =>
          document.querySelector("video") ===
          (window as unknown as { first: unknown }).first
      )
    ).toBe(true);
  });

  it("the drag handle still resizes after a format (a preset, not a lock)", async ({
    page,
  }) => {
    await open(page, { aspect: "4:3" });
    await page.locator(CONTAINER).evaluate((el) => {
      (el as HTMLElement).style.width = "400px";
      (el as HTMLElement).style.height = "400px";
    });
    expect(await containerSize(page)).toEqual({ height: 400, width: 400 });
    await expect
      .poll(async () => (await bands(page)).top ?? 0)
      .toBeGreaterThan(85);
  });
});
