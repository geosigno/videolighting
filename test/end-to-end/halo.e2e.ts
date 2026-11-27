import { expect, test } from "@playwright/test";
import { open, stopAndKeepHost, stops } from "./helpers.js";

/** The halo on the reference page: color bands around the video. */
test.describe("halo", () => {
  test("shows the edge color unchanged", async ({ page }) => {
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

  test("corners follow the rounded shape the eye sees", async ({ page }) => {
    await open(page, { effects: [] });
    const found = await page.evaluate(async () => {
      // The video, the two elements around it, and the halo's element above them.
      const video = document.querySelector<HTMLVideoElement>(
        '[data-testid="video"]'
      );
      const wrapper = video?.parentElement;
      const outer = wrapper?.parentElement;
      const host = outer?.parentElement;
      const api = window.glowApi;
      if (!(video && wrapper && outer && host && api)) {
        return;
      }
      const shape = (
        element: HTMLElement,
        overflow: string,
        radius: string
      ) => {
        element.style.overflow = overflow;
        element.style.borderRadius = radius;
      };
      /** Start a halo and let it measure: the radii come with the first resize observation. */
      const start = async () => {
        const stop = api.halo(video, host);
        await new Promise((done) =>
          requestAnimationFrame(() => requestAnimationFrame(done))
        );
        return stop;
      };
      /** The four radii the halo measured, then where its top band starts and ends. */
      const read = () => {
        const layer = host.querySelector<HTMLElement>('[data-vl="halo"]');
        const top = layer?.children[0]?.getBoundingClientRect();
        const box = layer?.getBoundingClientRect();
        return [
          ...["top-left", "top-right", "bottom-right", "bottom-left"].map(
            (corner) => layer?.style.getPropertyValue(`--vl-radius-${corner}`)
          ),
          Math.round((top?.left ?? 0) - (box?.left ?? 0)),
          Math.round((box?.right ?? 0) - (top?.right ?? 0)),
        ].join(" ");
      };
      const once = async () => {
        const stop = await start();
        const seen = read();
        stop();
        return seen;
      };

      shape(outer, "visible", "0px");
      shape(wrapper, "hidden", "0px");
      shape(video, "", "24px");
      const roundedVideo = await once();
      shape(video, "", "0px");
      shape(wrapper, "hidden", "32px");
      const roundedWrapper = await once();
      shape(wrapper, "hidden", "0px");
      const squareWrapper = await once();
      // A player's own square clip inside a rounded card: the card shows.
      shape(outer, "hidden", "32px");
      const squareInRounded = await once();
      shape(outer, "visible", "0px");
      shape(wrapper, "visible", "32px");
      const notClipped = await once();
      // 10% of 480 x 270 is an ellipse of 48 x 27: its smaller radius counts.
      shape(wrapper, "hidden", "10% 8px 0px 16px");
      const eachCorner = await once();

      shape(wrapper, "hidden", "32px");
      wrapper.style.transition = "border-radius 50ms";
      const stop = await start();
      const ended = new Promise((done) =>
        wrapper.addEventListener("transitionend", done, { once: true })
      );
      wrapper.style.borderRadius = "100px";
      await ended;
      const transitioned = read();
      stop();
      return {
        eachCorner,
        notClipped,
        roundedVideo,
        roundedWrapper,
        squareInRounded,
        squareWrapper,
        transitioned,
      };
    });
    expect(found).toEqual({
      eachCorner: "27px 8px 0px 16px 27 8",
      notClipped: "0px 0px 0px 0px 0 0",
      roundedVideo: "24px 24px 24px 24px 24 24",
      roundedWrapper: "32px 32px 32px 32px 32 32",
      squareInRounded: "32px 32px 32px 32px 32 32",
      squareWrapper: "0px 0px 0px 0px 0 0",
      transitioned: "100px 100px 100px 100px 100 100",
    });
  });

  test("layer is added and removed", async ({ page }) => {
    await open(page, { effects: ["halo"] });
    await expect(page.locator('[data-vl="halo"]')).toHaveCount(1);
    await stopAndKeepHost(page, "halo");
  });
});
