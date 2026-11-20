import { describe, expect, test as it } from "bun:test";
import { renderToString } from "react-dom/server";
import { NEUTRAL } from "../core/watcher.js";
import {
  Ambient,
  GlowProvider,
  Halo,
  Letterbox,
  Theme,
  useColors,
} from "./index.js";

function ColorsProbe() {
  const colors = useColors(null);
  return <span>{JSON.stringify(colors)}</span>;
}

describe("server rendering", () => {
  it("no DOM global is defined in this test", () => {
    expect(typeof document).toBe("undefined");
    expect(typeof window).toBe("undefined");
  });

  it("the four components render their element, className and children", () => {
    const html = renderToString(
      <GlowProvider options={{ method: "canvas" }} video={null}>
        <Halo className="halo">
          <video muted />
        </Halo>
        <Ambient as="section" className="ambient" />
        <Theme as="aside" className="theme">
          texte
        </Theme>
        <Letterbox className="letterbox" />
      </GlowProvider>
    );
    expect(html).toContain('<div class="halo"><video muted=""></video></div>');
    expect(html).toContain('<section class="ambient"></section>');
    expect(html).toContain('<aside class="theme">texte</aside>');
    expect(html).toContain('<div class="letterbox"></div>');
  });

  it("useColors renders NEUTRAL on the server", () => {
    const html = renderToString(<ColorsProbe />);
    expect(html).toContain(JSON.stringify(NEUTRAL).replaceAll('"', "&quot;"));
  });
});
