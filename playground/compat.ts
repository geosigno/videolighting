import "./nav.js";
import { type EdgeColors, type SampleCost, watchVideo } from "../src/index.js";
import {
  CASES,
  type CompatCase,
  type Expect,
  type Preparation,
  type Urls,
} from "./compat-cases.js";
import { copyText } from "./copy.js";
import { describe, waitReady } from "./ready.js";

type Kind = "readable" | "black" | "blocked" | "error" | "noplay" | "timeout";
type Verdict = "match" | "mismatch" | "observe" | "skipped";
type Engine = "main" | "worker";

interface Probe {
  detail: string;
  kind: Kind;
  swatches?: string[];
}

interface Outcome {
  expect: Expect;
  id: string;
  main: Probe;
  title: string;
  verdict: Verdict;
  worker: Probe;
}

interface Row {
  main: HTMLElement;
  run: HTMLButtonElement;
  slot: HTMLElement;
  verdict: HTMLElement;
  worker: HTMLElement;
}

const PROBE_TIMEOUT_MS = 4000;
/** Samples collected after the first one, to measure the steady-state cost. */
const STEADY_SAMPLES = 20;
const STEADY_TIMEOUT_MS = 3000;
/** A frame whose brightest channel is below this is considered black. */
const BLACK_THRESHOLD = 10;

// The test servers (`bun run servers`) listen on other ports of the same host,
// which makes them other origins for the browser.
const HOST =
  location.hostname === "localhost" ? "127.0.0.1" : location.hostname;
const URLS: Urls = {
  cors: `http://${HOST}:5201`,
  corsNoRange: `http://${HOST}:5202`,
  noCors: `http://${HOST}:5200`,
  same: "",
};

const KIND_LABEL: Record<Kind, string> = {
  black: "⚫ lisible mais noir",
  blocked: "⛔ bloqué",
  error: "💥 erreur (pas de sécurité)",
  noplay: "❌ ne joue pas",
  readable: "✅ lisible",
  timeout: "⏱ pas de couleurs",
};

const EXPECT_LABEL: Record<Expect, string> = {
  blocked: "bloqué",
  noplay: "ne joue pas",
  readable: "lisible",
  unknown: "à observer",
};

const VERDICT_LABEL: Record<Verdict, string> = {
  match: "✅ conforme",
  mismatch: "❗ écart",
  observe: "👀 à observer",
  skipped: "⏭ ignoré",
};

const KIND_FOR_EXPECT: Record<Exclude<Expect, "unknown">, Kind> = {
  blocked: "blocked",
  noplay: "noplay",
  readable: "readable",
};

const outcomes = new Map<string, Outcome>();
const rows = new Map<string, Row>();

function byId<T extends HTMLElement>(id: string): T {
  const found = document.querySelector<HTMLElement>(`#${id}`);
  if (!found) {
    throw new Error(`#${id} missing`);
  }
  return found as T;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  text = ""
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

// --- Probing ---------------------------------------------------------------

function classify(colors: EdgeColors, cost: SampleCost): Probe {
  const all = [
    ...colors.top,
    ...colors.right,
    ...colors.bottom,
    ...colors.left,
  ];
  const brightest = Math.max(...all.flat());
  return {
    detail: steadyDetail(cost, []),
    kind: brightest <= BLACK_THRESHOLD ? "black" : "readable",
    swatches: colors.top.map(([r, g, b]) => `rgb(${r} ${g} ${b})`),
  };
}

/** Only the browser's origin rules count as "blocked"; other errors are plain errors. */
function errorKind(error: unknown): Kind {
  const name = error instanceof Error ? error.name : "";
  return name === "SecurityError" || name === "DataCloneError"
    ? "blocked"
    : "error";
}

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return (
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ??
    0
  );
}

/** First sample (cold start) reported apart from the following ones (steady state). */
function steadyDetail(first: SampleCost, rest: SampleCost[]): string {
  const head = `1er échantillon : main ${first.mainMs.toFixed(2)} ms, latence ${first.latencyMs.toFixed(1)} ms`;
  if (rest.length === 0) {
    return head;
  }
  const main = rest.map((cost) => cost.mainMs);
  const latency = rest.map((cost) => cost.latencyMs);
  return `${head} · puis n=${rest.length} : main médiane ${percentile(main, 0.5).toFixed(2)} ms (p95 ${percentile(main, 0.95).toFixed(2)}), latence médiane ${percentile(latency, 0.5).toFixed(1)} ms`;
}

/**
 * Ask our real plugin for colors: the first sample decides readable / blocked,
 * the next ones give the steady-state cost of the engine.
 */
function probe(video: HTMLVideoElement, engine: Engine): Promise<Probe> {
  return new Promise((resolve) => {
    let stop: () => void = () => undefined;
    let finished = false;
    let first: { cost: SampleCost; result: Probe } | undefined;
    let steadyTimer: ReturnType<typeof setTimeout> | undefined;
    const rest: SampleCost[] = [];

    const finish = (result: Probe) => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timer);
      clearTimeout(steadyTimer);
      stop();
      resolve(result);
    };
    const finishSteady = () => {
      if (first) {
        finish({ ...first.result, detail: steadyDetail(first.cost, rest) });
      }
    };
    const timer = setTimeout(
      () => finish({ detail: "aucune couleur en 4 s", kind: "timeout" }),
      PROBE_TIMEOUT_MS
    );

    stop = watchVideo(video, {
      onColors: (colors, cost) => {
        if (first) {
          rest.push(cost);
          if (rest.length >= STEADY_SAMPLES) {
            finishSteady();
          }
          return;
        }
        first = { cost, result: classify(colors, cost) };
        clearTimeout(timer);
        steadyTimer = setTimeout(finishSteady, STEADY_TIMEOUT_MS);
      },
      onError: (error) => {
        if (first) {
          finishSteady();
        } else {
          finish({ detail: describe(error), kind: errorKind(error) });
        }
      },
      worker: engine === "worker",
    });
  });
}

// --- Rendering ---------------------------------------------------------------

function renderProbe(cell: HTMLElement, result: Probe) {
  cell.replaceChildren(
    element("div", `badge ${result.kind}`, KIND_LABEL[result.kind]),
    element("div", "small", result.detail)
  );
  if (result.swatches) {
    const strip = element("div", "strip");
    for (const color of result.swatches) {
      const swatch = element("span");
      swatch.style.background = color;
      strip.append(swatch);
    }
    cell.append(strip);
  }
}

function verdictFor(expect: Expect, main: Probe, worker: Probe): Verdict {
  if (expect === "unknown") {
    return "observe";
  }
  const wanted = KIND_FOR_EXPECT[expect];
  return main.kind === wanted && worker.kind === wanted ? "match" : "mismatch";
}

function record(
  testCase: CompatCase,
  row: Row,
  main: Probe,
  worker: Probe,
  skipped = false
) {
  const verdict = skipped
    ? "skipped"
    : verdictFor(testCase.expect, main, worker);
  renderProbe(row.main, main);
  renderProbe(row.worker, worker);
  row.verdict.className = `verdict ${verdict}`;
  row.verdict.textContent = VERDICT_LABEL[verdict];
  outcomes.set(testCase.id, {
    expect: testCase.expect,
    id: testCase.id,
    main,
    title: testCase.title,
    verdict,
    worker,
  });
  updateReport();
}

async function safePrepare(
  testCase: CompatCase
): Promise<Preparation | { failure: string }> {
  try {
    return await testCase.prepare(URLS);
  } catch (error) {
    return { failure: describe(error) };
  }
}

async function runCase(testCase: CompatCase, row: Row) {
  row.run.disabled = true;
  row.verdict.className = "verdict";
  row.verdict.textContent = "…";
  row.slot.replaceChildren();

  const prepared = await safePrepare(testCase);
  if ("skip" in prepared) {
    const skipped: Probe = { detail: prepared.skip, kind: "noplay" };
    record(testCase, row, skipped, skipped, true);
    row.run.disabled = false;
    return;
  }
  if ("failure" in prepared) {
    const failed: Probe = {
      detail: `préparation impossible : ${prepared.failure}`,
      kind: "noplay",
    };
    record(testCase, row, failed, failed);
    row.run.disabled = false;
    return;
  }

  const { video } = prepared;
  try {
    row.slot.replaceChildren(video);
    video.play().catch(() => undefined);
    const ready = await waitReady(video, prepared.diagnostics);
    if (ready.ok) {
      await testCase.afterReady?.(video);
      const main = await probe(video, "main");
      const worker = await probe(video, "worker");
      record(testCase, row, main, worker);
    } else {
      const failed: Probe = { detail: ready.reason, kind: "noplay" };
      record(testCase, row, failed, failed);
    }
  } finally {
    video.pause();
    prepared.cleanup?.();
    row.run.disabled = false;
  }
}

function buildTable() {
  const body = byId("matrix").querySelector("tbody");
  if (!body) {
    return;
  }
  let group = "";
  for (const testCase of CASES) {
    const { group: caseGroup } = testCase;
    if (caseGroup !== group) {
      group = caseGroup;
      const header = element("tr", "group");
      const cell = element("td", "", group);
      cell.colSpan = 6;
      header.append(cell);
      body.append(header);
    }
    const tr = element("tr");
    const title = element("td");
    title.append(
      element("div", "title", testCase.title),
      element("div", "small", testCase.detail)
    );
    const slot = element("div", "slot");
    title.append(slot);
    const expected = element("td", "", EXPECT_LABEL[testCase.expect]);
    const main = element("td");
    const worker = element("td");
    const verdict = element("td", "verdict", "—");
    const action = element("td");
    const run = element("button", "", "Lancer");
    run.type = "button";
    action.append(run);
    tr.append(title, expected, main, worker, verdict, action);
    body.append(tr);

    const row: Row = { main, run, slot, verdict, worker };
    rows.set(testCase.id, row);
    run.addEventListener("click", () => runCase(testCase, row));
  }
}

// --- Environment and report ---------------------------------------------------

async function detectFeatures(): Promise<Record<string, string>> {
  const yes = (value: boolean) => (value ? "oui" : "non");
  let clearKey = false;
  try {
    await navigator.requestMediaKeySystemAccess("org.w3.clearkey", [
      {
        initDataTypes: ["keyids", "cenc"],
        videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.64001E"' }],
      },
    ]);
    clearKey = true;
  } catch {
    clearKey = false;
  }
  const video = document.createElement("video");
  return {
    "ClearKey (EME)": yes(clearKey),
    createImageBitmap: yes("createImageBitmap" in window),
    "HLS natif": yes(video.canPlayType("application/vnd.apple.mpegurl") !== ""),
    ManagedMediaSource: yes("ManagedMediaSource" in window),
    MediaSource: yes("MediaSource" in window),
    OffscreenCanvas: yes("OffscreenCanvas" in window),
    requestVideoFrameCallback: yes("requestVideoFrameCallback" in video),
    "secure context": yes(window.isSecureContext),
    userAgent: navigator.userAgent,
    VideoFrame: yes("VideoFrame" in window),
    Worker: yes("Worker" in window),
  };
}

let features: Record<string, string> = {};

function updateReport() {
  const results = CASES.flatMap((testCase) => {
    const outcome = outcomes.get(testCase.id);
    if (!outcome) {
      return [];
    }
    return [
      {
        expect: outcome.expect,
        id: outcome.id,
        main: `${outcome.main.kind} (${outcome.main.detail})`,
        title: outcome.title,
        verdict: outcome.verdict,
        worker: `${outcome.worker.kind} (${outcome.worker.detail})`,
      },
    ];
  });
  byId<HTMLTextAreaElement>("report").value = JSON.stringify(
    { date: new Date().toISOString(), features, results, urls: URLS },
    null,
    2
  );
}

async function runAll() {
  const button = byId<HTMLButtonElement>("run-all");
  button.disabled = true;
  for (const testCase of CASES) {
    const row = rows.get(testCase.id);
    if (row) {
      // Cases run one after the other on purpose: they would compete for CPU.
      // biome-ignore lint/performance/noAwaitInLoops: sequential by design
      await runCase(testCase, row);
    }
  }
  button.disabled = false;
}

const COPY_LABEL = "Copier le rapport";

function copyReport() {
  return copyText(
    byId<HTMLTextAreaElement>("report"),
    byId("copy"),
    COPY_LABEL
  );
}

async function init() {
  buildTable();
  features = await detectFeatures();
  byId("env").textContent = Object.entries(features)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
  updateReport();
  byId("run-all").addEventListener("click", runAll);
  byId("copy").addEventListener("click", copyReport);
}

init();
