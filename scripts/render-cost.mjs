// Measures what a page's effects cost to render, in the installed Chrome (real
// GPU: Playwright's own Chromium renders in software and would mislead).
//
//   node scripts/render-cost.mjs --url http://localhost:5304 --runs 4 \
//     --width 1400 --height 1000 "none=effects=" "blobs=effects=ambient"
//
// Each `name=query` is the playground page opened with that query (plus
// `panel=0&strict=0&src=mire.mp4`). Runs are interleaved, one fresh page each:
// 4 s of warm-up, then 6 s measured. Everything is per second of display.
// This is a tool for performance work, not a test: GPU numbers move by up to
// +-20 ms/s between two identical runs, so only large gaps mean something.
/* global window, performance, requestAnimationFrame */
import { chromium } from "@playwright/test";

const WARM_MS = 4000;
const SPAN_MS = 6000;

function parse(argv) {
  const options = {
    height: 1000,
    runs: 3,
    url: "http://localhost:5173",
    width: 1400,
  };
  const variants = [];
  const flags = {
    "--height": "height",
    "--runs": "runs",
    "--url": "url",
    "--width": "width",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const key = flags[arg];
    if (key) {
      const value = argv[i + 1];
      options[key] = key === "url" ? value : Number(value);
      i += 1;
    } else {
      const split = arg.indexOf("=");
      variants.push({ name: arg.slice(0, split), query: arg.slice(split + 1) });
    }
  }
  return { options, variants };
}

const sum = (events, test) =>
  events.reduce(
    (total, event) =>
      event.ph === "X" && event.dur && test(event)
        ? total + event.dur / 1000
        : total,
    0
  );

async function measure(chrome, settings, variant) {
  const { height, url, width } = settings;
  const page = await chrome.newPage({ viewport: { height, width } });
  await page.goto(`${url}/?panel=0&strict=0&src=mire.mp4&${variant.query}`);
  await page.waitForFunction(() => Boolean(window.glowPage));
  await page.evaluate(() => window.glowPage.ready());
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  await page.evaluate(() => {
    window.__gaps = [];
    let last = performance.now();
    const tick = (now) => {
      window.__gaps.push(now - last);
      last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.waitForTimeout(WARM_MS);
  const read = async () =>
    Object.fromEntries(
      (await cdp.send("Performance.getMetrics")).metrics.map((m) => [
        m.name,
        m.value,
      ])
    );
  await page.evaluate(() => {
    window.__gaps = [];
  });
  const before = await read();
  await chrome.startTracing(page, {
    categories: [
      "cc",
      "gpu",
      "viz",
      "disabled-by-default-devtools.timeline",
      "toplevel",
    ],
  });
  await page.waitForTimeout(SPAN_MS);
  const trace = await chrome.stopTracing();
  const after = await read();
  const gaps = await page.evaluate(() => window.__gaps);
  await page.close();

  const events = JSON.parse(trace.toString()).traceEvents;
  const seconds = SPAN_MS / 1000;
  const perSecond = (key) => ((after[key] - before[key]) * 1000) / seconds;
  const sorted = [...gaps].sort((a, b) => a - b);
  return {
    gpu: sum(events, (e) => e.name === "GPUTask") / seconds,
    gapP95: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
    main: perSecond("TaskDuration"),
    raster:
      sum(
        events,
        (e) =>
          e.name.startsWith("RasterTask") ||
          e.name === "RasterizerTaskImpl::RunOnWorkerThread"
      ) / seconds,
    script: perSecond("ScriptDuration"),
    slow: gaps.filter((gap) => gap > 20).length / seconds,
    styleLayout: perSecond("RecalcStyleDuration") + perSecond("LayoutDuration"),
  };
}

const { options, variants } = parse(process.argv.slice(2));
const browser = await chromium.launch({ channel: "chrome" });
const rows = new Map(variants.map((variant) => [variant.name, []]));
for (let run = 0; run < options.runs; run += 1) {
  for (const variant of variants) {
    // One page at a time: measurements must not compete for the machine.
    // biome-ignore lint/performance/noAwaitInLoops: sequential on purpose
    rows.get(variant.name).push(await measure(browser, options, variant));
  }
}
await browser.close();

const mean = (list, key) =>
  list.reduce((total, row) => total + row[key], 0) / list.length;
console.log(
  `per second of display, mean of ${options.runs} runs, ${options.width}x${options.height}, installed Chrome, mire.mp4`
);
console.log(
  "variant".padEnd(16) +
    "main".padStart(8) +
    "script".padStart(8) +
    "style+lay".padStart(11) +
    "GPU".padStart(8) +
    "raster".padStart(8) +
    "gap p95".padStart(9) +
    ">20ms/s".padStart(9)
);
for (const variant of variants) {
  const list = rows.get(variant.name);
  console.log(
    variant.name.padEnd(16) +
      ["main", "script", "styleLayout", "gpu", "raster", "gapP95", "slow"]
        .map((key, index) =>
          mean(list, key).toFixed(1).padStart([8, 8, 11, 8, 8, 9, 9][index])
        )
        .join("")
  );
}
