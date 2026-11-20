import { expect, test } from "@playwright/test";
import { open, VIDEO } from "./helpers.js";

/**
 * The read must follow the machine during a video, not only at the start:
 * when it slows down, or recovers, the reader compares its methods again at
 * once instead of waiting for its one-minute safety net.
 *
 * The slowdown is Chromium's CPU throttling (DevTools protocol; the config runs
 * this file on Chromium only), the one way to
 * change the load under a running read that is the same on every run. The
 * frames read both ways to compare are the ones flagged `probe`: that is what
 * is counted. Which method wins is covered by the reader's unit tests (the
 * headless browser's WebGL is software, so the canvas always wins here).
 */

/**
 * Slows the whole renderer by this factor: a 1080p read goes from about 3 ms to
 * about 25. Large on purpose, for two reasons. The reader compares again when a
 * read gets 1.5 times slower or faster than the one it measured while slowed,
 * and on a busy machine the unslowed read is slower than on a calm one. And a
 * slowed read that hovers around 10 ms (as it does at 50) crosses the reader's
 * 10 ms mark again and again, so a comparison can straddle the moment the CPU
 * is released and be counted half before, half after.
 */
const SLOWDOWN = 100;
/** Frames the reader reads both ways in one comparison. */
const ONE_COMPARISON = 5;
/** No two comparisons closer than this (the reader's own minimum gap), plus a margin. */
const QUIET_MS = 11_000;

declare global {
  interface Window {
    probes?: number;
  }
}

test.describe("adaptive read", () => {
  test.setTimeout(120_000);

  test("compares the methods again when the machine slows down, and when it recovers", async ({
    page,
  }) => {
    await open(page, {
      effects: ["halo"],
      method: "auto",
      panel: false,
      src: "/quad-1080.webm",
      strict: false,
    });
    await page.evaluate((selector) => {
      window.probes = 0;
      const video = document.querySelector<HTMLVideoElement>(selector);
      if (!video) {
        return;
      }
      window.glowApi?.inspect(video)?.onSample((_edges, cost) => {
        if (cost.probe) {
          window.probes = (window.probes ?? 0) + 1;
        }
      });
    }, VIDEO);
    const probes = () => page.evaluate(() => window.probes ?? 0);

    // The first comparison is done; past the minimum gap, nothing asks for another.
    await page.waitForTimeout(QUIET_MS);
    const calm = await probes();

    const client = await page.context().newCDPSession(page);
    await client.send("Emulation.setCPUThrottlingRate", { rate: SLOWDOWN });
    await expect
      .poll(probes, {
        message: "a comparison after the slowdown",
        timeout: 15_000,
      })
      .toBeGreaterThanOrEqual(calm + ONE_COMPARISON);

    // Let that comparison, and any it would trigger, end before recovering.
    await page.waitForTimeout(QUIET_MS);
    const slow = await probes();
    await client.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    await expect
      .poll(probes, {
        message: "a comparison after the recovery",
        timeout: 25_000,
      })
      .toBeGreaterThanOrEqual(slow + ONE_COMPARISON);
  });
});
