import "../nav.js";
import Hls from "hls.js";
import { MUX_URL } from "../compat-cases.js";
import { mountAmbient } from "./ambient.js";
import { mountBarcode } from "./barcode.js";
import { createBus } from "./bus.js";
import { createColorCore, type LabContext } from "./core.js";
import { mountLetterbox } from "./letterbox.js";
import { mountLights } from "./lights.js";
import { mountSafety } from "./safety.js";
import { mountScenes } from "./scenes.js";
import { mountTheme } from "./theme.js";
import "./labs.css";

/**
 * Glow labs: throwaway proofs of concept. Each lab gets the video and a bus of
 * colours from the library, and draws something with them.
 */

function byId<T extends HTMLElement>(id: string): T {
  const element = document.querySelector<HTMLElement>(`#${id}`);
  if (!element) {
    throw new Error(`#${id} missing`);
  }
  return element as T;
}

const video = byId<HTMLVideoElement>("video");
const bus = createBus(video);
const core = createColorCore(bus);
const context: LabContext = { bus, core, video };

interface Lab {
  blurb: string;
  mount: (host: HTMLElement, ctx: LabContext) => () => void;
  title: string;
  wide?: boolean;
}

const LABS: Lab[] = [
  {
    blurb:
      "Two dominant colours become slow drifting blobs, like Apple Music. Colours fade in CSS (@property), updated 4 times a second.",
    mount: (host, ctx) => mountAmbient(host, ctx),
    title: "Animated background",
  },
  {
    blurb:
      "--video-primary / --video-secondary on any container. Text stays white: the colour is capped (darkened) until white on it reaches the contrast you pick. Smoothed, since a theme that blinked 25 times a second would be unusable.",
    mount: mountTheme,
    title: "Components that follow the video",
  },
  {
    blurb:
      "A 16:9 video in a tall box: the bars take the colours of its edges instead of black.",
    mount: mountLetterbox,
    title: "Letterbox fill",
  },
  {
    blurb:
      "A progress bar painted with the colours of the movie as it plays. Click to seek.",
    mount: mountBarcode,
    title: "Colour barcode",
    wide: true,
  },
  {
    blurb:
      "Cuts found from the colours alone; cuts at least 5 s apart become chapter suggestions.",
    mount: mountScenes,
    title: "Scene cuts",
  },
  {
    blurb:
      "The edge colours as data for a WLED strip and Hue lamps, sent at 10 Hz. Simulated, no network.",
    mount: mountLights,
    title: "Lights",
  },
  {
    blurb:
      "A glow that mirrors a strobing scene flashes too. A slowed copy keeps under 3 flashes a second.",
    mount: mountSafety,
    title: "Flash safety",
  },
];

const labs = byId("labs");
for (const lab of LABS) {
  const section = document.createElement("section");
  section.className = lab.wide ? "lab wide" : "lab";
  section.innerHTML = `<header><h2></h2><p></p></header><div class="slot"></div>`;
  const title = section.querySelector("h2");
  const blurb = section.querySelector("p");
  if (title) {
    title.textContent = lab.title;
  }
  if (blurb) {
    blurb.textContent = lab.blurb;
  }
  labs.append(section);
  const slot = section.querySelector<HTMLElement>(".slot");
  if (slot) {
    lab.mount(slot, context);
  }
}

// Whole-page background, mounted on a fixed layer behind everything.
let removePage: (() => void) | undefined;
byId<HTMLInputElement>("page-ambient").addEventListener("change", (event) => {
  removePage?.();
  removePage = undefined;
  if ((event.target as HTMLInputElement).checked) {
    const layer = document.createElement("div");
    layer.className = "page-ambient";
    document.body.prepend(layer);
    const off = mountAmbient(layer, context, { card: false });
    removePage = () => {
      off();
      layer.remove();
    };
  }
});

let hls: Hls | undefined;
function load(src: string) {
  hls?.destroy();
  hls = undefined;
  video.removeAttribute("crossorigin");
  video.removeAttribute("src");
  if (src === "mux") {
    if (Hls.isSupported()) {
      hls = new Hls();
      hls.loadSource(MUX_URL);
      hls.attachMedia(video);
    } else {
      video.crossOrigin = "anonymous";
      video.src = MUX_URL;
    }
  } else {
    video.src = src;
  }
  video.play().catch(() => undefined);
}

byId<HTMLSelectElement>("source").addEventListener("change", (event) => {
  load((event.target as HTMLSelectElement).value);
});
byId<HTMLInputElement>("file").addEventListener("change", (event) => {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (file) {
    load(URL.createObjectURL(file));
  }
});

load("mux");
bus.start();
