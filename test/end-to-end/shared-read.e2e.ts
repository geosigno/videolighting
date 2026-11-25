import { expect, test } from "@playwright/test";
import { saturate } from "../../src/core/colors.js";
import {
  ALL,
  CONTAINER,
  channels,
  crashes,
  crossOriginClip,
  errors,
  FRAME,
  far,
  metrics,
  NEUTRAL,
  open,
  SECURITY_ERROR,
  samplesOf,
  VIDEO,
} from "./helpers.js";

/**
 * Effects sharing one read: all together on the page, joining and failing, and
 * the edges of the contract. The page's components drive the effects; tests
 * that start and stop effects by hand use the vanilla API the page hands over
 * (`glowApi`).
 */

test.describe("all effects together", () => {
  test("share one read that delivers every frame @perf", async ({ page }) => {
    await open(page, { effects: ALL });
    // A full metrics window (3 s) after the first sample.
    await page.waitForTimeout(3500);
    const found = await metrics(page);
    expect(found.references).toBe(3);
    expect(found.ratio).toBeLessThanOrEqual(1.05);
    expect(found.ratio).toBeGreaterThan(0.8);
    expect(found.videoFps).toBeGreaterThan(15);
    expect(found.sampleFps).toBeGreaterThanOrEqual(0.9 * found.videoFps);
    expect(found.skipped).toBe(0);
  });

  test("jump to the colors of a new video instead of fading from the old one", async ({
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
      far(await channels(page, '[data-vl="ambient"]', "--vl-mean"), NEUTRAL)
    ).toBeGreaterThan(40);
    const intermediates = await page.evaluate(
      async ([selector, target]) => {
        const video = document.querySelector<HTMLVideoElement>(selector);
        const layer = document.querySelector<HTMLElement>(
          '[data-vl="ambient"]'
        );
        if (!(video && layer)) {
          return -1;
        }
        const mean = () =>
          (layer.style.getPropertyValue("--vl-mean").match(/\d+/gu) ?? []).map(
            Number
          );
        const before = mean();
        // The quad clip's edges average to about (128, 152, 43), saturated by
        // the vibrant variant: far from shift's red.
        video.src = "/quad-360.webm";
        video.play().catch(() => undefined);
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
      },
      [VIDEO, saturate([128, 152, 43])] as const
    );
    expect(intermediates).toBe(0);
  });

  test("stopping twice is harmless", async ({ page }) => {
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
        glowApi.theme(video, other); // still running afterwards
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

  test("a quick remount reuses the read", async ({ page }) => {
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

  test("restore the host when stopped in either order", async ({ page }) => {
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
      for (const first of ["halo", "ambient"] as const) {
        const states = [read()];
        const running = {
          halo: glowApi.halo(video, host),
          ambient: glowApi.ambient(video, host),
        };
        states.push(read());
        running[first]();
        states.push(read());
        running[first === "halo" ? "ambient" : "halo"]();
        states.push(read());
        out.push(states);
      }
      return out;
    }, VIDEO);
    // before, both on, one left, both stopped: in each order.
    const expected = ["|", "relative|isolate", "relative|isolate", "|"];
    expect(results).toEqual([expected, expected]);
  });

  test("stop sampling once every effect is stopped", async ({ page }) => {
    await open(page, { effects: ALL });
    await expect.poll(async () => (await metrics(page)).references).toBe(3);
    // Every effect off at once; the read must be gone within 400 ms.
    const goneMs = await page.evaluate(async (selector) => {
      const { glowApi, glowPage } = window;
      const video = document.querySelector<HTMLVideoElement>(selector);
      if (!(glowApi && glowPage && video)) {
        return -1;
      }
      for (const name of ["halo", "ambient", "theme"] as const) {
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
    await expect(page.locator("[data-vl]")).toHaveCount(0);
    await expect.poll(async () => (await metrics(page)).references).toBe(0);
  });
});

test.describe("joining and failing", () => {
  // The page's ambient is off, so the test gives the vanilla `ambient` a
  // full-window backdrop of its own, as the old page had.
  test("a late effect on a paused video paints at once", async ({ page }) => {
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
          '[data-vl="ambient"]'
        );
        const band = second.querySelector<HTMLElement>(
          '[data-vl="halo"] > div:nth-child(4)'
        );
        return {
          band: band?.style.backgroundImage ?? "",
          primary: layer?.style.getPropertyValue("--vl-primary") ?? "",
        };
      },
      [VIDEO, FRAME] as const
    );
    expect(out.primary.startsWith("rgb(")).toBe(true);
    expect(out.primary).not.toBe("rgb(24 24 30)");
    expect(out.band).toContain("linear-gradient");
  });

  test("each effect hears about a failed read, once, and nothing crashes", async ({
    page,
  }) => {
    const url = await crossOriginClip(page);
    const crashed = crashes(page);
    await open(page, { effects: ALL, src: url }, { ready: false });
    // Three effects, three callbacks: every effect's onError is called, not only the first one's.
    await expect.poll(async () => (await errors(page)).length).toBe(3);
    // And no more: a late second report would land within this window.
    await page.waitForTimeout(1500);
    const reported = await errors(page);
    expect(reported).toHaveLength(3);
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
    expect(crashed).toEqual([]);
  });

  test("recovers when the source is replaced by a readable video", async ({
    page,
  }) => {
    const url = await crossOriginClip(page);
    await open(page, { effects: ["halo"], src: url }, { ready: false });
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

  test("a listener that throws does not stop the read", async ({ page }) => {
    const crashed = crashes(page);
    await open(page, { effects: ["halo"] });
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
  test("is quiet while a still picture stays still", async ({ page }) => {
    await open(page, { effects: [], src: "/shift-360.webm" }, { ready: false });
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
  test("says so when an effect is given no video", async ({ page }) => {
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
    expect(message).toContain("videolighting: no <video> found");
  });

  // On a video of the test's own: removing the page's `<video>` from under
  // React would break the page rather than test the effect.
  test("stopping after the video left the page is harmless", async ({
    page,
  }) => {
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
});
