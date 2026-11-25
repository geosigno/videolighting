import { expect, test } from "@playwright/test";
import { open, stopAndKeepHost, stops } from "./helpers.js";

/** The halo on the reference page: colour bands around the video. */
test.describe("halo", () => {
  test("shows the edge colour unchanged", async ({ page }) => {
    await open(page, { effects: ["halo"] });
    // Bands are top, right, bottom, left: the left one runs down the red strip.
    await expect
      .poll(async () => (await stops(page, '[data-vl="halo"] > div', 3)).length)
      .toBeGreaterThan(6);
    const left = await stops(page, '[data-vl="halo"] > div', 3);
    const [r = 0, g = 0, b = 0] = left[Math.floor(left.length / 2)] ?? [];
    expect(r).toBeGreaterThan(200);
    expect(g).toBeLessThan(80);
    expect(b).toBeLessThan(80);
  });

  test("fills a rounded video's corners without drawing twice there", async ({
    page,
  }) => {
    await open(page, { effects: ["halo"] });
    // Bands are top, right, bottom, left; the layer has the video's size.
    const found = await page.evaluate(() => {
      const layer = document.querySelector('[data-vl="halo"]');
      const box = layer?.getBoundingClientRect() as DOMRect;
      const [top, right, bottom, left] = Array.from(
        layer?.children ?? [],
        (band) => band.getBoundingClientRect()
      );
      return {
        // Top and bottom run under the video, past any corner radius...
        deep: [top.bottom - box.top, box.bottom - bottom.top].map(
          (depth) => depth >= box.height / 2
        ),
        // ...the sides stop at its edge, so no two bands overlap.
        sides: [box.right - right.left, left.right - box.left],
      };
    });
    expect(found).toEqual({ deep: [true, true], sides: [0, 0] });
  });

  test("reach and opacity are settings of the halo, and win over the CSS variables", async ({
    page,
  }) => {
    await open(page, { effects: [] });
    const found = await page.evaluate(() => {
      const video = document.querySelector<HTMLVideoElement>(
        '[data-testid="video"]'
      );
      const host = video?.parentElement;
      if (!(video && host && window.glowApi)) {
        return;
      }
      host.style.setProperty("--vl-reach", "10px");
      const stop = window.glowApi.halo(video, host, {
        opacity: 0.6,
        reach: 200,
      });
      const layer = host.querySelector<HTMLElement>('[data-vl="halo"]');
      // Bands are top, right, bottom, left: the left one is `reach` wide.
      const left = layer?.children[3]?.getBoundingClientRect().width;
      const opacity = layer?.style.getPropertyValue("--vl-opacity");
      stop();
      return { left, opacity };
    });
    expect(found).toEqual({ left: 200, opacity: "0.6" });
  });

  test("the natural variant is one blurred layer, tuned by blur, reach and opacity", async ({
    page,
  }) => {
    await open(page, { effects: [] });
    const found = await page.evaluate(() => {
      const video = document.querySelector<HTMLVideoElement>(
        '[data-testid="video"]'
      );
      const host = video?.parentElement;
      const api = window.glowApi;
      if (!(video && host && api)) {
        return;
      }
      const read = (options: { blur?: number; reach?: number }) => {
        const stop = api.halo(video, host, {
          ...options,
          variant: "natural",
        });
        const layer = host.querySelector<HTMLElement>('[data-vl="halo"]');
        const style = layer ? getComputedStyle(layer) : undefined;
        const result = {
          filter: style?.filter,
          // The left band: the reach outside, twice the blur under the video.
          left: layer?.children[3]?.getBoundingClientRect().width,
          opacity: style?.opacity,
          // No piece has a filter or a mask of its own.
          pieces: Array.from(layer?.children ?? []).filter((piece) => {
            const own = getComputedStyle(piece);
            return own.filter !== "none" || own.maskImage !== "none";
          }).length,
        };
        stop();
        return result;
      };
      return [read({}), read({ blur: 10, reach: 30 })];
    });
    expect(found).toEqual([
      { filter: "blur(40px)", left: 100, opacity: "0.85", pieces: 0 },
      { filter: "blur(10px)", left: 50, opacity: "0.85", pieces: 0 },
    ]);
  });

  test("corners follow the video's radius, unless the page sets --vl-radius", async ({
    page,
  }) => {
    await open(page, { effects: [] });
    const found = await page.evaluate(() => {
      const video = document.querySelector<HTMLVideoElement>(
        '[data-testid="video"]'
      );
      const host = video?.parentElement;
      if (!(video && host && window.glowApi)) {
        return;
      }
      /** Mount a halo, read what it knows of the radius and where its top band starts. */
      const mount = () => {
        const stop = window.glowApi?.halo(video, host);
        const layer = host.querySelector<HTMLElement>('[data-vl="halo"]');
        const top = layer?.children[0]?.getBoundingClientRect();
        const box = layer?.getBoundingClientRect();
        const read = {
          inset: Math.round((top?.left ?? 0) - (box?.left ?? 0)),
          variable: layer?.style.getPropertyValue("--vl-radius"),
        };
        stop?.();
        return read;
      };
      host.style.borderRadius = "0px";
      video.style.borderRadius = "0px";
      const square = mount();
      video.style.borderRadius = "24px";
      const rounded = mount();
      host.style.setProperty("--vl-radius", "10px");
      const set = mount();
      return { rounded, set, square };
    });
    expect(found).toEqual({
      rounded: { inset: 24, variable: "24px" },
      set: { inset: 10, variable: "" },
      square: { inset: 0, variable: "0px" },
    });
  });

  test("layer is added and removed", async ({ page }) => {
    await open(page, { effects: ["halo"] });
    await expect(page.locator('[data-vl="halo"]')).toHaveCount(1);
    await stopAndKeepHost(page, "halo");
  });
});
