import Hls from "hls.js";
import {
  Profiler,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Ambient, Halo, Theme } from "../../src/react/index.js";
import { MUX_URL } from "../compat-cases.js";
import {
  countRender,
  recordComponentError,
  recordLateVideo,
} from "./handle.js";
import {
  type AmbientVariant,
  ASPECT_SIZES,
  type Aspect,
  type EffectName,
} from "./state.js";

/** Loads `src` in `video` (`mux`: the Video.js demo stream, through hls.js where it can) and plays it. */
function useSource(video: HTMLVideoElement | null, src: string) {
  useEffect(() => {
    if (!video) {
      return;
    }
    let hls: Hls | undefined;
    video.removeAttribute("crossorigin");
    if (src === "mux" && Hls.isSupported()) {
      hls = new Hls();
      hls.loadSource(MUX_URL);
      hls.attachMedia(video);
    } else {
      if (src === "mux") {
        video.crossOrigin = "anonymous";
      }
      video.src = src === "mux" ? MUX_URL : src;
    }
    video.play().catch(() => undefined);
    return () => hls?.destroy();
  }, [video, src]);
}

/**
 * `lateVideoMs` (test): the `<video>` is rendered only after that delay, the
 * effects before it; what the page held just before is recorded.
 */
function useLate(lateVideoMs: number): boolean {
  const [shown, setShown] = useState(lateVideoMs <= 0);
  useEffect(() => {
    if (shown) {
      return;
    }
    const timer = setTimeout(() => {
      recordLateVideo();
      setShown(true);
    }, lateVideoMs);
    return () => clearTimeout(timer);
  }, [lateVideoMs, shown]);
  return shown;
}

const Counted = ({ children, id }: { children: ReactNode; id: string }) => (
  <Profiler id={id} onRender={countRender}>
    {children}
  </Profiler>
);

/**
 * One `<video>` and the three effects on it: the halo around the frame, the
 * ambient on a fixed full-window backdrop, the theme on a card of buttons. The components take their video
 * from the provider.
 */
export function Stage({
  effects,
  lateVideoMs = 0,
  onVideo,
  preset,
  src,
  variant,
  video,
}: {
  effects: EffectName[];
  lateVideoMs?: number;
  onVideo: (video: HTMLVideoElement | null) => void;
  /** The format last chosen: a new object on every choice, even of the same one. */
  preset: { aspect: Aspect };
  src: string;
  variant: AmbientVariant;
  video: HTMLVideoElement | null;
}) {
  useSource(video, src);
  const container = useRef<HTMLDivElement>(null);
  // A format is a starting size, written on every choice (the current one
  // too, after a drag); a drag then overrides it.
  useLayoutEffect(() => {
    const element = container.current;
    if (!element) {
      return;
    }
    const { height, width } = ASPECT_SIZES[preset.aspect];
    element.style.width = `${width}px`;
    element.style.height = `${height}px`;
  }, [preset]);
  const showVideo = useLate(lateVideoMs);
  const on = (name: EffectName) => effects.includes(name);
  const buttons = (
    <>
      <button className="pg-btn primary" type="button">
        Subscribe
      </button>
      <button className="pg-btn secondary" type="button">
        Add to list
      </button>
      <span className="pg-badge">LIVE</span>
    </>
  );
  return (
    <div className="pg-stage" data-testid="stage">
      {on("ambient") && (
        <Counted id="ambient">
          <Ambient className="pg-backdrop" variant={variant} />
        </Counted>
      )}
      <div className="pg-frame" data-testid="frame">
        {on("halo") && (
          <Counted id="halo">
            {/* Inline callback, new each render: it must restart nothing. */}
            <Halo
              className="pg-fill"
              // biome-ignore lint/performance/noJsxPropsBind: new each render on purpose
              onError={(error) => recordComponentError("halo", error)}
            />
          </Counted>
        )}
        <div className="pg-container" data-testid="container" ref={container}>
          {showVideo && (
            <video
              autoPlay
              data-testid="video"
              loop
              muted
              playsInline
              ref={onVideo}
            />
          )}
        </div>
      </div>
      <section className="pg-card" data-testid="theme-card">
        {on("theme") ? (
          <Counted id="theme">
            <Theme className="pg-buttons">{buttons}</Theme>
          </Counted>
        ) : (
          <div className="pg-buttons">{buttons}</div>
        )}
      </section>
    </div>
  );
}
