import { expect, test } from "@playwright/test";
import { contrast } from "../../src/core/colors.js";
import { channels, open, THEME_HOST, VIDEO } from "./helpers.js";

/** The theme on the reference page: `--video-primary` / `--video-secondary` on an element. */
test.describe("theme", () => {
  test("keeps white text readable", async ({ page }) => {
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
  test("keeps the video colour when there is no limit", async ({ page }) => {
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
      shown: await channels(page, '[data-vl="ambient"]', "--vl-primary"),
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

  test("removes its variables on stop", async ({ page }) => {
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
