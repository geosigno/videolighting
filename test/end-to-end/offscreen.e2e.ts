import { expect, test } from "@playwright/test";
import { open, samplesOf, VIDEO } from "./helpers.js";

/**
 * Off screen, only what draws around the video (halo) has no reason
 * to read it. A background, a theme or `watch()` can be anywhere in the page
 * and keep reading while the video plays.
 */

const wait = (page: Parameters<typeof open>[0], ms: number) =>
  page.evaluate(
    (delay) => new Promise((resolve) => setTimeout(resolve, delay)),
    ms
  );

/** Samples taken in the second after the video has been scrolled far out of the viewport. */
async function readsOffScreen(
  page: Parameters<typeof open>[0],
  effects: ("ambient" | "halo" | "theme")[]
) {
  await open(page, { effects });
  await page.evaluate(() => {
    const spacer = document.createElement("div");
    spacer.style.height = "6000px";
    document.body.append(spacer);
    window.scrollTo(0, 5000);
  });
  await wait(page, 600);
  const before = await samplesOf(page);
  await wait(page, 1000);
  return (await samplesOf(page)) - before;
}

test.describe("off screen", () => {
  test("a halo alone stops reading", async ({ page }) => {
    expect(await readsOffScreen(page, ["halo"])).toBeLessThanOrEqual(1);
  });

  test("an ambient background keeps reading", async ({ page }) => {
    expect(await readsOffScreen(page, ["ambient"])).toBeGreaterThan(10);
  });

  test("a theme keeps reading", async ({ page }) => {
    expect(await readsOffScreen(page, ["theme"])).toBeGreaterThan(10);
  });

  test("a halo next to an ambient background: the background keeps the read going", async ({
    page,
  }) => {
    expect(await readsOffScreen(page, ["halo", "ambient"])).toBeGreaterThan(10);
  });

  test("the read follows the handles as they come and go", async ({ page }) => {
    // A halo alone paused, then a plain watch() wakes it, then its destroy pauses it again.
    const rate = async () => {
      const before = await samplesOf(page);
      await wait(page, 1000);
      return (await samplesOf(page)) - before;
    };
    await open(page, { effects: ["halo"] });
    await page.evaluate(() => {
      const spacer = document.createElement("div");
      spacer.style.height = "6000px";
      document.body.append(spacer);
      window.scrollTo(0, 5000);
    });
    await wait(page, 600);
    expect(await rate()).toBeLessThanOrEqual(1);
    await page.evaluate((selector) => {
      const video = document.querySelector<HTMLVideoElement>(selector);
      if (!(video && window.glowApi)) {
        throw new Error("no video");
      }
      Object.assign(window, { extra: window.glowApi.watch(video) });
    }, VIDEO);
    await wait(page, 300);
    expect(await rate()).toBeGreaterThan(10);
    await page.evaluate(() =>
      (window as unknown as { extra: { destroy: () => void } }).extra.destroy()
    );
    await wait(page, 600);
    expect(await rate()).toBeLessThanOrEqual(1);
  });
});
