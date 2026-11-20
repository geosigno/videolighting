import { css, every, forWhiteText } from "./colors.js";
import type { LabContext } from "./core.js";

/**
 * Design tokens from the video: --video-primary and --video-secondary, set on
 * any container. They start from the very colours the background shows (shared
 * core). The one thing done here: the text on them is always white, so the
 * colour is darkened, only as much as needed, until white on it reaches the
 * contrast asked for. The panel shows the colour of the video and the one used.
 */

const MARKUP = `
<div class="ui">
  <div class="row">
    <button class="btn primary" type="button">Subscribe</button>
    <button class="btn secondary" type="button">Add to list</button>
    <button class="btn outline" type="button">Share</button>
    <span class="badge">LIVE</span>
  </div>
  <div class="row">
    <div class="bar"><i></i></div>
    <input class="slider" type="range" min="0" max="100" value="60" aria-label="Volume">
  </div>
  <div class="note"><b>Card title</b><p>Text on the tinted surface, with a <mark>selection</mark> that follows the video.</p></div>
  <dl class="tokens"></dl>
  <div class="row opts">
    <label class="check">White text contrast
      <select class="min">
        <option value="4.5">at least 4.5:1 (AA)</option>
        <option value="7">at least 7:1 (AAA)</option>
        <option value="3">at least 3:1 (large text)</option>
        <option value="1">no limit (colour of the video)</option>
      </select>
    </label>
    <label class="check"><input type="checkbox"> Tint the browser bar (phones)</label>
  </div>
</div>`;

function tintBrowserBar(color: string) {
  let meta = document.querySelector<HTMLMetaElement>(
    'meta[name="theme-color"]'
  );
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.append(meta);
  }
  meta.content = color;
}

export function mountTheme(
  host: HTMLElement,
  { core, video }: LabContext
): () => void {
  host.classList.add("themed");
  host.innerHTML = MARKUP;
  const tokens = host.querySelector<HTMLElement>(".tokens");
  const bar = host.querySelector<HTMLElement>(".bar i");
  const tint = host.querySelector<HTMLInputElement>(
    ".check input[type=checkbox]"
  );
  const minimum = host.querySelector<HTMLSelectElement>(".min");

  const panel = every(120, (): void => {
    const { primary, secondary } = core.state();
    const min = Number(minimum?.value ?? 4.5);
    const rows: [string, ReturnType<typeof forWhiteText>, typeof primary][] = [
      ["--video-primary", forWhiteText(primary, min), primary],
      ["--video-secondary", forWhiteText(secondary, min), secondary],
    ];
    if (tokens) {
      tokens.innerHTML = rows
        .map(
          ([name, used, iso]) =>
            `<div><dt><i style="background:${css(iso)}"></i>${name}</dt><dd>video ${css(iso)} → used ${css(used.bg)} · white on it ${used.ratio.toFixed(1)}:1</dd></div>`
        )
        .join("");
    }
  });

  const off = core.subscribe(({ primary, secondary }) => {
    const min = Number(minimum?.value ?? 4.5);
    const a = forWhiteText(primary, min);
    const b = forWhiteText(secondary, min);
    host.style.setProperty("--video-primary", css(a.bg));
    host.style.setProperty("--video-secondary", css(b.bg));
    host.style.setProperty("--video-surface", css(a.bg, 0.16));
    if (tint?.checked) {
      tintBrowserBar(css(a.bg));
    }
    if (bar && video.duration > 0) {
      bar.style.width = `${(video.currentTime / video.duration) * 100}%`;
    }
    panel();
  });
  return () => {
    off();
    host.classList.remove("themed");
    host.innerHTML = "";
  };
}
