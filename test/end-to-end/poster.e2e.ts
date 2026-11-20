import { expect, type Page, test } from "@playwright/test";
import { BLUE, expectColor, GREEN, open, RED } from "./helpers.js";

/**
 * Before a video has any frame (nothing loaded yet, or `preload="none"`), the
 * colours come from its `poster` image, so an effect is not blank in the
 * meantime. Run on the reference page with no effect on.
 */
test.describe("poster", () => {
  /** A red/blue image, as a data URL for a poster. */
  const posterUrl = (page: Page) =>
    page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 160;
      canvas.height = 90;
      const draw = canvas.getContext("2d");
      if (!draw) {
        throw new Error("no 2d context");
      }
      draw.fillStyle = "#ff0000";
      draw.fillRect(0, 0, 80, 90);
      draw.fillStyle = "#0000ff";
      draw.fillRect(80, 0, 80, 90);
      return canvas.toDataURL();
    });

  test("a video that has not started takes its colours from its poster", async ({
    page,
  }) => {
    await open(page, { effects: [] });
    const edges = await page.evaluate(
      async (poster) => {
        const { glowApi } = window;
        if (!glowApi) {
          throw new Error("no glowApi");
        }
        const video = document.createElement("video");
        video.preload = "none";
        video.poster = poster;
        document.body.append(video);
        const watcher = glowApi.watch(video);
        const first = await new Promise<{ top: number[][] }>((resolve) => {
          watcher.onSample((sampled) => resolve(sampled));
        });
        watcher.destroy();
        video.remove();
        return first;
      },
      await posterUrl(page)
    );
    expect(edges.top).toHaveLength(12);
    expectColor(edges.top[0] ?? [], RED);
    expectColor(edges.top.at(-1) ?? [], BLUE);
  });

  test("primary is the most vivid colour of the picture, unless vibrant is off", async ({
    page,
  }) => {
    await open(page, { effects: [] });
    // A beige picture with a small pink patch: the edges are all beige.
    const primary = (vibrant: boolean) =>
      page.evaluate(async (on) => {
        const { glowApi } = window;
        if (!glowApi) {
          throw new Error("no glowApi");
        }
        const canvas = document.createElement("canvas");
        canvas.width = 160;
        canvas.height = 90;
        const draw = canvas.getContext("2d");
        if (!draw) {
          throw new Error("no 2d context");
        }
        draw.fillStyle = "#c8b9a5";
        draw.fillRect(0, 0, 160, 90);
        draw.fillStyle = "#f03c96";
        draw.fillRect(60, 30, 40, 30);
        const video = document.createElement("video");
        video.preload = "none";
        video.poster = canvas.toDataURL();
        document.body.append(video);
        const watcher = glowApi.watch(video, { vibrant: on });
        // Colours are only worked out for someone who listens.
        let latest = watcher.state();
        watcher.subscribe((next) => {
          latest = next;
        });
        await new Promise((resolve) => {
          watcher.onSample(resolve);
        });
        // The listeners run before the colours are set: let this delivery finish.
        await new Promise((resolve) => setTimeout(resolve));
        const colors = latest.primary;
        watcher.destroy();
        video.remove();
        return colors;
      }, vibrant);
    const [r = 0, g = 0, b = 0] = await primary(true);
    expect(r).toBeGreaterThan(200);
    expect(g).toBeLessThan(100);
    expect(b).toBeGreaterThan(100);
    const [, plainGreen = 0] = await primary(false);
    expect(plainGreen).toBeGreaterThan(150);
  });

  test("a loaded video that was not played keeps its poster colours", async ({
    page,
  }) => {
    await open(page, { effects: [] });
    const result = await page.evaluate(
      async (poster) => {
        const { glowApi } = window;
        const source = document.querySelector<HTMLVideoElement>(
          '[data-testid="video"]'
        );
        if (!(glowApi && source)) {
          throw new Error("no glowApi");
        }
        const video = document.createElement("video");
        video.muted = true;
        video.preload = "auto";
        video.poster = poster;
        video.src = source.currentSrc;
        document.body.append(video);
        const seen: number[][] = [];
        const watcher = glowApi.watch(video);
        watcher.onSample((sampled) => seen.push(sampled.top[0] ?? []));
        await new Promise((resolve) => setTimeout(resolve, 1500));
        watcher.destroy();
        video.remove();
        return { ready: video.readyState, seen };
      },
      await posterUrl(page)
    );
    expect(result.ready).toBeGreaterThanOrEqual(2);
    expect(result.seen.length).toBeGreaterThan(0);
    for (const color of result.seen) {
      expectColor(color, RED);
    }
  });

  test("the frames take over once the video plays", async ({ page }) => {
    await open(page, { effects: [] });
    const result = await page.evaluate(
      async (poster) => {
        const { glowApi } = window;
        const source = document.querySelector<HTMLVideoElement>(
          '[data-testid="video"]'
        );
        if (!(glowApi && source)) {
          throw new Error("no glowApi");
        }
        const video = document.createElement("video");
        video.muted = true;
        video.preload = "auto";
        video.poster = poster;
        video.src = source.currentSrc;
        document.body.append(video);
        const seen: number[][] = [];
        let lastTop: number[][] = [];
        const watcher = glowApi.watch(video);
        watcher.onSample((sampled) => {
          seen.push(sampled.top[0] ?? []);
          lastTop = sampled.top;
        });
        await new Promise((resolve) => setTimeout(resolve, 500));
        const posterOnly = seen.slice();
        await video.play();
        await new Promise((resolve) => setTimeout(resolve, 1000));
        watcher.destroy();
        video.remove();
        return { lastTop, posterOnly, seen };
      },
      await posterUrl(page)
    );
    expect(result.posterOnly.length).toBeGreaterThan(0);
    for (const color of result.posterOnly) {
      expectColor(color, RED);
    }
    expect(result.seen.length).toBeGreaterThan(5);
    // The clip's first picture has a green top edge: the middle of it, not the poster's red/blue.
    expectColor(
      result.lastTop[Math.floor(result.lastTop.length / 2)] ?? [],
      GREEN
    );
  });

  test("a poster that fails to load is silent", async ({ page }) => {
    await open(page, { effects: [] });
    const count = await page.evaluate(async () => {
      const { glowApi } = window;
      const video = document.createElement("video");
      video.preload = "none";
      video.poster = "/does-not-exist.png";
      document.body.append(video);
      let samples = 0;
      const watcher = glowApi?.watch(video);
      watcher?.onSample(() => {
        samples += 1;
      });
      await new Promise((resolve) => setTimeout(resolve, 800));
      watcher?.destroy();
      video.remove();
      return samples;
    });
    expect(count).toBe(0);
  });
});
