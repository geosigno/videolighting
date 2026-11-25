import "./nav.js";
import { createGlowWith, type Glow } from "../src/core/glow.js";
import { copyText } from "./copy.js";
import { EDGE_POINTS, type EdgeColors, watchVideo } from "./internal.js";
import { createLegacyGlow } from "./legacy-glow.js";
import { createSingleMaskGlow } from "./single-mask-glow.js";

interface Variant {
  create: (host: HTMLElement) => Glow;
  id: string;
  label: string;
  /** Part of the measured set (the others are only there to look at). */
  perf?: boolean;
}

interface Sample {
  fps: number;
  p95: number;
  updateMs: number;
}

/** Glow with some CSS properties set on its layer. */
function withLayerStyle(
  properties: Partial<Record<"contain" | "willChange", string>>
) {
  return (host: HTMLElement): Glow => {
    const glow = createGlowWith(host, {});
    Object.assign(glow.element.style, properties);
    return glow;
  };
}

const VARIANTS: Variant[] = [
  {
    create: createLegacyGlow,
    id: "legacy",
    label: "Avant : 4 bandes floutées 60px + saturate + opacité de groupe",
    perf: true,
  },
  {
    create: (host) => createGlowWith(host, {}),
    id: "falloff",
    label: "Nouveau : décroissance (exposant 2,5), sans flou",
    perf: true,
  },
  {
    create: (host) => createSingleMaskGlow(host),
    id: "single",
    label:
      "Test : 1 seul élément, 1 masque (2 couches intersect), coins carrés",
    perf: true,
  },
  {
    create: (host) => createGlowWith(host, { masks: false }),
    id: "falloff-nomask",
    label: "Nouveau sans masques (mesure le coût des masques)",
    perf: true,
  },
  {
    create: (host) => createGlowWith(host, { corners: false }),
    id: "falloff-nocorners",
    label: "Nouveau sans coins (mesure le coût des 4 taches radiales)",
    perf: true,
  },
  {
    create: withLayerStyle({ willChange: "transform" }),
    id: "falloff-willchange",
    label: "Nouveau + will-change: transform sur la couche",
    perf: true,
  },
  {
    create: withLayerStyle({ contain: "layout style" }),
    id: "falloff-contain",
    label: "Nouveau + contain: layout style sur la couche",
    perf: true,
  },
  {
    create: withLayerStyle({
      contain: "layout style",
      willChange: "transform",
    }),
    id: "falloff-both",
    label: "Nouveau + will-change: transform ET contain: layout style",
    perf: true,
  },
  {
    create: (host) => {
      const glow = createGlowWith(host, { blur: "40px", masks: false });
      glow.element.style.setProperty("--vl-reach", "20px");
      return glow;
    },
    id: "blur-group",
    label: "Halo natural : bandes + coins unis, sans masques, 1 flou 40px",
    perf: true,
  },
  {
    create: (host) => createGlowWith(host, { blur: "8px" }),
    id: "falloff-blur8",
    label: "Nouveau + flou 8px",
    perf: true,
  },
  {
    create: (host) => createGlowWith(host, { exponent: 1.5 }),
    id: "falloff-soft",
    label: "Décroissance douce (exposant 1,5)",
  },
  {
    create: (host) => createGlowWith(host, { exponent: 4 }),
    id: "falloff-sharp",
    label: "Décroissance concentrée (exposant 4)",
  },
  {
    create: (host) => createGlowWith(host, { blur: "24px" }),
    id: "falloff-blur24",
    label: "Nouveau + flou 24px (mesuré : inutilisable, 2 glows max)",
  },
];

const params = new URLSearchParams(location.search);
const only = params.get("only")?.split(",");
const PERF_VARIANTS = VARIANTS.filter(
  (variant) => variant.perf && (!only || only.includes(variant.id))
);

/** Glows stacked on the same box, on top of the empty-page baseline. */
const COUNTS = (params.get("counts") ?? "24,48").split(",").map(Number);
/** Each variant is measured this many times, in a different order each round. */
const ROUNDS = Number(params.get("rounds") ?? 3);
const STEP_MS = 600;
/** Longest wait for frames to come back to the baseline rate, in attempts. */
const CALM_ATTEMPTS = 12;
/** Frames count as back to normal at this share of the baseline rate. */
const CALM_SHARE = 0.97;
/** A variant holds a step while it keeps this share of the baseline frame rate... */
const MIN_FPS_SHARE = 0.92;
/** ...and its slowest 5 % of frames stay within this multiple of the baseline's. */
const MAX_P95_RATIO = 1.4;
const COPY_LABEL = "Copier le rapport";

/** samples[variantId][count] = one entry per round. */
const samples: Record<string, Record<number, Sample[]>> = {};
const baselines: Sample[] = [];
let running = false;

function byId<T extends HTMLElement>(id: string): T {
  const found = document.querySelector<HTMLElement>(`#${id}`);
  if (!found) {
    throw new Error(`#${id} missing`);
  }
  return found as T;
}

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return (
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ??
    0
  );
}

const median = (values: number[]) => percentile(values, 0.5);

// --- Synthetic colors: change on every frame, like a live video ----------------

function rainbow(hue: number): [number, number, number] {
  const wrapped = ((hue % 360) + 360) % 360;
  const sector = Math.floor(wrapped / 60);
  const x = 1 - Math.abs(((wrapped / 60) % 2) - 1);
  const table: [number, number, number][] = [
    [1, x, 0],
    [x, 1, 0],
    [0, 1, x],
    [0, x, 1],
    [x, 0, 1],
    [1, 0, x],
  ];
  const [r, g, b] = table[sector] ?? [1, 0, 0];
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function fakeColors(now: number): EdgeColors {
  const side = (offset: number) =>
    Array.from({ length: EDGE_POINTS }, (_, i) =>
      rainbow(now * 0.05 + offset + i * 25)
    );
  return { bottom: side(180), left: side(270), right: side(90), top: side(0) };
}

// --- Measuring --------------------------------------------------------------------

/** Run `count` glows on the lab box for a moment; measure how frames fare. */
async function measureStep(variant: Variant, count: number): Promise<Sample> {
  const lab = byId("lab");
  const glows = Array.from({ length: count }, () => variant.create(lab));
  const deltas: number[] = [];
  let updateTotal = 0;
  let frames = 0;

  await new Promise<void>((resolve) => {
    const started = performance.now();
    let last = started;
    const tick = (now: number) => {
      deltas.push(now - last);
      last = now;
      frames += 1;
      const before = performance.now();
      const colors = fakeColors(now);
      for (const glow of glows) {
        glow.update(colors);
      }
      updateTotal += performance.now() - before;
      if (now - started < STEP_MS) {
        requestAnimationFrame(tick);
      } else {
        resolve();
      }
    };
    requestAnimationFrame(tick);
  });

  for (const glow of glows) {
    glow.destroy();
  }
  // The first delta spans the setup, not a frame.
  deltas.shift();
  const mean = deltas.reduce((sum, delta) => sum + delta, 0) / deltas.length;
  return {
    fps: 1000 / mean,
    p95: percentile(deltas, 0.95),
    updateMs: updateTotal / frames,
  };
}

/** The variants in an order that changes with the round, to cancel drift. */
function rotated(round: number): Variant[] {
  const shift = round % PERF_VARIANTS.length;
  return [...PERF_VARIANTS.slice(shift), ...PERF_VARIANTS.slice(0, shift)];
}

/** Builds nothing (a count of 0): measures the page's own frame rate. */
const EMPTY: Variant = { create: createLegacyGlow, id: "empty", label: "" };

/**
 * Wait until frames are back to the baseline rate. A step that overloaded the
 * GPU leaves a backlog that would otherwise be blamed on the next variant.
 */
async function waitUntilCalm(baselineFps: number) {
  for (let attempt = 0; attempt < CALM_ATTEMPTS; attempt += 1) {
    // biome-ignore lint/performance/noAwaitInLoops: polling, one probe at a time
    const probe = await measureStep(EMPTY, 0);
    if (probe.fps >= baselineFps * CALM_SHARE) {
      return;
    }
  }
}

async function measureRound(round: number) {
  const reference = await measureStep(EMPTY, 0);
  baselines.push(reference);
  for (const variant of rotated(round)) {
    // biome-ignore lint/performance/noAwaitInLoops: variants must not overlap
    await waitUntilCalm(reference.fps);
    samples[variant.id] ??= {};
    for (const count of COUNTS) {
      byId("progress").textContent =
        `tour ${round + 1}/${ROUNDS} · ${variant.label} · ${count} glows`;
      // biome-ignore lint/performance/noAwaitInLoops: steps must run one after the other
      const sample = await measureStep(variant, count);
      samples[variant.id][count] ??= [];
      samples[variant.id][count].push(sample);
      if (sample.fps < reference.fps * CALM_SHARE) {
        await waitUntilCalm(reference.fps);
      }
    }
  }
}

// --- Page --------------------------------------------------------------------------

function baseline(): Sample {
  return {
    fps: median(baselines.map((sample) => sample.fps)),
    p95: median(baselines.map((sample) => sample.p95)),
    updateMs: 0,
  };
}

/** Holds a step only if EVERY round held it: noise must not pass for speed. */
function holds(runs: Sample[], base: Sample): boolean {
  return runs.every(
    (run) =>
      run.fps >= base.fps * MIN_FPS_SHARE && run.p95 <= base.p95 * MAX_P95_RATIO
  );
}

function stepText(runs: Sample[]): string {
  const fps = runs.map((run) => run.fps);
  const worstP95 = Math.max(...runs.map((run) => run.p95));
  const js = median(runs.map((run) => run.updateMs));
  return `${median(fps).toFixed(0)} fps (${Math.min(...fps).toFixed(0)}-${Math.max(...fps).toFixed(0)}) · p95 ≤ ${worstP95.toFixed(0)} ms · js ${js.toFixed(2)} ms`;
}

function renderHead() {
  const head = byId("results-head");
  head.replaceChildren();
  for (const title of [
    "Variante",
    ...COUNTS.map((count) => `${count} glows empilés`),
  ]) {
    const cell = document.createElement("th");
    cell.textContent = title;
    head.append(cell);
  }
}

function renderResults() {
  const body = byId("results");
  body.replaceChildren();
  const base = baselines.length > 0 ? baseline() : undefined;
  byId("baseline").textContent = base
    ? `référence (page sans glow) : ${base.fps.toFixed(0)} fps, p95 ${base.p95.toFixed(1)} ms`
    : "";
  for (const variant of PERF_VARIANTS) {
    const row = document.createElement("tr");
    const label = document.createElement("td");
    label.textContent = variant.label;
    row.append(label);
    for (const count of COUNTS) {
      const cell = document.createElement("td");
      const runs = samples[variant.id]?.[count];
      if (runs && base) {
        const ok = holds(runs, base);
        cell.className = ok ? "ok" : "ko";
        cell.textContent = `${ok ? "✓" : "✗"} ${stepText(runs)}`;
      } else {
        cell.textContent = "—";
      }
      row.append(cell);
    }
    body.append(row);
  }
  updateReport();
}

function updateReport() {
  byId<HTMLTextAreaElement>("report").value = JSON.stringify(
    {
      baseline: baselines.length > 0 ? baseline() : null,
      counts: COUNTS,
      date: new Date().toISOString(),
      note: "glows empilés sur une même boîte, couleurs changeant à chaque frame ; chaque variante mesurée ROUNDS fois dans un ordre tournant ; un palier est tenu si TOUS les tours gardent le débit et le p95",
      results: samples,
      rounds: ROUNDS,
      rule: { maxP95Ratio: MAX_P95_RATIO, minFpsShare: MIN_FPS_SHARE },
      userAgent: navigator.userAgent,
    },
    (_key, value) =>
      typeof value === "number" ? Math.round(value * 100) / 100 : value,
    2
  );
}

async function runAll() {
  if (running) {
    return;
  }
  running = true;
  const button = byId<HTMLButtonElement>("run");
  button.disabled = true;
  baselines.length = 0;
  for (const key of Object.keys(samples)) {
    delete samples[key];
  }
  // The live preview competes for the GPU: park it during the measure.
  byId("preview").style.visibility = "hidden";
  for (let round = 0; round < ROUNDS; round += 1) {
    // biome-ignore lint/performance/noAwaitInLoops: rounds are sequential by design
    await measureRound(round);
    renderResults();
  }
  byId("preview").style.visibility = "visible";
  byId("progress").textContent = "terminé";
  button.disabled = false;
  running = false;
}

// --- Live preview -----------------------------------------------------------------

let glow: Glow | undefined;
let stopWatching: () => void = () => undefined;

function startPreview(variant: Variant) {
  stopWatching();
  glow?.destroy();
  const host = byId("player");
  const video = byId<HTMLVideoElement>("video");
  const current = variant.create(host);
  glow = current;
  stopWatching = watchVideo(video, {
    onColors: (colors) => current.update(colors),
  });
}

function init() {
  const select = byId<HTMLSelectElement>("variant");
  for (const variant of VARIANTS) {
    const option = document.createElement("option");
    option.value = variant.id;
    option.textContent = variant.label;
    select.append(option);
  }
  select.value = "falloff";
  select.addEventListener("change", () => {
    const variant = VARIANTS.find((candidate) => candidate.id === select.value);
    if (variant) {
      startPreview(variant);
    }
  });

  byId<HTMLVideoElement>("video").src = "mire.mp4";
  const initial = VARIANTS.find((candidate) => candidate.id === select.value);
  if (initial) {
    startPreview(initial);
  }

  renderHead();
  renderResults();
  byId("run").addEventListener("click", runAll);
  byId("copy").addEventListener("click", () =>
    copyText(byId<HTMLTextAreaElement>("report"), byId("copy"), COPY_LABEL)
  );
}

init();
