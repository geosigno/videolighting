import "./nav.js";
import { renderPage } from "./page/page.js";

// `?src=` picks the source (a clip under playground/public, or `mux`).
// By default: the Mux stream, halo only.
renderPage(document.querySelector<HTMLElement>("#root") ?? document.body, {
  effects: ["halo"],
  src: "mux",
});
