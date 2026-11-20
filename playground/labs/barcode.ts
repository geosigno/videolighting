import type { Bus } from "./bus.js";
import { css, mean } from "./colors.js";

/**
 * A progress bar that paints itself with the colours of the movie as it plays:
 * the upper half from the top edge, the lower half from the bottom edge. Click
 * to seek.
 */
export function mountBarcode(
  host: HTMLElement,
  { bus, video }: { bus: Bus; video: HTMLVideoElement }
): () => void {
  host.classList.add("barcode");
  host.innerHTML =
    '<canvas width="1200" height="56"></canvas><i class="head"></i><p>Fills in as the video plays. Seek ahead and the gap stays empty.</p>';
  const canvas = host.querySelector<HTMLCanvasElement>("canvas");
  const head = host.querySelector<HTMLElement>(".head");
  const context = canvas?.getContext("2d");
  let lastX = -1;

  const clear = () => {
    if (canvas && context) {
      context.clearRect(0, 0, canvas.width, canvas.height);
    }
    lastX = -1;
  };
  video.addEventListener("emptied", clear);
  video.addEventListener("loadedmetadata", clear);

  const seek = (event: MouseEvent) => {
    if (canvas && Number.isFinite(video.duration)) {
      const box = canvas.getBoundingClientRect();
      video.currentTime =
        ((event.clientX - box.left) / box.width) * video.duration;
    }
  };
  canvas?.addEventListener("click", seek);

  const off = bus.subscribe((tick) => {
    if (!(canvas && context && Number.isFinite(video.duration))) {
      return;
    }
    const x = Math.floor((tick.time / video.duration) * canvas.width);
    const from = lastX >= 0 && x - lastX < 40 ? lastX : x;
    context.fillStyle = css(mean(tick.colors.top));
    context.fillRect(from, 0, x - from + 2, canvas.height / 2);
    context.fillStyle = css(mean(tick.colors.bottom));
    context.fillRect(from, canvas.height / 2, x - from + 2, canvas.height / 2);
    lastX = x;
    if (head) {
      head.style.left = `${(tick.time / video.duration) * 100}%`;
    }
  });
  return () => {
    off();
    video.removeEventListener("emptied", clear);
    video.removeEventListener("loadedmetadata", clear);
    canvas?.removeEventListener("click", seek);
    host.classList.remove("barcode");
    host.innerHTML = "";
  };
}
