import Hls from "hls.js";
import { createGlowWith, type Glow } from "../../src/core/glow.js";
import { createLayer } from "../../src/core/layer.js";
import type { EdgeColors } from "../../src/core/sample.js";
import { MUX_URL } from "../compat-cases.js";
import { watchVideo } from "../internal.js";
import "./labs.css";

/**
 * Halo blur lab: the two drawings of the halo side by side, on the same edge
 * colors, with sliders for the blurred one. Also what
 * `scripts/render-cost.mjs --path /labs/halo-blur.html` measures.
 */

interface Settings {
  blur: number;
  opacity: number;
  spread: number;
}

/** The bands that fade, as `variant: "vibrant"` draws them (colors not pushed here). */
function faded(host: HTMLElement): Glow {
  return createGlowWith(host, {});
}

/** The blurred glow of `variant: "natural"`, tuned by the sliders. */
function blurred(host: HTMLElement, settings: Settings): Glow {
  const glow = createGlowWith(host, {
    blur: `${settings.blur}px`,
    masks: false,
  });
  glow.element.style.setProperty("--vl-reach", `${settings.spread}px`);
  glow.element.style.setProperty("--vl-opacity", String(settings.opacity));
  return glow;
}

/**
 * `?only=none,natural` keeps those cells, `?src=/mire.mp4` picks the video,
 * `?blur=`, `?spread=`, `?opacity=` set the sliders and `?width=` the player's
 * width in px: what `scripts/render-cost.mjs` opens, one variant per page.
 */
const params = new URLSearchParams(location.search);
const only = params.get("only")?.split(",");

/** Shown without `?only=`. */
const SHOWN = ["vibrant", "natural"];

const ALL = [
  {
    // Measured only (`?only=none`): the page with no halo at all.
    create: (host: HTMLElement): Glow => ({
      ...createLayer(host),
      update: () => undefined,
    }),
    id: "none",
    name: "No halo",
    note: "The page's own cost: the video and its copy, nothing around.",
  },
  {
    create: faded,
    id: "vibrant",
    name: "Halo, vibrant",
    note: "Bands that fade with the distance: fade masks, no filter. The sliders do not touch it, and the colors are not pushed here.",
  },
  {
    create: blurred,
    id: "natural",
    name: "Halo, natural",
    note: "The same bands and corners in plain color, masks off, one blur for the whole layer. Spread is how far the color goes before the blur.",
  },
];
const VARIANTS = ALL.filter((variant) => (only ?? SHOWN).includes(variant.id));

for (const id of ["blur", "spread", "opacity"]) {
  const field = document.querySelector<HTMLInputElement>(`#${id}`);
  const value = params.get(id);
  if (field && value) {
    field.value = value;
  }
}

const video = document.querySelector<HTMLVideoElement>("#video");
const grid = document.querySelector<HTMLElement>("#grid");
if (!(video && grid)) {
  throw new Error("page markup missing");
}

const input = (id: string) => document.querySelector<HTMLInputElement>(id);
function readSettings(): Settings {
  return {
    blur: Number(input("#blur")?.value),
    opacity: Number(input("#opacity")?.value),
    spread: Number(input("#spread")?.value),
  };
}

const cells = VARIANTS.map((variant) => {
  const section = document.createElement("section");
  section.className = "halo-cell";
  section.innerHTML = `<header><h2></h2><p></p></header><div class="halo-stage"><div class="halo-host"><canvas width="1280" height="720"></canvas></div></div>`;
  const title = section.querySelector("h2");
  const note = section.querySelector("p");
  if (title) {
    title.textContent = variant.name;
  }
  if (note) {
    note.textContent = variant.note;
  }
  grid.append(section);
  const host = section.querySelector<HTMLElement>(".halo-host");
  const canvas = section.querySelector<HTMLCanvasElement>("canvas");
  if (!(host && canvas)) {
    throw new Error("cell markup missing");
  }
  const width = params.get("width");
  if (width) {
    host.style.width = `${width}px`;
  }
  return {
    canvas,
    drawing: variant.create(host, readSettings()),
    host,
    variant,
  };
});

let latest: EdgeColors | undefined;

/** The blur is fixed when a drawing is built: rebuild them all on a slider move. */
function rebuild() {
  const now = readSettings();
  for (const cell of cells) {
    cell.drawing.destroy();
    cell.drawing = cell.variant.create(cell.host, now);
    if (latest) {
      cell.drawing.update(latest);
    }
  }
  for (const [id, value] of Object.entries(now)) {
    const out = document.querySelector(`#${id}-out`);
    if (out) {
      out.textContent = String(value);
    }
  }
}
for (const id of ["#blur", "#spread", "#opacity"]) {
  input(id)?.addEventListener("input", rebuild);
}
rebuild();

let hls: Hls | undefined;
function load(src: string) {
  hls?.destroy();
  hls = undefined;
  video?.removeAttribute("src");
  if (src === "mux" && Hls.isSupported()) {
    hls = new Hls();
    hls.loadSource(MUX_URL);
    if (video) {
      hls.attachMedia(video);
    }
  } else if (video) {
    video.src = src === "mux" ? MUX_URL : src;
  }
  video?.play().catch(() => undefined);
}
document.querySelector("#source")?.addEventListener("change", (event) => {
  load((event.target as HTMLSelectElement).value);
});
// The clips live at the root of the playground, whatever page asks for them.
const asked = params.get("src") ?? "mux";
load(asked === "mux" || asked.startsWith("/") ? asked : `/${asked}`);

let ready: () => void = () => undefined;
const firstColors = new Promise<void>((resolve) => {
  ready = resolve;
});
Object.assign(window, { glowPage: { ready: () => firstColors } });

watchVideo(video, {
  onColors: (colors) => {
    ready();
    latest = colors;
    for (const { canvas, drawing } of cells) {
      drawing.update(colors);
      canvas
        .getContext("2d")
        ?.drawImage(video, 0, 0, canvas.width, canvas.height);
    }
  },
});
