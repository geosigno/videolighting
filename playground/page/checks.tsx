import {
  type ChangeEvent,
  Profiler,
  useCallback,
  useRef,
  useState,
} from "react";
import {
  type Colors,
  Halo,
  LightingProvider,
  useColors,
  useColorsEvent,
} from "../../src/react/index.js";
import { useGlow } from "../../src/react/use-glow.js";
import { ambient } from "../internal.js";
import { countEvent, countRender, recordComponentError } from "./handle.js";

/**
 * Test-only fixtures, in a collapsed section: nothing here holds a handle,
 * runs a timer or keeps per-frame state until a test turns it on.
 */

/** URL parameters only the tests use, read once at start (the page's URL rewrite drops them). */
export function readCheckParams(search: string): { lateVideoMs: number } {
  // `?lateVideo=1`: 500 ms; `?lateVideo=<ms>` (> 1): that delay; else none.
  const value = Number(new URLSearchParams(search).get("lateVideo"));
  if (!(value > 0)) {
    return { lateVideoMs: 0 };
  }
  return { lateVideoMs: value === 1 ? 500 : value };
}

const rgb = ([r, g, b]: readonly number[]) => `rgb(${r} ${g} ${b})`;

/** Renders on every colour update (`useColors`). */
function ColorsDemo() {
  const colors = useColors();
  return (
    <div
      className="pg-swatch"
      data-testid="colors-demo"
      style={{ background: rgb(colors.primary) }}
    />
  );
}

/** Never renders by itself: the callback paints the swatch directly. */
function EventDemo({ onColors }: { onColors: (colors: Colors) => void }) {
  const swatch = useRef<HTMLDivElement>(null);
  useColorsEvent(null, (colors) => {
    onColors(colors);
    if (swatch.current) {
      swatch.current.style.background = rgb(colors.primary);
    }
  });
  return <div className="pg-swatch" data-testid="event-demo" ref={swatch} />;
}

/** A Halo with no `video` prop under a provider without one: it finds the `<video>` among its children. */
function ChildCheck({ src }: { src: string }) {
  const [child, setChild] = useState<"none" | "a" | "b">("none");
  const add = useCallback(() => setChild("a"), []);
  const swap = useCallback(() => setChild("b"), []);
  return (
    <div data-testid="child-check">
      <button data-testid="check-child-add" onClick={add} type="button">
        add a video
      </button>
      <button data-testid="check-child-swap" onClick={swap} type="button">
        swap the video
      </button>
      <LightingProvider video={null}>
        <Halo className="pg-child-halo">
          {child !== "none" && (
            <video autoPlay key={child} loop muted playsInline src={src} />
          )}
        </Halo>
      </LightingProvider>
    </div>
  );
}

/**
 * `useGlow` called directly, with the video and the host both there at mount:
 * the one path where StrictMode really starts, stops and starts the effect again.
 */
function DirectCheck({
  host,
  video,
}: {
  host: HTMLElement;
  video: HTMLVideoElement;
}) {
  useGlow(ambient, { element: host, video });
  return null;
}

/** A Halo on the provider's video whose `onError` comes and goes: it must restart nothing. */
function OnErrorCheck() {
  const [withError, setWithError] = useState(false);
  const toggle = useCallback(() => setWithError((on) => !on), []);
  return (
    <div data-testid="onerror-check">
      <button
        aria-pressed={withError}
        data-testid="check-onerror-toggle"
        onClick={toggle}
        type="button"
      >
        onError
      </button>
      <Halo
        className="pg-swatch"
        onError={
          withError
            ? (error) => recordComponentError("onerror", error)
            : undefined
        }
      />
    </div>
  );
}

const RERENDERS = 30;

export function Checks({
  onRerender,
  rerenders,
  src,
  toggleAll,
  video,
}: {
  /** Renders the page again `RERENDERS` times, synchronously. */
  onRerender: (times: number) => void;
  rerenders: number;
  src: string;
  toggleAll: () => void;
  video: HTMLVideoElement | null;
}) {
  const [colors, setColors] = useState(false);
  const [event, setEvent] = useState(false);
  const [child, setChild] = useState(false);
  const [direct, setDirect] = useState(false);
  const [onError, setOnError] = useState(false);
  // Where the direct `useGlow` fixture applies: there before it mounts.
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const onColors = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => setColors(e.target.checked),
    []
  );
  const onEvent = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => setEvent(e.target.checked),
    []
  );
  const onChild = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => setChild(e.target.checked),
    []
  );
  const onDirect = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => setDirect(e.target.checked),
    []
  );
  const onOnError = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => setOnError(e.target.checked),
    []
  );
  const rerender = useCallback(() => onRerender(RERENDERS), [onRerender]);
  return (
    <details className="pg-checks" data-testid="checks">
      <summary>Checks (tests)</summary>
      <button data-testid="check-toggle-all" onClick={toggleAll} type="button">
        unmount / mount all effects
      </button>
      <button data-testid="check-rerender" onClick={rerender} type="button">
        render the page {RERENDERS} times
      </button>{" "}
      <span data-testid="check-rerender-count">{rerenders}</span>
      <label>
        <input
          checked={colors}
          data-testid="check-colors"
          onChange={onColors}
          type="checkbox"
        />{" "}
        useColors demo
      </label>
      <label>
        <input
          checked={event}
          data-testid="check-event"
          onChange={onEvent}
          type="checkbox"
        />{" "}
        useColorsEvent demo
      </label>
      <label>
        <input
          checked={child}
          data-testid="check-child"
          onChange={onChild}
          type="checkbox"
        />{" "}
        Halo on a child video
      </label>
      <label>
        <input
          checked={direct}
          data-testid="check-direct"
          onChange={onDirect}
          type="checkbox"
        />{" "}
        useGlow on the page's video
      </label>
      <label>
        <input
          checked={onError}
          data-testid="check-onerror"
          onChange={onOnError}
          type="checkbox"
        />{" "}
        Halo whose onError comes and goes
      </label>
      {colors && (
        <Profiler id="colors-demo" onRender={countRender}>
          <ColorsDemo />
        </Profiler>
      )}
      {event && (
        <Profiler id="event-demo" onRender={countRender}>
          {/* A new callback on every render of this section. */}
          {/* biome-ignore lint/performance/noJsxPropsBind: the new identity each render is what the test checks */}
          <EventDemo onColors={(value) => countEvent(value)} />
        </Profiler>
      )}
      {child && <ChildCheck src={src} />}
      <div className="pg-swatch" data-testid="direct-host" ref={setHost} />
      {direct && host && video && <DirectCheck host={host} video={video} />}
      {onError && <OnErrorCheck />}
    </details>
  );
}
