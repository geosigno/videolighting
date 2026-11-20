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

  test("layer is added and removed", async ({ page }) => {
    await open(page, { effects: ["halo"] });
    await expect(page.locator('[data-vl="halo"]')).toHaveCount(1);
    await stopAndKeepHost(page, "halo");
  });
});
