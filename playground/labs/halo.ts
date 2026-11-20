import Hls from "hls.js";
import { createGlowWith, type Glow } from "../../src/core/glow.js";
import { MUX_URL } from "../compat-cases.js";
import { watchVideo } from "../internal.js";
import "./labs.css";

/**
 * Halo lab: the glow's fade-out, compared. Everything is drawn by the library's
 * own `createGlowWith`; only the fade curve, its reach and its stops change.
 */

type Curve = (distance: number) => number;

interface Variant {
  curve: Curve;
  name: string;
  note: string;
  reach: number;
  steps: number;
  /** Multiplies the "strength at the edge" slider (default 1). */
  strength?: number;
}

const gauss =
  (k: number): Curve =>
  (d) =>
    (Math.exp(-k * d * d) - Math.exp(-k)) / (1 - Math.exp(-k));
const cosine =
  (power: number): Curve =>
  (d) =>
    ((1 + Math.cos(Math.PI * Math.min(1, Math.max(0, d)))) / 2) ** power;

const VARIANTS: Variant[] = [
  {
    curve: (d) => (1 - Math.min(1, Math.max(0, d))) ** 2.5,
    name: "A. Current",
    note: "(1 - d)^2.5, 140 px, 10 stops. Half the strength is gone at 34 px.",
    reach: 140,
    steps: 10,
  },
  {
    curve: (d) => (1 - Math.min(1, Math.max(0, d))) ** 2.5,
    name: "A2. Current, less opacity",
    note: "Exactly A, at 60 % of the strength: the step between glow and void is smaller, nothing else changes.",
    reach: 140,
    steps: 10,
    strength: 0.6,
  },
  {
    curve: (d) => (1 - Math.min(1, Math.max(0, d))) ** 2.5,
    name: "B. Current, wider",
    note: "Same curve spread over 220 px, 20 stops. Only the reach changes.",
    reach: 220,
    steps: 20,
  },
  {
    curve: gauss(3.5),
    name: "C. Gaussian",
    note: "Plateau near the edge, then a long soft slope, like a real blur. 220 px, 24 stops.",
    reach: 220,
    steps: 24,
  },
  {
    curve: cosine(1.3),
    name: "D. Cosine",
    note: "Soft at both ends (no kink where it meets the video or the void). 240 px, 24 stops.",
    reach: 240,
    steps: 24,
  },
];

const video = document.querySelector<HTMLVideoElement>("#video");
const grid = document.querySelector<HTMLElement>("#grid");
if (!(video && grid)) {
  throw new Error("page markup missing");
}

interface Cell {
  canvas: HTMLCanvasElement;
  glow: Glow;
  host: HTMLElement;
  variant: Variant;
}

const cells: Cell[] = VARIANTS.map((variant) => {
  const section = document.createElement("section");
  section.className = "halo-cell";
  section.innerHTML = `<header><h2></h2><p></p></header><div class="halo-stage"><div class="halo-host"><canvas width="320" height="180"></canvas></div></div>`;
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
  const glow = createGlowWith(host, {
    curve: variant.curve,
    steps: variant.steps,
  });
  return { canvas, glow, host, variant };
});

const reach = document.querySelector<HTMLInputElement>("#reach");
const opacity = document.querySelector<HTMLInputElement>("#opacity");
function applySliders() {
  const factor = Number(reach?.value ?? 1);
  const strength = Number(opacity?.value ?? 0.85);
  for (const { host, variant } of cells) {
    host.style.setProperty("--vl-reach", `${variant.reach * factor}px`);
    host.style.setProperty(
      "--vl-opacity",
      String(strength * (variant.strength ?? 1))
    );
  }
  const reachOut = document.querySelector("#reach-out");
  const opacityOut = document.querySelector("#opacity-out");
  if (reachOut) {
    reachOut.textContent = factor.toFixed(2);
  }
  if (opacityOut) {
    opacityOut.textContent = strength.toFixed(2);
  }
}
reach?.addEventListener("input", applySliders);
opacity?.addEventListener("input", applySliders);
applySliders();

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
load("mux");

watchVideo(video, {
  onColors: (colors) => {
    for (const { canvas, glow } of cells) {
      glow.update(colors);
      canvas
        .getContext("2d")
        ?.drawImage(video, 0, 0, canvas.width, canvas.height);
    }
  },
});
