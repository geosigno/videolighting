import "./nav.js";
import {
  createGlow,
  type EdgeColors,
  type SampleCost,
  watchVideo,
} from "./internal.js";

/**
 * The whole flow (sampling + glow) measured the way a page under pressure
 * would see it. Pressure comes from DevTools CPU throttling plus, optionally,
 * a busy loop that keeps the main thread occupied.
 */

const params = new URLSearchParams(location.search);
const SRC = params.get("src") ?? "mire60.mp4";
const ENGINE = params.get("engine") ?? "worker";
const GLOWS = Number(params.get("glows") ?? 1);
const SECONDS = Number(params.get("seconds") ?? 8);
const ROUNDS = Number(params.get("rounds") ?? 2);
const LOAD = Number(params.get("load") ?? 0);
const EVERY = Number(params.get("every") ?? 50);
const SKIP_SAME = params.get("skipSame") === "1";
const OFFSCREEN = params.get("offscreen") === "1";

function byId<T extends HTMLElement>(id: string): T {
  const found = document.querySelector<HTMLElement>(`#${id}`);
  if (!found) {
    throw new Error(`#${id} missing`);
  }
  return found as T;
}

const percentile = (values: number[], fraction: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return (
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ??
    0
  );
};

const sameColors = (a: EdgeColors, b: EdgeColors) =>
  JSON.stringify(a) === JSON.stringify(b);

const video = byId<HTMLVideoElement>("video");
video.src = SRC;
if (OFFSCREEN) {
  byId("spacer").style.height = "4000px";
}

interface Row {
  coverage: number;
  droppedVideoFrames: number;
  identicalShare: number;
  jsMsPerWrite: number;
  latencyMax: number;
  latencyP50: number;
  latencyP95: number;
  mainP50: number;
  mainP95: number;
  paintP95: number;
  paintsPerSecond: number;
  samplesPerSecond: number;
  skippedWrites: number;
  videoFramesPerSecond: number;
}

async function measure(): Promise<Row> {
  const host = byId("player");
  const glows = Array.from({ length: GLOWS }, () => createGlow(host));
  const costs: SampleCost[] = [];
  const deltas: number[] = [];
  let videoFrames = 0;
  let samples = 0;
  let identical = 0;
  let skipped = 0;
  let writes = 0;
  let jsMs = 0;
  let previous: EdgeColors | undefined;

  const quality = video.getVideoPlaybackQuality();
  const droppedBefore = quality.droppedVideoFrames;

  // Independent chain: how many frames the video presented.
  const chain: { counting: boolean } = { counting: true };
  const count = () => {
    videoFrames += 1;
    if (chain.counting) {
      video.requestVideoFrameCallback(count);
    }
  };
  video.requestVideoFrameCallback(count);

  const stop = watchVideo(video, {
    worker: ENGINE === "worker",
    onColors: (colors, cost) => {
      samples += 1;
      costs.push(cost);
      const same = previous ? sameColors(previous, colors) : false;
      if (same) {
        identical += 1;
      }
      previous = colors;
      if (SKIP_SAME && same) {
        skipped += 1;
        return;
      }
      const before = performance.now();
      for (const glow of glows) {
        glow.update(colors);
      }
      jsMs += performance.now() - before;
      writes += 1;
    },
  });

  const jank =
    LOAD > 0
      ? setInterval(() => {
          const until = performance.now() + LOAD;
          while (performance.now() < until) {
            // busy on purpose
          }
        }, EVERY)
      : undefined;

  await new Promise<void>((resolve) => {
    const started = performance.now();
    let last = started;
    const tick = (now: number) => {
      deltas.push(now - last);
      last = now;
      if (now - started < SECONDS * 1000) {
        requestAnimationFrame(tick);
      } else {
        resolve();
      }
    };
    requestAnimationFrame(tick);
  });

  clearInterval(jank);
  chain.counting = false;
  stop();
  for (const glow of glows) {
    glow.destroy();
  }
  deltas.shift();
  const latency = costs.map((cost) => cost.latencyMs);
  const main = costs.map((cost) => cost.mainMs);
  return {
    coverage: samples / Math.max(1, videoFrames),
    droppedVideoFrames:
      video.getVideoPlaybackQuality().droppedVideoFrames - droppedBefore,
    identicalShare: identical / Math.max(1, samples),
    jsMsPerWrite: jsMs / Math.max(1, writes),
    latencyMax: Math.max(0, ...latency),
    latencyP50: percentile(latency, 0.5),
    latencyP95: percentile(latency, 0.95),
    mainP50: percentile(main, 0.5),
    mainP95: percentile(main, 0.95),
    paintP95: percentile(deltas, 0.95),
    paintsPerSecond: deltas.length / SECONDS,
    samplesPerSecond: samples / SECONDS,
    skippedWrites: skipped,
    videoFramesPerSecond: videoFrames / SECONDS,
  };
}

const rows: Row[] = [];

const COLUMNS: [string, (row: Row) => string][] = [
  ["vidéo fps", (r) => r.videoFramesPerSecond.toFixed(1)],
  ["samples/s", (r) => r.samplesPerSecond.toFixed(1)],
  ["couverture", (r) => `${(r.coverage * 100).toFixed(0)} %`],
  [
    "latence p50/p95/max ms",
    (r) =>
      `${r.latencyP50.toFixed(1)} / ${r.latencyP95.toFixed(1)} / ${r.latencyMax.toFixed(0)}`,
  ],
  [
    "main p50/p95 ms",
    (r) => `${r.mainP50.toFixed(2)} / ${r.mainP95.toFixed(2)}`,
  ],
  ["paints/s", (r) => r.paintsPerSecond.toFixed(1)],
  ["paint p95 ms", (r) => r.paintP95.toFixed(1)],
  ["js ms/écriture", (r) => r.jsMsPerWrite.toFixed(3)],
  ["couleurs identiques", (r) => `${(r.identicalShare * 100).toFixed(0)} %`],
  ["écritures évitées", (r) => String(r.skippedWrites)],
  ["frames vidéo perdues", (r) => String(r.droppedVideoFrames)],
];

function render() {
  const head = byId("head");
  head.replaceChildren();
  for (const [title] of COLUMNS) {
    const cell = document.createElement("th");
    cell.textContent = title;
    head.append(cell);
  }
  const body = byId("results");
  body.replaceChildren();
  for (const row of rows) {
    const tr = document.createElement("tr");
    for (const [, format] of COLUMNS) {
      const cell = document.createElement("td");
      cell.textContent = format(row);
      tr.append(cell);
    }
    body.append(tr);
  }
  byId<HTMLTextAreaElement>("report").value = JSON.stringify(
    {
      config: {
        ENGINE,
        EVERY,
        GLOWS,
        LOAD,
        OFFSCREEN,
        SECONDS,
        SKIP_SAME,
        SRC,
      },
      rows,
    },
    (_key, value) =>
      typeof value === "number" ? Math.round(value * 1000) / 1000 : value,
    2
  );
}

byId("run").addEventListener("click", async () => {
  await video.play();
  for (let round = 0; round < ROUNDS; round += 1) {
    byId("progress").textContent = ` tour ${round + 1}/${ROUNDS}`;
    // biome-ignore lint/performance/noAwaitInLoops: rounds are sequential
    rows.push(await measure());
    render();
  }
  byId("progress").textContent = " terminé";
});

render();
