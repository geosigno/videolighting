import { describe, expect, test as it } from "bun:test";
import { renderToString } from "react-dom/server";
import { NEUTRAL } from "../../src/core/watcher.js";
import {
  Ambient,
  Halo,
  LightingProvider,
  Theme,
  useColors,
} from "../../src/react/index.js";

function ColorsProbe() {
  const colors = useColors(null);
  return <span>{JSON.stringify(colors)}</span>;
}

describe("server rendering", () => {
  it("the three components render their element, className and children", () => {
    // The point is rendering without a DOM: none must exist here.
    expect(typeof document).toBe("undefined");
    expect(typeof window).toBe("undefined");
    const html = renderToString(
      <LightingProvider options={{ method: "canvas" }} video={null}>
        <Halo className="halo">
          <video muted />
        </Halo>
        <Ambient as="section" className="ambient" />
        <Theme as="aside" className="theme">
          texte
        </Theme>
      </LightingProvider>
    );
    expect(html).toContain('<div class="halo"><video muted=""></video></div>');
    expect(html).toContain('<section class="ambient"></section>');
    expect(html).toContain('<aside class="theme">texte</aside>');
  });

  it("useColors renders NEUTRAL on the server", () => {
    const html = renderToString(<ColorsProbe />);
    expect(html).toContain(JSON.stringify(NEUTRAL).replaceAll('"', "&quot;"));
  });
});
