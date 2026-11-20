import { expect, test } from "@playwright/test";
import { open, stops } from "./helpers.js";

/** What the plugin does where the browser gives it less than it wants. */
test.describe("robustness", () => {
  test("a browser without requestVideoFrameCallback reports it and does not throw", async ({
    page,
  }) => {
    await open(page, { effects: [] });
    // A video of the test's own: the page itself needs the API on its video.
    const found = await page.evaluate(async () => {
      const { glowApi } = window;
      if (!glowApi) {
        return;
      }
      const video = document.createElement("video");
      Object.defineProperty(video, "requestVideoFrameCallback", {
        value: undefined,
      });
      document.body.append(video);
      const messages: string[] = [];
      let thrown = "";
      try {
        const stop = glowApi.halo(video, document.body, {
          onError: (error) => messages.push(String(error)),
        });
        await new Promise((resolve) => setTimeout(resolve, 300));
        stop();
      } catch (error) {
        thrown = String(error);
      }
      video.remove();
      return { messages, thrown };
    });
    expect(found?.thrown).toBe("");
    expect(found?.messages.join()).toContain("requestVideoFrameCallback");
  });

  test("a Content-Security-Policy that blocks workers still gives colours", async ({
    page,
  }) => {
    await page.route("**/page.html*", async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        headers: {
          ...response.headers(),
          "content-security-policy": "worker-src 'none'",
        },
        response,
      });
    });
    await open(page, { effects: ["halo"] });
    await expect
      .poll(async () => (await stops(page, '[data-vl="halo"] > div', 3)).length)
      .toBeGreaterThan(6);
  });

  test("under prefers-reduced-motion the halo repaints about once a second", async ({
    page,
  }) => {
    await open(page, { effects: [] });
    /** Style writes on a halo around a video whose colour changes 20 times a second, for 3 s. */
    const paints = () =>
      page.evaluate(async () => {
        const { glowApi } = window;
        if (!glowApi) {
          return -1;
        }
        const canvas = document.createElement("canvas");
        canvas.width = 64;
        canvas.height = 36;
        const context = canvas.getContext("2d");
        const video = document.createElement("video");
        video.muted = true;
        video.srcObject = canvas.captureStream(30);
        const host = document.createElement("div");
        host.style.cssText = "position:relative;width:320px;height:180px";
        host.append(video);
        document.body.append(host);
        let tick = 0;
        const timer = setInterval(() => {
          tick += 1;
          if (context) {
            context.fillStyle = `hsl(${(tick * 47) % 360} 90% 50%)`;
            context.fillRect(0, 0, 64, 36);
          }
        }, 50);
        await video.play();
        const stop = glowApi.halo(video, host);
        await new Promise((resolve) => setTimeout(resolve, 500));
        let writes = 0;
        const observer = new MutationObserver((records) => {
          writes += records.length;
        });
        observer.observe(host, { attributes: true, subtree: true });
        await new Promise((resolve) => setTimeout(resolve, 3000));
        observer.disconnect();
        stop();
        clearInterval(timer);
        host.remove();
        return writes;
      });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const normal = await paints();
    await page.emulateMedia({ reducedMotion: "reduce" });
    const calm = await paints();
    expect(normal).toBeGreaterThan(0);
    expect(calm).toBeLessThan(normal / 5);
  });
});
