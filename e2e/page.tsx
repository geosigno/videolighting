import { renderPage } from "../playground/page/page.js";

// The playground's reference page on a test clip; `?src=` picks another.
renderPage(document.querySelector<HTMLElement>("#root") ?? document.body, {
  src: "/quad-360.webm",
});
