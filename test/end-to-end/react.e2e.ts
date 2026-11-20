import { expect, type Page, test } from "@playwright/test";
import {
  method,
  metrics,
  open,
  referencesOf,
  samplesOf,
  webglOr,
} from "./helpers.js";

/**
 * Behaviour of the React layer on the reference page, driven through its
 * collapsed "Checks" section (test-only fixtures that cost nothing until used),
 * its controls and `?lateVideo=1`.
 */
test.describe("react layer", () => {
  type TestWindow = Window & Record<string, unknown>;

  const openChecks = (page: Page) =>
    page.getByTestId("checks").locator("summary").click();

  const renders = async (page: Page) =>
    (await page.evaluate(() => window.glowPage?.renders())) ?? {};

  const EFFECT_NAMES = ["ambient", "halo", "theme"] as const;

  test("provider settings win whatever the mount order", async ({
    browserName,
    page,
  }) => {
    for (const forced of ["canvas", "webgl"]) {
      // biome-ignore lint/performance/noAwaitInLoops: one page at a time
      await open(page, `?method=${forced}&effects=`);
      await openChecks(page);
      // A `useColors` consumer first, then the effects in reverse order.
      await page.getByTestId("check-colors").check();
      await expect.poll(() => referencesOf(page)).toBe(1);
      for (const name of ["theme", "ambient", "halo"]) {
        // biome-ignore lint/performance/noAwaitInLoops: the mount order is the point
        await page.getByTestId(`effect-${name}`).check();
      }
      await expect.poll(() => referencesOf(page)).toBe(4);
      const expected = forced === "canvas" ? ["canvas"] : webglOr(browserName);
      await expect
        .poll(async () => expected.includes(await method(page)))
        .toBe(true);
      await page.getByTestId("check-colors").uncheck();
      await expect.poll(() => referencesOf(page)).toBe(3);
    }
  });

  test("changing the method, the main thread or vibrant on a live video restarts the read on the same video", async ({
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

    // The same goes for the other two options: a fresh read, its sample count
    // starting again from zero, and the colours keep coming.
    await expect
      .poll(() => samplesOf(page), { timeout: 10_000 })
      .toBeGreaterThan(40);
    let before = await samplesOf(page);
    await page.getByTestId("advanced").locator("summary").click();
    await page.getByTestId("main-thread").check();
    await expect.poll(() => samplesOf(page)).toBeLessThan(before);
    expect(page.url()).toContain("main=1");
    await expect.poll(() => samplesOf(page)).toBeGreaterThan(0);

    await expect
      .poll(() => samplesOf(page), { timeout: 10_000 })
      .toBeGreaterThan(40);
    before = await samplesOf(page);
    await page.getByTestId("vibrant").uncheck();
    await expect.poll(() => samplesOf(page)).toBeLessThan(before);
    expect(page.url()).toContain("vibrant=0");
    await expect.poll(() => samplesOf(page)).toBeGreaterThan(0);
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
    await expect.poll(() => referencesOf(page)).toBe(3);
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

  test("strict mode: useGlow with the video there at mount starts one read", async ({
    page,
  }) => {
    // No other effect: the fixture's read is the only one, so a read stopped
    // and started again by StrictMode's second mount would show.
    await countWorkers(page);
    await open(page, "?effects=");
    await openChecks(page);
    const start = {
      layers: await page.locator("[data-vl]").count(),
      references: (await referencesOf(page)) ?? 0,
      workers: await workersCreated(page),
    };
    await page.getByTestId("check-direct").check();
    await expect.poll(() => referencesOf(page)).toBe(start.references + 1);
    await expect(
      page.getByTestId("direct-host").locator("[data-vl]")
    ).toHaveCount(1);
    await expect(page.locator("[data-vl]")).toHaveCount(start.layers + 1);
    // Well past the grace period: one Worker, one handle.
    await page.waitForTimeout(500);
    expect(await workersCreated(page)).toBe(start.workers + 1);
    expect(await referencesOf(page)).toBe(start.references + 1);

    await page.getByTestId("check-direct").uncheck();
    await expect
      .poll(async () => (await referencesOf(page)) ?? 0)
      .toBe(start.references);
    await expect(page.locator("[data-vl]")).toHaveCount(start.layers);
  });

  test("an onError that comes and goes restarts nothing", async ({ page }) => {
    await open(page);
    await openChecks(page);
    await page.getByTestId("check-onerror").check();
    const layer = page.getByTestId("onerror-check").locator("[data-vl]");
    await expect(layer).toHaveCount(1);
    await expect.poll(() => referencesOf(page)).toBe(4);
    await layer.evaluate((node) => {
      (window as unknown as TestWindow).onErrorLayer = node;
    });
    const sameLayer = () =>
      page.evaluate(() => {
        const node = document.querySelector(
          '[data-testid="onerror-check"] [data-vl]'
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
      expect(await referencesOf(page)).toBe(4);
    }
  });

  test("a video that arrives late starts the effects", async ({ page }) => {
    await open(page, "?lateVideo=1");
    // What the page held just before the video was added (recorded in-page,
    // so no race): the three effects mounted, no video, no layer.
    const before = await page.evaluate(() => window.glowPage?.lateVideo());
    expect(before).toBeDefined();
    expect(before?.videos).toBe(0);
    expect(before?.layers).toBe(0);
    for (const name of EFFECT_NAMES) {
      expect(before?.renders[name] ?? 0).toBeGreaterThan(0);
    }
    // Once it is there, they start on it.
    await expect.poll(() => referencesOf(page)).toBe(3);
    await expect(page.locator("[data-vl]")).toHaveCount(2);
  });

  test("a child video that arrives late or is swapped is picked up", async ({
    page,
  }) => {
    await open(page);
    await openChecks(page);
    await page.getByTestId("check-child").check();
    const child = page.getByTestId("child-check");
    // A Halo with no `video` prop, under a provider without a video.
    await expect(child).toHaveCount(1);
    await expect(child.locator("video")).toHaveCount(0);
    await expect(child.locator("[data-vl]")).toHaveCount(0);
    // The video appears later, through state.
    await page.getByTestId("check-child-add").click();
    await expect(child.locator("video")).toHaveCount(1);
    await expect
      .poll(() => referencesOf(page, '[data-testid="child-check"] video'))
      .toBe(1);
    await expect(child.locator('[data-vl="halo"]')).toHaveCount(1);
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
    await expect(child.locator('[data-vl="halo"]')).toHaveCount(1);
    expect(await referencesOf(page)).toBe(3);
  });

  test("inline options restart nothing, and the effect components stay quiet", async ({
    page,
  }) => {
    await open(page);
    await expect.poll(() => referencesOf(page)).toBe(3);
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
        ambient: document.querySelector('[data-vl="ambient"]'),
        layer: document.querySelector('[data-vl="halo"]'),
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
        ambientKept:
          before.ambient !== null && before.ambient === after.ambient,
        layerKept: before.layer !== null && before.layer === after.layer,
        primaryKept: before.primary !== "" && before.primary === after.primary,
        references: [before.references, after.references],
      };
    });
    expect(result).toEqual({
      ambientKept: true,
      layerKept: true,
      primaryKept: true,
      references: [3, 3],
    });
    expect(await page.getByTestId("check-rerender-count").textContent()).toBe(
      "30"
    );
    // And the effect components stay quiet later on: they rendered, and nothing restarts.
    const start = await renders(page);
    await page.waitForTimeout(10_000);
    const end = await renders(page);
    for (const name of EFFECT_NAMES) {
      expect(start[name]).toBeGreaterThan(0);
      expect((end[name] ?? 0) - (start[name] ?? 0)).toBeLessThanOrEqual(2);
    }
    expect(
      await page.evaluate(
        () =>
          document.querySelector('[data-vl="halo"]') ===
          (window as unknown as TestWindow).haloLayer
      )
    ).toBe(true);
    expect(await referencesOf(page)).toBe(3);
  });

  test("mounting and unmounting 50 times leaks nothing", async ({ page }) => {
    await open(page);
    await expect.poll(() => referencesOf(page)).toBe(3);
    await expect(page.locator("[data-vl]")).toHaveCount(2);
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
    await expect.poll(() => referencesOf(page)).toBe(3);
    await expect.poll(async () => (await metrics(page)).references).toBe(3);
    await expect(page.locator("[data-vl]")).toHaveCount(2);
    await expect(page.locator("video")).toHaveCount(1);
    // Settled: still three, and the read still delivers.
    await page.waitForTimeout(500);
    expect(await referencesOf(page)).toBe(3);
    await expect
      .poll(async () => (await metrics(page)).sampleFps)
      .toBeGreaterThan(0);
  });

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

  test("useColors renders once per colour update", async ({ page }) => {
    // A clip whose overall colour changes (red, then blue, in a loop).
    await open(page, "?src=%2Fshift-360.webm");
    await openChecks(page);
    await page.getByTestId("check-colors").check();
    await expect.poll(() => referencesOf(page)).toBe(4);
    const counts = await countColourFrames(page, 4500, MIN_UPDATES);
    expect(counts).toBeDefined();
    const { colorsRenders = 0, frames = 0 } = counts ?? {};
    test.info().annotations.push({
      description: `renders ${colorsRenders} / updates ${frames}`,
      type: "counts",
    });
    expect(frames).toBeGreaterThanOrEqual(MIN_UPDATES);
    expect(near(colorsRenders, frames)).toBe(true);
  });

  test("useColorsEvent never renders", async ({ page }) => {
    await open(page, "?src=%2Fshift-360.webm");
    await openChecks(page);
    await page.getByTestId("check-event").check();
    await expect.poll(() => referencesOf(page)).toBe(4);
    const counts = await countColourFrames(page, 4500, MIN_UPDATES);
    const { calls = 0, eventRenders = -1, frames = 0 } = counts ?? {};
    test.info().annotations.push({
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
    expect(churn).toEqual({ calls: 0, references: [4, 4] });
    expect(await page.getByTestId("check-rerender-count").textContent()).toBe(
      "30"
    );
    // Still called with the latest callback afterwards.
    const after = await countColourFrames(page, 2500);
    expect(after?.calls ?? 0).toBeGreaterThan(0);
  });
});
