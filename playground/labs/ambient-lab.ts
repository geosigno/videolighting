import Hls from "hls.js";
import { css } from "../../src/core/colors.js";
import { MUX_URL } from "../compat-cases.js";
import {
  ambient,
  type EdgeColors,
  type Rgb,
  type Watcher,
  watch,
} from "../internal.js";
import "../nav.js";
import "./ambient-lab.css";

/**
 * Throwaway lab: several ways to turn the video's colours into a page
 * background, side by side on one read. Each variant is a function that fills
 * its tile and returns how to stop it.
 */

interface Running {
  /** Mean main-thread ms of one update of this variant, if it measures it. */
  cost?: () => number;
  destroy: () => void;
}

interface Variant {
  id: string;
  mount: (tile: HTMLElement, watcher: Watcher) => Running;
  note: string;
  title: string;
}

const BASE = "#101018";

/** Wraps an update so its main-thread time is averaged. */
function timed<Args extends unknown[]>(update: (...args: Args) => void) {
  let mean = 0;
  return {
    cost: () => mean,
    run: (...args: Args) => {
      const start = performance.now();
      update(...args);
      mean += (performance.now() - start - mean) * 0.05;
    },
  };
}

interface BlobSpec {
  color: string;
  drift: string;
  place: string;
  seconds: number;
  size: string;
}

/** A flat colour under a fixed radial mask that drifts: a colour change repaints a fill, not a gradient. */
function addBlob(tile: HTMLElement, spec: BlobSpec) {
  const dot = document.createElement("div");
  dot.className = "al-blob";
  dot.style.cssText = `${spec.place};width:${spec.size};background-color:var(${spec.color})`;
  tile.append(dot);
  dot.animate(
    [{ transform: "translate(0, 0) scale(1)" }, { transform: spec.drift }],
    {
      direction: "alternate",
      duration: spec.seconds * 1000,
      easing: "ease-in-out",
      iterations: Number.POSITIVE_INFINITY,
    }
  );
}

/** The three smoothed colours into CSS variables on the tile, timed. */
function followColors(tile: HTMLElement, watcher: Watcher) {
  const timer = timed((colors: ReturnType<Watcher["state"]>) => {
    tile.style.setProperty("--p", css(colors.primary));
    tile.style.setProperty("--s", css(colors.secondary));
    tile.style.setProperty("--m", css(colors.mean));
  });
  const stop = watcher.subscribe(timer.run);
  return { cost: timer.cost, destroy: stop };
}

/** Edge colours smoothed one sample at a time (the raw read flickers). */
function smoothedEdges(
  watcher: Watcher,
  onChange: (edges: EdgeColors) => void
) {
  let shown: EdgeColors | undefined;
  const stop = watcher.onSample((edges) => {
    if (shown) {
      // A side can change length (a source of another ratio): follow the new one.
      const mix = (from: Rgb[], to: Rgb[]) =>
        to.map((target, i): Rgb => {
          const c = from[i] ?? target;
          return [
            c[0] + (target[0] - c[0]) * 0.25,
            c[1] + (target[1] - c[1]) * 0.25,
            c[2] + (target[2] - c[2]) * 0.25,
          ];
        });
      shown = {
        bottom: mix(shown.bottom, edges.bottom),
        left: mix(shown.left, edges.left),
        right: mix(shown.right, edges.right),
        top: mix(shown.top, edges.top),
      };
    } else {
      shown = edges;
    }
    onChange(shown);
  });
  return stop;
}

const meanOf = (colors: Rgb[]): Rgb => {
  const sum = colors.reduce<Rgb>(
    (acc, [r, g, b]) => [acc[0] + r, acc[1] + g, acc[2] + b],
    [0, 0, 0]
  );
  const n = Math.max(1, colors.length);
  return [sum[0] / n, sum[1] / n, sum[2] / n];
};

const BLOB_SET = [
  {
    drift: "translate(40%, 25%) scale(1.25)",
    key: "primary",
    place: "left:-20%;top:-30%",
    seconds: 23,
  },
  {
    drift: "translate(-35%, 30%) scale(0.85)",
    key: "secondary",
    place: "right:-25%;top:10%",
    seconds: 29,
  },
  {
    drift: "translate(30%, -35%) scale(1.15)",
    key: "mean",
    place: "left:15%;bottom:-45%",
    seconds: 19,
  },
] as const;

interface BlobMode {
  /** Write each blob's colour on the blob itself, not as a variable inherited from the tile. */
  direct: boolean;
  /** A radial gradient with the colour in it, instead of a flat colour under a fixed mask. */
  gradient: boolean;
  /** `will-change: transform` on the blobs, `contain: paint` on the tile. */
  hints: boolean;
}

/** The current effect's three blobs, with the optimisations to try switched on or off. */
function blobsMount(mode: BlobMode): Variant["mount"] {
  return (tile, watcher) => {
    if (mode.hints) {
      tile.style.contain = "paint";
    }
    const dots = BLOB_SET.map((blob) => {
      const dot = document.createElement("div");
      dot.className = "al-blob";
      dot.style.cssText = `${blob.place};width:85%`;
      if (mode.gradient) {
        dot.style.maskImage = "none";
        if (!mode.direct) {
          dot.style.background = `radial-gradient(closest-side, var(--${blob.key}), transparent)`;
        }
      } else if (!mode.direct) {
        dot.style.backgroundColor = `var(--${blob.key})`;
      }
      if (mode.hints) {
        dot.style.willChange = "transform";
      }
      tile.append(dot);
      dot.animate(
        [{ transform: "translate(0, 0) scale(1)" }, { transform: blob.drift }],
        {
          direction: "alternate",
          duration: blob.seconds * 1000,
          easing: "ease-in-out",
          iterations: Number.POSITIVE_INFINITY,
        }
      );
      return dot;
    });
    const timer = timed((colors: ReturnType<Watcher["state"]>) => {
      BLOB_SET.forEach((blob, i) => {
        const color = css(colors[blob.key]);
        const dot = dots[i];
        if (mode.gradient && mode.direct && dot) {
          dot.style.background = `radial-gradient(closest-side, ${color}, transparent)`;
        } else if (mode.direct && dot) {
          dot.style.backgroundColor = color;
        } else {
          tile.style.setProperty(`--${blob.key}`, color);
        }
      });
    });
    return { cost: timer.cost, destroy: watcher.subscribe(timer.run) };
  };
}

interface MosaicMode {
  blur: number;
  /** Draw the grid as a tiny canvas, scaled up smoothly by the browser, instead of cells. */
  canvas: boolean;
  cols: number;
  hints: boolean;
  /** How far the blurred layer overflows the tile, in %. */
  inset: number;
  rows: number;
}

const at = (colors: Rgb[], t: number): Rgb =>
  colors[Math.round(t * (colors.length - 1))] ?? [0, 0, 0];

/** The colour of the cell at (u, v), both 0 to 1: the four edges blended. */
function cellColor(edges: EdgeColors, u: number, v: number): Rgb {
  const top = at(edges.top, u);
  const bottom = at(edges.bottom, u);
  const left = at(edges.left, v);
  const right = at(edges.right, v);
  const channel = (k: 0 | 1 | 2) =>
    ((1 - v) * top[k] + v * bottom[k] + (1 - u) * left[k] + u * right[k]) / 2;
  return [channel(0), channel(1), channel(2)];
}

function mosaicMount(mode: MosaicMode): Variant["mount"] {
  return (tile, watcher) => {
    const { blur, cols, inset, rows } = mode;
    if (mode.hints) {
      tile.style.contain = "strict";
    }
    const holder = document.createElement("div");
    holder.className = "al-mosaic";
    holder.style.inset = `-${inset}%`;
    holder.style.filter = `blur(${blur}px)`;
    if (mode.hints) {
      holder.style.willChange = "transform";
    }
    tile.append(holder);
    if (mode.canvas) {
      const canvas = document.createElement("canvas");
      canvas.width = cols;
      canvas.height = rows;
      canvas.style.cssText = "width:100%;height:100%;display:block";
      holder.append(canvas);
      const context = canvas.getContext("2d");
      const image = new ImageData(cols, rows);
      const timer = timed((edges: EdgeColors) => {
        for (let index = 0; index < cols * rows; index += 1) {
          const [r, g, b] = cellColor(
            edges,
            (index % cols) / (cols - 1),
            Math.floor(index / cols) / (rows - 1)
          );
          image.data.set([r, g, b, 255], index * 4);
        }
        context?.putImageData(image, 0, 0);
      });
      return { cost: timer.cost, destroy: smoothedEdges(watcher, timer.run) };
    }
    holder.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    holder.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
    const cells = Array.from({ length: cols * rows }, () => {
      const cell = document.createElement("i");
      holder.append(cell);
      return cell;
    });
    const timer = timed((edges: EdgeColors) => {
      cells.forEach((cell, index) => {
        cell.style.backgroundColor = css(
          cellColor(
            edges,
            (index % cols) / (cols - 1),
            Math.floor(index / cols) / (rows - 1)
          )
        );
      });
    });
    return { cost: timer.cost, destroy: smoothedEdges(watcher, timer.run) };
  };
}

const MOSAIC: MosaicMode = {
  blur: 36,
  canvas: false,
  cols: 8,
  hints: false,
  inset: 20,
  rows: 5,
};

const VARIANTS: Variant[] = [
  {
    id: "current",
    mount: (tile) => ({
      destroy: ambient(
        tile.ownerDocument.querySelector("video") as HTMLVideoElement,
        tile
      ),
    }),
    note: "Three blobs drifting (the library's effect today)",
    title: "Current",
  },
  {
    id: "calm",
    mount: (tile, watcher) => {
      addBlob(tile, {
        color: "--p",
        drift: "translate(25%, 15%) scale(1.15)",
        place: "left:-15%;top:-30%",
        seconds: 41,
        size: "110%",
      });
      addBlob(tile, {
        color: "--s",
        drift: "translate(-20%, -15%) scale(0.9)",
        place: "right:-20%;bottom:-45%",
        seconds: 53,
        size: "105%",
      });
      return followColors(tile, watcher);
    },
    note: "Two large blobs, slower: calmer, one colour fewer",
    title: "Two calm blobs",
  },
  {
    id: "sides",
    mount: (tile, watcher) => {
      const sides = ["top", "right", "bottom", "left"] as const;
      const layout = {
        bottom:
          "left:0;right:0;bottom:0;height:60%;mask-image:linear-gradient(to top,#000,transparent)",
        left: "left:0;top:0;bottom:0;width:60%;mask-image:linear-gradient(to right,#000,transparent)",
        right:
          "right:0;top:0;bottom:0;width:60%;mask-image:linear-gradient(to left,#000,transparent)",
        top: "left:0;right:0;top:0;height:60%;mask-image:linear-gradient(to bottom,#000,transparent)",
      };
      const layers = sides.map((side) => {
        const el = document.createElement("div");
        el.className = "al-side";
        el.style.cssText = layout[side];
        tile.append(el);
        return el;
      });
      const timer = timed((edges: EdgeColors) => {
        sides.forEach((side, i) => {
          const el = layers[i];
          if (el) {
            el.style.backgroundColor = css(meanOf(edges[side]));
          }
        });
      });
      return { cost: timer.cost, destroy: smoothedEdges(watcher, timer.run) };
    },
    note: "The colour of each side fades inwards: where the colour comes from stays where it comes from",
    title: "Sides",
  },
  {
    id: "sides-drift",
    mount: (tile, watcher) => {
      const spots = [
        { place: "left:15%;top:-50%", side: "top" },
        { place: "right:-45%;top:5%", side: "right" },
        { place: "left:15%;bottom:-50%", side: "bottom" },
        { place: "left:-45%;top:5%", side: "left" },
      ] as const;
      spots.forEach((spot, i) => {
        addBlob(tile, {
          color: `--${spot.side}`,
          drift:
            i % 2
              ? "translate(-12%, 14%) scale(1.1)"
              : "translate(14%, -12%) scale(0.95)",
          place: spot.place,
          seconds: 17 + i * 5,
          size: "75%",
        });
      });
      const timer = timed((edges: EdgeColors) => {
        for (const spot of spots) {
          tile.style.setProperty(
            `--${spot.side}`,
            css(meanOf(edges[spot.side]))
          );
        }
      });
      return { cost: timer.cost, destroy: smoothedEdges(watcher, timer.run) };
    },
    note: "One blob per side, in that side's colour, drifting a little",
    title: "Sides + drift",
  },
  {
    id: "mosaic",
    mount: mosaicMount(MOSAIC),
    note: "A grid of 8 x 5 cells blended from the four edges, then blurred: a soft picture of the surroundings",
    title: "Blurred mosaic",
  },
  {
    id: "gradient",
    mount: (tile, watcher) => {
      const layer = document.createElement("div");
      layer.className = "al-drift";
      layer.style.background =
        "linear-gradient(115deg, var(--p), var(--m), var(--s))";
      tile.append(layer);
      layer.animate(
        [
          { transform: "translate(-8%, -6%)" },
          { transform: "translate(8%, 6%)" },
        ],
        {
          direction: "alternate",
          duration: 37_000,
          easing: "ease-in-out",
          iterations: Number.POSITIVE_INFINITY,
        }
      );
      return followColors(tile, watcher);
    },
    note: "One oversized gradient sliding slowly: the cheapest shape, but each colour change repaints a gradient",
    title: "Sliding gradient",
  },
];

/** Only with `?opt`: the optimisations to measure, one switched on at a time. */
const OPT_VARIANTS: Variant[] = [
  {
    id: "blobs-ctrl",
    mount: blobsMount({ direct: false, gradient: false, hints: false }),
    note: "control: the library's blobs, rebuilt here",
    title: "Blobs control",
  },
  {
    id: "blobs-direct",
    mount: blobsMount({ direct: true, gradient: false, hints: false }),
    note: "colour written on each blob, no inherited variable",
    title: "Blobs direct",
  },
  {
    id: "blobs-hints",
    mount: blobsMount({ direct: false, gradient: false, hints: true }),
    note: "will-change + contain",
    title: "Blobs hints",
  },
  {
    id: "blobs-direct-hints",
    mount: blobsMount({ direct: true, gradient: false, hints: true }),
    note: "direct + hints",
    title: "Blobs direct + hints",
  },
  {
    id: "blobs-gradient-vars",
    mount: blobsMount({ direct: false, gradient: true, hints: false }),
    note: "gradient with the colour taken from the tile variable: the library's variables stay",
    title: "Blobs gradient (variables kept)",
  },
  {
    id: "blobs-gradient",
    mount: blobsMount({ direct: true, gradient: true, hints: false }),
    note: "gradient with the colour, no mask",
    title: "Blobs gradient",
  },
  {
    id: "mosaic-c8-32",
    mount: mosaicMount({ ...MOSAIC, blur: 32, canvas: true, inset: 18 }),
    note: "8 x 5 canvas scaled up smoothly, blur 32",
    title: "Mosaic 8x5 canvas, blur 32",
  },
  {
    id: "mosaic-hints",
    mount: mosaicMount({ ...MOSAIC, hints: true }),
    note: "will-change + contain strict",
    title: "Mosaic hints",
  },
  {
    id: "mosaic-less",
    mount: mosaicMount({ ...MOSAIC, blur: 22, cols: 6, inset: 12, rows: 4 }),
    note: "6 x 4, blur 22, overflow 12 %",
    title: "Mosaic lighter",
  },
  {
    id: "mosaic-canvas",
    mount: mosaicMount({
      ...MOSAIC,
      blur: 10,
      canvas: true,
      cols: 16,
      inset: 8,
      rows: 9,
    }),
    note: "16 x 9 canvas scaled up smoothly, blur 10",
    title: "Mosaic canvas",
  },
  {
    id: "mosaic-canvas-hints",
    mount: mosaicMount({
      ...MOSAIC,
      blur: 10,
      canvas: true,
      cols: 16,
      hints: true,
      inset: 8,
      rows: 9,
    }),
    note: "canvas + hints",
    title: "Mosaic canvas + hints",
  },
];
OPT_VARIANTS.push(
  {
    id: "mosaic-c8-16",
    mount: mosaicMount({ ...MOSAIC, blur: 16, canvas: true, inset: 10 }),
    note: "8 x 5 canvas scaled up smoothly, blur 16",
    title: "Mosaic 8x5 canvas, blur 16",
  },
  {
    id: "mosaic-c8-24",
    mount: mosaicMount({ ...MOSAIC, blur: 24, canvas: true, inset: 14 }),
    note: "8 x 5 canvas scaled up smoothly, blur 24",
    title: "Mosaic 8x5 canvas, blur 24",
  }
);
const COMPARE_PAIRS = [
  [
    "blobs-ctrl",
    "D2 · Actuel : taches avec masque",
    "A flat colour under a fixed radial mask",
  ],
  [
    "blobs-gradient-vars",
    "D2 · Proposé : taches en dégradé radial",
    "Same shape in one gradient: about 41 % less GPU",
  ],
  [
    "mosaic",
    "D3 · Version de la page d'essai : 40 cellules, flou 36 px",
    "The mosaic you saw and liked",
  ],
  [
    "mosaic-c8-24",
    "D3 · Proposé : canvas 8 x 5, flou 24 px",
    "Main thread -52 %, GPU -68 % in the measures",
  ],
  [
    "mosaic-c8-32",
    "D3 · Variante plus floue : canvas 8 x 5, flou 32 px",
    "Softer, closer to the 40-cell version; a little more GPU",
  ],
] as const;
const everyVariant = [...VARIANTS, ...OPT_VARIANTS];
const compare = location.search.includes("compare");
document.body.classList.toggle("al-compare", compare);
function pickVariants(): Variant[] {
  if (compare) {
    return COMPARE_PAIRS.flatMap(([id, title, note]) => {
      const found = everyVariant.find((variant) => variant.id === id);
      return found ? [{ ...found, note, title }] : [];
    });
  }
  return location.search.includes("opt") ? everyVariant : VARIANTS;
}
const ACTIVE = pickVariants();

// ---- the page ----

const video = document.querySelector<HTMLVideoElement>("#video");
const grid = document.querySelector<HTMLElement>("#grid");
const sourceSelect = document.querySelector<HTMLSelectElement>("#source");
const soloSelect = document.querySelector<HTMLSelectElement>("#solo");

if (video && grid && sourceSelect && soloSelect) {
  soloSelect.append(new Option("all variants", "all"));
  soloSelect.append(new Option("none (video only)", "none"));
  for (const variant of ACTIVE) {
    soloSelect.append(new Option(variant.title, variant.id));
  }

  let hls: Hls | undefined;
  const load = (source: string) => {
    hls?.destroy();
    hls = undefined;
    if (source === "mux" && Hls.isSupported()) {
      hls = new Hls();
      hls.loadSource(MUX_URL);
      hls.attachMedia(video);
    } else {
      video.src = source === "mux" ? MUX_URL : source;
    }
    video.play().catch(() => undefined);
  };
  sourceSelect.addEventListener("change", () => load(sourceSelect.value));
  load(sourceSelect.value);

  const watcher = watch(video, {
    onError: (error) => {
      console.error("The video cannot be read:", error);
    },
  });

  let running: { label: HTMLOutputElement; run: Running; tile: HTMLElement }[] =
    [];
  const show = (only: string) => {
    for (const item of running) {
      item.run.destroy();
    }
    running = [];
    grid.replaceChildren();
    document.body.classList.toggle("al-solo", only !== "all");
    for (const variant of ACTIVE) {
      if (only !== "all" && variant.id !== only) {
        continue;
      }
      const item = document.createElement("figure");
      item.className = "al-item";
      const tile = document.createElement("div");
      tile.className = "al-tile";
      tile.style.background = BASE;
      const label = document.createElement("figcaption");
      label.className = "al-label";
      const output = document.createElement("output");
      label.innerHTML = `<div><b>${variant.title}</b><br><span>${variant.note}</span></div>`;
      label.append(output);
      item.append(tile, label);
      grid.append(item);
      const run = variant.mount(tile, watcher);
      running.push({ label: output, run, tile });
    }
  };
  soloSelect.addEventListener("change", () => show(soloSelect.value));
  const freeze = document.querySelector<HTMLInputElement>("#freeze");
  freeze?.addEventListener("change", () => {
    for (const animation of document.getAnimations()) {
      if (freeze.checked) {
        animation.pause();
      } else {
        animation.play();
      }
    }
  });
  show("all");

  setInterval(() => {
    for (const item of running) {
      const ms = item.run.cost?.();
      item.label.textContent =
        ms === undefined ? "library effect" : `${ms.toFixed(3)} ms / update`;
    }
  }, 500);
}
