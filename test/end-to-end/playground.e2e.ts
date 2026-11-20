import { expect, type Page, test } from "@playwright/test";
import { metrics, open, VIDEO } from "./helpers.js";

/**
 * The reference page itself, the playground's page for developers: it mounts
 * every effect on one video, and its format presets resize the container.
 */

test("the page mounts every effect on one video", async ({ page }) => {
  // StrictMode off: the same count, so its double mount leaks no handle.
  await open(page, "?strict=0");
  await expect.poll(async () => (await metrics(page)).references).toBe(3);
  await open(page);
  await expect.poll(async () => (await metrics(page)).references).toBe(3);
  await expect(page.locator("video")).toHaveCount(1);
  // Halo and ambient draw a layer; theme writes variables only.
  for (const name of ["halo", "ambient"]) {
    // biome-ignore lint/performance/noAwaitInLoops: one locator at a time, clearer failures
    await expect(page.locator(`[data-vl="${name}"]`)).toHaveCount(1);
  }
  await expect(page.locator("[data-vl]")).toHaveCount(2);
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

test("choosing a format resizes the container and the URL, on the same video", async ({
  page,
}) => {
  const container = page.getByTestId("container");
  const size = (_page: Page) =>
    container.evaluate((el) => {
      const box = el.getBoundingClientRect();
      return { height: Math.round(box.height), width: Math.round(box.width) };
    });
  await open(page);
  expect(await size(page)).toEqual({ height: 270, width: 480 });
  await page.evaluate(() => {
    (window as unknown as { first: unknown }).first =
      document.querySelector("video");
  });
  const time = () =>
    page.locator(VIDEO).evaluate((v: HTMLVideoElement) => v.currentTime);

  await page.getByTestId("aspect-4:3").click();
  await expect.poll(() => size(page)).toEqual({ height: 360, width: 480 });
  await expect
    .poll(() => decodeURIComponent(page.url()))
    .toContain("aspect=4:3");
  const before = await time();
  await expect.poll(time).toBeGreaterThan(before);

  // Back to the default: no parameter any more.
  await page.getByTestId("aspect-16:9").click();
  await expect.poll(() => size(page)).toEqual({ height: 270, width: 480 });
  await expect.poll(() => page.url()).not.toContain("aspect");
  expect(
    await page.evaluate(
      () =>
        document.querySelector("video") ===
        (window as unknown as { first: unknown }).first
    )
  ).toBe(true);
});
