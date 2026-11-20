import "./nav.js";
import { createGlow, type EdgeColors, watchVideo } from "./internal.js";

/**
 * Direct write vs write coalesced in requestAnimationFrame, on the real
 * pipeline. For each mode we count how many samples arrive, how many paints
 * there are, how many paints receive 2+ samples (the only case where coalescing
 * can save a write), and the JS time spent writing styles.
 */

const params = new URLSearchParams(location.search);
const SRC = params.get("src") ?? "mire60.mp4";
const GLOWS = Number(params.get("glows") ?? 1);
const ROUNDS = Number(params.get("rounds") ?? 3);
const SECONDS = Number(params.get("seconds") ?? 6);
/** Main-thread jank: block the thread for LOAD ms every EVERY ms (0 = none). */
const LOAD = Number(params.get("load") ?? 0);
const EVERY = Number(params.get("every") ?? 50);

type Mode = "direct" | "raf";
const MODES: Mode[] = ["direct", "raf"];

interface Result {
  doublePaints: number;
  droppedSamples: number;
  fps: number;
  msPerPaintJs: number;
  p95: number;
  paints: number;
  samples: number;
  writes: number;
}

function byId<T extends HTMLElement>(id: string): T {
  const found = document.querySelector<HTMLElement>(`#${id}`);
  if (!found) {
    throw new Error(`#${id} missing`);
  }
  return found as T;
}

const video = byId<HTMLVideoElement>("video");
video.src = SRC;

async function measure(mode: Mode): Promise<Result> {
  const host = byId("player");
  const glows = Array.from({ length: GLOWS }, () => createGlow(host));
  let samples = 0;
  let writes = 0;
  let droppedSamples = 0;
  let jsMs = 0;
  let sinceLastPaint = 0;
  let doublePaints = 0;
  let paints = 0;
  let pending: EdgeColors | undefined;
  const deltas: number[] = [];

  const apply = (colors: EdgeColors) => {
    const before = performance.now();
    for (const glow of glows) {
      glow.update(colors);
    }
    jsMs += performance.now() - before;
    writes += 1;
  };

  const stop = watchVideo(video, {
    onColors: (colors) => {
      samples += 1;
      sinceLastPaint += 1;
      if (mode === "direct") {
        apply(colors);
      } else {
        if (pending) {
          droppedSamples += 1;
        }
        pending = colors;
      }
    },
  });

  const jank =
    LOAD > 0
      ? setInterval(() => {
          const until = performance.now() + LOAD;
          while (performance.now() < until) {
            // busy on purpose: a page that keeps the main thread occupied
          }
        }, EVERY)
      : undefined;

  await new Promise<void>((resolve) => {
    const started = performance.now();
    let last = started;
    const tick = (now: number) => {
      deltas.push(now - last);
      last = now;
      if (mode === "raf" && pending) {
        apply(pending);
        pending = undefined;
      }
      if (sinceLastPaint >= 2) {
        doublePaints += 1;
      }
      sinceLastPaint = 0;
      paints += 1;
      if (now - started < SECONDS * 1000) {
        requestAnimationFrame(tick);
      } else {
        resolve();
      }
    };
    requestAnimationFrame(tick);
  });

  clearInterval(jank);
  stop();
  for (const glow of glows) {
    glow.destroy();
  }
  deltas.shift();
  const sorted = [...deltas].sort((a, b) => a - b);
  const mean = deltas.reduce((sum, d) => sum + d, 0) / deltas.length;
  return {
    doublePaints,
    droppedSamples,
    fps: 1000 / mean,
    msPerPaintJs: jsMs / paints,
    p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
    paints,
    samples,
    writes,
  };
}

const results: Record<Mode, Result[]> = { direct: [], raf: [] };

function render() {
  const head = byId("head");
  head.replaceChildren();
  for (const title of [
    "mode",
    "samples/s",
    "paints/s",
    "écritures/s",
    "paints avec ≥2 samples",
    "samples écrasés",
    "js ms/paint",
    "fps",
    "p95 ms",
  ]) {
    const cell = document.createElement("th");
    cell.textContent = title;
    head.append(cell);
  }
  const body = byId("results");
  body.replaceChildren();
  for (const mode of MODES) {
    for (const run of results[mode]) {
      const row = document.createElement("tr");
      const values = [
        mode,
        (run.samples / SECONDS).toFixed(1),
        (run.paints / SECONDS).toFixed(1),
        (run.writes / SECONDS).toFixed(1),
        `${run.doublePaints} (${((100 * run.doublePaints) / run.paints).toFixed(1)} %)`,
        String(run.droppedSamples),
        run.msPerPaintJs.toFixed(3),
        run.fps.toFixed(1),
        run.p95.toFixed(1),
      ];
      for (const value of values) {
        const cell = document.createElement("td");
        cell.textContent = value;
        row.append(cell);
      }
      body.append(row);
    }
  }
  byId<HTMLTextAreaElement>("report").value = JSON.stringify(
    {
      every: EVERY,
      glows: GLOWS,
      load: LOAD,
      results,
      seconds: SECONDS,
      src: SRC,
    },
    (_key, value) =>
      typeof value === "number" ? Math.round(value * 1000) / 1000 : value,
    2
  );
}

byId("run").addEventListener("click", async () => {
  await video.play();
  for (let round = 0; round < ROUNDS; round += 1) {
    for (const mode of round % 2 === 0 ? MODES : [...MODES].reverse()) {
      byId("progress").textContent = ` tour ${round + 1}/${ROUNDS} · ${mode}`;
      // biome-ignore lint/performance/noAwaitInLoops: modes must not overlap
      results[mode].push(await measure(mode));
      render();
    }
  }
  byId("progress").textContent = " terminé";
});

render();
