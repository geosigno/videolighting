import type { Bus } from "./bus.js";
import { css, flat, mmss } from "./colors.js";

/**
 * Cuts detected from the colors alone: how far the edge colors jump between
 * two sampled frames, against what is usual for this video.
 */
export function mountScenes(
  host: HTMLElement,
  { bus, video }: { bus: Bus; video: HTMLVideoElement }
): () => void {
  host.classList.add("scenes");
  host.innerHTML =
    '<div class="meter"><i></i></div><p class="count">0 cuts</p><ol class="cuts"></ol>';
  const meter = host.querySelector<HTMLElement>(".meter i");
  const count = host.querySelector<HTMLElement>(".count");
  const list = host.querySelector<HTMLElement>(".cuts");
  let previous: number[] | undefined;
  let usual = 4;
  let lastCut = Number.NEGATIVE_INFINITY;
  let lastChapter = Number.NEGATIVE_INFINITY;
  let cuts = 0;

  const reset = () => {
    previous = undefined;
  };
  video.addEventListener("seeking", reset);

  const off = bus.subscribe((tick) => {
    const now = flat(tick.colors).flat();
    if (previous && previous.length === now.length) {
      let jump = 0;
      for (const [i, value] of now.entries()) {
        jump += Math.abs(value - (previous[i] ?? 0));
      }
      jump /= now.length;
      const isCut = jump > Math.max(18, usual * 6) && tick.time - lastCut > 0.4;
      usual += (jump - usual) * 0.02;
      if (meter) {
        meter.style.width = `${Math.min(100, jump * 2)}%`;
      }
      if (isCut) {
        lastCut = tick.time;
        cuts += 1;
        const chapter = tick.time - lastChapter >= 5;
        if (chapter) {
          lastChapter = tick.time;
        }
        const item = document.createElement("li");
        item.className = chapter ? "chapter" : "";
        item.innerHTML = `<i style="background:${css(tick.palette[0] ?? [0, 0, 0])}"></i>${mmss(tick.time)}<span>${chapter ? "chapter" : "cut"}</span>`;
        list?.prepend(item);
        while ((list?.children.length ?? 0) > 8) {
          list?.lastElementChild?.remove();
        }
        if (count) {
          count.textContent = `${cuts} cuts`;
        }
      }
    }
    previous = now;
  });
  return () => {
    off();
    video.removeEventListener("seeking", reset);
    host.classList.remove("scenes");
    host.innerHTML = "";
  };
}
