import { css } from "../src/core/colors.js";
import { ambient, halo, theme, watch } from "../src/index.js";

/**
 * Style cost bench: one video, the effects asked for, and a page of `nodes`
 * elements. The theme's variables are inherited, so writing them on an element
 * makes the browser recalculate the style of everything under it.
 *
 * `?transport=` compares ways to bring the two colours to the `consumers`
 * elements that use them (class `themed`), written `fps` times a second (0:
 * every display frame) by this page, not by the library's `theme`:
 *   page       inline, on the element that holds the whole page (inherited)
 *   consumers  inline, on each element that uses them
 *   sheet      one rule `.themed { … }` of a stylesheet made by script
 *   sheet-page one rule `#page { … }` of that stylesheet (inherited)
 * `?register=inherit|noinherit` registers the two properties as `<color>`;
 * `?cv=1` puts `content-visibility: auto` on every block of cards.
 */

const params = new URLSearchParams(location.search);
const effects = (params.get("effects") ?? "").split(",");
const nodes = Number(params.get("nodes") ?? 800);
const scope = params.get("scope") ?? "page";
const transport = params.get("transport");
const consumers = Number(params.get("consumers") ?? 10);
const fps = Number(params.get("fps") ?? 0);
const register = params.get("register");

const byId = <T extends HTMLElement>(id: string) =>
  document.querySelector(`#${id}`) as T;
const video = byId<HTMLVideoElement>("video");
const cards = byId("cards");
const page = byId("page");
const NAMES = ["--video-primary", "--video-secondary"] as const;

// Four elements per card, in blocks of 40 cards.
let block = cards;
for (let i = 0; i < nodes / 4; i += 1) {
  if (i % 40 === 0) {
    block = document.createElement("section");
    block.className = "block";
    if (params.get("cv")) {
      // The browser skips the style of a block that is off screen.
      block.style.cssText =
        "content-visibility:auto;contain-intrinsic-size:auto 400px";
    }
    cards.append(block);
  }
  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML = `<b>Card ${i}</b> <span>text</span> <button type="button"${i < consumers ? ' class="themed"' : ""}>ok</button>`;
  block.append(card);
}

if (register) {
  for (const name of NAMES) {
    CSS.registerProperty({
      inherits: register === "inherit",
      initialValue: "#444",
      name,
      syntax: "<color>",
    });
  }
}

video.src = params.get("src") ?? "/mire.mp4";

if (effects.includes("halo")) {
  halo(video);
}
if (effects.includes("ambient")) {
  ambient(video, byId("stage"), {
    variant: params.get("variant") === "mosaic" ? "mosaic" : "blobs",
  });
}
if (effects.includes("theme")) {
  theme(video, byId(scope === "box" ? "box" : "page"));
}

/** The styles the colours are written to, for the transport asked for. */
function targets(): CSSStyleDeclaration[] {
  if (transport === "page") {
    return [page.style];
  }
  if (transport === "consumers") {
    return [...document.querySelectorAll<HTMLElement>(".themed")].map(
      (element) => element.style
    );
  }
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(transport === "sheet" ? ".themed{}" : "#page{}");
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  return [(sheet.cssRules[0] as CSSStyleRule).style];
}

if (transport) {
  const styles = targets();
  let last = Number.NEGATIVE_INFINITY;
  watch(video).subscribe(({ primary, secondary }) => {
    const now = performance.now();
    if (fps > 0 && now - last < 1000 / fps) {
      return;
    }
    last = now;
    for (const style of styles) {
      style.setProperty(NAMES[0], css(primary));
      style.setProperty(NAMES[1], css(secondary));
    }
  });
}

byId("stats").textContent =
  `effects: ${effects.join(" ") || "none"} · transport: ${transport ?? "none"} · ${document.querySelectorAll("*").length} elements`;
