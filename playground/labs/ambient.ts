import { css } from "./colors.js";
import type { Colors, LabContext } from "./core.js";

/**
 * Apple Music style background: three soft blobs drifting slowly, in the
 * video's own colors (dominant, second dominant, mean) over a neutral dark
 * base. The colors come from the shared core: nothing is changed here.
 */

export interface AmbientSurface {
  apply: (colors: Colors) => void;
  destroy: () => void;
}

export function createAmbientSurface(host: HTMLElement): AmbientSurface {
  const layer = document.createElement("div");
  layer.className = "ambient-blobs";
  layer.innerHTML = "<i></i><i></i><i></i>";
  host.prepend(layer);
  return {
    apply: ({ mean, primary, secondary }) => {
      layer.style.setProperty("--c1", css(primary));
      layer.style.setProperty("--c2", css(secondary));
      layer.style.setProperty("--c3", css(mean));
    },
    destroy: () => layer.remove(),
  };
}

const MARKUP = `
  <canvas width="320" height="180"></canvas>
  <div>
    <b>Now playing</b>
    <span>Live from the video</span>
    <label class="react">Reactivity <input type="range" min="0.03" max="1.5" step="0.01" aria-label="Reactivity"> <output></output></label>
  </div>`;

/** The ambient surface driven by the shared core, plus a small live "now playing" card. */
export function mountAmbient(
  host: HTMLElement,
  { bus, core, video }: LabContext,
  options: { card?: boolean } = {}
): () => void {
  host.classList.add("ambient");
  const surface = createAmbientSurface(host);
  let canvas: HTMLCanvasElement | undefined;
  if (options.card !== false) {
    const card = document.createElement("div");
    card.className = "ambient-card";
    card.innerHTML = MARKUP;
    host.append(card);
    canvas = card.querySelector("canvas") ?? undefined;
    const slider = card.querySelector<HTMLInputElement>(".react input");
    const output = card.querySelector<HTMLElement>(".react output");
    if (slider) {
      // Time constant of the shared smoothing: it moves the components too.
      slider.value = String(core.settings.tau);
      const show = () => {
        if (output) {
          output.textContent = `${Math.round(core.settings.tau * 1000)} ms`;
        }
      };
      slider.addEventListener("input", () => {
        core.settings.tau = Number(slider.value);
        show();
      });
      show();
    }
  }
  const context = canvas?.getContext("2d");
  const offCore = core.subscribe(surface.apply);
  const offBus = bus.subscribe(() => {
    if (canvas && context && video.readyState >= 2) {
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
    }
  });
  return () => {
    offCore();
    offBus();
    surface.destroy();
    host.classList.remove("ambient");
    host.querySelector(".ambient-card")?.remove();
  };
}
